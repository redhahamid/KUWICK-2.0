import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from './admin-actor';
import { fromCents, toCents } from './money';

/**
 * PROFITABILITY — what each drug and each procedure actually earns.
 *
 * Kuwick already had a drug-movement report (what moved, how fast) and a
 * segmented P&L (which service LINE earns). Neither answers the question an
 * owner asks about a single item: this thing, this month, what did it bring in
 * and what did it cost me. That is this.
 *
 * SAME NUMBERS AS EVERYWHERE ELSE. Revenue is the line amount less its
 * discount plus its tax, in cents, exactly as `segment.service.ts` computes
 * it; cost is the catalogue cost on the item behind the line. Two screens that
 * derive the same figure two ways will disagree eventually, and on a
 * profitability screen the disagreement is the reason somebody stops stocking
 * a medicine.
 *
 * WHAT IT REFUSES TO SAY:
 *
 *   - "Net profit". Rent, salaries, utilities and equipment are not allocated
 *     to a line item. This is CONTRIBUTION, and every field is named so.
 *   - "Zero cost". A procedure with no cost basis is `costConfigured: false`
 *     and its margin is null — NOT a 100% margin, which is what silently
 *     treating an unknown as RM0 produces. That distinction is the whole
 *     reason this file exists rather than a `COALESCE(cost, 0)`.
 */

export type ProfitabilityKind = 'DRUG' | 'SERVICE';

export interface ProfitabilityRow {
  kind: ProfitabilityKind;
  /** Catalogue id where the line resolved to one; null for unresolved text lines. */
  referenceId: string | null;
  name: string;
  code: string | null;
  category: string | null;
  clinicId: string | null;
  clinicName: string | null;
  /** Units dispensed, or times the procedure was performed. */
  quantity: number;
  revenue: number;
  /** NULL where no cost basis exists — never zero standing in for unknown. */
  directCost: number | null;
  /** revenue − directCost, and NULL for the same reason. */
  contribution: number | null;
  /** Percent, NULL where contribution is. */
  margin: number | null;
  costConfigured: boolean;
  /** How many billed lines rolled into this row. */
  lines: number;
  invoices: number;
}

@Injectable()
export class ProfitabilityService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async report(params: { from: string; to: string; clinicId?: string; kind?: ProfitabilityKind }) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const lines = await this.prisma.invoiceLine.findMany({
      where: {
        cancelledAt: null,
        invoice: {
          status: { not: 'CANCELLED' },
          createdAt: { gte: from, lt: to },
          ...(clinicId ? { visit: { clinicId } } : {}),
        },
      },
      select: {
        invoiceId: true,
        description: true,
        quantity: true,
        amount: true,
        lineDiscountAmount: true,
        taxAmount: true,
        sourcePrescription: {
          select: {
            itemId: true,
            quantity: true,
            item: { select: { id: true, name: true, code: true, category: true, cost: true } },
          },
        },
        sourceOrderService: {
          select: {
            serviceCatalogId: true,
            quantity: true,
            serviceCatalog: { select: { id: true, name: true, code: true, category: true } },
          },
        },
        invoice: { select: { visit: { select: { clinicId: true, clinic: { select: { name: true } } } } } },
      },
    });

    type Bucket = Omit<ProfitabilityRow, 'revenue' | 'directCost' | 'contribution' | 'margin'> & {
      revenueCents: number;
      costCents: number;
      invoiceIds: Set<string>;
    };
    const buckets = new Map<string, Bucket>();

    for (const line of lines) {
      const revenueCents =
        toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0) + toCents(line.taxAmount);

      const item = line.sourcePrescription?.item ?? null;
      const service = line.sourceOrderService?.serviceCatalog ?? null;

      // A line that resolves to neither is still REVENUE and must appear —
      // dropping it would make the totals disagree with the sales report. It
      // groups by its own description and carries no cost basis.
      const kind: ProfitabilityKind = item ? 'DRUG' : 'SERVICE';
      if (params.kind && params.kind !== kind) continue;

      const referenceId = item?.id ?? service?.id ?? null;
      const clinic = line.invoice?.visit?.clinicId ?? null;
      const key = `${kind}:${referenceId ?? `text:${line.description}`}:${clinic ?? 'all'}`;

      // Units: the PRESCRIBED/ORDERED quantity where the line came from one,
      // because that is what was actually dispensed or performed. The invoice
      // line's own quantity is a billing quantity and can differ.
      const units = item
        ? (line.sourcePrescription?.quantity ?? line.quantity)
        : (line.sourceOrderService?.quantity ?? line.quantity);

      // Cost basis: standard cost from the item catalogue. NULL is unknown and
      // stays unknown; see the header.
      const unitCost = item?.cost ?? null;
      const costConfigured = kind === 'DRUG' ? unitCost !== null && unitCost !== undefined : false;
      const costCents = costConfigured ? toCents(unitCost) * units : 0;

      const existing = buckets.get(key);
      if (existing) {
        existing.quantity += units;
        existing.revenueCents += revenueCents;
        existing.costCents += costCents;
        existing.lines += 1;
        existing.invoiceIds.add(line.invoiceId);
        // One line without a cost makes the whole row's cost incomplete.
        existing.costConfigured = existing.costConfigured && costConfigured;
      } else {
        buckets.set(key, {
          kind,
          referenceId,
          name: item?.name ?? service?.name ?? line.description,
          code: item?.code ?? service?.code ?? null,
          category: item?.category ?? service?.category ?? null,
          clinicId: clinic,
          clinicName: line.invoice?.visit?.clinic?.name ?? null,
          quantity: units,
          revenueCents,
          costCents,
          costConfigured,
          lines: 1,
          invoices: 0,
          invoiceIds: new Set([line.invoiceId]),
        });
      }
    }

    const rows: ProfitabilityRow[] = [...buckets.values()].map((bucket) => {
      const contributionCents = bucket.costConfigured ? bucket.revenueCents - bucket.costCents : null;
      return {
        kind: bucket.kind,
        referenceId: bucket.referenceId,
        name: bucket.name,
        code: bucket.code,
        category: bucket.category,
        clinicId: bucket.clinicId,
        clinicName: bucket.clinicName,
        quantity: bucket.quantity,
        revenue: fromCents(bucket.revenueCents),
        directCost: bucket.costConfigured ? fromCents(bucket.costCents) : null,
        contribution: contributionCents === null ? null : fromCents(contributionCents),
        margin:
          contributionCents === null || bucket.revenueCents === 0
            ? null
            : Math.round((contributionCents / bucket.revenueCents) * 1000) / 10,
        costConfigured: bucket.costConfigured,
        lines: bucket.lines,
        invoices: bucket.invoiceIds.size,
      };
    });

    rows.sort((a, b) => b.revenue - a.revenue);

    // Totals are summed over the rows that HAVE a cost basis, and the rest are
    // reported as their own figure. A total contribution that quietly included
    // rows costing "nothing" would be the same lie one level up.
    const costed = rows.filter((row) => row.costConfigured);
    const revenueCents = rows.reduce((total, row) => total + toCents(row.revenue), 0);
    const costedRevenueCents = costed.reduce((total, row) => total + toCents(row.revenue), 0);
    const costCents = costed.reduce((total, row) => total + toCents(row.directCost ?? 0), 0);

    return {
      from: params.from,
      to: params.to,
      clinicId: clinicId ?? null,
      costBasis:
        'Direct cost is each item’s current catalogue cost price × units dispensed. Weighted-average and FIFO costing are not implemented and this figure does not claim to be either.',
      contributionNote:
        'Contribution is revenue less direct item cost. Rent, salaries, equipment and every other overhead are NOT allocated, so this is a contribution figure and never net profit.',
      rows,
      totals: {
        revenue: fromCents(revenueCents),
        /** Only the part of revenue that has a cost basis behind it. */
        costedRevenue: fromCents(costedRevenueCents),
        directCost: fromCents(costCents),
        contribution: fromCents(costedRevenueCents - costCents),
        margin:
          costedRevenueCents === 0
            ? null
            : Math.round(((costedRevenueCents - costCents) / costedRevenueCents) * 1000) / 10,
        rows: rows.length,
        rowsWithoutCost: rows.length - costed.length,
        revenueWithoutCost: fromCents(revenueCents - costedRevenueCents),
      },
    };
  }
}
