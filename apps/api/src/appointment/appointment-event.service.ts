import { AppointmentEventType, AppointmentSource, AppointmentStatus, Prisma } from '@prisma/client';
import { ClinicalTx } from '../clinical/clinical-actor';
import { currentTenantId } from '../core/tenant-context';

export interface AppointmentEventInput {
  appointmentId: string;
  eventType: AppointmentEventType;
  fromStatus?: AppointmentStatus | null;
  toStatus?: AppointmentStatus | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reason?: string | null;
  source?: AppointmentSource | null;
  actorStaffId?: string | null;
  actorLabel?: string | null;
}

/**
 * THE APPOINTMENT'S HISTORY, WRITTEN WHERE THE CHANGE IS.
 *
 * A plain function rather than an injectable service, and it takes the same
 * `tx` as the write it describes. That is the whole design: an event is
 * recorded in the SAME transaction as the change, so there is no window in
 * which an appointment has moved and nothing says who moved it. A service
 * with its own connection could not make that promise.
 *
 * Follows the house pattern (`VisitWorkflowEvent`, eight writers) rather than
 * the generic `AuditLog` table, which has none — a shape nobody writes to is
 * not an audit trail, it is an empty table with a promising name.
 *
 * The actor's NAME is snapshotted beside their id. A staff member who leaves
 * the clinic must not erase their name from the record of what they did.
 */
export async function recordAppointmentEvent(
  tx: ClinicalTx,
  event: AppointmentEventInput,
): Promise<void> {
  await tx.appointmentEvent.create({
    data: {
      tenantId: currentTenantId(),
      appointmentId: event.appointmentId,
      eventType: event.eventType,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      beforeValue: event.before ?? Prisma.DbNull,
      afterValue: event.after ?? Prisma.DbNull,
      reason: event.reason ?? null,
      source: event.source ?? null,
      actorStaffId: event.actorStaffId ?? null,
      actorLabel: event.actorLabel ?? null,
    },
  });
}

/**
 * The diary-facing description of an appointment, for the before/after halves
 * of an event. Deliberately small: the ids that identify what changed, and the
 * times a person reads. Not the whole row — an audit entry that copies
 * everything is one nobody can diff.
 */
export function appointmentSnapshot(appointment: {
  staffId: string;
  serviceId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: AppointmentStatus;
}): Prisma.InputJsonValue {
  return {
    staffId: appointment.staffId,
    serviceId: appointment.serviceId,
    scheduledStart: appointment.scheduledStart.toISOString(),
    scheduledEnd: appointment.scheduledEnd.toISOString(),
    status: appointment.status,
  };
}
