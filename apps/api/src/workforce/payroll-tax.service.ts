import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { currentTenantId } from '../core/tenant-context';

function monthStart(value: string): Date {
  return new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
}

/**
 * TP1 AND TP3 — the two LHDN forms that change a month's tax, as records.
 *
 * TP1: the employee claims allowable deductions and rebates for the month;
 * THE EMPLOYER approves the claim off the form and applies it as LP1. The
 * relief catalogue and its annual caps are the register's TP1 rules, still
 * UNVERIFIED — so Kuwick records the employer's approved figure, itemised for
 * the audit trail, and does not police caps it holds no authoritative table
 * for. What it does police is arithmetic (items must sum to the total) and
 * TIME: a month an approved run already covers is frozen, and a late form
 * goes through a correction run, not through quietly editing the past.
 *
 * TP3: a mid-year joiner's previous employment this tax year, so cumulative
 * MTD carries on from where it stood. The overlap discipline is the point —
 * previous-employer money arrives HERE, this employer's own pre-Kuwick months
 * arrive through the opening import, and each write path refuses what belongs
 * to the other, because the same ringgit arriving twice halves somebody's
 * remaining tax.
 */
@Injectable()
export class PayrollTaxService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async taxRecords(staffId: string, year?: number) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const taxYear = year ?? new Date().getUTCFullYear();
    const [tp1, tp3, profile] = await Promise.all([
      this.prisma.employeeTp1Entry.findMany({
        where: { staffId, period: { gte: new Date(Date.UTC(taxYear, 0, 1)), lt: new Date(Date.UTC(taxYear + 1, 0, 1)) } },
        orderBy: { period: 'asc' },
        include: { createdBy: { select: { fullName: true } } },
      }),
      this.prisma.employeeTp3Record.findMany({
        where: { staffId, taxYear },
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { fullName: true } } },
      }),
      this.prisma.employeeProfile.findUnique({
        where: { staffId },
        select: { startDate: true, legalEmployerId: true },
      }),
    ]);
    if (!profile) throw new NotFoundException('No employee profile for that staff member');
    return {
      staffId,
      taxYear,
      tp1: tp1.map((row) => ({
        id: row.id,
        period: row.period.toISOString().slice(0, 7),
        deductionsCents: row.deductionsCents,
        zakatSelfPaidCents: row.zakatSelfPaidCents,
        items: (row.items as { label: string; amountCents: number }[] | null) ?? null,
        receivedDate: row.receivedDate?.toISOString().slice(0, 10) ?? null,
        note: row.note,
        recordedBy: row.createdBy.fullName,
        recordedAt: row.createdAt.toISOString(),
      })),
      tp3: tp3.map((row) => ({
        id: row.id,
        previousEmployerName: row.previousEmployerName,
        employmentFrom: row.employmentFrom?.toISOString().slice(0, 10) ?? null,
        employmentTo: row.employmentTo?.toISOString().slice(0, 10) ?? null,
        grossCents: row.grossCents,
        epfCents: row.epfCents,
        mtdPaidCents: row.mtdPaidCents,
        zakatCents: row.zakatCents,
        deductionsCents: row.deductionsCents,
        source: row.source,
        note: row.note,
        recordedBy: row.createdBy.fullName,
        recordedAt: row.createdAt.toISOString(),
      })),
    };
  }

  async recordTp1(
    staffId: string,
    body: {
      period: string;
      deductionsCents: number;
      zakatSelfPaidCents?: number;
      items?: { label: string; amountCents: number }[];
      receivedDate?: string;
      note?: string;
    },
  ) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const deductions = Math.round(body.deductionsCents ?? 0);
      const zakat = Math.round(body.zakatSelfPaidCents ?? 0);
      if (!body.period || !/^\d{4}-\d{2}/.test(body.period)) {
        throw new ConflictException('A TP1 entry belongs to a month.');
      }
      if (deductions < 0 || zakat < 0) {
        throw new ConflictException('TP1 amounts cannot be negative.');
      }
      if (deductions === 0 && zakat === 0) {
        throw new ConflictException(
          'A TP1 entry with nothing on it changes nothing. Record the approved deduction, the self-paid zakat, or both.',
        );
      }
      if (body.items && body.items.length > 0) {
        const sum = body.items.reduce((total, item) => total + Math.round(item.amountCents ?? 0), 0);
        if (sum !== deductions) {
          throw new ConflictException(
            `The itemised amounts add to RM${(sum / 100).toFixed(2)} but the total records ` +
              `RM${(deductions / 100).toFixed(2)}. A form that does not add up is not a record.`,
          );
        }
        if (body.items.some((item) => !item.label || item.label.trim().length === 0)) {
          throw new ConflictException('Every itemised TP1 line needs the relief it claims.');
        }
      }
      const profile = await tx.employeeProfile.findUnique({
        where: { staffId },
        select: { legalEmployerId: true, staff: { select: { fullName: true } } },
      });
      if (!profile) throw new NotFoundException('No employee profile for that staff member');
      if (!profile.legalEmployerId) {
        throw new ConflictException(
          'This employee has no employing company, and a TP1 approval is the employer’s act. Set the legal employer first.',
        );
      }
      const period = monthStart(body.period);

      // A MONTH AN APPROVED RUN COVERS IS FROZEN. The LP the run applied is
      // in the snapshot; recording a different form against that month would
      // make the record disagree with the payslip it claims to explain.
      const approvedLine = await tx.payrollLine.findFirst({
        where: {
          staffId,
          payrollRun: { period, status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] } },
        },
        select: { payrollRunId: true },
      });
      if (approvedLine) {
        throw new ConflictException(
          'An approved payroll already covers this month for this employee. A late TP1 goes through a correction ' +
            'run — reopen or open a correction, then record the form.',
        );
      }

      const existing = await tx.employeeTp1Entry.findFirst({ where: { staffId, period } });
      if (existing) {
        throw new ConflictException(
          'A TP1 entry already exists for this month. Delete it first if the form was re-approved — the deletion is audited.',
        );
      }

      const created = await tx.employeeTp1Entry.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          legalEmployerId: profile.legalEmployerId,
          period,
          deductionsCents: deductions,
          zakatSelfPaidCents: zakat,
          items: body.items && body.items.length > 0 ? (body.items as never) : undefined,
          receivedDate: body.receivedDate ? new Date(`${body.receivedDate}T00:00:00.000Z`) : null,
          note: body.note?.trim() || null,
          createdByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'payrollTax.tp1Recorded',
        entityType: 'EmployeeTp1Entry',
        entityId: created.id,
        after: {
          staffId,
          period: body.period.slice(0, 7),
          deductionsCents: deductions,
          zakatSelfPaidCents: zakat,
        },
        source: 'hr.payroll',
      });
    });
    return this.taxRecords(staffId, Number(body.period.slice(0, 4)));
  }

  async deleteTp1(id: string) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const entry = await tx.employeeTp1Entry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException('No such TP1 entry.');
      const approvedLine = await tx.payrollLine.findFirst({
        where: {
          staffId: entry.staffId,
          payrollRun: { period: entry.period, status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] } },
        },
        select: { id: true },
      });
      if (approvedLine) {
        throw new ConflictException(
          'An approved payroll applied this TP1. The record stays; correct the month through a correction run.',
        );
      }
      await tx.employeeTp1Entry.delete({ where: { id } });
      await recordAudit(tx, actor, {
        action: 'payrollTax.tp1Deleted',
        entityType: 'EmployeeTp1Entry',
        entityId: id,
        before: {
          staffId: entry.staffId,
          period: entry.period.toISOString().slice(0, 7),
          deductionsCents: entry.deductionsCents,
        },
        source: 'hr.payroll',
      });
    });
    return { deleted: true };
  }

  async recordTp3(
    staffId: string,
    body: {
      taxYear: number;
      previousEmployerName: string;
      employmentFrom?: string;
      employmentTo?: string;
      grossCents: number;
      epfCents: number;
      mtdPaidCents: number;
      zakatCents?: number;
      deductionsCents?: number;
      source: string;
      note?: string;
    },
  ) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const taxYear = Math.round(body.taxYear ?? 0);
      if (!taxYear || taxYear < 2000 || taxYear > 2100) {
        throw new ConflictException('A TP3 record belongs to a tax year.');
      }
      if (!body.previousEmployerName || body.previousEmployerName.trim().length < 2) {
        throw new ConflictException('Name the previous employer as the form does.');
      }
      if (!body.source || body.source.trim().length < 5) {
        throw new ConflictException(
          'Say where these figures came from — "Borang TP3 dated 12 May 2026", for instance. A cumulative tax ' +
            'position with no provenance cannot be defended later.',
        );
      }
      for (const [label, value] of [
        ['gross', body.grossCents],
        ['EPF', body.epfCents],
        ['MTD paid', body.mtdPaidCents],
        ['zakat', body.zakatCents ?? 0],
        ['deductions', body.deductionsCents ?? 0],
      ] as const) {
        if (Math.round(value) < 0) throw new ConflictException(`The ${label} figure cannot be negative.`);
      }

      const profile = await tx.employeeProfile.findUnique({
        where: { staffId },
        select: { startDate: true, legalEmployerId: true },
      });
      if (!profile) throw new NotFoundException('No employee profile for that staff member');
      if (!profile.legalEmployerId) {
        throw new ConflictException('Set the employing company before recording tax history against it.');
      }

      /*
       * THE OVERLAP DISCIPLINE. Previous employment "this year" is only
       * possible for somebody who JOINED this year: an employee here since
       * before January owes the whole year's history to this employer's own
       * records, and a TP3 against it would double what the accumulators
       * already carry.
       */
      const start = profile.startDate;
      if (!start) {
        throw new ConflictException('Record the employment start date first — TP3 is a joiner’s declaration.');
      }
      if (start.getUTCFullYear() !== taxYear) {
        throw new ConflictException(
          `This employee started on ${start.toISOString().slice(0, 10)}, so ${taxYear} has no previous employment ` +
            'to declare here. Previous-employer figures only exist for the year somebody joined in.',
        );
      }
      if (body.employmentTo) {
        const to = new Date(`${body.employmentTo}T00:00:00.000Z`);
        if (to >= start) {
          throw new ConflictException(
            'The previous employment ends on or after this one begins. TP3 covers employment BEFORE this employer; ' +
              'overlapping employment is not what the form declares.',
          );
        }
      }
      if (body.employmentFrom && body.employmentTo) {
        if (new Date(body.employmentFrom) > new Date(body.employmentTo)) {
          throw new ConflictException('The previous employment cannot end before it began.');
        }
      }

      const created = await tx.employeeTp3Record.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          legalEmployerId: profile.legalEmployerId,
          taxYear,
          previousEmployerName: body.previousEmployerName.trim(),
          employmentFrom: body.employmentFrom ? new Date(`${body.employmentFrom}T00:00:00.000Z`) : null,
          employmentTo: body.employmentTo ? new Date(`${body.employmentTo}T00:00:00.000Z`) : null,
          grossCents: Math.round(body.grossCents),
          epfCents: Math.round(body.epfCents),
          mtdPaidCents: Math.round(body.mtdPaidCents),
          zakatCents: Math.round(body.zakatCents ?? 0),
          deductionsCents: Math.round(body.deductionsCents ?? 0),
          source: body.source.trim(),
          note: body.note?.trim() || null,
          createdByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'payrollTax.tp3Recorded',
        entityType: 'EmployeeTp3Record',
        entityId: created.id,
        after: {
          staffId,
          taxYear,
          previousEmployerName: body.previousEmployerName.trim(),
          grossCents: Math.round(body.grossCents),
          mtdPaidCents: Math.round(body.mtdPaidCents),
        },
        source: 'hr.payroll',
      });
    });
    return this.taxRecords(staffId, body.taxYear);
  }

  async deleteTp3(id: string) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const record = await tx.employeeTp3Record.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('No such TP3 record.');
      await tx.employeeTp3Record.delete({ where: { id } });
      await recordAudit(tx, actor, {
        action: 'payrollTax.tp3Deleted',
        entityType: 'EmployeeTp3Record',
        entityId: id,
        before: {
          staffId: record.staffId,
          taxYear: record.taxYear,
          previousEmployerName: record.previousEmployerName,
          grossCents: record.grossCents,
        },
        source: 'hr.payroll',
      });
    });
    return { deleted: true };
  }
}
