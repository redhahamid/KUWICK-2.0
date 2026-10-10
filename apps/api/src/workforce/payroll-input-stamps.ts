import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { employedInMonth } from './employed-in-month';

/**
 * WHAT A DRAFT WAS WORKED OUT FROM, AS A FINGERPRINT.
 *
 * Reported from UAT: an employee's record changed after the month was worked
 * out, and nothing said so — the draft kept showing figures from records that
 * were no longer true. So when a month is worked out, every kind of record the
 * calculation reads is fingerprinted per employee; when the draft is opened,
 * the same records are fingerprinted again and compared. A difference is named
 * — who, and which kind of record — and the workspace asks for the month to be
 * worked out again.
 *
 * A fingerprint is a hash of CONTENT, not of timestamps: a record saved
 * without a change does not move it, and a record deleted or added does.
 * Employee fields are those a payslip or a calculation reads; a new phone
 * number is not a reason to work a month out again.
 *
 * Deliberately a superset of what changes a figure: a fingerprint that moves
 * when nothing that matters did costs one more "work it out again"; one that
 * stays still when something did costs a wrong payslip.
 */
export const STAMP_KINDS = {
  employee: 'employee record',
  salary: 'salary',
  standing: 'statutory standing',
  epfBasis: 'EPF contribution basis',
  tax: 'TP1 or TP3',
  attendance: 'attendance',
  leave: 'leave',
  incentives: 'incentives',
  inputs: 'items for the month',
  claims: 'claims',
  recurring: 'recurring items',
  yearToDate: 'year-to-date figures',
} as const;

export type StampKind = keyof typeof STAMP_KINDS;

export interface InputStamps {
  version: 1;
  /** staffId → kind → fingerprint. Every employee in the run's scope, paid or left out. */
  employees: Record<string, Partial<Record<StampKind, string>>>;
}

export interface RecordsChanged {
  staffId: string;
  /** The kinds of record that changed, in words; or that the person joined or left the run's scope. */
  what: string[];
}

/** The delegates a fingerprint reads. A transaction or the tenant-scoped client both have them. */
export type StampDb = Pick<
  Prisma.TransactionClient,
  | 'employeeProfile'
  | 'employeeSalary'
  | 'employeeStatutoryClassification'
  | 'employeeContributionBasis'
  | 'employeeTp1Entry'
  | 'employeeTp3Record'
  | 'attendanceRecord'
  | 'leaveRequest'
  | 'incentiveResult'
  | 'payrollInputEntry'
  | 'staffClaim'
  | 'employeeRecurringItem'
  | 'employeeYtd'
>;

/** Timestamps and authorship say when and who, not what: two saves of the same record are the same record. */
const NOT_CONTENT = ['createdAt', 'updatedAt', 'createdByStaffId'];
/**
 * A DATED VERSION (salary, standing, EPF basis) is read for what it says
 * about the month, not for its identity or its paperwork: a split that
 * leaves the month's values alone, or a reason reworded, is not a change to
 * this month's pay.
 */
const NOT_THE_MONTHS = [...NOT_CONTENT, 'id', 'reason', 'note', 'changedFields'];

/**
 * Dates outside the month say nothing about it. A version closed after the
 * month, a start before it or an end after it, all read the same as before,
 * so recording next year's salary does not unsettle this month's draft.
 */
function inMonth(row: Record<string, unknown>, period: Date, lastDay: Date): Record<string, unknown> {
  const out = { ...row };
  for (const [from, to] of [
    ['effectiveFrom', 'effectiveTo'],
    ['startDate', 'endDate'],
  ] as const) {
    if (from in out && (out[from] === null || (out[from] instanceof Date && (out[from] as Date).getTime() <= period.getTime()))) out[from] = 'before the month';
    if (to in out && (out[to] === null || (out[to] instanceof Date && (out[to] as Date).getTime() >= lastDay.getTime()))) out[to] = 'after the month';
  }
  return out;
}

function fingerprint(rows: object[], drop: string[] = NOT_CONTENT, window?: { period: Date; lastDay: Date }): string {
  const shaped = rows.map((row) => {
    const kept = Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => !drop.includes(key)));
    return window ? inMonth(kept, window.period, window.lastDay) : kept;
  });
  const sorted = shaped.map((row) => JSON.stringify(row)).sort();
  return createHash('sha256').update(JSON.stringify(sorted)).digest('base64url').slice(0, 22);
}

/** A dated version that is in force on some day of the month. */
function touchesMonth(row: { effectiveFrom: Date; effectiveTo: Date | null }, period: Date, lastDay: Date): boolean {
  return row.effectiveFrom.getTime() <= lastDay.getTime() && (row.effectiveTo === null || row.effectiveTo.getTime() >= period.getTime());
}

function byStaff<T extends { staffId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.staffId) ?? [];
    list.push(row);
    map.set(row.staffId, list);
  }
  return map;
}

/**
 * Fingerprint every employee in a run's scope, reading what the calculation
 * reads for the month: the same scope (employees, not contractors, who are
 * active, on probation or serving notice, in the run's branch) and the same
 * windows (the month's attendance and items, leave and recurring items that
 * touch it, the year's earlier months).
 */
export async function computeInputStamps(db: StampDb, run: { clinicId: string | null; period: Date }): Promise<InputStamps> {
  const period = new Date(Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
  const lastDay = new Date(periodEnd.getTime() - 86_400_000);
  const year = period.getUTCFullYear();
  const month = period.getUTCMonth() + 1;

  const employees = await db.employeeProfile.findMany({
    where: {
      engagement: 'EMPLOYEE',
      ...employedInMonth(period, periodEnd),
      ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
    },
    include: { staff: { select: { fullName: true, active: true, clinicId: true } } },
  });
  const staffIds = employees.map((e) => e.staffId);
  const among = { staffId: { in: staffIds } };

  const [salary, standing, epfBasis, tp1, tp3, attendance, leave, incentives, inputs, claims, recurring, yearToDate] = await Promise.all([
    db.employeeSalary.findMany({ where: among }),
    db.employeeStatutoryClassification.findMany({ where: among }),
    db.employeeContributionBasis.findMany({ where: { ...among, scheme: 'EPF' } }),
    db.employeeTp1Entry.findMany({ where: { ...among, period } }),
    db.employeeTp3Record.findMany({ where: { ...among, taxYear: year } }),
    db.attendanceRecord.findMany({ where: { ...among, workDate: { gte: period, lt: periodEnd } } }),
    db.leaveRequest.findMany({ where: { ...among, status: 'APPROVED', startDate: { lt: periodEnd }, endDate: { gte: period } } }),
    db.incentiveResult.findMany({ where: { ...among, incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } } } }),
    db.payrollInputEntry.findMany({ where: { ...among, period } }),
    db.staffClaim.findMany({ where: { ...among, status: 'APPROVED', paymentRoute: 'PAYROLL', payrollPeriod: period } }),
    db.employeeRecurringItem.findMany({
      where: { ...among, effectiveFrom: { lte: lastDay }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period } }] },
    }),
    db.employeeYtd.findMany({ where: { ...among, taxYear: year, month: { lt: month } } }),
  ]);

  const window = { period, lastDay };
  // The dated versions in force on some day of the month, read for their values.
  const dated: [StampKind, Map<string, object[]>][] = [
    ['salary', byStaff(salary.filter((row) => touchesMonth(row, period, lastDay)))],
    ['standing', byStaff(standing.filter((row) => touchesMonth(row, period, lastDay)))],
    ['epfBasis', byStaff(epfBasis.filter((row) => touchesMonth(row, period, lastDay)))],
  ];
  const kinds: [StampKind, Map<string, object[]>][] = [
    ['tax', byStaff([...tp1, ...tp3])],
    ['attendance', byStaff(attendance)],
    ['leave', byStaff(leave)],
    ['incentives', byStaff(incentives)],
    ['inputs', byStaff(inputs)],
    ['claims', byStaff(claims)],
    ['recurring', byStaff(recurring)],
    ['yearToDate', byStaff(yearToDate)],
  ];

  const stamps: InputStamps = { version: 1, employees: {} };
  for (const e of employees) {
    const own: Partial<Record<StampKind, string>> = {
      // What a payslip or a calculation reads from the record itself, with a
      // start before the month or an end after it read as just that.
      employee: fingerprint([
        {
          id: e.id,
          fullName: e.staff.fullName,
          active: e.staff.active,
          clinicId: e.staff.clinicId,
          employeeNo: e.employeeNo,
          legalName: e.legalName,
          dateOfBirth: e.dateOfBirth,
          employmentType: e.employmentType,
          employmentStatus: e.employmentStatus,
          workDaysPerWeek: e.workDaysPerWeek,
          startDate: e.startDate,
          endDate: e.endDate,
          position: e.position,
          department: e.department,
          bankName: e.bankName,
          legalEmployerId: e.legalEmployerId,
          payrollPolicyId: e.payrollPolicyId,
          leavePolicyId: e.leavePolicyId,
        },
      ], NOT_CONTENT, window),
    };
    for (const [kind, map] of dated) own[kind] = fingerprint(map.get(e.staffId) ?? [], NOT_THE_MONTHS, window);
    for (const [kind, map] of kinds) own[kind] = fingerprint(map.get(e.staffId) ?? [], NOT_CONTENT, kind === 'recurring' || kind === 'leave' ? window : undefined);
    stamps.employees[e.staffId] = own;
  }
  return stamps;
}

/** Read back a stored fingerprint, or null when there is none to compare with. */
export function storedInputStamps(value: unknown): InputStamps | null {
  if (!value || typeof value !== 'object') return null;
  const stamps = value as Partial<InputStamps>;
  return stamps.version === 1 && stamps.employees && typeof stamps.employees === 'object' ? (stamps as InputStamps) : null;
}

/** Who changed, and what, between the fingerprint a draft was worked out from and the records now. */
export function diffInputStamps(saved: InputStamps, current: InputStamps): RecordsChanged[] {
  const changed: RecordsChanged[] = [];
  const ids = new Set([...Object.keys(saved.employees), ...Object.keys(current.employees)]);
  for (const staffId of ids) {
    const before = saved.employees[staffId];
    const now = current.employees[staffId];
    if (!before) {
      changed.push({ staffId, what: ['joined this month’s payroll'] });
      continue;
    }
    if (!now) {
      changed.push({ staffId, what: ['no longer in this month’s payroll'] });
      continue;
    }
    const kinds = (Object.keys(STAMP_KINDS) as StampKind[]).filter((kind) => before[kind] !== now[kind]);
    if (kinds.length > 0) changed.push({ staffId, what: kinds.map((kind) => STAMP_KINDS[kind]) });
  }
  return changed;
}
