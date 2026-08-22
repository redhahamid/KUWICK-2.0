import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentEventType, CommunicationStatus } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { recordAppointmentEvent } from './appointment-event.service';
import { LogCommunicationDto } from './dto/appointment-extras.dto';

/**
 * §37 — WHAT WAS SENT, AND WHETHER IT ACTUALLY LEFT.
 *
 * KUWICK HAS NO MESSAGE GATEWAY. There is no WhatsApp Business integration, no
 * SMS provider and no mail transport configured in this repository, and this
 * service does not pretend otherwise: the brief says "do not fake delivery",
 * and a row reading SENT beside a message nobody sent is the fakery it means.
 *
 * So the channel that works today is the one a clinic already uses: a
 * receptionist presses "WhatsApp patient", a `wa.me` link opens on their own
 * phone, and they send the message with their own hands. That IS the delivery,
 * and it is recorded as MANUAL — a first-class status, not a lesser one.
 *
 * The table is shaped for the gateway that does not exist yet (queued, sent,
 * failed, provider message id) so that adding one is a writer against this log
 * rather than a second log. What it will never do is claim a delivery the
 * system did not perform.
 */
@Injectable()
export class AppointmentCommunicationService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  list(appointmentId: string) {
    return this.prisma.appointmentCommunication.findMany({
      where: { appointmentId },
      orderBy: { queuedAt: 'desc' },
      include: { actor: { select: { fullName: true } } },
    });
  }

  /**
   * A staff member sent it themselves. Recorded as MANUAL with their name on
   * it and the moment they pressed the button.
   */
  async logManualSend(appointmentId: string, dto: LogCommunicationDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'EDIT');

      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        select: { id: true, patient: { select: { phone: true } } },
      });
      if (!appointment) throw new NotFoundException('Appointment not found');

      const now = new Date();
      const row = await tx.appointmentCommunication.create({
        data: {
          tenantId: currentTenantId(),
          appointmentId,
          channel: dto.channel,
          template: dto.template,
          destination: dto.destination ?? appointment.patient?.phone ?? null,
          status: CommunicationStatus.MANUAL,
          sentAt: now,
          actorStaffId: actor.id,
        },
      });

      await recordAppointmentEvent(tx, {
        appointmentId,
        eventType: AppointmentEventType.COMMUNICATION_SENT,
        after: { channel: dto.channel, template: dto.template, status: 'MANUAL' },
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });

      // The reminder columns on the appointment stay in step, because the
      // dashboard's Reminder column reads them and a clinic should not have to
      // learn which of two places to look.
      if (dto.template.startsWith('REMINDER')) {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { reminderSentAt: now, reminderSentByStaffId: actor.id },
        });
      }

      return row;
    });
  }

  /**
   * §38 — WHAT IS DUE TO GO OUT, from the clinic's own reminder rules.
   *
   * A read, not a send. It returns the appointments whose reminder offset has
   * passed and for which no reminder of that template has been logged, so the
   * counter can work down a list. When a gateway exists this is the query the
   * dispatcher will run; until then it is a worklist, which is honest.
   */
  async due(clinicId: string, now = new Date()) {
    const rules = await this.prisma.appointmentReminderRule.findMany({
      where: { clinicId, active: true },
      orderBy: { offsetMinutes: 'desc' },
    });
    if (rules.length === 0) return [];

    const widest = Math.max(...rules.map((rule) => rule.offsetMinutes));
    const horizon = new Date(now.getTime() + widest * 60 * 1000);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: ['CONFIRMED', 'REMINDED'] },
        scheduledStart: { gte: now, lte: horizon },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 200,
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true, preInstructions: true } },
        staff: { select: { fullName: true } },
        communications: { select: { template: true, sentAt: true } },
      },
    });

    const dueRows: {
      appointmentId: string;
      template: string;
      offsetMinutes: number;
      channel: string;
      patient: { id: string; name: string; phone: string | null };
      scheduledStart: Date;
      providerName: string;
      serviceName: string;
      preInstructions: string | null;
      manageToken: string | null;
    }[] = [];

    for (const appointment of appointments) {
      const applicable = rules.filter(
        (rule) => rule.serviceId === null || rule.serviceId === appointment.serviceId,
      );
      // A service-specific rule REPLACES the clinic-wide one rather than
      // adding to it — otherwise turning reminders off for one service would
      // be impossible without turning them off for everything.
      const specific = applicable.filter((rule) => rule.serviceId !== null);
      const effective = specific.length > 0 ? specific : applicable;

      for (const rule of effective) {
        const template = `REMINDER_${rule.offsetMinutes}`;
        const dueAt = appointment.scheduledStart.getTime() - rule.offsetMinutes * 60 * 1000;
        if (dueAt > now.getTime()) continue; // not yet due — upcoming() owns it
        // Cleared by the worklist's own send (exact template) OR by ANY
        // reminder sent once this one was already due — a receptionist who
        // messaged the patient from the drawer has reminded them, and the
        // worklist showing that patient anyway teaches the counter to ignore
        // it. A reminder sent long BEFORE this rule's window does not count:
        // the rule wants a nudge NEAR the time.
        const reminded = appointment.communications.some(
          (row) =>
            row.template === template ||
            (row.template.startsWith('REMINDER') &&
              row.sentAt !== null &&
              row.sentAt.getTime() >= dueAt),
        );
        if (reminded) continue;
        dueRows.push({
          appointmentId: appointment.id,
          template,
          offsetMinutes: rule.offsetMinutes,
          channel: rule.channel,
          patient: appointment.patient,
          scheduledStart: appointment.scheduledStart,
          providerName: appointment.staff.fullName,
          serviceName: appointment.service.name,
          preInstructions: appointment.service.preInstructions,
          manageToken: appointment.manageToken,
        });
      }
    }

    return dueRows;
  }

  /**
   * Final-UAT (Reminder Centre) — what WILL come due in the next week, from
   * the same rules and the same replace-not-add service scoping as due().
   * A read for planning, never a send: each row names the moment it will
   * appear on the worklist.
   */
  async upcoming(clinicId: string, now = new Date()) {
    const rules = await this.prisma.appointmentReminderRule.findMany({
      where: { clinicId, active: true },
      orderBy: { offsetMinutes: 'desc' },
    });
    if (rules.length === 0) return [];

    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: ['CONFIRMED', 'REMINDED'] },
        scheduledStart: { gte: now, lte: horizon },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 200,
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true } },
        staff: { select: { fullName: true } },
        communications: { select: { template: true, sentAt: true } },
      },
    });

    const rows: {
      appointmentId: string;
      template: string;
      offsetMinutes: number;
      channel: string;
      dueAt: Date;
      patient: { id: string; name: string; phone: string | null };
      scheduledStart: Date;
      providerName: string;
      serviceName: string;
      manageToken: string | null;
    }[] = [];

    for (const appointment of appointments) {
      const applicable = rules.filter(
        (rule) => rule.serviceId === null || rule.serviceId === appointment.serviceId,
      );
      const specific = applicable.filter((rule) => rule.serviceId !== null);
      const effective = specific.length > 0 ? specific : applicable;

      for (const rule of effective) {
        const template = `REMINDER_${rule.offsetMinutes}`;
        const dueAt = appointment.scheduledStart.getTime() - rule.offsetMinutes * 60 * 1000;
        if (dueAt <= now.getTime()) continue; // already due — due() owns it
        // An early send clears the future occurrence too: the patient has
        // been reminded, and a centre that re-asks anyway teaches the
        // counter to ignore it (same reasoning as due()'s clearing).
        const reminded = appointment.communications.some(
          (row) => row.template === template || row.template.startsWith('REMINDER'),
        );
        if (reminded) continue;
        rows.push({
          appointmentId: appointment.id,
          template,
          offsetMinutes: rule.offsetMinutes,
          channel: rule.channel,
          dueAt: new Date(dueAt),
          patient: appointment.patient,
          scheduledStart: appointment.scheduledStart,
          providerName: appointment.staff.fullName,
          serviceName: appointment.service.name,
          manageToken: appointment.manageToken,
        });
      }
    }

    return rows.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  }

  /**
   * Final-UAT (Reminder Centre) — the reminders that DID go out, last seven
   * days, with who sent each. Everything here is a recorded MANUAL send;
   * the centre never invents a "Sent" a person did not perform.
   */
  sentHistory(clinicId: string, now = new Date()) {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.prisma.appointmentCommunication.findMany({
      where: {
        template: { startsWith: 'REMINDER' },
        sentAt: { gte: since },
        appointment: { clinicId },
      },
      orderBy: { sentAt: 'desc' },
      take: 100,
      select: {
        id: true,
        template: true,
        channel: true,
        status: true,
        sentAt: true,
        destination: true,
        actor: { select: { fullName: true } },
        appointment: {
          select: {
            id: true,
            scheduledStart: true,
            patient: { select: { id: true, name: true } },
            service: { select: { name: true } },
            staff: { select: { fullName: true } },
          },
        },
      },
    });
  }
}
