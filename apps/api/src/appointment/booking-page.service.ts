import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { UpsertBookingPageDto, UpsertReminderRulesDto } from './dto/appointment-extras.dto';

/**
 * THE PUBLIC BOOKING PAGE'S SETTINGS — one place, not four technical screens.
 *
 * General, Patient Details, Communication, Payment and Sharing are TABS of one
 * page here rather than separate settings screens, because they are one
 * decision to the person making it: "what does my booking link look like and
 * what does it ask for". Spreading them meant a clinic could publish a link
 * whose confirmation message referred to a field it had turned off.
 */
@Injectable()
export class BookingPageService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async get(clinicId: string) {
    const page = await this.prisma.clinicBookingPage.findFirst({ where: { clinicId } });
    const rules = await this.prisma.appointmentReminderRule.findMany({
      where: { clinicId, serviceId: null, active: true },
      orderBy: { offsetMinutes: 'desc' },
    });
    const services = await this.prisma.serviceCatalog.findMany({
      where: { bookable: true, active: true },
      select: { id: true, name: true, bookingSlug: true },
      orderBy: { name: 'asc' },
    });

    return {
      page,
      reminderRules: rules.map((rule) => ({
        id: rule.id,
        offsetMinutes: rule.offsetMinutes,
        channel: rule.channel,
      })),
      // §40 — the shareable links, computed from the page's own slug so the
      // Sharing tab never shows a link that does not resolve.
      links: page
        ? {
            general: `/${page.slug}`,
            services: services
              .filter((service) => service.bookingSlug)
              .map((service) => ({
                serviceId: service.id,
                name: service.name,
                path: `/${page.slug}/${service.bookingSlug}`,
              })),
          }
        : null,
    };
  }

  async upsert(dto: UpsertBookingPageDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');

      const slug = dto.slug.trim().toLowerCase();
      // The slug is PUBLIC and shared outside any tenant, so it is unique
      // across the platform. Checked here so the clinic is told which word is
      // taken instead of meeting a raw unique-index violation.
      const clash = await tx.clinicBookingPage.findFirst({
        where: { slug, NOT: { clinicId: dto.clinicId } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `The link ending "${slug}" is already in use. Try adding your town or branch name.`,
        );
      }

      const existing = await tx.clinicBookingPage.findFirst({
        where: { clinicId: dto.clinicId },
        select: { id: true },
      });

      const data = {
        slug,
        displayName: dto.displayName.trim(),
        logoUrl: dto.logoUrl?.trim() || null,
        language: dto.language ?? 'en',
        introText: dto.introText?.trim() || null,
        requirePhone: dto.requirePhone ?? true,
        requireEmail: dto.requireEmail ?? false,
        requireNric: dto.requireNric ?? false,
        showReasonField: dto.showReasonField ?? true,
        active: dto.active ?? false,
        allowPatientReschedule: dto.allowPatientReschedule ?? true,
        allowPatientCancel: dto.allowPatientCancel ?? true,
        patientChangeCutoffHours: dto.patientChangeCutoffHours ?? 4,
        confirmationMessage: dto.confirmationMessage?.trim() || null,
      };

      if (existing) {
        await tx.clinicBookingPage.update({ where: { id: existing.id }, data });
      } else {
        await tx.clinicBookingPage.create({
          data: { ...data, tenantId: currentTenantId(), clinicId: dto.clinicId },
        });
      }
      return this.get(dto.clinicId);
    });
  }

  /**
   * §38 — reminders as ROWS. Zero, one or many offsets, replaced as one
   * statement: a clinic that wants three reminders, or none, must not need a
   * migration to say so, and must not need three requests either.
   */
  async setReminderRules(dto: UpsertReminderRulesDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');

      const offsets = [...new Set(dto.offsets)].filter((value) => value > 0).sort((a, b) => b - a);
      if (offsets.length !== dto.offsets.length && dto.offsets.some((value) => value <= 0)) {
        throw new BadRequestException(
          'A reminder has to be some number of minutes BEFORE the appointment.',
        );
      }

      await tx.appointmentReminderRule.deleteMany({
        where: { clinicId: dto.clinicId, serviceId: dto.serviceId ?? null },
      });
      if (offsets.length > 0) {
        await tx.appointmentReminderRule.createMany({
          data: offsets.map((offsetMinutes) => ({
            tenantId: currentTenantId(),
            clinicId: dto.clinicId,
            serviceId: dto.serviceId ?? null,
            offsetMinutes,
            channel: dto.channel ?? 'WHATSAPP',
          })),
        });
      }
      return this.get(dto.clinicId);
    });
  }
}
