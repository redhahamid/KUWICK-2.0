import { ForbiddenException } from '@nestjs/common';
import type { ActingStaff } from '../clinical/clinical-actor';
import { actorCan } from '../finance/admin-actor';

export type RosterGroup = 'DOCTOR' | 'STAFF';

/**
 * WHO MAY WRITE WHICH HALF OF THE ROSTER (UAT, 14 October 2026): "Separate
 * edit permissions for staff roster and doctor roster." The whole-roster
 * permission still writes both.
 */
export function mayRoster(actor: ActingStaff, group: RosterGroup): boolean {
  return actorCan(actor, 'appointment.manage_roster') || actorCan(actor, group === 'DOCTOR' ? 'roster.manage_doctors' : 'roster.manage_staff');
}

export function assertMayRoster(actor: ActingStaff, group: RosterGroup) {
  if (!mayRoster(actor, group)) {
    throw new ForbiddenException(`Your account is not permitted to change the ${group === 'DOCTOR' ? 'doctor' : 'staff'} roster.`);
  }
}
