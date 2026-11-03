import { currentTenantId } from '../core/tenant-context';
import type { AdminTx } from '../finance/admin-actor';
import { leaveKinds } from '../hr/leave-types';

/**
 * WHAT A NEW EMPLOYEE STARTS WITH (new-clinic UAT #2, 1 November 2026).
 *
 * Two answers a new record used to leave blank: which leave policy the person
 * is on (so their profile said annual leave "Not recorded"), and their
 * employee number. Both are the clinic's own, and both can be changed on the
 * record afterwards.
 */

/** Read from the clinic's "Defaults for new staff" (Pay rules), `hr.newStaffDefaults`. */
export const NEW_STAFF_DEFAULTS_SETTING = 'hr.newStaffDefaults';
export const DEFAULT_EMPLOYEE_NO_PREFIX = 'E';
export const STANDARD_LEAVE_POLICY = 'Standard leave';

/**
 * THE LEAVE POLICY A NEW EMPLOYEE IS PUT ON: the clinic's first active policy.
 * A clinic with none gets "Standard leave", made from its own leave types
 * (Kuwick's defaults until it changes them): annual 8 days, medical 14,
 * hospitalisation 60, the Employment Act's figures for the first two years.
 * Longer service gets the Act's higher minimum (s.60E(1): 12 days from two
 * years, 16 from five) without any change here, because a balance is never
 * below the Act; a mid-year joiner's annual leave is pro-rated, and unused
 * leave is paid out on leaving (s.60E(3)).
 */
// Every read names the tenant, so the one-off backfill (which runs outside a
// request, across tenants) asks the same questions the request path does.
export async function defaultLeavePolicyId(tx: AdminTx, tenantId: string = currentTenantId()): Promise<string> {
  const active = await tx.leavePolicy.findFirst({ where: { tenantId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (active) return active.id;
  // One the clinic switched off keeps its name; it is not made again.
  const named = await tx.leavePolicy.findFirst({ where: { tenantId, name: STANDARD_LEAVE_POLICY }, select: { id: true } });
  if (named) return named.id;
  const kinds = leaveKinds(await tx.leaveTypeSetting.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }));
  const policy = await tx.leavePolicy.create({
    data: {
      tenantId,
      name: STANDARD_LEAVE_POLICY,
      proRateOnJoin: true,
      payUntakenLeaveOnExit: true,
      notes: 'Made by Kuwick from the clinic’s leave types when the first employee was added. Change it under Settings → Attendance & leave.',
      entitlements: {
        create: kinds
          .filter((kind) => kind.active && kind.daysPerYear !== null)
          .map((kind) => ({
            tenantId,
            leaveType: kind.code,
            daysPerYear: kind.daysPerYear as number,
            paid: kind.paid,
            requiresAttachment: kind.documentRequired,
          })),
      },
    },
    select: { id: true },
  });
  return policy.id;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * THE NEXT EMPLOYEE NUMBER: the clinic's prefix (E unless it set another)
 * and one more than the highest number already given with it, three digits
 * at least: E001, E002 … E010. Numbers typed by hand in another shape are
 * left alone and never reused.
 */
export async function nextEmployeeNo(tx: AdminTx, tenantId: string = currentTenantId()): Promise<string> {
  const setting = await tx.globalSetting.findUnique({
    where: { tenantId_key: { tenantId, key: NEW_STAFF_DEFAULTS_SETTING } },
  });
  const chosen = (setting?.value as { employeeNoPrefix?: unknown } | null)?.employeeNoPrefix;
  const prefix = typeof chosen === 'string' && chosen.trim() !== '' ? chosen.trim() : DEFAULT_EMPLOYEE_NO_PREFIX;
  const given = await tx.employeeProfile.findMany({ where: { tenantId, employeeNo: { startsWith: prefix } }, select: { employeeNo: true } });
  const pattern = new RegExp(`^${escaped(prefix)}(\\d+)$`);
  const highest = given.reduce((top, row) => {
    const match = row.employeeNo ? pattern.exec(row.employeeNo) : null;
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/**
 * STAFF ON FILE FROM BEFORE THESE DEFAULTS (new-clinic UAT #2 re-check, item
 * 78): everybody with no leave policy is put on the clinic's default one, and
 * everybody with no employee number is given the next, oldest start date
 * first. Nothing already set is changed. Returns what it did (or, with
 * `apply` false, what it would do) for the person running it to read.
 */
export async function backfillStaffDefaults(tx: AdminTx, tenantId: string, apply: boolean) {
  const missingPolicy = await tx.employeeProfile.findMany({ where: { tenantId, leavePolicyId: null }, select: { id: true } });
  const missingNumber = await tx.employeeProfile.findMany({
    where: { tenantId, OR: [{ employeeNo: null }, { employeeNo: '' }] },
    orderBy: [{ startDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const numbers: string[] = [];
  if (apply) {
    if (missingPolicy.length > 0) {
      const policyId = await defaultLeavePolicyId(tx, tenantId);
      await tx.employeeProfile.updateMany({ where: { id: { in: missingPolicy.map((row) => row.id) } }, data: { leavePolicyId: policyId } });
    }
    for (const row of missingNumber) {
      const employeeNo = await nextEmployeeNo(tx, tenantId);
      await tx.employeeProfile.update({ where: { id: row.id }, data: { employeeNo } });
      numbers.push(employeeNo);
    }
  }
  return { leavePolicyAssigned: missingPolicy.length, employeeNumbersGiven: missingNumber.length, numbers };
}
