import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { UpdateServiceBookingConfigDto } from './dto/service-booking-config.dto';
import { parseTimeToDate } from './time.util';

/**
 * THE SERVICE EDITOR'S BACK END — one catalogue, extended.
 *
 * `ServiceCatalog` is reused rather than shadowed by an appointment-only
 * service table. A clinic that renames "CONSULTATION - GENERAL" must not find
 * the public booking page still advertising the old name, and a second table
 * is precisely how that happens.
 *
 * TWO USER-FACING PAGES ARE RETIRED HERE and become tabs of this one:
 *
 *   Doctor-Service Mapping → Service ▸ Providers. The junction table
 *       (`DoctorServiceQualification`) stays exactly as it was; only its
 *       presentation moves. "Who can do this?" is a question about a service,
 *       and asking it on a grid of every doctor against every service is how a
 *       clinic ends up with a mapping nobody can read.
 *
 *   Slot Capacity → Service ▸ Scheduling. `concurrentLimit` — how many may run
 *       at once — is a fact about the service and its rooms.
 *       `SlotCapacityConfig` survives as the per-provider ADVANCED override it
 *       always was, and is not deleted.
 */
@Injectable()
export class ServiceBookingConfigService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The Services tab: every service, with the booking facts the list shows. */
  async list(params: { bookableOnly?: boolean; search?: string; category?: string } = {}) {
    const services = await this.prisma.serviceCatalog.findMany({
      where: {
        ...(params.bookableOnly ? { bookable: true } : {}),
        ...(params.category ? { category: params.category } : {}),
        ...(params.search?.trim()
          ? { name: { contains: params.search.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ bookable: 'desc' }, { name: 'asc' }],
      include: {
        doctorServiceQualifications: {
          select: { staffId: true, staff: { select: { id: true, fullName: true, active: true } } },
        },
      },
    });

    return services.map((service) => ({
      id: service.id,
      name: service.name,
      category: service.category,
      active: service.active,
      bookable: service.bookable,
      durationMinutesDefault: service.durationMinutesDefault,
      slotIntervalMinutes: service.slotIntervalMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      concurrentLimit: service.concurrentLimit,
      requiresApproval: service.requiresApproval,
      price: String(service.price),
      priceDisplay: service.priceDisplay,
      bookingFee: String(service.bookingFee),
      bookingPaymentRule: service.bookingPaymentRule,
      depositAmount: String(service.depositAmount),
      bookingSlug: service.bookingSlug,
      providers: service.doctorServiceQualifications
        .filter((row) => row.staff?.active)
        .map((row) => ({ id: row.staffId, fullName: row.staff!.fullName })),
    }));
  }

  /** Everything the service editor's seven tabs need, in one request. */
  async detail(serviceId: string) {
    const service = await this.prisma.serviceCatalog.findUnique({
      where: { id: serviceId },
      include: {
        doctorServiceQualifications: { select: { staffId: true } },
        bookableHours: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
        bookingFormFields: { orderBy: { sortOrder: 'asc' } },
        reminderRules: { where: { active: true }, orderBy: { offsetMinutes: 'desc' } },
      },
    });
    if (!service) throw new NotFoundException('Service not found');

    return {
      id: service.id,
      name: service.name,
      code: service.code,
      category: service.category,
      active: service.active,
      orderType: service.orderType,
      price: String(service.price),
      // Basic
      bookable: service.bookable,
      bookingDescription: service.bookingDescription,
      bookingPhotoUrl: service.bookingPhotoUrl,
      priceDisplay: service.priceDisplay,
      // Scheduling
      durationMinutesDefault: service.durationMinutesDefault,
      slotIntervalMinutes: service.slotIntervalMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      concurrentLimit: service.concurrentLimit,
      minimumNoticeMinutes: service.minimumNoticeMinutes,
      maxAdvanceDays: service.maxAdvanceDays,
      requiresApproval: service.requiresApproval,
      bookableHours: service.bookableHours.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startTime: formatTime(row.startTime),
        endTime: formatTime(row.endTime),
      })),
      // Providers
      providerStaffIds: service.doctorServiceQualifications.map((row) => row.staffId),
      // Patient form
      formFields: service.bookingFormFields.map((field) => ({
        id: field.id,
        label: field.label,
        helpText: field.helpText,
        fieldType: field.fieldType,
        required: field.required,
        active: field.active,
        sortOrder: field.sortOrder,
        options: field.options,
      })),
      // Payment & policies
      bookingFee: String(service.bookingFee),
      bookingPaymentRule: service.bookingPaymentRule,
      depositAmount: String(service.depositAmount),
      // Instructions
      preInstructions: service.preInstructions,
      postInstructions: service.postInstructions,
      // Sharing
      bookingSlug: service.bookingSlug,
      reminderRules: service.reminderRules.map((rule) => ({
        id: rule.id,
        offsetMinutes: rule.offsetMinutes,
        channel: rule.channel,
      })),
    };
  }

  /**
   * SAVE THE WHOLE EDITOR, in one transaction.
   *
   * All of it lands or none of it does. Seven endpoints — one per tab — is how
   * a service ends up with its new duration and its old provider list, and the
   * person who pressed Save has no way to tell.
   */
  async update(serviceId: string, dto: UpdateServiceBookingConfigDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');

      const service = await tx.serviceCatalog.findUnique({ where: { id: serviceId } });
      if (!service) throw new NotFoundException('Service not found');

      // A DEPOSIT RULE WITH NO AMOUNT would take nothing and tell the patient
      // it had. Refused here rather than discovered on the payment page.
      const rule = dto.bookingPaymentRule ?? service.bookingPaymentRule;
      const deposit = dto.depositAmount ?? Number(service.depositAmount);
      if (rule === 'DEPOSIT' && !(deposit > 0)) {
        throw new BadRequestException(
          'A deposit rule needs a deposit amount. Set one, or choose "no upfront payment".',
        );
      }
      // The interval may not exceed the duration in a way that leaves gaps
      // nobody can book — but it MAY be shorter, which is overlapping slots
      // and is what a concurrent limit is for.
      const duration = dto.durationMinutesDefault ?? service.durationMinutesDefault;
      if (dto.slotIntervalMinutes != null && dto.slotIntervalMinutes > duration) {
        throw new BadRequestException(
          'The start interval is longer than the appointment, which would leave unbookable gaps between slots.',
        );
      }

      await tx.serviceCatalog.update({
        where: { id: serviceId },
        data: {
          // Listed one by one rather than spread from the DTO: the DTO also
          // carries the provider list, the form fields and the bookable hours,
          // which are separate tables. A blanket spread would try to write
          // them onto the service row.
          ...defined({
            bookable: dto.bookable,
            bookingDescription: dto.bookingDescription,
            bookingPhotoUrl: dto.bookingPhotoUrl,
            priceDisplay: dto.priceDisplay,
            durationMinutesDefault: dto.durationMinutesDefault,
            slotIntervalMinutes: dto.slotIntervalMinutes,
            bufferBeforeMinutes: dto.bufferBeforeMinutes,
            bufferAfterMinutes: dto.bufferAfterMinutes,
            concurrentLimit: dto.concurrentLimit,
            minimumNoticeMinutes: dto.minimumNoticeMinutes,
            maxAdvanceDays: dto.maxAdvanceDays,
            requiresApproval: dto.requiresApproval,
            bookingPaymentRule: dto.bookingPaymentRule,
            preInstructions: dto.preInstructions,
            postInstructions: dto.postInstructions,
          }),
          ...(dto.depositAmount === undefined ? {} : { depositAmount: dto.depositAmount }),
          ...(dto.bookingFee === undefined ? {} : { bookingFee: dto.bookingFee }),
          ...(dto.bookingSlug === undefined
            ? {}
            : { bookingSlug: dto.bookingSlug?.trim() || null }),
        },
      });

      if (dto.bookableHours) {
        // Replaced wholesale: the tab is one statement about the week, exactly
        // like the weekly roster form, and a diff computed in the browser
        // cannot see what is stored.
        await tx.serviceBookableHour.deleteMany({ where: { serviceId } });
        if (dto.bookableHours.length > 0) {
          await tx.serviceBookableHour.createMany({
            data: dto.bookableHours.map((row) => ({
              tenantId: currentTenantId(),
              serviceId,
              dayOfWeek: row.dayOfWeek,
              startTime: parseTimeToDate(row.startTime),
              endTime: parseTimeToDate(row.endTime),
            })),
          });
        }
      }

      if (dto.providerStaffIds) {
        // The junction table is unchanged — this is the SAME
        // `DoctorServiceQualification` the retired mapping page wrote, read
        // and written from the question's natural side.
        const existing = await tx.doctorServiceQualification.findMany({
          where: { serviceId },
          select: { staffId: true },
        });
        const wanted = new Set(dto.providerStaffIds);
        const held = new Set(existing.map((row) => row.staffId));

        const toRemove = [...held].filter((id) => !wanted.has(id));
        if (toRemove.length > 0) {
          await tx.doctorServiceQualification.deleteMany({
            where: { serviceId, staffId: { in: toRemove } },
          });
        }
        const toAdd = [...wanted].filter((id) => !held.has(id));
        if (toAdd.length > 0) {
          await tx.doctorServiceQualification.createMany({
            data: toAdd.map((staffId) => ({ tenantId: currentTenantId(), serviceId, staffId })),
          });
        }
      }

      if (dto.formFields) {
        // Fields are DEACTIVATED rather than deleted when they disappear from
        // the list. Answers snapshot their question, so a deleted field breaks
        // nothing historical — but a clinic that removes "Are you pregnant?"
        // by accident should be able to put it back with its id intact.
        const keep = new Set(dto.formFields.map((field) => field.id).filter(Boolean));
        await tx.bookingFormField.updateMany({
          where: { serviceId, id: { notIn: [...keep] as string[] } },
          data: { active: false },
        });
        for (const [index, field] of dto.formFields.entries()) {
          const data = {
            label: field.label.trim(),
            helpText: field.helpText?.trim() || null,
            fieldType: field.fieldType,
            required: field.required ?? false,
            active: field.active ?? true,
            sortOrder: field.sortOrder ?? index,
            options: field.options ?? [],
          };
          if (field.id) {
            await tx.bookingFormField.update({ where: { id: field.id }, data });
          } else {
            await tx.bookingFormField.create({
              data: { ...data, tenantId: currentTenantId(), serviceId },
            });
          }
        }
      }

      return this.detail(serviceId);
    });
  }

  /** The provider picker on the Providers tab: who could be given this. */
  async eligibleProviders(clinicId: string) {
    const staff = await this.prisma.staff.findMany({
      where: { clinicId, active: true },
      select: { id: true, fullName: true, professionalType: true, calendarColor: true },
      orderBy: { fullName: 'asc' },
    });
    return staff;
  }
}

/**
 * Drops the keys the caller did not send, so "absent" and "cleared to null"
 * stay different answers. A PATCH that wrote every undefined field as null
 * would erase whatever the form did not happen to be showing.
 */
function defined<T extends object>(source: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

function formatTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}
