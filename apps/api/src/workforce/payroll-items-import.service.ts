import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PayComponent, PayrollInputKind } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import { employedInMonth, paidThisMonth } from './employed-in-month';
import { itemAppliesTo, monthBefore, monthLabel } from './payroll-register-columns';
import type { ItemsImportDto } from './dto/items-import.dto';

/**
 * IMPORT A MONTH'S ITEMS FROM A CSV (UAT, 10 October 2026).
 *
 * For moving a clinic's past months in: "load Jan–Sep 2026 from the clinic's
 * old payroll in one upload per month, instead of ~45 lines typed by hand each
 * month." One file, one month, one draft run:
 *
 *   Employee No. | Item code | Amount (RM) | Earned in | PCB type | Note
 *
 * NOTHING IS SAVED UNTIL EVERY ROW PASSES. The same call previews (every row
 * checked, nothing written) and, with `commit`, writes; a commit re-checks
 * from scratch and refuses if any row fails, so a preview that went stale
 * cannot half-save a month.
 *
 * AN IMPORTED LINE IS A HAND-ADDED LINE with `source = IMPORT`: one per
 * person and item, the same payslip line, earned-in label, pay date and
 * statutory treatment, editable on the grid. Two things follow from that:
 *   * Re-uploading a month REPLACES that month's previous import for the
 *     run's people, and a line copied from last month for the same person and
 *     item. A line somebody typed this month is theirs: the row is refused
 *     until it is cleared, rather than paid twice or overwritten.
 *   * A line the run derives (overtime from attendance, unpaid leave from the
 *     leave queue, a claim, a recurring item) for the same person and item
 *     refuses the row too: the import would pay it a second time.
 *
 * UNPAID_LEAVE_DAYS is DAYS, not ringgit. It is stored as an Unpaid leave
 * line carrying the days, and the run prices it at the rule set's daily rate
 * each time the month is worked out, exactly as it prices leave from the
 * leave queue.
 *
 * PCB TYPE IS THE ITEM'S. Whether pay is normal or additional remuneration
 * for PCB is a setting on the item in Payroll items, and the calculation reads
 * that, not the line; a column that could disagree would be ignored in
 * silence. So a blank cell takes the item's setting and a cell that
 * contradicts it is refused, naming the setting to change.
 */

/** Days, priced by the run. Not an item in Payroll items: it becomes an Unpaid leave line. */
export const UNPAID_DAYS_CODE = 'UNPAID_LEAVE_DAYS';
/** Items a file may not name: basic pay comes from the salary record, PCB is worked out, and unpaid leave is entered in days. */
const NOT_IMPORTABLE = new Set(['BASIC', 'PCB', 'UNPAID_LEAVE']);

export type ImportRowResult = {
  row: number;
  employeeNo: string;
  itemCode: string;
  ok: boolean;
  problems: string[];
  /** Filled where the row could be read. */
  name?: string;
  staffId?: string;
  itemName?: string;
  addsOrDeducts?: 'ADDS' | 'DEDUCTS';
  amount?: string | null;
  days?: string | null;
  earnedIn?: string | null;
  pcbType?: 'normal' | 'additional';
  note?: string | null;
  /** A line this row replaces: the previous import, or one carried from last month. */
  replaces?: string | null;
};

export type ImportResult = {
  runId: string;
  period: string;
  committed: boolean;
  rows: ImportRowResult[];
  passed: number;
  failed: number;
  /** Lines the last import for this month left, which a commit replaces. */
  previousImport: number;
  /** Lines the commit removed: last import for the month, and carried lines it supersedes. */
  replaced: number;
  added: number;
};

const MONEY = /^\d+(\.\d{1,2})?$/;

@Injectable()
export class PayrollItemsImportService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The codes a file may use, for the template: the clinic's own items plus UNPAID_LEAVE_DAYS. */
  async codes() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const items = latestByCode(await this.prisma.payComponent.findMany({ where: { active: true }, orderBy: { effectiveFrom: 'desc' } }));
    return {
      codes: [
        ...[...items.values()]
          .filter((item) => !NOT_IMPORTABLE.has(item.code))
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((item) => ({
            code: item.code,
            name: item.name,
            addsOrDeducts: item.type === 'DEDUCTION' ? ('DEDUCTS' as const) : ('ADDS' as const),
            pcbType: item.additionalRemuneration ? ('additional' as const) : ('normal' as const),
            unit: 'RM' as const,
          })),
        { code: UNPAID_DAYS_CODE, name: 'Unpaid leave, in days', addsOrDeducts: 'DEDUCTS' as const, pcbType: 'normal' as const, unit: 'days' as const },
      ],
    };
  }

  async importItems(runId: string, dto: ItemsImportDto): Promise<ImportResult> {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED') {
        throw new ConflictException(
          `${monthLabel(run.period)} is ${run.status.toLowerCase()}. Items are imported into a draft month only; an approved month is corrected by an adjustment.`,
        );
      }
      if (run.runType !== 'REGULAR') {
        throw new ConflictException('Items are imported into the month’s regular run, not a bonus or correction run.');
      }
      const period = run.period;
      const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
      const daysInMonth = Math.round((periodEnd.getTime() - period.getTime()) / 86_400_000);
      const month = period.toISOString().slice(0, 7);

      const checked = await this.check(tx, run, dto, { period, periodEnd, daysInMonth, month });
      const passed = checked.rows.filter((row) => row.ok).length;
      const failed = checked.rows.length - passed;
      const base: ImportResult = {
        runId,
        period: month,
        committed: false,
        rows: checked.rows,
        passed,
        failed,
        previousImport: checked.previousImport,
        replaced: 0,
        added: 0,
      };
      if (!dto.commit || failed > 0 || checked.rows.length === 0) return base;

      // ---- Commit: replace, then add, in this one transaction. ------------
      const removed = await tx.payrollInputEntry.deleteMany({
        where: {
          period,
          staffId: { in: checked.runStaffIds },
          OR: [{ source: 'IMPORT' }, { id: { in: checked.carriedToReplace } }],
        },
      });
      for (const row of checked.writes) {
        await tx.payrollInputEntry.create({
          data: {
            tenantId: currentTenantId(),
            clinicId: row.clinicId,
            staffId: row.staffId,
            period,
            componentCode: row.componentCode,
            label: row.label,
            amount: row.amount,
            quantity: row.quantity,
            source: 'IMPORT',
            sourceRecordId: null,
            kind: row.kind,
            earnedPeriod: row.earnedPeriod,
            reason: `Imported from ${dto.fileName ?? 'a CSV file'}, row ${row.row}`,
            note: row.note,
            createdByStaffId: actor.id,
          },
        });
      }
      await recordAudit(tx, actor, {
        action: 'payrollInput.imported',
        entityType: 'PayrollRun',
        entityId: run.id,
        reason:
          `Imported ${checked.writes.length} line${checked.writes.length === 1 ? '' : 's'} for ${monthLabel(period)} from ` +
          `${dto.fileName ?? 'a CSV file'}; replaced ${removed.count} earlier line${removed.count === 1 ? '' : 's'}.`,
        after: {
          fileName: dto.fileName ?? null,
          period: month,
          lines: checked.writes.length,
          replaced: removed.count,
          people: new Set(checked.writes.map((row) => row.staffId)).size,
        },
      });
      return { ...base, committed: true, replaced: removed.count, added: checked.writes.length };
    });
  }

  private async check(
    tx: AdminTx,
    run: { id: string; clinicId: string | null; legalEmployerId: string | null; period: Date },
    dto: ItemsImportDto,
    month: { period: Date; periodEnd: Date; daysInMonth: number; month: string },
  ) {
    const { period, periodEnd, daysInMonth } = month;
    const lastDay = new Date(periodEnd.getTime() - 86_400_000);

    // Everybody with an employee number, so "unknown" and "not in this month" read differently.
    const everyone = await tx.employeeProfile.findMany({
      where: { employeeNo: { not: null } },
      select: { staffId: true, employeeNo: true, engagement: true, staff: { select: { fullName: true, clinicId: true } } },
    });
    const byNo = new Map<string, typeof everyone>();
    for (const person of everyone) {
      const key = normNo(person.employeeNo ?? '');
      byNo.set(key, [...(byNo.get(key) ?? []), person]);
    }
    // The run's people, by the run's own rule.
    const runPeople = (
      await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          ...employedInMonth(period, periodEnd),
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
          ...(run.legalEmployerId ? { legalEmployerId: run.legalEmployerId } : {}),
        },
        select: { staffId: true, endDate: true, staff: { select: { active: true, clinicId: true } } },
      })
    ).filter(paidThisMonth);
    const inRun = new Map(runPeople.map((person) => [person.staffId, person]));

    // Items: the version in force for the month, else the latest active one.
    const versions = await tx.payComponent.findMany({ where: { active: true }, orderBy: { effectiveFrom: 'desc' } });
    const inForce = new Map<string, PayComponent>();
    for (const version of versions) {
      const live = version.effectiveFrom <= lastDay && (!version.effectiveTo || version.effectiveTo >= period);
      if (live && !inForce.has(version.code)) inForce.set(version.code, version);
    }
    for (const [code, latest] of latestByCode(versions)) if (!inForce.has(code)) inForce.set(code, latest);
    const unpaidLeave = inForce.get('UNPAID_LEAVE');

    // What is already on this month for the run's people.
    const existing = await tx.payrollInputEntry.findMany({
      where: { period, staffId: { in: [...inRun.keys()] } },
      select: { id: true, staffId: true, componentCode: true, source: true, carriedFromId: true },
    });

    const rows: ImportRowResult[] = [];
    const writes: {
      row: number;
      staffId: string;
      clinicId: string | null;
      componentCode: string;
      label: string | null;
      amount: string;
      quantity: string | null;
      kind: PayrollInputKind;
      earnedPeriod: Date | null;
      note: string | null;
    }[] = [];
    const carriedToReplace: string[] = [];
    const seen = new Map<string, number>();

    dto.rows.forEach((input, index) => {
      const rowNo = index + 1;
      const employeeNo = (input.employeeNo ?? '').trim();
      const rawCode = (input.itemCode ?? '').trim().toUpperCase();
      const result: ImportRowResult = { row: rowNo, employeeNo, itemCode: rawCode, ok: false, problems: [] };
      rows.push(result);

      // ---- Who. --------------------------------------------------------------
      let staffId: string | undefined;
      if (!employeeNo) {
        result.problems.push('No Employee No.');
      } else {
        const matches = byNo.get(normNo(employeeNo)) ?? [];
        if (matches.length === 0) {
          result.problems.push(`No employee has Employee No. ${employeeNo}.`);
        } else if (matches.length > 1) {
          result.problems.push(`${matches.length} employees share Employee No. ${employeeNo}. Give each their own number first.`);
        } else {
          const person = matches[0];
          result.name = person.staff.fullName;
          if (person.engagement === 'CONTRACTOR') {
            result.problems.push(`${person.staff.fullName} is a contractor, paid outside payroll.`);
          } else if (!inRun.has(person.staffId)) {
            result.problems.push(
              `${person.staff.fullName} is not in ${monthLabel(period)}’s run: not employed here that month, or at another branch or company.`,
            );
          } else {
            staffId = person.staffId;
            result.staffId = staffId;
          }
        }
      }

      // ---- What. -------------------------------------------------------------
      const isDays = rawCode === UNPAID_DAYS_CODE;
      const item = isDays ? unpaidLeave : inForce.get(rawCode);
      if (!rawCode) {
        result.problems.push('No item code.');
      } else if (!isDays && NOT_IMPORTABLE.has(rawCode)) {
        result.problems.push(
          rawCode === 'UNPAID_LEAVE'
            ? 'Unpaid leave is imported in days: use UNPAID_LEAVE_DAYS and the number of days.'
            : rawCode === 'BASIC'
              ? 'Basic pay comes from the salary record, not from an import.'
              : 'PCB is worked out by the run, not imported.',
        );
      } else if (!item) {
        result.problems.push(`"${rawCode}" is not an item in Payroll items.`);
      } else {
        result.itemName = isDays ? 'Unpaid leave' : item.name;
        result.addsOrDeducts = item.type === 'DEDUCTION' ? 'DEDUCTS' : 'ADDS';
        if (staffId && !itemAppliesTo(item, staffId)) {
          result.problems.push(`${item.name} is for selected employees only, and ${result.name} is not one of them.`);
        }
      }

      // ---- How much. ---------------------------------------------------------
      const rawAmount = (input.amount ?? '').trim().replace(/^RM\s*/i, '').replace(/,/g, '');
      let amount: string | null = null;
      let quantity: string | null = null;
      if (!rawAmount) {
        result.problems.push(isDays ? 'No number of days.' : 'No amount.');
      } else if (!MONEY.test(rawAmount) || Number(rawAmount) <= 0) {
        result.problems.push(
          isDays
            ? `"${input.amount}" is not a number of days: a positive number, up to two decimals (e.g. 1.5).`
            : `"${input.amount}" is not an amount: a positive number in ringgit, up to two decimals.`,
        );
      } else if (isDays && Number(rawAmount) > daysInMonth) {
        result.problems.push(`${rawAmount} days is more than the ${daysInMonth} days in ${monthLabel(period)}.`);
      } else if (isDays) {
        quantity = Number(rawAmount).toFixed(2);
        amount = '0.00';
        result.days = quantity;
      } else {
        amount = formatCents(toCents(rawAmount)).replace(/,/g, '');
        result.amount = amount;
      }

      // ---- Earned in. --------------------------------------------------------
      const rawEarned = (input.earnedIn ?? '').trim();
      let earnedPeriod: Date | null = null;
      if (rawEarned) {
        const match = /^(\d{4})-(\d{2})$/.exec(rawEarned);
        const earned = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : null;
        if (!earned || Number(match![2]) < 1 || Number(match![2]) > 12) {
          result.problems.push(`Earned in "${rawEarned}" is not a month: write it as YYYY-MM, e.g. 2026-01.`);
        } else if (earned > period) {
          result.problems.push(`Earned in ${monthLabel(earned)} is after ${monthLabel(period)}.`);
        } else {
          earnedPeriod = earned.getTime() === period.getTime() ? null : earned;
        }
      } else if (item && !isDays && item.payMonthOffset === 1) {
        // As a hand-added line: an item paid a month in arrears was earned the month before.
        earnedPeriod = monthBefore(period);
      }
      result.earnedIn = earnedPeriod ? earnedPeriod.toISOString().slice(0, 7) : null;

      // ---- PCB type: the item's. ---------------------------------------------
      const rawPcb = (input.pcbType ?? '').trim().toLowerCase();
      const itemPcb: 'normal' | 'additional' = item && !isDays && item.additionalRemuneration ? 'additional' : 'normal';
      if (rawPcb && rawPcb !== 'normal' && rawPcb !== 'additional') {
        result.problems.push(`PCB type "${input.pcbType}" is not normal or additional.`);
      } else if (rawPcb && item && rawPcb !== itemPcb) {
        result.problems.push(
          `${result.itemName} is ${itemPcb} remuneration for PCB in Payroll items, and this row says ${rawPcb}. ` +
            'PCB follows the item: change the item there, or leave the cell blank.',
        );
      }
      if (item) result.pcbType = itemPcb;

      const note = (input.note ?? '').trim() || null;
      result.note = note;

      // ---- Once per person and item, and nothing paid twice. ----------------
      const componentCode = isDays ? 'UNPAID_LEAVE' : rawCode;
      if (staffId && item) {
        const key = `${staffId}|${componentCode}`;
        const first = seen.get(key);
        if (first !== undefined) {
          result.problems.push(`Row ${first} already has ${result.itemName} for ${result.name}. Put the total on one row.`);
        } else {
          seen.set(key, rowNo);
        }
        const already = existing.filter((line) => line.staffId === staffId && line.componentCode === componentCode);
        for (const line of already) {
          if (line.source === 'IMPORT') {
            result.replaces = 'the earlier import';
          } else if (line.source === 'MANUAL' && line.carriedFromId) {
            result.replaces = 'the line carried from last month';
            carriedToReplace.push(line.id);
          } else if (line.source === 'MANUAL') {
            result.problems.push(
              `${result.name} already has ${result.itemName} typed in on the grid this month. Clear it there, or leave this row out.`,
            );
          } else {
            result.problems.push(
              `${result.name} already has ${result.itemName} from ${line.source.toLowerCase()} this month; importing it would pay it twice.`,
            );
          }
        }
      }

      result.ok = result.problems.length === 0;
      if (result.ok && staffId && amount !== null) {
        writes.push({
          row: rowNo,
          staffId,
          clinicId: inRun.get(staffId)?.staff.clinicId ?? null,
          componentCode,
          label: isDays ? `Unpaid leave · ${Number(quantity)} day${Number(quantity) === 1 ? '' : 's'}` : null,
          amount,
          quantity,
          kind: itemPcb === 'additional' ? 'ADDITIONAL' : 'RECURRING',
          earnedPeriod,
          note,
        });
      }
    });

    return {
      rows,
      writes,
      carriedToReplace,
      runStaffIds: [...inRun.keys()],
      previousImport: existing.filter((line) => line.source === 'IMPORT').length,
    };
  }
}

/** Employee numbers compare without case or surrounding space: "em-043" is EM-043. */
const normNo = (value: string) => value.trim().toUpperCase();

function latestByCode<T extends { code: string }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) if (!out.has(row.code)) out.set(row.code, row);
  return out;
}
