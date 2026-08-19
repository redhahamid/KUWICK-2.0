import { ForbiddenException } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { Permission, assertCan, attachedGrants, attachedRoles, can } from '../core/permissions';

/**
 * WHO MAY DO WHAT TO THE DIARY.
 *
 * Every appointment endpoint used to be gated by `requireActor` alone — that
 * is, by being signed in. A stock clerk could cancel tomorrow's clinic. This
 * module is the appointment module's half of the permission policy, written
 * the same way the queue's and billing's are: an ACTION vocabulary, a map to
 * the permission it needs, and a refusal that says what was refused without
 * enumerating who else holds it.
 */
export type AppointmentAction =
  | 'VIEW'
  | 'CREATE'
  | 'EDIT'
  | 'RESCHEDULE'
  | 'CANCEL'
  | 'CHECK_IN'
  | 'NO_SHOW'
  | 'OVERRIDE'
  | 'CONFIGURE'
  | 'MANAGE_ROSTER';

const APPOINTMENT_PERMISSION: Record<AppointmentAction, Permission> = {
  VIEW: 'appointment.view',
  CREATE: 'appointment.create',
  EDIT: 'appointment.edit',
  RESCHEDULE: 'appointment.reschedule',
  CANCEL: 'appointment.cancel',
  CHECK_IN: 'appointment.check_in',
  NO_SHOW: 'appointment.no_show',
  OVERRIDE: 'appointment.override',
  CONFIGURE: 'appointment.configure',
  MANAGE_ROSTER: 'appointment.manage_roster',
};

const ACTION_WORDS: Record<AppointmentAction, string> = {
  VIEW: 'view the appointment diary',
  CREATE: 'book an appointment',
  EDIT: 'change an appointment',
  RESCHEDULE: 'move an appointment',
  CANCEL: 'cancel an appointment',
  CHECK_IN: 'check a patient in',
  NO_SHOW: 'mark an appointment as a no-show',
  OVERRIDE: 'book against the clinic’s scheduling rules',
  CONFIGURE: 'change how appointments and services are configured',
  MANAGE_ROSTER: 'change the provider roster',
};

export function canPerformAppointmentAction(staff: Staff, action: AppointmentAction): boolean {
  return can(staff, APPOINTMENT_PERMISSION[action], attachedRoles(staff), attachedGrants(staff));
}

export function assertCanPerformAppointmentAction(staff: Staff, action: AppointmentAction): void {
  if (!canPerformAppointmentAction(staff, action)) {
    // "Your account", not "your role" — override and roster management can be
    // granted to one person by name, so naming a role would be wrong as often
    // as it was right.
    throw new ForbiddenException(`Your account is not permitted to ${ACTION_WORDS[action]}.`);
  }
}

/** The direct form, for callers that already hold a specific permission. */
export function assertAppointmentPermission(staff: Staff, permission: Permission): void {
  assertCan(staff, permission, attachedRoles(staff), attachedGrants(staff));
}
