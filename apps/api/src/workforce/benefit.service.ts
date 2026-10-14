import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, requireScope, withAdminTx, withScopedAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { currentTenantId } from '../core/tenant-context';
import { benefitAlert, proratedAllowanceCents } from './benefit-allowance';
import { BenefitUsageDto, SaveBenefitPolicyDto } from './dto/benefit.dto';
import { fromCents, toCents } from '../finance/money';

/**
 * STAFF MEDICAL BENEFIT — what a clinic gives its own people, and what is left.
 *
 * A staff member gets an annual allowance; their listed dependants draw on the
 * same pot unless one carries an override. Every use is a dated row against an
 * invoice, so the balance is DERIVED and not a running column somebody edits —
 * the same rule the stock ledger and the payment ledger follow.
 *
 * READ-ONLY on purpose. Recording a use happens where the money happens, at
 * billing; allocating an allowance is a payroll-adjacent decision the clinic
 * has not asked to move here yet. Building either of those now would be
 * inventing a workflow nobody has described. This answers the question the HR
 * screen needs to answer — who has what left — from rows that already exist.
 */
@Injectable()
export class BenefitService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { year?: number; clinicId?: string }) {
    // hr.view, not hr.payroll.view: an allowance balance is not a salary.
    // The branch goes through the actor's scope like every other admin list.
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const year = params.year ?? new Date().getUTCFullYear();

    const policy = await this.policyRow();
    const accounts = await this.prisma.staffBenefitAccount.findMany({
      where: { benefitYear: year, staff: scope.where(params.clinicId) },
      include: {
        staff: { select: { id: true, fullName: true, role: true, clinic: { select: { name: true } } } },
        members: {
          where: { active: true },
          select: { id: true, name: true, relationship: true, allowanceOverride: true, patientId: true },
        },
        usages: {
          select: {
            id: true,
            usedAt: true,
            amount: true,
            notes: true,
            memberId: true,
            member: { select: { name: true } },
            invoice: { select: { invoiceNumber: true } },
            recordedBy: { select: { fullName: true } },
          },
          orderBy: { usedAt: 'desc' },
        },
      },
      orderBy: { staff: { fullName: 'asc' } },
    });

    return {
      year,
      clinicId: params.clinicId ?? null,
      policy: describePolicy(policy),
      note:
        'The balance is the allowance less every recorded use. Uses are recorded at billing, against the invoice they paid for, which is why this screen reads rather than writes.',
      accounts: accounts.map((account) => {
        const allowanceCents = toCents(account.allowance);
        const usedCents = account.usages.reduce((total, usage) => total + toCents(usage.amount), 0);
        return {
          id: account.id,
          staffId: account.staffId,
          staffName: account.staff.fullName,
          role: account.staff.role,
          clinicName: account.staff.clinic?.name ?? null,
          benefitYear: account.benefitYear,
          allowance: fromCents(allowanceCents),
          used: fromCents(usedCents),
          // Clamped: an over-drawn account is reported as zero remaining with
          // the overdrawn amount named, rather than as a negative allowance.
          remaining: fromCents(Math.max(0, allowanceCents - usedCents)),
          overdrawn: fromCents(Math.max(0, usedCents - allowanceCents)),
          /** LOW at the clinic's alert level, OVERDRAWN past the allowance (Section F). */
          alert: benefitAlert(allowanceCents, usedCents, policy.alertBelowPercent),
          notes: account.notes,
          members: account.members.map((member) => ({
            id: member.id,
            name: member.name,
            relationship: member.relationship,
            allowanceOverride: member.allowanceOverride === null ? null : Number(member.allowanceOverride),
            linkedPatient: member.patientId !== null,
          })),
          usages: account.usages.map((usage) => ({
            id: usage.id,
            usedAt: usage.usedAt.toISOString().slice(0, 10),
            amount: Number(usage.amount),
            forWhom: usage.member?.name ?? account.staff.fullName,
            invoiceNumber: usage.invoice?.invoiceNumber ?? null,
            recordedBy: usage.recordedBy.fullName,
            notes: usage.notes,
          })),
        };
      }),
    };
  }

  /** The clinic's benefit rules, made with their defaults the first time anybody asks. */
  async policy() {
    await requirePermission(this.rawPrisma, 'hr.view');
    return describePolicy(await this.policyRow());
  }

  async savePolicy(dto: SaveBenefitPolicyDto) {
    await this.policyRow();
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const saved = await tx.benefitPolicy.update({
        where: { tenantId: currentTenantId() },
        data: {
          ...(dto.yearlyLimit === undefined ? {} : { yearlyLimit: dto.yearlyLimit }),
          ...(dto.joiningMonthCutoffDay === undefined ? {} : { joiningMonthCutoffDay: dto.joiningMonthCutoffDay }),
          ...(dto.alertBelowPercent === undefined ? {} : { alertBelowPercent: dto.alertBelowPercent }),
        },
      });
      await recordAudit(tx, actor, {
        action: 'benefit.policySaved',
        entityType: 'BenefitPolicy',
        entityId: saved.id,
        after: describePolicy(saved),
        source: 'hr.benefits',
      });
      return describePolicy(saved);
    });
  }

  /**
   * THE YEAR'S ACCOUNTS (Section F): one for every employee of the branch who
   * has none yet, at the clinic's yearly limit, pro-rated for a joiner. An
   * account already there is left as it is, so this can be pressed again.
   */
  async setUpYear(year: number, clinicId?: string) {
    const policy = await this.policyRow();
    const limitCents = toCents(policy.yearlyLimit);
    if (limitCents <= 0) throw new BadRequestException('Set the yearly limit in the benefit settings first.');
    return withScopedAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor, scope) => {
      const yearStart = new Date(Date.UTC(year, 0, 1));
      const yearEnd = new Date(Date.UTC(year, 11, 31));
      const employees = await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          staff: { active: true, ...scope.where(clinicId) },
          OR: [{ startDate: null }, { startDate: { lte: yearEnd } }],
          AND: [{ OR: [{ endDate: null }, { endDate: { gte: yearStart } }] }],
          NOT: { staff: { benefitAccounts: { some: { benefitYear: year } } } },
        },
        select: { staffId: true, startDate: true },
      });
      for (const employee of employees) {
        const allowanceCents = proratedAllowanceCents(limitCents, year, employee.startDate, policy.joiningMonthCutoffDay);
        await tx.staffBenefitAccount.create({
          data: {
            tenantId: currentTenantId(),
            staffId: employee.staffId,
            benefitYear: year,
            allowance: fromCents(allowanceCents),
            notes: allowanceCents < limitCents ? 'Pro-rated for the months left after joining' : null,
          },
        });
      }
      await recordAudit(tx, actor, {
        action: 'benefit.yearSetUp',
        entityType: 'StaffBenefitAccount',
        entityId: `year-${year}`,
        after: { year, created: employees.length, clinicId: clinicId ?? null },
        source: 'hr.benefits',
      });
      return { year, created: employees.length };
    });
  }

  /** A use of the benefit entered by hand: a clinic bill, a pharmacy receipt (Section F). */
  async addUsage(accountId: string, dto: BenefitUsageDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const account = await tx.staffBenefitAccount.findUnique({ where: { id: accountId }, select: { id: true } });
      if (!account) throw new NotFoundException('Benefit account not found');
      const saved = await tx.staffBenefitUsage.create({
        data: {
          tenantId: currentTenantId(),
          accountId,
          usedAt: new Date(`${dto.usedAt.slice(0, 10)}T00:00:00.000Z`),
          amount: dto.amount,
          notes: dto.notes,
          recordedByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'benefit.usageRecorded',
        entityType: 'StaffBenefitUsage',
        entityId: saved.id,
        after: { accountId, usedAt: dto.usedAt.slice(0, 10), amount: dto.amount },
        reason: dto.notes,
        source: 'hr.benefits',
      });
      return { id: saved.id };
    });
  }

  private async policyRow() {
    const tenantId = currentTenantId();
    const existing = await this.prisma.benefitPolicy.findUnique({ where: { tenantId } });
    return existing ?? this.prisma.benefitPolicy.create({ data: { tenantId } });
  }
}

function describePolicy(row: { yearlyLimit: unknown; joiningMonthCutoffDay: number | null; alertBelowPercent: number }) {
  return {
    yearlyLimit: Number(row.yearlyLimit).toFixed(2),
    joiningMonthCutoffDay: row.joiningMonthCutoffDay,
    alertBelowPercent: row.alertBelowPercent,
  };
}
