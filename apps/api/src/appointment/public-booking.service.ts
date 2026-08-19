import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentCancellationReason,
  AppointmentEventType,
  AppointmentSource,
  AppointmentStatus,
  PatientIdentifierType,
  PatientMatchConfidence,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import { ClinicalTx } from '../clinical/clinical-actor';
import { appointmentSnapshot, recordAppointmentEvent } from './appointment-event.service';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';
import { SlotAvailabilityService } from './slot-availability.service';
import { PublicBookDto, PublicCancelDto, PublicRescheduleDto } from './dto/public-booking.dto';
import { clinicDateKey, parseDateOnly } from './time.util';

interface ResolvedPage {
  tenantId: string;
  clinicId: string;
  pageId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  language: string;
  introText: string | null;
  requirePhone: boolean;
  requireEmail: boolean;
  requireNric: boolean;
  showReasonField: boolean;
  allowPatientReschedule: boolean;
  allowPatientCancel: boolean;
  patientChangeCutoffHours: number;
  confirmationMessage: string | null;
}

/**
 * THE PUBLIC BOOKING PAGE — unauthenticated, and NOT unscoped.
 *
 * A patient opening /hijraa-bangi has no session and no tenant, so the first
 * question ("whose clinic is this?") cannot be asked through row-level
 * security — there is nothing yet to scope by. Exactly one table answers it:
 * `clinic_booking_pages` carries a second policy allowing ACTIVE rows to be
 * read without tenant context, because a published booking link is public by
 * definition and that table holds no patient data. See the migration.
 *
 * From that answer onwards, everything runs under normal tenant scoping: the
 * resolved tenant is pushed into the request context and every subsequent read
 * and write goes through RLS as usual.
 *
 * THREE RULES THIS PATH KEEPS:
 *
 *  1. IT USES THE SAME ENGINE. Availability, validation and the slot grid come
 *     from `SlotAvailabilityService`. A public page that computed its own
 *     availability would eventually offer what the front desk refuses.
 *
 *  2. IT NEVER CONFIRMS WHO EXISTS. "This IC is already registered" is a
 *     patient-enumeration oracle: anybody could test a list of ICs against a
 *     clinic's records. Matching happens server-side and the response is the
 *     same either way.
 *
 *  3. IT REACHES NO OTHER PATIENT'S DATA. The manage-booking link carries a
 *     32-byte random token that identifies ONE appointment, and every read
 *     through it is filtered by that token.
 */
@Injectable()
export class PublicBookingService {
  constructor(
    /**
     * The RAW client, used for exactly two things: the slug lookup that has
     * no tenant to be scoped by yet, and opening the transactions the booking
     * writes run inside.
     */
    private readonly prisma: PrismaService,
    /**
     * Everything else. The tenant-scoped client sets `app.tenant_id` in the
     * same transaction as each query, reading it from the async context that
     * `inTenant` establishes — so every read on this path goes through
     * row-level security exactly as a staff request does.
     *
     * Using the raw client here instead was a real defect and not a
     * theoretical one: with no `app.tenant_id` set, `tenant_isolation`
     * evaluates to NULL and every row is filtered out. The public page
     * rendered a clinic with a working slug, a name, an intro — and ZERO
     * services, which reads as "this clinic offers nothing" rather than as a
     * permission failure.
     */
    @Inject(TENANT_SCOPED_PRISMA) private readonly scoped: TenantScopedPrismaClient,
    private readonly availability: SlotAvailabilityService,
    private readonly bookingValidator: AppointmentBookingValidator,
  ) {}

  /**
   * The bootstrap: slug → tenant. The one query in this system that runs
   * without tenant context, against the one table that permits it.
   */
  private async resolvePage(slug: string): Promise<ResolvedPage> {
    const rows = await this.prisma.$queryRaw<ResolvedPage[]>`
      SELECT
        tenant_id   AS "tenantId",
        clinic_id   AS "clinicId",
        id          AS "pageId",
        slug,
        display_name AS "displayName",
        logo_url     AS "logoUrl",
        language,
        intro_text   AS "introText",
        require_phone AS "requirePhone",
        require_email AS "requireEmail",
        require_nric  AS "requireNric",
        show_reason_field AS "showReasonField",
        allow_patient_reschedule AS "allowPatientReschedule",
        allow_patient_cancel AS "allowPatientCancel",
        patient_change_cutoff_hours AS "patientChangeCutoffHours",
        confirmation_message AS "confirmationMessage"
      FROM clinic_booking_pages
      WHERE slug = ${slug} AND active = true
      LIMIT 1`;
    const page = rows[0];
    if (!page) {
      // The same answer whether the slug never existed or the clinic
      // unpublished it. A different message would let anybody enumerate which
      // clinics use Kuwick.
      throw new NotFoundException('This booking page is not available.');
    }
    return page;
  }

  /** Runs `fn` with the resolved tenant in context, so RLS applies normally. */
  private inTenant<T>(page: ResolvedPage, fn: () => Promise<T>): Promise<T> {
    return tenantContextStorage.run(
      { tenantId: page.tenantId, staffId: undefined, userId: undefined } as never,
      fn,
    );
  }

  private tx<T>(page: ResolvedPage, fn: (tx: ClinicalTx) => Promise<T>): Promise<T> {
    return this.inTenant(page, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${page.tenantId}, true)`;
        return fn(tx);
      }),
    );
  }

  /** What the page shows before anybody has chosen anything. */
  async page(slug: string, serviceSlug?: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const timeZone = await this.availability.clinicTimeZone(page.clinicId);
      const services = await this.scoped.serviceCatalog.findMany({
        where: { bookable: true, active: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          category: true,
          bookingDescription: true,
          bookingPhotoUrl: true,
          durationMinutesDefault: true,
          price: true,
          priceDisplay: true,
          bookingFee: true,
          bookingPaymentRule: true,
          depositAmount: true,
          requiresApproval: true,
          preInstructions: true,
          bookingSlug: true,
        },
      });

      const selected = serviceSlug
        ? services.find((service) => service.bookingSlug === serviceSlug)
        : undefined;
      if (serviceSlug && !selected) {
        throw new NotFoundException('This booking page is not available.');
      }

      return {
        clinic: {
          slug: page.slug,
          displayName: page.displayName,
          logoUrl: page.logoUrl,
          language: page.language,
          introText: page.introText,
          timeZone,
        },
        form: {
          requirePhone: page.requirePhone,
          requireEmail: page.requireEmail,
          requireNric: page.requireNric,
          showReasonField: page.showReasonField,
        },
        selectedServiceId: selected?.id ?? null,
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          category: service.category,
          description: service.bookingDescription,
          photoUrl: service.bookingPhotoUrl,
          durationMinutes: service.durationMinutesDefault,
          // §22 — the page shows what the clinic chose to show. HIDDEN means
          // HIDDEN: the number is not sent to the browser at all, because a
          // price "hidden" only by CSS is a price anybody can read.
          price:
            service.priceDisplay === 'HIDDEN'
              ? null
              : { display: service.priceDisplay, amount: String(service.price) },
          bookingFee: String(service.bookingFee),
          paymentRule: service.bookingPaymentRule,
          depositAmount: String(service.depositAmount),
          requiresApproval: service.requiresApproval,
          preInstructions: service.preInstructions,
          slug: service.bookingSlug,
        })),
      };
    });
  }

  /** The providers a patient may pick for a service, plus "any available". */
  async providers(slug: string, serviceId: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const qualified = await this.scoped.doctorServiceQualification.findMany({
        where: { serviceId },
        select: { staffId: true },
      });
      if (qualified.length === 0) return [];
      const staff = await this.scoped.staff.findMany({
        where: {
          id: { in: qualified.map((row) => row.staffId) },
          active: true,
          clinicId: page.clinicId,
        },
        select: { id: true, fullName: true, calendarColor: true },
        orderBy: { fullName: 'asc' },
      });
      return staff;
    });
  }

  /**
   * The slot grid, from the SAME engine the front desk uses.
   *
   * `staffId` absent means "any available provider": every qualified provider
   * is asked, their answers are merged, and each offered slot still names the
   * real provider who would take it. A confirmed appointment is never attached
   * to a fictional "Any Provider" resource.
   */
  async availabilityFor(slug: string, params: { serviceId: string; staffId?: string; date: string }) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const date = parseDateOnly(params.date);
      const timeZone = await this.availability.clinicTimeZone(page.clinicId);

      if (params.staffId) {
        const result = await this.availability.findAvailability({
          staffId: params.staffId,
          clinicId: page.clinicId,
          serviceId: params.serviceId,
          date,
        });
        return {
          timeZone,
          reason: result.reason,
          slots: result.slots.map((slot) => ({ ...slot, staffId: params.staffId })),
        };
      }

      const answers = await this.availability.findAvailabilityAcrossProviders({
        clinicId: page.clinicId,
        serviceId: params.serviceId,
        date,
      });

      const merged = new Map<number, { start: Date; end: Date; staffId: string }>();
      for (const answer of answers) {
        for (const slot of answer.slots) {
          // First provider to offer a start time keeps it. The list is
          // deterministically ordered, so the same patient reloading the page
          // is offered the same doctor rather than a different one each time.
          if (!merged.has(slot.start.getTime())) {
            merged.set(slot.start.getTime(), { ...slot, staffId: answer.staffId });
          }
        }
      }
      const slots = [...merged.values()].sort((a, b) => a.start.getTime() - b.start.getTime());

      return {
        timeZone,
        // Only report a reason when NOBODY could offer anything. "Dr A is on
        // leave" is not why the day is empty if Dr B is free.
        reason: slots.length > 0 ? null : (answers.find((a) => a.reason)?.reason ?? 'NOT_ROSTERED'),
        slots,
      };
    });
  }

  /** The questions this service asks, clinic-wide ones included. */
  async formFields(slug: string, serviceId: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, () =>
      this.scoped.bookingFormField.findMany({
        where: {
          active: true,
          OR: [{ serviceId }, { serviceId: null, clinicId: page.clinicId }],
        },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          label: true,
          helpText: true,
          fieldType: true,
          required: true,
          options: true,
          sortOrder: true,
        },
      }),
    );
  }

  async book(slug: string, dto: PublicBookDto) {
    const page = await this.resolvePage(slug);
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    if (!(scheduledEnd > scheduledStart)) {
      throw new BadRequestException('That appointment ends before it starts.');
    }
    if (page.requirePhone && !dto.phone?.trim()) {
      throw new BadRequestException('A phone number is needed so the clinic can reach you.');
    }
    if (page.requireEmail && !dto.email?.trim()) {
      throw new BadRequestException('An email address is needed to send your confirmation.');
    }
    if (page.requireNric && !dto.identifier?.trim()) {
      throw new BadRequestException('An IC or passport number is needed.');
    }

    return this.tx(page, async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.appointment.findFirst({
          where: { tenantId: page.tenantId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return this.confirmationOf(page, existing);
      }

      // The same advisory locks the staff path takes, for the same reason: a
      // patient on the public page and a receptionist at the counter are two
      // racers for one slot.
      const timeZone = await this.availability.clinicTimeZone(page.clinicId);
      const dateKey = clinicDateKey(scheduledStart, timeZone);
      const staffId = dto.staffId ?? (await this.firstAvailableProvider(page, dto, scheduledStart));
      for (const key of [
        `appointment:${page.clinicId}:staff:${staffId}:${dateKey}`,
        `appointment:${page.clinicId}:service:${dto.serviceId}:${dateKey}`,
      ].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }

      const check = await this.bookingValidator.check({
        clinicId: page.clinicId,
        staffId,
        serviceId: dto.serviceId,
        scheduledStart,
        scheduledEnd,
      });
      if (!check.ok) {
        // NO OVERRIDE ON THIS PATH, ever. An override is a staff act with a
        // permission and a named reason behind it; a public page has neither.
        throw new BadRequestException(check.message);
      }

      const service = await tx.serviceCatalog.findUnique({
        where: { id: dto.serviceId },
        select: {
          bookable: true,
          active: true,
          requiresApproval: true,
          bookingFee: true,
          bookingPaymentRule: true,
          depositAmount: true,
        },
      });
      if (!service?.bookable || !service.active) {
        throw new NotFoundException('That service is not available for booking.');
      }

      const match = await this.matchPatient(tx, page, dto);

      const appointment = await tx.appointment.create({
        data: {
          tenantId: page.tenantId,
          clinicId: page.clinicId,
          patientId: match.patientId,
          staffId,
          serviceId: dto.serviceId,
          source: AppointmentSource.ONLINE_PORTAL,
          sourceDetail: dto.sourceDetail?.trim() || null,
          // Auto-confirm unless the service asks a human to look. §30.
          status: service.requiresApproval
            ? AppointmentStatus.REQUESTED
            : AppointmentStatus.CONFIRMED,
          scheduledStart,
          scheduledEnd,
          patientNote: dto.reason?.trim() || null,
          bookingFeeAmount: service.bookingFee,
          paymentStatus:
            service.bookingPaymentRule === 'NONE' ? 'NOT_REQUIRED' : 'PENDING',
          patientMatch: match.confidence,
          idempotencyKey: dto.idempotencyKey ?? null,
          manageToken: randomBytes(32).toString('base64url'),
        },
      });

      // §34 — the answers are SNAPSHOTTED with the question as it was asked.
      if (dto.answers?.length) {
        const fields = await tx.bookingFormField.findMany({
          where: { id: { in: dto.answers.map((answer) => answer.fieldId) } },
        });
        const byId = new Map(fields.map((field) => [field.id, field]));
        const rows = dto.answers
          .map((answer) => {
            const field = byId.get(answer.fieldId);
            if (!field) return null;
            return {
              tenantId: page.tenantId,
              appointmentId: appointment.id,
              fieldId: field.id,
              label: field.label,
              fieldType: field.fieldType,
              answer: answer.answer?.trim() || null,
              sortOrder: field.sortOrder,
            };
          })
          .filter(Boolean);
        if (rows.length > 0) {
          await tx.appointmentFormAnswer.createMany({ data: rows as never });
        }
      }

      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.CREATED,
        toStatus: appointment.status,
        after: appointmentSnapshot(appointment),
        source: AppointmentSource.ONLINE_PORTAL,
        // No staff id, and the label says so rather than being blank. A blank
        // actor reads as "lost", which is a different thing from "the patient".
        actorLabel: 'Patient (online booking)',
      });
      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.PATIENT_LINKED,
        after: { confidence: match.confidence },
        actorLabel: 'Patient (online booking)',
      });

      return this.confirmationOf(page, appointment);
    });
  }

  /**
   * §33 — PATIENT IDENTITY MATCHING, and the enumeration oracle it must not be.
   *
   * Three outcomes, and the patient sees the same confirmation for all three:
   *
   *   MATCHED_IDENTIFIER — the IC or passport matches an existing record
   *       exactly. This is the strong one: a Malaysian IC identifies a person.
   *   MATCHED_PHONE_AND_NAME — no identifier given, but the phone AND the name
   *       both match. Deliberately BOTH: a phone alone is shared by a family,
   *       and matching on it would attach a daughter's booking to her mother's
   *       record.
   *   CREATED_NEW — nothing matched confidently, so a NEW record is created and
   *       the appointment is flagged for staff reconciliation. Merging two
   *       people is a clinical safety incident; creating a duplicate is an
   *       afternoon's tidying. The system chooses the tidying.
   *
   * What it never does is TELL anybody which happened. No "this IC is already
   * registered", no different error, no different timing that matters.
   */
  private async matchPatient(
    tx: ClinicalTx,
    page: ResolvedPage,
    dto: PublicBookDto,
  ): Promise<{ patientId: string; confidence: PatientMatchConfidence }> {
    const name = dto.name.trim();
    const phone = dto.phone?.trim() || null;
    const identifier = dto.identifier?.trim().toUpperCase().replace(/[\s-]/g, '') || null;

    if (identifier) {
      const byIdentifier = await tx.patient.findFirst({
        where: { identifierValue: identifier, deletedAt: null },
        select: { id: true },
      });
      if (byIdentifier) {
        return { patientId: byIdentifier.id, confidence: 'MATCHED_IDENTIFIER' };
      }
    }

    if (!identifier && phone) {
      const candidates = await tx.patient.findMany({
        where: { phone, deletedAt: null },
        select: { id: true, name: true },
        take: 5,
      });
      const exact = candidates.filter(
        (candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase(),
      );
      // Exactly ONE match. Two people on one phone with the same name is a
      // situation for a human, not for a guess.
      if (exact.length === 1) {
        return { patientId: exact[0].id, confidence: 'MATCHED_PHONE_AND_NAME' };
      }
    }

    // A new record. `identifierValue` must be unique per tenant and a patient
    // who gave no IC still needs one, so a provisional value is generated and
    // marked as such — a receptionist reconciling this will see immediately
    // that no document was ever presented.
    const provisional = identifier ?? `PENDING-${randomBytes(6).toString('hex').toUpperCase()}`;
    const created = await tx.patient.create({
      data: {
        tenantId: page.tenantId,
        identifierType: identifier ? PatientIdentifierType.NRIC : PatientIdentifierType.PASSPORT,
        identifierValue: provisional,
        name,
        phone,
      },
      select: { id: true },
    });
    return {
      patientId: created.id,
      confidence: identifier ? 'CREATED_NEW' : 'NEEDS_REVIEW',
    };
  }

  private async firstAvailableProvider(
    page: ResolvedPage,
    dto: PublicBookDto,
    start: Date,
  ): Promise<string> {
    const timeZone = await this.availability.clinicTimeZone(page.clinicId);
    const date = parseDateOnly(clinicDateKey(start, timeZone));
    const answers = await this.availability.findAvailabilityAcrossProviders({
      clinicId: page.clinicId,
      serviceId: dto.serviceId,
      date,
    });
    const match = answers.find((answer) =>
      answer.slots.some((slot) => slot.start.getTime() === start.getTime()),
    );
    if (!match) {
      throw new BadRequestException('That time is no longer available. Please pick another.');
    }
    return match.staffId;
  }

  /**
   * §42 — MANAGE MY BOOKING.
   *
   * THE SLUG IS IN THE URL AND IT IS NOT DECORATION. Appointments are behind
   * row-level security like every other table, so a bare token lookup with no
   * tenant context returns NOTHING — `tenant_isolation` evaluates to NULL and
   * filters the row out. The alternatives were a second RLS policy on
   * `appointments` (which would have to permit reading any row carrying a
   * token) or a lookup table mapping tokens to tenants, which is a second
   * store of a fact. The slug already identifies the clinic, it is already in
   * the link the patient was sent, and `clinic_booking_pages` is already
   * readable without a tenant — so the bootstrap costs nothing and adds no
   * policy.
   *
   * The token then identifies ONE appointment, under ordinary RLS. Everything
   * returned is about that appointment and the patient who made it; no query
   * here can reach a second patient, because the token is the primary filter
   * rather than a check applied after a broader read.
   */
  async manage(slug: string, token: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const appointment = await this.scoped.appointment.findFirst({
        where: { manageToken: token },
        select: {
          id: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          patientNote: true,
          paymentStatus: true,
          bookingFeeAmount: true,
          serviceId: true,
          // The PATIENT'S OWN name only. Nothing about anybody else, and no
          // clinical record: this link is shared by SMS and forwarded.
          patient: { select: { name: true } },
          staff: { select: { fullName: true } },
          service: {
            select: { name: true, durationMinutesDefault: true, preInstructions: true, postInstructions: true },
          },
          formAnswers: { orderBy: { sortOrder: 'asc' }, select: { label: true, answer: true } },
        },
      });
      if (!appointment) throw new NotFoundException('This booking link is not valid.');

      const timeZone = await this.availability.clinicTimeZone(page.clinicId);
      const cutoff = new Date(
        appointment.scheduledStart.getTime() - page.patientChangeCutoffHours * 3600 * 1000,
      );
      const changeable =
        (appointment.status === AppointmentStatus.CONFIRMED ||
          appointment.status === AppointmentStatus.REQUESTED) &&
        Date.now() < cutoff.getTime();

      return {
        clinic: { displayName: page.displayName, logoUrl: page.logoUrl, timeZone },
        appointment: {
          status: appointment.status,
          scheduledStart: appointment.scheduledStart,
          scheduledEnd: appointment.scheduledEnd,
          serviceName: appointment.service.name,
          providerName: appointment.staff.fullName,
          patientName: appointment.patient.name,
          note: appointment.patientNote,
          paymentStatus: appointment.paymentStatus,
          bookingFeeAmount: String(appointment.bookingFeeAmount),
          preInstructions: appointment.service.preInstructions,
          postInstructions: appointment.service.postInstructions,
          answers: appointment.formAnswers,
        },
        can: {
          reschedule: page.allowPatientReschedule && changeable,
          cancel: page.allowPatientCancel && changeable,
        },
        cutoffHours: page.patientChangeCutoffHours,
        confirmationMessage: page.confirmationMessage,
      };
    });
  }

  /**
   * The slot grid for a patient moving their OWN appointment.
   *
   * Same engine, same service, same provider, and the appointment excludes
   * itself from its own overlap check — without that, the 09:00 booking being
   * moved is the thing refusing the move.
   */
  async availabilityForToken(slug: string, token: string, dateKey: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const appointment = await this.scoped.appointment.findFirst({
        where: { manageToken: token },
        select: {
          id: true,
          clinicId: true,
          staffId: true,
          serviceId: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      });
      if (!appointment) throw new NotFoundException('This booking link is not valid.');

      const timeZone = await this.availability.clinicTimeZone(appointment.clinicId);
      const result = await this.availability.findAvailability({
        staffId: appointment.staffId,
        clinicId: appointment.clinicId,
        serviceId: appointment.serviceId,
        date: parseDateOnly(dateKey),
        excludeAppointmentId: appointment.id,
      });
      return {
        timeZone,
        reason: result.reason,
        slots: result.slots.map((slot) => ({ ...slot, staffId: appointment.staffId })),
      };
    });
  }

  async rescheduleByToken(slug: string, token: string, dto: PublicRescheduleDto) {
    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    if (!(end > start)) throw new BadRequestException('That appointment ends before it starts.');

    const page = await this.resolvePage(slug);
    return this.tx(page, async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: { manageToken: token } });
      if (!appointment) throw new NotFoundException('This booking link is not valid.');
      this.assertPatientMayChange(page, appointment, 'reschedule');

      // THE SAME ENGINE. A patient moving their own appointment is checked
      // against exactly what the front desk is checked against.
      const check = await this.bookingValidator.check({
        clinicId: appointment.clinicId,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
        scheduledStart: start,
        scheduledEnd: end,
        excludeAppointmentId: appointment.id,
      });
      if (!check.ok) throw new BadRequestException(check.message);

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: AppointmentCancellationReason.RESCHEDULED,
          cancelReason: 'Moved by the patient',
          cancelledAt: new Date(),
        },
      });
      const replacement = await tx.appointment.create({
        data: {
          tenantId: appointment.tenantId,
          clinicId: appointment.clinicId,
          patientId: appointment.patientId,
          staffId: appointment.staffId,
          serviceId: appointment.serviceId,
          source: appointment.source,
          sourceDetail: appointment.sourceDetail,
          status: AppointmentStatus.CONFIRMED,
          scheduledStart: start,
          scheduledEnd: end,
          patientNote: appointment.patientNote,
          bookingFeeAmount: appointment.bookingFeeAmount,
          bookingFeePaidAt: appointment.bookingFeePaidAt,
          paymentStatus: appointment.paymentStatus,
          depositInvoiceId: appointment.depositInvoiceId,
          patientMatch: appointment.patientMatch,
          rescheduledFromId: appointment.id,
          // A NEW token. The old link stops working, which is what a patient
          // expects after they have moved their appointment, and it means a
          // forwarded link cannot be used to move it again.
          manageToken: randomBytes(32).toString('base64url'),
        },
      });
      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.RESCHEDULED,
        fromStatus: appointment.status,
        toStatus: AppointmentStatus.CANCELLED,
        before: appointmentSnapshot(appointment),
        after: { ...(appointmentSnapshot(replacement) as object), replacementAppointmentId: replacement.id },
        reason: 'Moved by the patient',
        actorLabel: 'Patient (manage booking)',
      });
      await recordAppointmentEvent(tx, {
        appointmentId: replacement.id,
        eventType: AppointmentEventType.CREATED,
        toStatus: AppointmentStatus.CONFIRMED,
        before: { previousAppointmentId: appointment.id },
        after: appointmentSnapshot(replacement),
        actorLabel: 'Patient (manage booking)',
      });

      return { manageToken: replacement.manageToken };
    });
  }

  async cancelByToken(slug: string, token: string, dto: PublicCancelDto) {
    const page = await this.resolvePage(slug);
    return this.tx(page, async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: { manageToken: token } });
      if (!appointment) throw new NotFoundException('This booking link is not valid.');
      this.assertPatientMayChange(page, appointment, 'cancel');

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: AppointmentCancellationReason.PATIENT_REQUEST,
          cancelReason: dto.reason?.trim() || 'Cancelled by the patient',
          cancelledAt: new Date(),
        },
      });
      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.CANCELLED,
        fromStatus: appointment.status,
        toStatus: AppointmentStatus.CANCELLED,
        reason: dto.reason?.trim() || 'Cancelled by the patient',
        actorLabel: 'Patient (manage booking)',
      });
      return { cancelled: true };
    });
  }

  private assertPatientMayChange(
    page: ResolvedPage,
    appointment: { status: AppointmentStatus; scheduledStart: Date },
    action: 'reschedule' | 'cancel',
  ): void {
    const allowed = action === 'reschedule' ? page.allowPatientReschedule : page.allowPatientCancel;
    if (!allowed) {
      throw new ForbiddenException(
        `This clinic asks you to ring them to ${action === 'cancel' ? 'cancel' : 'change'} an appointment.`,
      );
    }
    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.REQUESTED
    ) {
      throw new BadRequestException('This appointment can no longer be changed online.');
    }
    const cutoff =
      appointment.scheduledStart.getTime() - page.patientChangeCutoffHours * 3600 * 1000;
    if (Date.now() >= cutoff) {
      throw new BadRequestException(
        `Changes have to be made at least ${page.patientChangeCutoffHours} hours before the appointment. Please ring the clinic.`,
      );
    }
  }

  private confirmationOf(page: ResolvedPage, appointment: {
    id: string;
    status: AppointmentStatus;
    scheduledStart: Date;
    scheduledEnd: Date;
    manageToken: string | null;
  }) {
    return {
      status: appointment.status,
      scheduledStart: appointment.scheduledStart,
      scheduledEnd: appointment.scheduledEnd,
      manageToken: appointment.manageToken,
      // The path the WEB APP routes on, so a confirmation can link straight to
      // it without the browser having to rebuild it. `/book` is the public
      // prefix; the slug is what lets the server find the tenant again.
      manageUrl: `/book/${page.slug}/manage/${appointment.manageToken}`,
      message:
        page.confirmationMessage ??
        (appointment.status === AppointmentStatus.REQUESTED
          ? 'Thank you. The clinic will confirm your appointment shortly.'
          : 'Your appointment is confirmed. We look forward to seeing you.'),
    };
  }
}
