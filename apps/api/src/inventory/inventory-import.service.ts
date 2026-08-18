import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { ParsedInventoryRow, RowProblem, parseInventoryCsv } from './inventory-csv';

export interface ImportResult {
  /** True when nothing was written — either a dry run or a file with problems. */
  dryRun: boolean;
  created: number;
  updated: number;
  /** Rows that arrived with no divisor and no declaration. */
  needsAttention: number;
  problems: RowProblem[];
}

/**
 * THE UPLOAD. Validate everything, then write everything, or write nothing.
 *
 * A partially-imported file is the worst outcome available here. The clinic
 * cannot tell which rows landed, the obvious remedy (fix the file, upload
 * again) is the right one anyway, and re-uploading is safe because rows are
 * matched by NAME rather than appended. So a file with any problem in it
 * imports nothing and reports every problem at once — one pass through the
 * spreadsheet instead of one round trip per mistake.
 *
 * D4 — EVERY ROW THIS TOUCHES HAS `defaultsFromSeed` CLEARED. `seed:standard-rx`
 * skips a row whose defaults it did not write, and it decides that by this
 * flag. Without the clear, the next seeder run would revert a clinic's own
 * curation without a word — which is the exact defect Phase 1G found in the
 * item PATCH path and fixed there. An upload is a bigger version of the same
 * edit, so it clears the flag on everything it writes, whether or not the row
 * carried a dosage instruction.
 */
@Injectable()
export class InventoryImportService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async import(csv: string, options: { dryRun?: boolean } = {}): Promise<ImportResult> {
    const parsed = parseInventoryCsv(csv);
    const problems = [...parsed.problems];

    const [stockUnits, doseUnits, frequencies, methods, existing] = await Promise.all([
      this.prisma.stockUnitRef.findMany({ where: { active: true }, select: { id: true, name: true } }),
      this.prisma.dosageUnit.findMany({ where: { active: true }, select: { id: true, systemNameEn: true } }),
      this.prisma.prescriptionFrequency.findMany({ where: { active: true }, select: { id: true, code: true } }),
      this.prisma.consumptionMethodRef.findMany({
        where: { active: true },
        select: { id: true, methodBilingual: true },
      }),
      this.prisma.item.findMany({ select: { id: true, name: true } }),
    ]);

    const stockUnitByName = index(stockUnits, (row) => row.name);
    const doseUnitByName = index(doseUnits, (row) => row.systemNameEn);
    const frequencyByCode = index(frequencies, (row) => row.code);
    const methodByName = index(methods, (row) => row.methodBilingual);

    // Two existing items with the same name make "update by name" ambiguous,
    // and picking one silently would edit a medicine at random.
    const existingByName = new Map<string, string[]>();
    for (const item of existing) {
      const key = item.name.trim().toLowerCase();
      existingByName.set(key, [...(existingByName.get(key) ?? []), item.id]);
    }

    const plans: Array<{ row: ParsedInventoryRow; id: string | null; data: Record<string, unknown> }> = [];

    for (const row of parsed.rows) {
      const before = problems.length;

      const stockUnitId = resolve(row.stockUnitName, stockUnitByName, {
        line: row.line,
        column: 'Stock Unit',
        where: 'Settings › Prescription Vocabulary › Stock Units',
        problems,
      });
      const defaultDoseUnitId = resolve(row.doseUnitName, doseUnitByName, {
        line: row.line,
        column: 'Dose Unit',
        where: 'Settings › Prescription Vocabulary › Dosage Units',
        problems,
      });
      const defaultFrequencyId = resolve(row.frequencyCode, frequencyByCode, {
        line: row.line,
        column: 'Frequency',
        where: 'Settings › Prescription Vocabulary › Frequencies',
        problems,
      });
      const defaultConsumptionMethodId = resolve(row.consumptionMethodName, methodByName, {
        line: row.line,
        column: 'Consumption Method',
        where: 'Settings › Prescription Vocabulary › Consumption Methods',
        problems,
      });

      const matches = existingByName.get(row.name.trim().toLowerCase()) ?? [];
      if (matches.length > 1) {
        problems.push({
          line: row.line,
          column: 'Name',
          message: `This clinic already has ${matches.length} items called "${row.name}". Rename them so an upload knows which one it means.`,
        });
      }

      if (problems.length > before) continue;

      plans.push({
        row,
        id: matches[0] ?? null,
        data: this.dataFor(row, {
          stockUnitId,
          defaultDoseUnitId,
          defaultFrequencyId,
          defaultConsumptionMethodId,
        }),
      });
    }

    // Nothing is written while anything is wrong. See the class comment.
    if (problems.length > 0 || options.dryRun) {
      return {
        dryRun: true,
        created: plans.filter((plan) => plan.id === null).length,
        updated: plans.filter((plan) => plan.id !== null).length,
        needsAttention: parsed.needsAttention,
        problems,
      };
    }

    const tenantId = currentTenantId();
    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const plan of plans) {
        if (plan.id) {
          await tx.item.update({ where: { id: plan.id }, data: plan.data as never });
          updated += 1;
        } else {
          await tx.item.create({
            // `name` and `sellPrice` are both required by the parser, so the
            // plan always carries them; the cast is about Prisma's generated
            // input type, not about a value that might be missing.
            data: { ...plan.data, tenantId, name: plan.row.name, sellPrice: plan.row.sellPrice } as never,
          });
          created += 1;
        }
      }
    });

    return { dryRun: false, created, updated, needsAttention: parsed.needsAttention, problems: [] };
  }

  /**
   * One row's writes.
   *
   * A blank cell is left out of the payload entirely — `undefined` means
   * "leave it alone", which is what a blank in a 200-row template almost
   * always is. The exception is the D1 declaration, which is always decided:
   * the word was there or it was not.
   *
   * ONE INPUT WRITES BOTH HOMES for dose unit, frequency, duration and
   * consumption method. The structured 1F reference is what the prescribing
   * form reads first; the legacy free-text column beside it is still read as a
   * fallback (`defaultsFromItem`). Two columns in the template would get
   * filled inconsistently; writing both from one cell means they cannot
   * disagree.
   */
  private dataFor(
    row: ParsedInventoryRow,
    ids: {
      stockUnitId?: string;
      defaultDoseUnitId?: string;
      defaultFrequencyId?: string;
      defaultConsumptionMethodId?: string;
    },
  ): Record<string, unknown> {
    return prune({
      name: row.name,
      code: row.code,
      category: row.category,
      concVolMl: row.concVolMl,
      strengthMg: row.strengthMg,
      sellPrice: row.sellPrice,
      cost: row.cost,
      active: row.active,
      tracksBatchExpiry: row.tracksBatchExpiry,
      indication: row.indication,
      prescriptionReference: row.prescriptionReference,
      remark: row.remark,
      defaultDispenseQuantity: row.defaultDispenseQuantity,

      // How it is counted, and D1's declaration with its author.
      stockUnitId: ids.stockUnitId,
      quantityPerStockUnit: row.quantityPerStockUnit ?? undefined,
      ...(row.dispensedWhole
        ? { dispensedWholeAt: new Date(), dispensedWholeByStaffId: currentStaffId() ?? null }
        : {}),

      // The 1F reference and the legacy free text, from one cell each.
      defaultDoseAmount: row.doseAmount,
      doseDefault: row.doseAmount === undefined ? undefined : String(row.doseAmount),
      defaultDoseUnitId: ids.defaultDoseUnitId,
      doseUnitDefault: row.doseUnitName,
      defaultFrequencyId: ids.defaultFrequencyId,
      frequencyDefault: row.frequencyCode,
      defaultDurationValue: row.durationValue,
      defaultDurationUnit: row.durationUnit,
      durationDefault: row.durationValue === undefined ? undefined : String(row.durationValue),
      defaultConsumptionMethodId: ids.defaultConsumptionMethodId,
      consumptionMethod: row.consumptionMethodName,

      // D4 — this row is the clinic's now, so `seed:standard-rx` leaves it
      // alone. Set on EVERY row the upload writes, not only rows carrying a
      // dosage instruction: the flag is the seeder's only signal, and a row
      // the clinic has curated should not depend on which columns they used.
      defaultsFromSeed: false,
    });
  }
}

function index<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [key(row).trim().toLowerCase(), row]));
}

/**
 * A name into an id, or a problem naming WHERE to add it.
 *
 * "Unknown frequency" sends somebody looking. "TDSS is not on this clinic's
 * frequency list — add it in Settings › Prescription Vocabulary › Frequencies"
 * is a row they can fix and a path they can follow.
 */
function resolve<T extends { id: string }>(
  value: string | undefined,
  lookup: Map<string, T>,
  context: { line: number; column: string; where: string; problems: RowProblem[] },
): string | undefined {
  if (!value) return undefined;
  const found = lookup.get(value.trim().toLowerCase());
  if (!found) {
    context.problems.push({
      line: context.line,
      column: context.column,
      message: `"${value}" is not on this clinic's list. Add it in ${context.where}, or use one of the existing entries.`,
    });
    return undefined;
  }
  return found.id;
}

/** Drops the keys a blank cell produced, so they never reach the update. */
function prune(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}
