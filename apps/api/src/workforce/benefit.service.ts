import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, requireScope } from '../finance/admin-actor';
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
}
