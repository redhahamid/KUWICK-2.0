import { ProfessionalType, Role, ShiftGroup } from '@prisma/client';

/**
 * WHAT KIND OF WORKER IS THIS — the axis a roster is actually read along.
 *
 * A clinic owner opening the roster does not think "show me DOCTOR_RESIDENT
 * and DOCTOR_LOCUM"; they think "show me the doctors", then "show me the front
 * desk". `Role` is a permissions concept and has nine values, several of which
 * nobody holds. This is the five-way split the people doing the work use, and
 * it is DERIVED rather than stored so that it cannot drift from the role.
 *
 * Deliberately not a database column. A sixth category, or a re-cut of these
 * five, is then a change to one pure function with tests rather than a
 * migration plus a backfill plus a period where some rows disagree.
 */
export type WorkforceCategory = 'DOCTOR' | 'CLINICAL' | 'ADMIN' | 'MANAGEMENT' | 'OTHER';

export const WORKFORCE_CATEGORIES: { key: WorkforceCategory; label: string }[] = [
  { key: 'DOCTOR', label: 'Doctors' },
  { key: 'CLINICAL', label: 'Clinical staff' },
  { key: 'ADMIN', label: 'Admin / front desk' },
  { key: 'MANAGEMENT', label: 'Finance / management' },
  { key: 'OTHER', label: 'Other' },
];

/**
 * `FRONT_DESK_CLINICAL_STAFF` is one role covering two jobs — it records
 * vitals AND registers patients, and the permission model keeps them together
 * deliberately. The roster still has to tell a nurse from a receptionist, so
 * the professional identity breaks the tie: somebody carrying a clinical
 * professional type is clinical, and everybody else on that role is front desk.
 */
export function workforceCategoryOf(staff: {
  role: Role;
  professionalType?: ProfessionalType | null;
  /** From the employee record (UAT, 14 October 2026); wins over the role when set. */
  staffGroup?: ShiftGroup | null;
}): WorkforceCategory {
  const byRole = categoryByRole(staff);
  if (staff.staffGroup === 'DOCTOR') return 'DOCTOR';
  if (staff.staffGroup === 'STAFF' && byRole === 'DOCTOR') return 'CLINICAL';
  return byRole;
}

function categoryByRole(staff: { role: Role; professionalType?: ProfessionalType | null }): WorkforceCategory {
  switch (staff.role) {
    case Role.DOCTOR_RESIDENT:
    case Role.DOCTOR_LOCUM:
      return 'DOCTOR';
    case Role.FRONT_DESK_CLINICAL_STAFF:
      return staff.professionalType && staff.professionalType !== ProfessionalType.NON_CLINICAL
        ? 'CLINICAL'
        : 'ADMIN';
    case Role.OWNER_ADMIN:
    case Role.FINANCE_STAFF:
      return 'MANAGEMENT';
    default:
      return 'OTHER';
  }
}

/**
 * WHOSE SHIFTS CAN BE BOOKED INTO.
 *
 * The roster now holds the whole workforce, and a receptionist's shift is a
 * real shift — it is simply not a slot anybody can book an appointment in.
 * Keeping this as its own question stops the widening of the roster from
 * quietly widening what the availability engine offers, which is the one thing
 * this change must not do.
 */
export function isBookableProvider(staff: { role: Role; active?: boolean }): boolean {
  return (
    (staff.role === Role.DOCTOR_RESIDENT || staff.role === Role.DOCTOR_LOCUM) && staff.active !== false
  );
}

/** Everyone a roster may contain. A patient-portal account is not staff. */
export function isRosterableRole(role: Role): boolean {
  return role !== Role.PATIENT_PORTAL;
}
