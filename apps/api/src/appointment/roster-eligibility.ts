import { Role } from '@prisma/client';

/**
 * WHO IS ON A BRANCH'S ROSTER FOR A MONTH (UAT, 15 October 2026).
 *
 * The HR employee record decides, not appointment "provider" status: every
 * employee of the branch who is employed in the period, doctor or staff,
 * with a login or without. Somebody with no branch on their record is shown
 * on every branch, flagged, until HR sets one. An account with no HR record
 * stays on the board while it is active in the branch, as before.
 *
 * One rule for the board and for the owner's roster check, so the check can
 * never disagree with what the board shows.
 */
export interface RosterPerson {
  clinicId: string | null;
  active: boolean;
  role: Role;
  employeeProfile: {
    startDate: Date | null;
    endDate: Date | null;
    employmentStatus: string;
  } | null;
}

export type RosterEligibility = { included: true; noBranch: boolean } | { included: false; reason: string };

const EMPLOYED = ['ACTIVE', 'PROBATION', 'NOTICE'];
const LEFT = ['RESIGNED', 'TERMINATED'];
const day = (date: Date) => date.toISOString().slice(0, 10);

/** `from` is the first day shown, `to` the last. */
export function rosterEligibility(person: RosterPerson, branch: string, from: Date, to: Date): RosterEligibility {
  if (person.role === Role.PATIENT_PORTAL) return { included: false, reason: 'Patient portal account, not staff' };
  const profile = person.employeeProfile;
  if (person.clinicId !== null && person.clinicId !== branch) return { included: false, reason: 'Recorded in another branch' };

  if (!profile) {
    if (person.clinicId === null) return { included: false, reason: 'No HR employee record and no branch' };
    if (!person.active) return { included: false, reason: 'Account switched off and no HR employee record' };
    return { included: true, noBranch: false };
  }

  if (profile.startDate && profile.startDate > to) return { included: false, reason: `Starts ${day(profile.startDate)}, after this period` };
  if (profile.endDate && profile.endDate < from) return { included: false, reason: `Left ${day(profile.endDate)}, before this period` };
  const employed = EMPLOYED.includes(profile.employmentStatus) || (LEFT.includes(profile.employmentStatus) && profile.endDate !== null);
  if (!employed) {
    return {
      included: false,
      reason: LEFT.includes(profile.employmentStatus)
        ? `Marked ${profile.employmentStatus.toLowerCase()} with no last day recorded`
        : `Employment status ${profile.employmentStatus.toLowerCase()}`,
    };
  }
  return { included: true, noBranch: person.clinicId === null };
}
