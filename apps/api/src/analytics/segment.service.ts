import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { fromCents, toCents } from '../finance/money';
import { MappingRule, accumulateSegments, grossProfitCents, marginPercent } from './segment-mapping';
import { UpsertSegmentDto } from './dto/upsert-segment.dto';

/**
 * SEGMENTED P&L — Hijraa's service-line split, as configuration.
 *
 * Every figure here is a GROSS PROFIT or a CONTRIBUTION, never a net profit:
 * rent, salaries and utilities are not allocated to segments anywhere in this
 * system, and the field names say so (owner brief §6J).
 */
@Injectable()
export class SegmentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async listSegments() {
    await requirePermission(this.rawPrisma, 'analytics.view');
    const segments = await this.prisma.businessSegment.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { rules: { orderBy: { priority: 'asc' } } },
    });
    return segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      code: segment.code,
      colour: segment.colour,
      sortOrder: segment.sortOrder,
      active: segment.active,
      notes: segment.notes,
      rules: segment.rules.map((rule) => ({
        id: rule.id,
        priority: rule.priority,
        serviceCatalogId: rule.serviceCatalogId,
        itemId: rule.itemId,
        itemCategory: rule.itemCategory,
        serviceCategory: rule.serviceCategory,
        descriptionMatch: rule.descriptionMatch,
      })),
    }));
  }

  async upsertSegment(dto: UpsertSegmentDto) {
    return withAdminTx(this.rawPrisma, 'analytics.configure', async (tx, actor) => {
      const existing = dto.id ? await tx.businessSegment.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Segment not found');

      const segment = existing
        ? await tx.businessSegment.update({
            where: { id: existing.id },
            data: {
              name: dto.name,
              code: dto.code,
              colour: dto.colour,
              sortOrder: dto.sortOrder ?? existing.sortOrder,
              active: dto.active ?? existing.active,
              notes: dto.notes,
            },
          })
        : await tx.businessSegment.create({
            data: {
              tenantId: currentTenantId(),
              name: dto.name,
              code: dto.code,
              colour: dto.colour,
              sortOrder: dto.sortOrder ?? 0,
              notes: dto.notes,
            },
          });

      if (dto.rules) {
        // Replaced wholesale rather than merged: a mapping rule set is read as
        // an ordered whole, and a half-updated one would silently reclassify
        // revenue.
        await tx.segmentMappingRule.deleteMany({ where: { segmentId: segment.id } });
        for (const rule of dto.rules) {
          await tx.segmentMappingRule.create({
            data: {
              tenantId: currentTenantId(),
              segmentId: segment.id,
              priority: rule.priority ?? 100,
              serviceCatalogId: rule.serviceCatalogId ?? null,
              itemId: rule.itemId ?? null,
              itemCategory: rule.itemCategory ?? null,
              serviceCategory: rule.serviceCategory ?? null,
              descriptionMatch: rule.descriptionMatch ?? null,
            },
          });
        }
      }

      await recordAudit(tx, actor, {
        action: 'taxCode.changed',
        entityType: 'BusinessSegment',
        entityId: segment.id,
        before: existing ? { name: existing.name, code: existing.code } : null,
        after: { name: dto.name, code: dto.code, rules: dto.rules?.length ?? 0 },
        source: 'analytics.segments',
      });
      return segment;
    });
  }

  /**
   * THE SEGMENTED P&L.
   *
   * Reads every active invoice line in the period, maps each to at most one
   * segment, and reports revenue, direct cost, gross profit and margin. Lines
   * nobody has mapped are their own row, labelled — they are the work item.
   */
  async profitAndLoss(params: { clinicId?: string; from: string; to: string }) {
    const actor = await requirePermission(this.rawPrisma, 'analytics.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const [segments, rules, lines] = await Promise.all([
      this.prisma.businessSegment.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.segmentMappingRule.findMany({ orderBy: { priority: 'asc' } }),
      this.prisma.invoiceLine.findMany({
        where: {
          cancelledAt: null,
          invoice: {
            status: { not: 'CANCELLED' },
            createdAt: { gte: from, lt: to },
            ...(clinicId ? { visit: { clinicId } } : {}),
          },
        },
        select: {
          id: true,
          invoiceId: true,
          description: true,
          quantity: true,
          amount: true,
          lineDiscountAmount: true,
          taxAmount: true,
          sourcePrescription: {
            select: { itemId: true, item: { select: { cost: true, category: true } } },
          },
          sourceOrderService: {
            select: { serviceCatalogId: true, serviceCatalog: { select: { category: true } } },
          },
          consultationTariffRule: { select: { serviceCatalogId: true } },
          invoice: { select: { visit: { select: { patientId: true } } } },
        },
      }),
    ]);

    if (segments.length === 0) {
      return {
        configured: false,
        message:
          'No reporting segments are configured. Add segments and mapping rules in Operations ▸ Segments to split the P&L by service line.',
        from: params.from,
        to: params.to,
        segments: [],
        totals: { revenue: 0, cost: 0, grossProfit: 0, margin: null, lines: 0, unmappedRevenue: 0 },
      };
    }

    const mappable = lines.map((line) => {
      const revenueCents =
        toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0) + toCents(line.taxAmount);
      // Direct COST only, and only where the line has a catalogue cost. A
      // service with no mapped cost contributes zero cost and is counted in
      // `linesWithoutCost` so the margin is not read as more reliable than it
      // is.
      const unitCost = line.sourcePrescription?.item?.cost ?? null;
      const costCents = unitCost === null ? 0 : toCents(unitCost) * line.quantity;
      return {
        invoiceId: line.invoiceId,
        patientId: line.invoice.visit?.patientId ?? null,
        description: line.description,
        serviceCatalogId:
          line.sourceOrderService?.serviceCatalogId ?? line.consultationTariffRule?.serviceCatalogId ?? null,
        itemId: line.sourcePrescription?.itemId ?? null,
        itemCategory: line.sourcePrescription?.item?.category ?? null,
        serviceCategory: line.sourceOrderService?.serviceCatalog?.category ?? null,
        revenueCents,
        costCents,
        hasCost: unitCost !== null,
      };
    });

    const totals = accumulateSegments(rules as MappingRule[], mappable);
    const byId = new Map(segments.map((segment) => [segment.id, segment]));

    const rows = [...totals.entries()].map(([segmentId, bucket]) => {
      const segment = segmentId ? byId.get(segmentId) : null;
      return {
        segmentId,
        name: segment?.name ?? 'Not classified',
        code: segment?.code ?? 'UNMAPPED',
        colour: segment?.colour ?? null,
        sortOrder: segment?.sortOrder ?? 9999,
        revenue: fromCents(bucket.revenueCents),
        directCost: fromCents(bucket.costCents),
        grossProfit: fromCents(grossProfitCents(bucket.revenueCents, bucket.costCents)),
        margin: marginPercent(bucket.revenueCents, bucket.costCents),
        lines: bucket.lines,
        bills: bucket.invoiceIds.size,
        patients: bucket.patientIds.size,
      };
    });

    const revenueCents = mappable.reduce((total, line) => total + line.revenueCents, 0);
    const costCents = mappable.reduce((total, line) => total + line.costCents, 0);
    const unmapped = totals.get(null);

    return {
      configured: true,
      from: params.from,
      to: params.to,
      // Stated on the payload so no screen can quietly call it net profit.
      profitBasis:
        'Gross profit is revenue less direct item cost. Rent, salaries and other overheads are NOT allocated to segments, so this is a contribution figure, not net profit.',
      linesWithoutCost: mappable.filter((line) => !line.hasCost).length,
      segments: rows.sort((a, b) => a.sortOrder - b.sortOrder || b.revenue - a.revenue),
      totals: {
        revenue: fromCents(revenueCents),
        cost: fromCents(costCents),
        grossProfit: fromCents(grossProfitCents(revenueCents, costCents)),
        margin: marginPercent(revenueCents, costCents),
        lines: mappable.length,
        unmappedRevenue: fromCents(unmapped?.revenueCents ?? 0),
      },
    };
  }

  /** The bills behind one segment — the drill-down the brief asks for. */
  async segmentDetail(segmentId: string, params: { clinicId?: string; from: string; to: string }) {
    const pl = await this.profitAndLoss(params);
    if (!pl.configured) return { segmentId, lines: [] };

    const actor = await requirePermission(this.rawPrisma, 'analytics.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const rules = (await this.prisma.segmentMappingRule.findMany({
      where: segmentId === 'UNMAPPED' ? {} : { segmentId },
      orderBy: { priority: 'asc' },
    })) as MappingRule[];

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
        id: true,
        description: true,
        quantity: true,
        amount: true,
        lineDiscountAmount: true,
        taxAmount: true,
        sourcePrescription: { select: { itemId: true, item: { select: { category: true } } } },
        sourceOrderService: { select: { serviceCatalogId: true, serviceCatalog: { select: { category: true } } } },
        consultationTariffRule: { select: { serviceCatalogId: true } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            createdAt: true,
            visit: {
              select: { visitNumber: true, patient: { select: { name: true } }, staff: { select: { fullName: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const { segmentFor } = await import('./segment-mapping');
    const allRules = (await this.prisma.segmentMappingRule.findMany({ orderBy: { priority: 'asc' } })) as MappingRule[];

    return {
      segmentId,
      lines: lines
        .filter((line) => {
          const mapped = segmentFor(allRules, {
            description: line.description,
            serviceCatalogId:
              line.sourceOrderService?.serviceCatalogId ?? line.consultationTariffRule?.serviceCatalogId ?? null,
            itemId: line.sourcePrescription?.itemId ?? null,
            itemCategory: line.sourcePrescription?.item?.category ?? null,
            serviceCategory: line.sourceOrderService?.serviceCatalog?.category ?? null,
          });
          return segmentId === 'UNMAPPED' ? mapped === null : mapped === segmentId;
        })
        .map((line) => ({
          lineId: line.id,
          invoiceId: line.invoice.id,
          invoiceNumber: line.invoice.invoiceNumber,
          date: line.invoice.createdAt,
          visitNumber: line.invoice.visit?.visitNumber ?? null,
          patientName: line.invoice.visit?.patient?.name ?? null,
          doctorName: line.invoice.visit?.staff?.fullName ?? null,
          description: line.description,
          quantity: line.quantity,
          revenue: fromCents(
            toCents(line.amount) - toCents(line.lineDiscountAmount ?? 0) + toCents(line.taxAmount),
          ),
        })),
      rulesApplied: rules.length,
    };
  }
}
