import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, requireScope, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { toCents, formatCents } from '../finance/money';
import { UpsertPayrollInputDto } from './dto/upsert-payroll-input.dto';

function periodStart(period: string): Date {
  const d = new Date(`${period}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('period must be a YYYY-MM-DD date.');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * PAYROLL INPUTS — the dead end, opened.
 *
 * `PayrollInputEntry` had a table, row-level security, an index and a read in
 * the calculation, and NO WRITE PATH ANYWHERE: no DTO, no route, no service.
 * The only writers in the repository were the seed script and one test, both
 * going straight to Prisma.
 *
 * That was not a cosmetic gap. PCB is not calculated by this system, so a null
 * PCB with no input raises a blocking exception, and approval refuses a run
 * with any blocking exception. Every clinic with one PCB-applicable employee
 * therefore had a payroll it could never approve. The schema comment described
 * keying PCB in as an existing step; the step had never been built.
 *
 * WHAT THIS ADDS THAT THE AUDITED COMPETITOR DOES NOT RECORD: who entered the
 * figure, when, where it came from, which upstream record produced it, and
 * optionally why. A clinic asked "why was this RM300 added" can answer.
 */
@Injectable()
export class PayrollInputService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { period: string; staffId?: string; clinicId?: string }) {
    // Inputs are pay figures with names on them; a requested branch is
    // validated against the actor's scope like every other admin read. Rows
    // carry the STAFF's branch through the relation, so entries keyed with
    // no branch of their own still filter correctly.
    const { scope } = await requireScope(this.rawPrisma, 'hr.payroll.view');
    const period = periodStart(params.period);
    const [rows, components] = await Promise.all([
      this.prisma.payrollInputEntry.findMany({
        where: {
          period,
          ...(params.staffId ? { staffId: params.staffId } : {}),
          staff: scope.where(params.clinicId),
        },
        orderBy: [{ staffId: 'asc' }, { componentCode: 'asc' }],
        include: {
          staff: { select: { id: true, fullName: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      // The latest version of every item, active or not: a row keyed against
      // an item that was retired afterwards still has to say what it is.
      this.prisma.payComponent.findMany({
        orderBy: { effectiveFrom: 'desc' },
        select: { code: true, name: true, type: true, includeIn: true },
      }),
    ]);
    const itemByCode = new Map<string, (typeof components)[number]>();
    for (const item of components) if (!itemByCode.has(item.code)) itemByCode.set(item.code, item);
    const month = period.toISOString().slice(0, 7);

    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId,
      staffName: row.staff.fullName,
      componentCode: row.componentCode,
      label: row.label,
      itemName: itemByCode.get(row.componentCode)?.name ?? row.componentCode,
      /**
       * WHICH CELL OF THE REGISTER THIS ROW LANDS IN — decided here, by the
       * same rule the run uses to fill the columns, so the drawer's subtotal
       * and the grid's cell cannot disagree.
       */
      ...placeOnRegister(row, itemByCode.get(row.componentCode)),
      ...originOf(row, month),
      // Always two decimals: Decimal.toString() renders 300.00 as "300".
      amount: formatCents(toCents(row.amount)),
      kind: row.kind,
      source: row.source,
      sourceRecordId: row.sourceRecordId,
      earnedPeriod: row.earnedPeriod ? row.earnedPeriod.toISOString().slice(0, 10) : null,
      reason: row.reason,
      note: row.note,
      /** Provenance, which the audited competitor records for none of its inputs. */
      enteredBy: row.createdBy.fullName,
      enteredAt: row.createdAt.toISOString(),
      /** A derived figure is corrected upstream, not here. */
      editable: row.source === 'MANUAL' || row.source === 'IMPORT',
    }));
  }

  async upsert(dto: UpsertPayrollInputDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const period = periodStart(dto.period);

      const profile = await tx.employeeProfile.findFirst({
        where: { staffId: dto.staffId },
        include: { staff: { select: { fullName: true, clinicId: true } } },
      });
      if (!profile) throw new NotFoundException('Employee not found');

      const component = await tx.payComponent.findFirst({
        where: { code: dto.componentCode, active: true },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!component) {
        throw new BadRequestException(
          `"${dto.componentCode}" is not an active pay component. An input naming a component the system does not know would be silently dropped from somebody's pay.`,
        );
      }

      const amountCents = toCents(dto.amount);
      if (amountCents < 0) {
        throw new BadRequestException(
          'Enter a positive amount. Whether it adds to or subtracts from pay is decided by the component, not by the sign.',
        );
      }

      // A locked run is corrected by an adjustment, never by editing the
      // inputs behind it.
      const locked = await tx.payrollRun.findFirst({
        where: { period, status: { in: ['APPROVED', 'PAID'] }, ...(profile.staff.clinicId ? { OR: [{ clinicId: profile.staff.clinicId }, { clinicId: null }] } : {}) },
      });
      if (locked) {
        throw new ConflictException(
          `The payroll for ${dto.period} is already ${locked.status.toLowerCase()}. Record an adjustment against that run, or reopen it deliberately.`,
        );
      }

      const existing = await tx.payrollInputEntry.findFirst({
        where: { staffId: dto.staffId, period, componentCode: dto.componentCode },
      });

      if (existing && existing.source !== 'MANUAL' && existing.source !== 'IMPORT') {
        throw new ConflictException(
          `This ${existing.componentCode} figure came from ${existing.source.toLowerCase()} and is maintained there. Correct the underlying record, then recalculate.`,
        );
      }

      const data = {
        label: dto.label ?? null,
        amount: dto.amount,
        kind: dto.kind ?? 'ADDITIONAL',
        source: 'MANUAL' as const,
        sourceRecordId: null,
        earnedPeriod: dto.earnedPeriod ? new Date(`${dto.earnedPeriod}T00:00:00.000Z`) : null,
        reason: dto.reason ?? null,
        note: dto.note ?? null,
      };

      const saved = existing
        ? await tx.payrollInputEntry.update({ where: { id: existing.id }, data })
        : await tx.payrollInputEntry.create({
            data: {
              ...data,
              tenantId: currentTenantId(),
              clinicId: profile.staff.clinicId,
              staffId: dto.staffId,
              period,
              componentCode: dto.componentCode,
              createdByStaffId: actor.id,
            },
          });

      await recordAudit(tx, actor, {
        action: existing ? 'payrollInput.updated' : 'payrollInput.created',
        entityType: 'PayrollInputEntry',
        entityId: saved.id,
        reason: `${existing ? 'Updated' : 'Entered'} ${dto.componentCode} of ${dto.amount} for ${profile.staff.fullName}, ${dto.period}`,
        ...(existing ? { before: existing, after: saved } : { after: saved }),
      });

      return saved;
    });
  }

  async remove(id: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const row = await tx.payrollInputEntry.findFirst({
        where: { id },
        include: { staff: { select: { fullName: true } } },
      });
      if (!row) throw new NotFoundException('Payroll input not found');

      if (row.source !== 'MANUAL' && row.source !== 'IMPORT') {
        throw new ConflictException(
          `This figure came from ${row.source.toLowerCase()}. Remove it at its source, or it will simply be re-derived on the next calculation.`,
        );
      }

      const locked = await tx.payrollRun.findFirst({
        where: { period: row.period, status: { in: ['APPROVED', 'PAID'] } },
      });
      if (locked) {
        throw new ConflictException(`The payroll for that period is already ${locked.status.toLowerCase()}.`);
      }

      await tx.payrollInputEntry.delete({ where: { id } });
      await recordAudit(tx, actor, {
        action: 'payrollInput.deleted',
        entityType: 'PayrollInputEntry',
        entityId: id,
        reason: `Removed ${row.componentCode} of ${formatCents(toCents(row.amount))} for ${row.staff.fullName}`,
      });
      return { removed: true };
    });
  }

  /**
   * MATERIALISE UPSTREAM FEEDS.
   *
   * Attendance, leave and incentives were read LIVE inside the calculation, so
   * no reviewable row existed, nothing recorded which attendance record produced
   * an overtime figure, and a derived number could not be adjusted without
   * editing the record behind it.
   *
   * Idempotent on `(staff, period, component, sourceRecordId)`, which the
   * database also enforces with a partial unique index — so importing the same
   * approved overtime twice cannot pay anybody twice.
   */
  async materialise(params: { period: string; clinicId?: string }) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const period = periodStart(params.period);
      const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));

      const locked = await tx.payrollRun.findFirst({
        where: { period, status: { in: ['APPROVED', 'PAID'] } },
      });
      if (locked) {
        throw new ConflictException(`The payroll for ${params.period} is already ${locked.status.toLowerCase()}.`);
      }

      const incentives = await tx.incentiveResult.findMany({
        where: { incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } } },
        include: { staff: { select: { id: true, clinicId: true } } },
      });

      let created = 0;
      let unchanged = 0;

      for (const row of incentives) {
        if (params.clinicId && row.staff.clinicId !== params.clinicId) continue;
        const existing = await tx.payrollInputEntry.findFirst({
          where: { staffId: row.staffId, period, componentCode: 'INCENTIVE', sourceRecordId: row.id },
        });
        if (existing) {
          unchanged += 1;
          continue;
        }
        await tx.payrollInputEntry.create({
          data: {
            tenantId: currentTenantId(),
            clinicId: row.staff.clinicId,
            staffId: row.staffId,
            period,
            componentCode: 'INCENTIVE',
            label: 'Incentive',
            amount: row.amount,
            kind: 'ADDITIONAL',
            source: 'INCENTIVE',
            sourceRecordId: row.id,
            createdByStaffId: actor.id,
          },
        });
        created += 1;
      }

      await recordAudit(tx, actor, {
        action: 'payrollInput.materialised',
        entityType: 'PayrollInputEntry',
        entityId: params.period,
        reason: `Materialised upstream inputs for ${params.period}: ${created} created, ${unchanged} already present`,
      });

      return {
        period: params.period,
        created,
        unchanged,
        note:
          unchanged > 0
            ? 'Rows already present were left alone. Re-running this cannot pay anybody twice.'
            : 'Every upstream figure for this period now has a reviewable input row.',
        periodEnd: periodEnd.toISOString().slice(0, 10),
      };
    });
  }
}


type InputItem = { code: string; name: string; type: string; includeIn: string };
type InputRowForPlacing = { componentCode: string; source: string; sourceRecordId: string | null; staffId: string; createdBy: { fullName: string } };

/**
 * WHERE ON THE REGISTER A ROW IS COUNTED.
 *
 * The grid's "Other income" cell is everything that reached gross except
 * basic pay, overtime and reimbursed claims; its "Other" deductions cell is
 * every withholding line; unpaid leave reduces gross and PCB is a supplied
 * amount with a column of its own. This mirrors `kindOf` in
 * `component-liability.ts` and the column sums in the run, so a line the
 * drawer shows under "Counted in Other income" is a line the cell counts.
 */
export function placeOnRegister(
  row: Pick<InputRowForPlacing, 'componentCode' | 'source'>,
  item: InputItem | undefined,
): { bucket: 'OTHER_INCOME' | 'OWN_COLUMN' | 'DEDUCTION' | 'UNKNOWN'; column: string } {
  if (row.componentCode === 'PCB') return { bucket: 'OWN_COLUMN', column: 'PCB' };
  if (!item) return { bucket: 'UNKNOWN', column: 'Not paid' };
  if (item.type === 'OVERTIME' || row.componentCode === 'OVERTIME') return { bucket: 'OWN_COLUMN', column: 'OT h' };
  if (row.source === 'CLAIM' || row.componentCode === 'CLAIM_REIMBURSEMENT') return { bucket: 'OWN_COLUMN', column: 'Claims' };
  if (item.type === 'DEDUCTION') {
    // `kindOf`: a deduction that reaches gross makes the wages smaller.
    if (item.includeIn === 'NET_ONLY') return { bucket: 'DEDUCTION', column: 'Other' };
    return { bucket: 'OWN_COLUMN', column: row.componentCode === 'UNPAID_LEAVE' ? 'Unpaid d' : 'Gross' };
  }
  return { bucket: 'OTHER_INCOME', column: 'Other income' };
}

/** The sentence for where a row came from, and the screen that corrects it. */
export function originOf(row: InputRowForPlacing, month: string): { origin: string; sourceLink: string | null } {
  switch (row.source) {
    case 'ATTENDANCE':
      return { origin: 'From attendance: overtime approved on the timesheet', sourceLink: `/admin/hr/attendance?staffId=${row.staffId}&month=${month}` };
    case 'LEAVE':
      return { origin: 'From leave: unpaid leave approved on the leave queue', sourceLink: `/admin/hr/leave?staffId=${row.staffId}` };
    case 'CLAIM':
      return { origin: 'From an approved claim routed to payroll', sourceLink: row.sourceRecordId ? `/admin/hr/claims?claimId=${row.sourceRecordId}` : '/admin/hr/claims' };
    case 'INCENTIVE':
      return { origin: 'From the incentive run for this month', sourceLink: '/admin/hr/incentives' };
    case 'RECURRING':
      return { origin: 'Recurring item on the employee record', sourceLink: `/admin/hr/employees/${row.staffId}?tab=employment` };
    case 'IMPORT':
      return { origin: 'Imported', sourceLink: null };
    default:
      return { origin: `Entered by ${row.createdBy.fullName}`, sourceLink: null };
  }
}
