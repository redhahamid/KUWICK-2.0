/**
 * THE CLINIC'S ATTENDANCE POLICY — resolved, with defaults that change nothing.
 *
 * Pure, so the resolution order can be tested without a database, and so the
 * defaults are readable in one place rather than inferred from five column
 * definitions.
 *
 * The defaults ARE the constants that used to live in `attendance-hours.ts`,
 * which is why introducing this table changed no computed attendance anywhere:
 * a clinic with no policy row measures exactly as it did before.
 */

export interface AttendancePolicy {
  /** Minutes after the scheduled start before an arrival counts as late. */
  lateGraceMinutes: number;
  /** Minutes before the scheduled end that leaving early is not counted short. */
  earlyOutGraceMinutes: number;
  /** Extra time below this is not even an overtime candidate. */
  overtimeMinimumMinutes: number;
  /** Candidate overtime rounds DOWN to a multiple of this. 0 disables it. */
  overtimeRoundingMinutes: number;
  /** Whether clocking in before the shift counts toward extra time. */
  countEarlyClockIn: boolean;
  /** Longer than this and the record is flagged rather than believed. */
  maximumShiftHours: number;
  /** The branch's point for portal clock-ins; null means the distance is not checked. */
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadiusMetres: number;
}

/**
 * What every clinic measured by before this table existed.
 *
 * `countEarlyClockIn` defaults FALSE because that is the direction that cannot
 * overpay by accident: arriving at 07:30 for an 08:00 shift is not overtime.
 *
 * `overtimeRequiresApproval` USED TO BE HERE and was a switch with one
 * position — only approved extra time ever reached payroll, whatever it said.
 * `unpaidBreakMinutes` and `breakAfterMinutes` used to deduct a flat break from
 * any long shift, into a `payableMinutes` figure nothing read. Both are gone:
 * the first would have let a clinic pay extra time nobody agreed to, and the
 * second would deduct a break twice in a clinic whose staff punch out for it.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  lateGraceMinutes: 5,
  earlyOutGraceMinutes: 5,
  overtimeMinimumMinutes: 30,
  overtimeRoundingMinutes: 15,
  countEarlyClockIn: false,
  maximumShiftHours: 16,
  geofenceLat: null,
  geofenceLng: null,
  geofenceRadiusMetres: 150,
};

/** A stored row, with every field optional so a partial row still resolves. */
/**
 * A stored row, as Prisma hands it back: the point arrives as Decimal, so it
 * is typed loosely here and read through Number() in one place.
 */
export type AttendancePolicyRow = Partial<Omit<AttendancePolicy, 'geofenceLat' | 'geofenceLng'>> & {
  clinicId?: string | null;
  geofenceLat?: number | string | { toString(): string } | null;
  geofenceLng?: number | string | { toString(): string } | null;
};

/**
 * CLINIC ROW, THEN TENANT DEFAULT, THEN THE BUILT-IN.
 *
 * Field by field rather than row by row: a clinic that overrides only its
 * grace period should still inherit the group's overtime rounding, not fall
 * back to the built-in for everything it did not mention.
 */
export function resolveAttendancePolicy(
  rows: AttendancePolicyRow[],
  clinicId: string | null | undefined,
): AttendancePolicy {
  const forClinic = clinicId ? rows.find((row) => row.clinicId === clinicId) : undefined;
  const tenantDefault = rows.find((row) => !row.clinicId);
  const pick = <K extends keyof AttendancePolicy>(key: K): AttendancePolicy[K] => {
    const fromClinic = forClinic?.[key];
    if (fromClinic !== undefined && fromClinic !== null) return fromClinic as AttendancePolicy[K];
    const fromTenant = tenantDefault?.[key];
    if (fromTenant !== undefined && fromTenant !== null) return fromTenant as AttendancePolicy[K];
    return DEFAULT_ATTENDANCE_POLICY[key];
  };
  return {
    lateGraceMinutes: pick('lateGraceMinutes'),
    earlyOutGraceMinutes: pick('earlyOutGraceMinutes'),
    overtimeMinimumMinutes: pick('overtimeMinimumMinutes'),
    overtimeRoundingMinutes: pick('overtimeRoundingMinutes'),
    countEarlyClockIn: pick('countEarlyClockIn'),
    maximumShiftHours: pick('maximumShiftHours'),
    // The point is one fact, not two: a branch that recorded a latitude but
    // no longitude has recorded nothing. Read from the same row, or not at all.
    ...pickPoint(forClinic, tenantDefault),
    geofenceRadiusMetres: pick('geofenceRadiusMetres'),
  };
}

function pickPoint(
  forClinic: AttendancePolicyRow | undefined,
  tenantDefault: AttendancePolicyRow | undefined,
): { geofenceLat: number | null; geofenceLng: number | null } {
  for (const row of [forClinic, tenantDefault]) {
    const lat = row?.geofenceLat;
    const lng = row?.geofenceLng;
    if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
      const point = { geofenceLat: Number(String(lat)), geofenceLng: Number(String(lng)) };
      if (Number.isFinite(point.geofenceLat) && Number.isFinite(point.geofenceLng)) return point;
    }
  }
  return { geofenceLat: null, geofenceLng: null };
}

/**
 * Extra minutes worked → the minutes a clinic would actually consider paying.
 *
 * Two rules, applied in this order and not the other: the MINIMUM decides
 * whether there is a claim at all, and the ROUNDING then shapes it. Rounding
 * first would turn 8 minutes into 0 and hide the fact that a threshold was
 * ever consulted.
 */
export function overtimeCandidateMinutes(extraMinutes: number, policy: AttendancePolicy): number {
  if (extraMinutes < policy.overtimeMinimumMinutes) return 0;
  if (policy.overtimeRoundingMinutes <= 0) return extraMinutes;
  return Math.floor(extraMinutes / policy.overtimeRoundingMinutes) * policy.overtimeRoundingMinutes;
}
