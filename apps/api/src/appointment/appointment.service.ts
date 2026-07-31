import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentSource, AppointmentStatus, QueueType } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { QueueTicketService } from '../clinical/queue-ticket.service';

// No billing-type input exists at the point an appointment is marked
// arrived (unlike the front-desk "Add to Daily Queue" walk-in flow, which
// asks for one) — defaulted here rather than left unset. Non-critical,
// revisit if Appointment ever carries its own billing-type field.
const DEFAULT_ARRIVAL_BILLING_TYPE = 'Self-pay';

export interface FindAppointmentsFilter {
  clinicId?: string;
  staffId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
}

const ARRIVABLE_FROM: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED];
const NON_CANCELLABLE: AppointmentStatus[] = [...TERMINAL_APPOINTMENT_STATUSES, AppointmentStatus.COMPLETED];

@Injectable()
export class AppointmentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly bookingValidator: AppointmentBookingValidator,
    private readonly queueTickets: QueueTicketService,
  ) {}

  async create(dto: CreateAppointmentDto) {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    assertValidWindow(scheduledStart, scheduledEnd);

    await this.bookingValidator.validate({
      clinicId: dto.clinicId,
      staffId: dto.staffId,
      serviceId: dto.serviceId,
      scheduledStart,
      scheduledEnd,
    });

    // Front-desk bookings are confirmed on the spot; online-portal bookings
    // wait for confirmation (PRODUCT_REQUIREMENTS.md §7).
    const initialStatus =
      dto.source === AppointmentSource.FRONT_DESK ? AppointmentStatus.CONFIRMED : AppointmentStatus.REQUESTED;

    return this.prisma.appointment.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: dto.clinicId,
        patientId: dto.patientId,
        staffId: dto.staffId,
        serviceId: dto.serviceId,
        source: dto.source,
        status: initialStatus,
        scheduledStart,
        scheduledEnd,
        notes: dto.notes,
      },
    });
  }

  findAll(filter: FindAppointmentsFilter) {
    return this.prisma.appointment.findMany({
      where: {
        clinicId: filter.clinicId,
        staffId: filter.staffId,
        patientId: filter.patientId,
        status: filter.status,
        scheduledStart:
          filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
      },
      orderBy: { scheduledStart: 'asc' },
    });
  }

  async findById(id: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    return appointment;
  }

  async confirm(id: string) {
    const appointment = await this.findById(id);
    assertStatus(appointment.status, [AppointmentStatus.REQUESTED], 'confirm');
    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CONFIRMED },
    });
  }

  async cancel(id: string, dto: CancelAppointmentDto) {
    const appointment = await this.findById(id);
    if (NON_CANCELLABLE.includes(appointment.status)) {
      throw new BadRequestException(`Cannot cancel an appointment in status ${appointment.status}`);
    }
    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }

  async noShow(id: string) {
    const appointment = await this.findById(id);
    assertStatus(appointment.status, ARRIVABLE_FROM, 'mark as no-show');
    return this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.NO_SHOW },
    });
  }

  // Marks arrived, then auto-creates a queue ticket (docs/PRODUCT_
  // REQUIREMENTS.md §6). Two separate writes for the same reason
  // reschedule() below is: TENANT_SCOPED_PRISMA wraps each query in its own
  // transaction, so this isn't atomic — an accepted gap, not an oversight.
  async arrived(id: string) {
    const appointment = await this.findById(id);
    assertStatus(appointment.status, ARRIVABLE_FROM, 'mark as arrived');
    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.ARRIVED, arrivedAt: new Date() },
    });
    await this.queueTickets.addToQueue({
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      staffId: appointment.staffId,
      billingType: DEFAULT_ARRIVAL_BILLING_TYPE,
      presentingComplaint: appointment.notes ?? undefined,
      // D-038 — appointment arrivals join the "A" queue stream.
      queueType: QueueType.APPOINTMENT,
    });
    return updated;
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto) {
    const appointment = await this.findById(id);
    if (NON_CANCELLABLE.includes(appointment.status)) {
      throw new BadRequestException(`Cannot reschedule an appointment in status ${appointment.status}`);
    }

    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    assertValidWindow(scheduledStart, scheduledEnd);

    await this.bookingValidator.validate({
      clinicId: appointment.clinicId,
      staffId: appointment.staffId,
      serviceId: appointment.serviceId,
      scheduledStart,
      scheduledEnd,
      excludeAppointmentId: appointment.id,
    });

    // Not wrapped in a single DB transaction: the tenant-scoping Prisma
    // extension (core/tenant-scoped-prisma.provider.ts) already wraps each
    // individual query in its own transaction, and nesting an interactive
    // $transaction through that extension is untested. A crash between
    // these two writes would leave an orphaned RESCHEDULED row with no
    // successor — an accepted gap for this MVP pass, flagged here rather
    // than silently risked.
    await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.RESCHEDULED },
    });
    return this.prisma.appointment.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
        source: appointment.source,
        status: AppointmentStatus.CONFIRMED,
        scheduledStart,
        scheduledEnd,
        notes: appointment.notes,
        rescheduledFromId: appointment.id,
      },
    });
  }
}

function assertValidWindow(scheduledStart: Date, scheduledEnd: Date): void {
  if (scheduledEnd <= scheduledStart) {
    throw new BadRequestException('scheduledEnd must be after scheduledStart');
  }
}

function assertStatus(current: AppointmentStatus, allowed: AppointmentStatus[], action: string): void {
  if (!allowed.includes(current)) {
    throw new BadRequestException(`Cannot ${action} an appointment in status ${current}`);
  }
}
