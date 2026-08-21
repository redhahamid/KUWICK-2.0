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
import { StaffNotificationService, notificationWhen } from './staff-notification.service';
import { mediaIdOf } from './media.service';
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
  patientRescheduleMode: string | null;
  patientCancelMode: string | null;
  patientChangeCutoffMinutes: number | null;
  confirmationMessage: string | null;
}

/** Phase 7 — what the patient may do, per action. */
export type PatientChangeMode = 'NOT_ALLOWED' | 'REQUEST_APPROVAL' | 'INSTANT';

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
    /** Phase 5 — the staff inbox fan-out for patient-initiated events. */
    private readonly staffNotifications: StaffNotificationService,
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
        patient_reschedule_mode AS "patientRescheduleMode",
        patient_cancel_mode AS "patientCancelMode",
        patient_change_cutoff_minutes AS "patientChangeCutoffMinutes",
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

  /**
   * Phase 6 — a stored `media://<id>` reference becomes the slug-scoped
   * public URL; an ordinary http(s) URL passes through untouched (the
   * Advanced fallback). Relative, so the web prefixes its own API base.
   */
  private publicMediaUrl(slug: string, ref: string | null): string | null {
    const id = mediaIdOf(ref);
    return id ? `/public/booking/${slug}/media/${id}` : ref;
  }

  /**
   * Phase 7 — the tri-state policy, with the frozen booleans as fallback for
   * pages that have never been saved under the new model: true was always
   * instant self-service, false was always "ring us".
   */
  private changeModeOf(page: ResolvedPage, action: 'reschedule' | 'cancel'): PatientChangeMode {
    const stored = action === 'reschedule' ? page.patientRescheduleMode : page.patientCancelMode;
    if (stored === 'NOT_ALLOWED' || stored === 'REQUEST_APPROVAL' || stored === 'INSTANT') {
      return stored;
    }
    const allowed = action === 'reschedule' ? page.allowPatientReschedule : page.allowPatientCancel;
    return allowed ? 'INSTANT' : 'NOT_ALLOWED';
  }

  private cutoffMinutesOf(page: ResolvedPage): number {
    return page.patientChangeCutoffMinutes ?? page.patientChangeCutoffHours * 60;
  }

  /** What the page shows before anybody has chosen anything. */
  async page(slug: string, serviceSlug?: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const timeZone = await this.availability.clinicTimeZone(page.clinicId);
      const services = await this.scoped.serviceCatalog.findMany({
        // A service is OFFERED to patients only when it can actually produce
        // a slot — and the first thing slot generation needs is an active
        // qualified provider. This is the same eligibility `providers()` and
        // the availability engine enforce one step later (the
        // doctor_service_qualifications junction), applied at the shop
        // window instead of after the patient has already picked: a
        // booking-enabled service nobody performs is a configuration in
        // progress, not a product. It reappears here the moment the owner
        // assigns a provider; the admin screens keep showing it throughout,
        // marked "setup incomplete", so it can be fixed. Direct service
        // links resolve from THIS list, so they go quiet at the same moment.
        where: {
          bookable: true,
          active: true,
          doctorServiceQualifications: { some: { staff: { active: true } } },
        },
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
          logoUrl: this.publicMediaUrl(page.slug, page.logoUrl),
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
          photoUrl: this.publicMediaUrl(page.slug, service.bookingPhotoUrl),
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
      // Only for services this page actually offers. Without this, anybody
      // holding a service's uuid — a retired or never-published one — could
      // list which doctors are mapped to it. Same 404 wording as everywhere
      // else on this surface: no oracle for which uuids exist.
      const service = await this.scoped.serviceCatalog.findFirst({
        where: { id: serviceId, bookable: true, active: true },
        select: { id: true },
      });
      if (!service) throw new NotFoundException('That service is not available for booking.');
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
        select: { id: true, fullName: true, calendarColor: true, professionalType: true },
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
    return this.inTenant(page, async () => {
      // Same gate as providers(): questions belong to a service the page
      // offers, not to any uuid somebody once saw.
      const service = await this.scoped.serviceCatalog.findFirst({
        where: { id: serviceId, bookable: true, active: true },
        select: { id: true },
      });
      if (!service) throw new NotFoundException('That service is not available for booking.');
      return this.scoped.bookingFormField.findMany({
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
      });
    });
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

    // Phase 5 — the clinic is told AFTER the booking's own transaction has
    // committed; an inbox write must never roll a patient's booking back.
    let freshAppointmentId: string | null = null;
    const confirmation = await this.tx(page, async (tx) => {
      if (dto.idempotencyKey) {
        const existing = await tx.appointment.findFirst({
          where: { tenantId: page.tenantId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return this.confirmationOf(page, existing);
      }
      freshAppointmentId = null; // set below once the row exists

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

      freshAppointmentId = appointment.id;
      return this.confirmationOf(page, appointment);
    });
    if (freshAppointmentId) {
      await this.notifyClinic(
        page,
        freshAppointmentId,
        // Auto-confirmed bookings land as work on the diary; requests land as
        // a decision on the desk. Two different sentences.
        (status) => (status === 'REQUESTED'
          ? { type: 'BOOKING_REQUEST' as const, title: 'Booking request (online)' }
          : { type: 'NEW_BOOKING' as const, title: 'New online booking' }),
      );
    }
    return confirmation;
  }

  /**
   * Phase 5 — re-read the names through the tenant-scoped client (RLS as
   * usual) and fan out to the branch desk and the assigned provider. No
   * actor: the patient is not a staff member and nobody is excluded.
   */
  private async notifyClinic(
    page: ResolvedPage,
    appointmentId: string,
    describe: (status: string) => { type: 'NEW_BOOKING' | 'BOOKING_REQUEST' | 'PATIENT_CANCELLED' | 'PATIENT_RESCHEDULED' | 'RESCHEDULE_REQUESTED' | 'CANCELLATION_REQUESTED'; title: string },
  ): Promise<void> {
    try {
    await this.inTenant(page, async () => {
      const row = await this.scoped.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          status: true,
          clinicId: true,
          staffId: true,
          scheduledStart: true,
          patient: { select: { name: true } },
          service: { select: { name: true } },
          staff: { select: { fullName: true } },
          clinic: { select: { timezone: true } },
        },
      });
      if (!row?.patient?.name || !row.service?.name || !row.staff?.fullName) return;
      const { type, title } = describe(row.status);
      await this.staffNotifications.notify({
        clinicId: row.clinicId,
        type,
        title,
        body: `${row.patient.name} · ${row.service.name} · ${notificationWhen(row.scheduledStart, row.clinic.timezone)} · ${row.staff.fullName}`,
        appointmentId,
        assignedStaffId: row.staffId,
        includeDesk: true,
      });
    });
    } catch {
      // Best-effort by contract: the patient's booking already exists, and
      // the inbox is a convenience that must never surface an error here.
    }
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
  /**
   * Phase 6 — the public image bytes. The slug resolves the tenant exactly
   * as every other public read does, then RLS scopes the asset lookup: an id
   * from another tenant's page finds nothing here. Only booking-surface
   * kinds are served — the table holds nothing else, and the kind check
   * keeps that a contract rather than an accident.
   */
  async mediaBySlug(slug: string, id: string) {
    const page = await this.resolvePage(slug);
    return this.inTenant(page, async () => {
      const row = await this.scoped.mediaAsset.findUnique({
        where: { id },
        select: { kind: true, contentType: true, data: true },
      });
      if (!row || !['SERVICE_PHOTO', 'CLINIC_LOGO'].includes(row.kind)) {
        throw new NotFoundException('Image not found');
      }
      return { contentType: row.contentType, data: row.data };
    });
  }

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
        appointment.scheduledStart.getTime() - this.cutoffMinutesOf(page) * 60 * 1000,
      );
      const changeable =
        (appointment.status === AppointmentStatus.CONFIRMED ||
          appointment.status === AppointmentStatus.REQUESTED) &&
        Date.now() < cutoff.getTime();

      // Phase 7 — the page tells the patient where their request stands.
      const requests = await this.scoped.appointmentChangeRequest.findMany({
        where: { appointmentId: appointment.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      return {
        clinic: { displayName: page.displayName, logoUrl: this.publicMediaUrl(page.slug, page.logoUrl), timeZone },
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
          reschedule: this.changeModeOf(page, 'reschedule') === 'INSTANT' && changeable,
          cancel: this.changeModeOf(page, 'cancel') === 'INSTANT' && changeable,
        },
        // Phase 7 — the policy said in full, so the page can offer the right
        // verb: change it, request it, or ring us.
        policy: {
          reschedule: this.changeModeOf(page, 'reschedule'),
          cancel: this.changeModeOf(page, 'cancel'),
          cutoffMinutes: this.cutoffMinutesOf(page),
          changeable,
        },
        pendingRequests: requests
          .filter((row) => row.status === 'PENDING')
          .map((row) => ({
            id: row.id,
            type: row.type,
            reason: row.reason,
            requestedStart: row.requestedStart,
            requestedEnd: row.requestedEnd,
            createdAt: row.createdAt,
          })),
        lastDecision: (() => {
          const decided = requests.find(
            (row) => row.status === 'APPROVED' || row.status === 'DECLINED',
          );
          return decided
            ? {
                type: decided.type,
                status: decided.status,
                decisionNote: decided.decisionNote,
                decidedAt: decided.decidedAt,
              }
            : null;
        })(),
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

      // THE SAME LOCKS. book() and the staff paths serialise racers for a
      // slot with two sorted advisory locks before validating; this path
      // must too, or two patients moving onto the last shared-capacity slot
      // both pass the check and the clinic is overbooked past its room
      // limit — the EXCLUDE constraint only backstops same-provider overlap.
      const timeZone = await this.availability.clinicTimeZone(appointment.clinicId);
      const dateKey = clinicDateKey(start, timeZone);
      for (const key of [
        `appointment:${appointment.clinicId}:staff:${appointment.staffId}:${dateKey}`,
        `appointment:${appointment.clinicId}:service:${appointment.serviceId}:${dateKey}`,
      ].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      }

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

      return { manageToken: replacement.manageToken, replacementId: replacement.id };
    }).then(async (result: { manageToken: string | null; replacementId: string }) => {
      await this.notifyClinic(page, result.replacementId, () => ({
        type: 'PATIENT_RESCHEDULED' as const,
        title: 'Rescheduled by the patient',
      }));
      return { manageToken: result.manageToken };
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
      return { cancelled: true, appointmentId: appointment.id };
    }).then(async (result: { cancelled: boolean; appointmentId: string }) => {
      await this.notifyClinic(page, result.appointmentId, () => ({
        type: 'PATIENT_CANCELLED' as const,
        title: 'Cancelled by the patient',
      }));
      return { cancelled: result.cancelled };
    });
  }

  /**
   * PHASE 7 — the patient ASKS; nothing about the appointment moves.
   *
   * The request records what they want (a new time, or out entirely) and why,
   * in their own words. The original booking keeps its slot and its status —
   * only a staff decision (appointment-change-request.service) mutates
   * anything, back through the same engine-checked paths as ever. A newer
   * request of the same type supersedes the older one: the clinic answers the
   * patient's CURRENT wish, not a stack of drafts.
   */
  async requestChangeByToken(
    slug: string,
    token: string,
    dto: {
      type: 'RESCHEDULE' | 'CANCELLATION';
      reason: string;
      scheduledStart?: string;
      scheduledEnd?: string;
    },
  ) {
    const page = await this.resolvePage(slug);
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Please tell the clinic why, so they can decide.');
    }
    let requestedStart: Date | null = null;
    let requestedEnd: Date | null = null;
    if (dto.type === 'RESCHEDULE') {
      if (!dto.scheduledStart || !dto.scheduledEnd) {
        throw new BadRequestException('Pick the time you would like instead.');
      }
      requestedStart = new Date(dto.scheduledStart);
      requestedEnd = new Date(dto.scheduledEnd);
      if (!(requestedEnd > requestedStart)) {
        throw new BadRequestException('That time ends before it starts.');
      }
    }

    const created = await this.tx(page, async (tx) => {
      const appointment = await tx.appointment.findFirst({ where: { manageToken: token } });
      if (!appointment) throw new NotFoundException('This booking link is not valid.');
      this.assertPatientMayChange(
        page,
        appointment,
        dto.type === 'CANCELLATION' ? 'cancel' : 'reschedule',
        'REQUEST_APPROVAL',
      );

      if (dto.type === 'RESCHEDULE' && requestedStart && requestedEnd) {
        // An early, honest answer — the same engine the desk uses. NOT a
        // reservation: the slot can still be taken before the clinic
        // approves, and approval re-checks (7E).
        const check = await this.bookingValidator.check({
          clinicId: appointment.clinicId,
          staffId: appointment.staffId,
          serviceId: appointment.serviceId,
          scheduledStart: requestedStart,
          scheduledEnd: requestedEnd,
          excludeAppointmentId: appointment.id,
        });
        if (!check.ok) {
          throw new BadRequestException(check.message);
        }
      }

      // The patient's CURRENT wish replaces their earlier one.
      await tx.appointmentChangeRequest.updateMany({
        where: { appointmentId: appointment.id, type: dto.type, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
      const request = await tx.appointmentChangeRequest.create({
        data: {
          tenantId: page.tenantId,
          clinicId: appointment.clinicId,
          appointmentId: appointment.id,
          type: dto.type,
          reason,
          requestedStart,
          requestedEnd,
        },
      });
      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.CHANGE_REQUESTED,
        reason,
        after: {
          changeRequestId: request.id,
          type: dto.type,
          ...(requestedStart ? { requestedStart, requestedEnd } : {}),
        },
        actorLabel: 'Patient (manage booking)',
      });
      return { request, appointmentId: appointment.id };
    });

    await this.notifyClinic(page, created.appointmentId, () => ({
      type: dto.type === 'CANCELLATION' ? 'CANCELLATION_REQUESTED' : 'RESCHEDULE_REQUESTED',
      title: dto.type === 'CANCELLATION' ? 'Cancellation request' : 'Reschedule request',
    }));

    return { requested: true, requestId: created.request.id };
  }

  /**
   * Phase 7 — one guard, two strengths. `requiredMode` says what the caller
   * is trying to do: the INSTANT endpoints demand INSTANT policy (a clinic
   * on approval-mode must never be mutated directly from a patient link),
   * the request endpoints demand REQUEST_APPROVAL. Status and cutoff apply
   * to both — a request past the cutoff is the same phone call.
   */
  private assertPatientMayChange(
    page: ResolvedPage,
    appointment: { status: AppointmentStatus; scheduledStart: Date },
    action: 'reschedule' | 'cancel',
    requiredMode: PatientChangeMode = 'INSTANT',
  ): void {
    const mode = this.changeModeOf(page, action);
    if (mode === 'NOT_ALLOWED') {
      throw new ForbiddenException(
        `This clinic asks you to ring them to ${action === 'cancel' ? 'cancel' : 'change'} an appointment.`,
      );
    }
    if (mode !== requiredMode) {
      throw new ForbiddenException(
        mode === 'REQUEST_APPROVAL'
          ? 'This clinic reviews changes first — please send a request instead.'
          : 'This clinic lets you change the booking directly — no request is needed.',
      );
    }
    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.REQUESTED
    ) {
      throw new BadRequestException('This appointment can no longer be changed online.');
    }
    const cutoffMinutes = this.cutoffMinutesOf(page);
    const cutoff = appointment.scheduledStart.getTime() - cutoffMinutes * 60 * 1000;
    if (Date.now() >= cutoff) {
      throw new BadRequestException(
        `Changes have to be made at least ${describeCutoff(cutoffMinutes)} before the appointment. Please ring the clinic.`,
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

/** "4 hours" / "90 minutes" / "2 days" — the cutoff in the patient's units. */
function describeCutoff(minutes: number): string {
  if (minutes % (24 * 60) === 0 && minutes > 0) {
    const days = minutes / (24 * 60);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0 && minutes > 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}
