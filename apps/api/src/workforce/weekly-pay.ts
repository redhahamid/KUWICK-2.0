import { Prisma } from '@prisma/client';
import type { NightPayMode as NightPayModeRow, PaidHoursRule } from '@prisma/client';
import type { AdminTx } from '../finance/admin-actor';
import { currentTenantId } from '../core/tenant-context';
import { resolveAttendancePolicy } from './attendance-policy';
import type { MaterialisedInput } from './payroll-materialisation';
import { datesToLoad, hoursOf, NightPayMode, OvertimeBasis, priceWeek, WorkedShift, workOutWeeks } from './weekly-hours';

/**
 * LOADING A PERSON'S WEEKS for `weekly-hours.ts`: roster + attendance → paid
 * minutes per shift (Section C, 14 October 2026).
 *
 * The published roster is the approval (decision 3). A day's paid minutes
 * follow the branch's paid-hours rule:
 *   ROSTER_CONFIRMED  the rostered hours, once the person clocked in
 *   SCANS_CAPPED      the scanned hours, never more than the roster
 *   SCANS             the scanned hours as they are
 * Minutes worked past the roster are added only once a manager approved them
 * on the Timesheet. A day nobody rostered counts only approved minutes.
 */

const iso = (date: Date) => date.toISOString().slice(0, 10);
const cents = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value) * 100));

export interface DoctorNightPay {
  nightPayMode: NightPayModeRow | null;
  nightRate: unknown;
}

function nightPayOf(own: DoctorNightPay | null, template: DoctorNightPay | null): { mode: NightPayMode; amountCents: number } | null {
  // The doctor's own setting wins over the night shift template's.
  for (const source of [own, template]) {
    const amount = cents(source?.nightRate);
    if (source && amount !== null && amount > 0) return { mode: source.nightPayMode ?? 'PER_SHIFT', amountCents: amount };
  }
  return null;
}

export function paidMinutes(
  rule: PaidHoursRule,
  rosteredMinutes: number,
  record: { clockInAt: Date | null; workedMinutes: number | null; overtimeMinutes: number; overtimeApproved: boolean },
): number {
  const approvedExtra = record.overtimeApproved ? record.overtimeMinutes : 0;
  if (rosteredMinutes <= 0) return approvedExtra;
  const worked = record.workedMinutes ?? 0;
  if (rule === 'SCANS') return worked;
  if (rule === 'SCANS_CAPPED') return Math.min(worked, rosteredMinutes) + approvedExtra;
  return (record.clockInAt ? rosteredMinutes : 0) + approvedExtra;
}

export async function loadWorkedShifts(
  tx: AdminTx,
  args: { staffId: string; from: string; to: string; doctorNightPay: DoctorNightPay | null },
): Promise<{ shifts: WorkedShift[]; notes: { date: string; text: string }[] }> {
  const between = { gte: new Date(`${args.from}T00:00:00.000Z`), lte: new Date(`${args.to}T00:00:00.000Z`) };
  const [records, rostered] = await Promise.all([
    tx.attendanceRecord.findMany({
      where: { staffId: args.staffId, workDate: between },
      select: { workDate: true, clinicId: true, clockInAt: true, workedMinutes: true, overtimeMinutes: true, overtimeApproved: true },
    }),
    tx.providerShift.findMany({
      where: { staffId: args.staffId, shiftDate: between, shiftType: { in: ['WORKING', 'LOCUM'] } },
      select: {
        clinicId: true,
        shiftDate: true,
        startsAt: true,
        endsAt: true,
        breakMinutes: true,
        night: true,
        template: { select: { nightPayMode: true, nightRate: true } },
      },
    }),
  ]);
  const clinicIds = [...new Set([...records.map((row) => row.clinicId), ...rostered.map((row) => row.clinicId)].filter((id): id is string => !!id))];
  const [policies, published] = await Promise.all([
    tx.attendancePolicy.findMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { clinicId: null }] } }),
    tx.rosterPublication.findMany({ where: { clinicId: { in: clinicIds } }, select: { clinicId: true, month: true } }),
  ]);
  const isPublished = (clinicId: string, date: string) => published.some((row) => row.clinicId === clinicId && row.month === date.slice(0, 7));
  const notes: { date: string; text: string }[] = [];

  const shifts: WorkedShift[] = records.map((record) => {
    const date = iso(record.workDate);
    const sameDay = rostered.filter((shift) => iso(shift.shiftDate) === date && (!record.clinicId || shift.clinicId === record.clinicId));
    const onRoster = sameDay.filter((shift) => isPublished(shift.clinicId, date));
    if (sameDay.length > onRoster.length) {
      notes.push({ date, text: `The roster for ${date.slice(0, 7)} is not published, so ${date} counts only overtime approved on the Timesheet.` });
    }
    const rosteredMinutes = onRoster.reduce(
      (sum, shift) => sum + Math.max(0, Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000) - shift.breakMinutes),
      0,
    );
    const rule = resolveAttendancePolicy(policies, record.clinicId ?? null).paidHoursRule;
    const night = onRoster.find((shift) => shift.night) ?? null;
    return {
      date,
      minutes: paidMinutes(rule, rosteredMinutes, record),
      night: !!night,
      nightPay: night ? nightPayOf(args.doctorNightPay, night.template) : null,
    };
  });
  return { shifts, notes };
}

export interface WeeklyPayArgs {
  staffId: string;
  clinicId: string | null;
  group: 'DOCTOR' | 'STAFF';
  basis: OvertimeBasis;
  /** First of the month the weeks end in: the month before the run's. */
  earnedMonth: Date;
  weeklyNormalHours: number;
  normalDayMinutes: number;
  restDayOfWeek: number | null;
  employedFrom: Date | null;
  employedTo: Date | null;
  /** Staff overtime: hourly rate, multiplier, and whether overtime is owed at all. */
  overtime: { hourlyCents: number; multiplier: number; paid: boolean };
  /** Doctors: their own locum rate, else the rule set's. */
  locumHourlyCents: number | null;
  doctorNightPay: DoctorNightPay | null;
}

const shortDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rm = (amountCents: number) => `RM${(amountCents / 100).toFixed(2)}`;

/**
 * Work out, store and turn into payroll items the weeks ending in `earnedMonth`
 * for one person. The stored `work_weeks` row is what each item points at and
 * what the payroll page shows as the week-by-week working.
 */
export async function payWeeks(tx: AdminTx, args: WeeklyPayArgs): Promise<MaterialisedInput[]> {
  const month = iso(args.earnedMonth).slice(0, 7);
  const attendancePolicies = await tx.attendancePolicy.findMany({
    where: args.clinicId ? { OR: [{ clinicId: args.clinicId }, { clinicId: null }] } : { clinicId: null },
  });
  const weekStartDay = resolveAttendancePolicy(attendancePolicies, args.clinicId).weekStartDay;
  const range = datesToLoad(month, { weekStartDay, basis: args.basis });
  if (!range) return [];

  const holidayRows = await tx.publicHoliday.findMany({
    where: { date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
    select: { date: true, name: true, multiplier: true },
  });
  const holidays = new Map(
    holidayRows.map((row) => [iso(row.date), { name: row.name, multiplier: row.multiplier === null ? null : Number(row.multiplier) }]),
  );
  const loaded = await loadWorkedShifts(tx, { staffId: args.staffId, from: range.from, to: range.to, doctorNightPay: args.doctorNightPay });
  const weeks = workOutWeeks(month, loaded.shifts, {
    group: args.group,
    basis: args.basis,
    weeklyNormalMinutes: Math.round(args.weeklyNormalHours * 60),
    normalDayMinutes: args.normalDayMinutes,
    weekStartDay,
    holidays,
    restDayOfWeek: args.restDayOfWeek,
    employedFrom: args.employedFrom ? iso(args.employedFrom) : null,
    employedTo: args.employedTo ? iso(args.employedTo) : null,
  });

  const inputs: MaterialisedInput[] = [];
  const kept: string[] = [];
  for (const week of weeks) {
    for (const note of loaded.notes) {
      if (note.date >= week.weekStart && note.date <= week.weekEnd && !week.notes.includes(note.text)) week.notes.push(note.text);
    }
    const pay = priceWeek(week, {
      overtimeHourlyCents: args.overtime.hourlyCents,
      overtimeMultiplier: args.overtime.multiplier,
      locumHourlyCents: args.locumHourlyCents,
    });
    if (!args.overtime.paid && pay.overtimeCents > 0) {
      week.notes.push('Wages are above the overtime limit and no overtime was agreed, so the hours are shown but not paid.');
      pay.overtimeCents = 0;
    }
    if (args.group === 'DOCTOR' && args.locumHourlyCents === null && (week.locumMinutes > 0 || week.holidayLocum.length > 0)) {
      week.notes.push('No locum rate is set for this doctor or the rule set, so the locum hours are not paid.');
    }
    const amountCents = pay.overtimeCents + pay.locumCents + pay.holidayCents + pay.nightCents;
    const saved = await tx.workWeek.upsert({
      where: { staffId_weekStart: { staffId: args.staffId, weekStart: new Date(`${week.weekStart}T00:00:00Z`) } },
      create: {
        tenantId: currentTenantId(),
        staffId: args.staffId,
        weekStart: new Date(`${week.weekStart}T00:00:00Z`),
        weekEnd: new Date(`${week.weekEnd}T00:00:00Z`),
        earnedMonth: args.earnedMonth,
        overtimeMinutes: week.overtimeMinutes,
        locumMinutes: week.locumMinutes,
        nightShifts: week.nights.length,
        amountCents,
        working: { ...week, basis: args.basis, group: args.group, pay } as unknown as Prisma.InputJsonValue,
      },
      update: {
        earnedMonth: args.earnedMonth,
        overtimeMinutes: week.overtimeMinutes,
        locumMinutes: week.locumMinutes,
        nightShifts: week.nights.length,
        amountCents,
        working: { ...week, basis: args.basis, group: args.group, pay } as unknown as Prisma.InputJsonValue,
      },
    });
    kept.push(saved.id);

    const label = `Week ${shortDate(week.weekStart)} – ${shortDate(week.weekEnd)}`;
    const item = (componentCode: string, name: string, amount: number, provenance: string): MaterialisedInput => ({
      staffId: args.staffId,
      componentCode,
      label: name,
      amountCents: amount,
      source: 'ATTENDANCE',
      sourceRecordId: saved.id,
      earnedPeriod: args.earnedMonth,
      provenance: `${label}: ${provenance} The published roster is the approval.`,
      approvedBy: null,
    });
    if (pay.overtimeCents > 0) {
      inputs.push(
        item('OVERTIME', 'Overtime', pay.overtimeCents, `${hoursOf(week.overtimeMinutes)} h overtime × ${rm(args.overtime.hourlyCents)} × ${args.overtime.multiplier}.`),
      );
    }
    if (pay.locumCents + pay.holidayCents > 0) {
      const holidayHours = week.holidayLocum.reduce((sum, day) => sum + day.minutes, 0);
      inputs.push(
        item(
          'LOCUM_FEE',
          'Locum hours',
          pay.locumCents + pay.holidayCents,
          `${hoursOf(week.locumMinutes)} h above the weekly normal` +
            (holidayHours > 0 ? ` and ${hoursOf(holidayHours)} h on public holidays` : '') +
            ` at ${rm(args.locumHourlyCents ?? 0)} an hour.`,
        ),
      );
    }
    if (pay.nightCents > 0) {
      inputs.push(item('NIGHT_INCENTIVE', 'Night shifts', pay.nightCents, `${week.nights.length} night shift${week.nights.length === 1 ? '' : 's'}.`));
    }
  }
  // A week no longer worked out for this month (the week start setting changed) is not left behind.
  await tx.workWeek.deleteMany({ where: { staffId: args.staffId, earnedMonth: args.earnedMonth, id: { notIn: kept } } });
  return inputs;
}
