import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IncentiveRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, requireScope, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { fromCents, toCents } from '../finance/money';
import { computeProcedureIncentive, computeSalesCommission, ruleInForce } from './incentive-calculation';
import { UpsertIncentiveRuleDto } from './dto/upsert-incentive-rule.dto';

function monthStart(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * DOCTOR INCENTIVES — the part that touches the database.
 *
 * THE PROPERTY THIS SERVICE PROTECTS: historical reproducibility. A rule is
 * never edited; a change creates a NEW VERSION with a new effective date, and
 * every result stores the version and a full snapshot of the rule it used. A
 * closed period's numbers therefore stay the numbers that were paid, however
 * many times the rules change afterwards.
 */
@Injectable()
export class IncentiveService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async listRules() {
    await requirePermission(this.rawPrisma, 'hr.view');
    const rules = await this.prisma.incentiveRule.findMany({
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      include: {
        clinic: { select: { name: true } },
        staff: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType,
      version: rule.version,
      active: rule.active,
      effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: rule.effectiveTo?.toISOString().slice(0, 10) ?? null,
      clinicName: rule.clinic?.name ?? 'All branches',
      staffName: rule.staff?.fullName ?? 'All eligible doctors',
      employmentType: rule.employmentType,
      thresholdAmount: rule.thresholdAmount === null ? null : Number(rule.thresholdAmount),
      flatAmount: rule.flatAmount === null ? null : Number(rule.flatAmount),
      percentAbove: rule.percentAbove === null ? null : Number(rule.percentAbove),
      perProcedureAmount: rule.perProcedureAmount === null ? null : Number(rule.perProcedureAmount),
      perProcedurePercent: rule.perProcedurePercent === null ? null : Number(rule.perProcedurePercent),
      serviceCatalogIds: rule.serviceCatalogIds,
      excludedServiceCatalogIds: rule.excludedServiceCatalogIds,
      createdBy: rule.createdBy.fullName,
      notes: rule.notes,
    }));
  }

  /**
   * Create a rule, or SUPERSEDE one with a new version.
   *
   * There is deliberately no update path. Editing a rule in place makes every
   * historic payment unreproducible; superseding it closes the old version on
   * the day before the new one starts and leaves the old row exactly as it was.
   */
  async upsertRule(dto: UpsertIncentiveRuleDto) {
    return withAdminTx(this.rawPrisma, 'hr.incentive.manage', async (tx, actor) => {
      const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);

      let version = 1;
      if (dto.supersedesRuleId) {
        const previous = await tx.incentiveRule.findUnique({ where: { id: dto.supersedesRuleId } });
        if (!previous) throw new NotFoundException('The rule being superseded does not exist.');
        if (previous.effectiveFrom >= effectiveFrom) {
          throw new BadRequestException('A new version must start after the version it replaces.');
        }
        version = previous.version + 1;
        await tx.incentiveRule.update({
          where: { id: previous.id },
          data: { effectiveTo: new Date(effectiveFrom.getTime() - 86400000) },
        });
      }

      const rule = await tx.incentiveRule.create({
        data: {
          tenantId: currentTenantId(),
          name: dto.name,
          ruleType: dto.ruleType,
          clinicId: dto.clinicId ?? null,
          staffId: dto.staffId ?? null,
          employmentType: dto.employmentType ?? null,
          thresholdAmount: dto.thresholdAmount ?? null,
          flatAmount: dto.flatAmount ?? null,
          percentAbove: dto.percentAbove ?? null,
          perProcedureAmount: dto.perProcedureAmount ?? null,
          perProcedurePercent: dto.perProcedurePercent ?? null,
          serviceCatalogIds: dto.serviceCatalogIds ?? [],
          excludedServiceCatalogIds: dto.excludedServiceCatalogIds ?? [],
          version,
          effectiveFrom,
          notes: dto.notes ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'incentiveRule.changed',
        entityType: 'IncentiveRule',
        entityId: rule.id,
        before: dto.supersedesRuleId ? { supersededRuleId: dto.supersedesRuleId } : null,
        after: { name: dto.name, version, effectiveFrom: dto.effectiveFrom, ruleType: dto.ruleType },
        reason: dto.notes ?? null,
        source: 'hr.incentives',
      });
      return rule;
    });
  }

  /**
   * Calculate a month's incentives.
   *
   * The basis comes from INVOICES the doctor attended, in the period, excluding
   * cancelled ones — the same source the doctor-performance report reads, so
   * "my sales" means the same number on both screens.
   */
  async calculate(period: string, clinicId?: string) {
    return withAdminTx(this.rawPrisma, 'hr.incentive.manage', async (tx, actor) => {
      const periodStart = monthStart(period);
      const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));

      let run = await tx.incentiveRun.findFirst({ where: { period: periodStart, clinicId: clinicId ?? null } });
      if (run && (run.status === IncentiveRunStatus.PAID || run.status === IncentiveRunStatus.APPROVED)) {
        throw new ConflictException(
          'This incentive run has been approved. Recalculating it would change a figure somebody has been told.',
        );
      }
      run ??= await tx.incentiveRun.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: clinicId ?? null,
          period: periodStart,
          createdByStaffId: actor.id,
        },
      });

      await tx.incentiveResult.deleteMany({ where: { incentiveRunId: run.id } });

      const allRules = await tx.incentiveRule.findMany({
        where: { OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])] },
      });

      const doctors = await tx.staff.findMany({
        where: {
          active: true,
          professionalType: 'MEDICAL_DOCTOR',
          ...(clinicId ? { clinicId } : {}),
        },
        include: { employeeProfile: { select: { employmentType: true } } },
      });

      let total = 0;
      for (const doctor of doctors) {
        // The rules that could apply to this person, then the VERSION in force.
        const candidates = allRules.filter(
          (rule) =>
            (rule.staffId === null || rule.staffId === doctor.id) &&
            (rule.employmentType === null ||
              rule.employmentType === doctor.employeeProfile?.employmentType),
        );
        // Group by name so each named rule contributes its own in-force version.
        const byName = new Map<string, typeof candidates>();
        for (const rule of candidates) {
          byName.set(rule.name, [...(byName.get(rule.name) ?? []), rule]);
        }

        for (const [, versions] of byName) {
          const rule = ruleInForce(
            versions.map((version) => ({ ...version, effectiveFrom: version.effectiveFrom })),
            periodStart,
          );
          if (!rule) continue;

          const result =
            rule.ruleType === 'SALES_COMMISSION'
              ? await this.salesFor(tx, doctor.id, periodStart, periodEnd, rule)
              : await this.proceduresFor(tx, doctor.id, periodStart, periodEnd, rule);

          if (result.amountCents === 0 && result.basisCount === 0 && result.basisCents === 0) continue;

          await tx.incentiveResult.create({
            data: {
              tenantId: currentTenantId(),
              incentiveRunId: run.id,
              staffId: doctor.id,
              incentiveRuleId: rule.id,
              ruleVersion: rule.version,
              // THE SNAPSHOT. This is what makes a paid incentive reproducible
              // in five years, whatever the rules say by then.
              ruleSnapshot: {
                name: rule.name,
                ruleType: rule.ruleType,
                version: rule.version,
                effectiveFrom: rule.effectiveFrom,
                thresholdAmount: rule.thresholdAmount,
                flatAmount: rule.flatAmount,
                percentAbove: rule.percentAbove,
                perProcedureAmount: rule.perProcedureAmount,
                perProcedurePercent: rule.perProcedurePercent,
                serviceCatalogIds: rule.serviceCatalogIds,
                excludedServiceCatalogIds: rule.excludedServiceCatalogIds,
              } as never,
              basisAmount: fromCents(result.basisCents),
              basisCount: result.basisCount,
              amount: fromCents(result.amountCents),
              calculation: result.workings as never,
            },
          });
          total += result.amountCents;
        }
      }

      const updated = await tx.incentiveRun.update({
        where: { id: run.id },
        data: {
          status: IncentiveRunStatus.CALCULATED,
          calculatedAt: new Date(),
          totalAmount: fromCents(total),
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.calculated',
        entityType: 'IncentiveRun',
        entityId: run.id,
        after: { period, total: fromCents(total) },
        source: 'hr.incentives',
      });
      return updated;
    });
  }

  private async salesFor(
    tx: AdminTx,
    staffId: string,
    from: Date,
    to: Date,
    rule: { thresholdAmount: unknown; flatAmount: unknown; percentAbove: unknown },
  ) {
    const invoices = await tx.invoice.findMany({
      where: { visit: { staffId }, createdAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
      select: { totalAmount: true },
    });
    const salesCents = invoices.reduce((total, invoice) => total + toCents(invoice.totalAmount), 0);
    const commission = computeSalesCommission(fromCents(salesCents), {
      thresholdAmount: rule.thresholdAmount as never,
      flatAmount: rule.flatAmount as never,
      percentAbove: rule.percentAbove as never,
    });
    return {
      basisCents: salesCents,
      basisCount: invoices.length,
      amountCents: commission.totalCents,
      workings: {
        sales: fromCents(salesCents),
        invoices: invoices.length,
        threshold: fromCents(commission.thresholdCents),
        qualified: commission.qualified,
        flat: fromCents(commission.flatCents),
        aboveThreshold: fromCents(commission.aboveThresholdCents),
        percentPart: fromCents(commission.percentCents),
        explanation: commission.explanation,
      },
    };
  }

  private async proceduresFor(
    tx: AdminTx,
    staffId: string,
    from: Date,
    to: Date,
    rule: {
      serviceCatalogIds: string[];
      excludedServiceCatalogIds: string[];
      perProcedureAmount: unknown;
      perProcedurePercent: unknown;
    },
  ) {
    const orders = await tx.orderService.findMany({
      where: {
        visit: { staffId, createdAt: { gte: from, lt: to } },
        status: 'COMPLETED',
      },
      select: { serviceCatalogId: true, quantity: true, serviceCatalog: { select: { price: true } } },
    });

    const result = computeProcedureIncentive(
      orders.map((order) => ({
        serviceCatalogId: order.serviceCatalogId,
        amount: Number(order.serviceCatalog?.price ?? 0) * (order.quantity ?? 1),
        quantity: order.quantity ?? 1,
      })),
      {
        serviceCatalogIds: rule.serviceCatalogIds,
        excludedServiceCatalogIds: rule.excludedServiceCatalogIds,
        perProcedureAmount: rule.perProcedureAmount as never,
        perProcedurePercent: rule.perProcedurePercent as never,
      },
    );

    return {
      basisCents: result.qualifyingAmountCents,
      basisCount: result.qualifyingCount,
      amountCents: result.totalCents,
      workings: {
        qualifying: result.qualifyingCount,
        excluded: result.excludedCount,
        qualifyingValue: fromCents(result.qualifyingAmountCents),
        explanation: result.explanation,
      },
    };
  }

  /** Approve and lock, so payroll can pick it up. */
  async approve(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.incentiveRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Incentive run not found');
      if (run.status !== IncentiveRunStatus.CALCULATED) {
        throw new ConflictException(`A ${run.status.toLowerCase()} incentive run cannot be approved.`);
      }
      const approved = await tx.incentiveRun.update({
        where: { id: runId },
        data: { status: IncentiveRunStatus.APPROVED, approvedByStaffId: actor.id, approvedAt: new Date() },
      });
      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'IncentiveRun',
        entityId: runId,
        before: { status: IncentiveRunStatus.CALCULATED },
        after: { status: IncentiveRunStatus.APPROVED, total: String(run.totalAmount) },
        source: 'hr.incentives',
      });
      return approved;
    });
  }

  async detail(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const run = await this.prisma.incentiveRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        results: {
          include: { staff: { select: { fullName: true } }, rule: { select: { name: true, ruleType: true } } },
          orderBy: { amount: 'desc' },
        },
      },
    });
    if (!run) throw new NotFoundException('Incentive run not found');
    return {
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      totalAmount: Number(run.totalAmount),
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      approvedBy: run.approvedBy?.fullName ?? null,
      results: run.results.map((result) => ({
        id: result.id,
        staffId: result.staffId,
        name: result.staff.fullName,
        ruleName: result.rule.name,
        ruleType: result.rule.ruleType,
        // The version is shown, because "which rules paid this" is the question
        // a doctor asks when the number changes between months.
        ruleVersion: result.ruleVersion,
        basisAmount: Number(result.basisAmount),
        basisCount: result.basisCount,
        amount: Number(result.amount),
        calculation: result.calculation,
      })),
    };
  }

  async list(params: { clinicId?: string; year?: number } = {}) {
    // A run belongs to a branch (or to every branch, clinicId null). The
    // branch comes through the actor's scope: one outside it is refused,
    // none means the branches the account holds.
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const runs = await this.prisma.incentiveRun.findMany({
      where: {
        ...scope.where(params.clinicId),
        ...(params.year
          ? { period: { gte: new Date(Date.UTC(params.year, 0, 1)), lt: new Date(Date.UTC(params.year + 1, 0, 1)) } }
          : {}),
      },
      orderBy: { period: 'desc' },
      include: { clinic: { select: { name: true } }, _count: { select: { results: true } } },
    });
    return runs.map((run) => ({
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      totalAmount: Number(run.totalAmount),
      doctors: run._count.results,
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
    }));
  }
}
