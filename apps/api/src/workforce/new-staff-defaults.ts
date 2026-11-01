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
export async function defaultLeavePolicyId(tx: AdminTx): Promise<string> {
  const active = await tx.leavePolicy.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (active) return active.id;
  // One the clinic switched off keeps its name; it is not made again.
  const named = await tx.leavePolicy.findFirst({ where: { name: STANDARD_LEAVE_POLICY }, select: { id: true } });
  if (named) return named.id;
  const tenantId = currentTenantId();
  const kinds = leaveKinds(await tx.leaveTypeSetting.findMany({ orderBy: { sortOrder: 'asc' } }));
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
export async function nextEmployeeNo(tx: AdminTx): Promise<string> {
  const setting = await tx.globalSetting.findUnique({
    where: { tenantId_key: { tenantId: currentTenantId(), key: NEW_STAFF_DEFAULTS_SETTING } },
  });
  const chosen = (setting?.value as { employeeNoPrefix?: unknown } | null)?.employeeNoPrefix;
  const prefix = typeof chosen === 'string' && chosen.trim() !== '' ? chosen.trim() : DEFAULT_EMPLOYEE_NO_PREFIX;
  const given = await tx.employeeProfile.findMany({ where: { employeeNo: { startsWith: prefix } }, select: { employeeNo: true } });
  const pattern = new RegExp(`^${escaped(prefix)}(\\d+)$`);
  const highest = given.reduce((top, row) => {
    const match = row.employeeNo ? pattern.exec(row.employeeNo) : null;
    return match ? Math.max(top, Number(match[1])) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
