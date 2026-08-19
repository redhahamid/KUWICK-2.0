import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WaitlistStatus } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import {
  assertCanPerformAppointmentAction,
  canPerformAppointmentAction,
} from './appointment-authorization';
import { CreateWaitlistEntryDto, UpdateWaitlistEntryDto } from './dto/appointment-extras.dto';
import { SlotAvailabilityService } from './slot-availability.service';
import { clinicDateKey, parseDateOnly } from './time.util';

/**
 * §44 — THE WAITLIST.
 *
 * Its own table, and not an appointment in a WAITLIST status. A waitlist entry
 * has no time: it has a service, a range of acceptable dates and possibly a
 * daypart. Forcing that into a row whose defining facts are `scheduledStart`
 * and `scheduledEnd` would mean inventing times nobody agreed to — and an
 * invented time occupies a slot.
 *
 * MATCHING IS DELIBERATELY NOT AUTOMATIC. When a slot frees up, this finds who
 * fits it and hands the list to a person. Ringing a patient to offer an
 * appointment is a judgement — the 4pm that suits a retiree does not suit a
 * parent — and a system that texted the top of the list would be wrong often
 * enough to be turned off. The architecture supports automatic notification
 * later; the decision to send is not this release's to make.
 */
@Injectable()
export class WaitlistService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly availability: SlotAvailabilityService,
  ) {}

  async create(dto: CreateWaitlistEntryDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CREATE');

      if (dto.priority && dto.priority > 0 && !canPerformAppointmentAction(actor, 'OVERRIDE')) {
        // Priority is a queue-jump. It needs the same permission as booking
        // past a full diary, for the same reason: somebody is being put ahead
        // of somebody else and that should be answerable.
        throw new BadRequestException(
          'Raising a waitlist priority needs the appointment-override permission.',
        );
      }

      const earliest = dto.earliestDate ? parseDateOnly(dto.earliestDate) : null;
      const latest = dto.latestDate ? parseDateOnly(dto.latestDate) : null;
      if (earliest && latest && latest < earliest) {
        throw new BadRequestException('The last acceptable date is before the first.');
      }

      return tx.waitlistEntry.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId,
          patientId: dto.patientId,
          serviceId: dto.serviceId,
          preferredStaffId: dto.preferredStaffId ?? null,
          earliestDate: earliest,
          latestDate: latest,
          preferredDaypart: dto.preferredDaypart?.trim() || null,
          priority: dto.priority ?? 0,
          note: dto.note?.trim() || null,
          createdByStaffId: actor.id,
        },
      });
    });
  }

  async update(id: string, dto: UpdateWaitlistEntryDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'EDIT');

      const entry = await tx.waitlistEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException('Waitlist entry not found');

      if (dto.priority != null && dto.priority !== entry.priority) {
        assertCanPerformAppointmentAction(actor, 'OVERRIDE');
      }

      return tx.waitlistEntry.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.priority == null ? {} : { priority: dto.priority }),
          ...(dto.note === undefined ? {} : { note: dto.note.trim() || null }),
          ...(dto.status === WaitlistStatus.OFFERED ? { offeredAt: new Date() } : {}),
        },
      });
    });
  }

  /**
   * WHO FITS THIS SLOT — the list a receptionist rings down, in the order the
   * clinic said to ring it.
   *
   * Filters on the facts the entry itself states: the right service, a date
   * range that contains the slot, a preferred provider that is either this one
   * or nobody, and a daypart that matches. It does NOT re-check availability:
   * the caller found this slot because it is free, and asking the engine again
   * per entry would be one query per patient on the list.
   */
  async matchesFor(params: {
    clinicId: string;
    serviceId: string;
    staffId: string;
    start: Date;
  }) {
    const timeZone = await this.availability.clinicTimeZone(params.clinicId);
    const date = parseDateOnly(clinicDateKey(params.start, timeZone));
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(params.start),
    );
    const daypart = hour < 12 ? 'MORNING' : hour < 17 ? 'AFTERNOON' : 'EVENING';

    const entries = await this.prisma.waitlistEntry.findMany({
      where: {
        clinicId: params.clinicId,
        serviceId: params.serviceId,
        status: WaitlistStatus.ACTIVE,
        OR: [{ preferredStaffId: null }, { preferredStaffId: params.staffId }],
        AND: [
          { OR: [{ earliestDate: null }, { earliestDate: { lte: date } }] },
          { OR: [{ latestDate: null }, { latestDate: { gte: date } }] },
          {
            OR: [
              { preferredDaypart: null },
              { preferredDaypart: 'ANY' },
              { preferredDaypart: daypart },
            ],
          },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 25,
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        preferredStaff: { select: { id: true, fullName: true } },
      },
    });

    return { slot: { start: params.start, daypart, timeZone }, entries };
  }

  /**
   * The entry produced an appointment. Recorded on the entry rather than the
   * entry being deleted: "we rang eleven people and booked two" is a fact a
   * clinic wants back, and a deleted row cannot say it.
   */
  async markBooked(id: string, appointmentId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'EDIT');
      return tx.waitlistEntry.update({
        where: { id },
        data: { status: WaitlistStatus.BOOKED, bookedAppointmentId: appointmentId },
      });
    });
  }
}
