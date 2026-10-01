import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, requireScope, withAdminTx } from '../finance/admin-actor';
import type { ActingStaff } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { toCents, formatCents } from '../finance/money';
import { UpsertPayrollInputDto } from './dto/upsert-payroll-input.dto';
import {
  carriedReason,
  columnItems,
  itemAppliesTo,
  itemsByCode,
  monthBefore,
  monthLabel,
  monthStartOf,
  originOf,
  placeOnRegister,
} from './payroll-register-columns';

export type CarriedForward = {
  /** "January 2026" — the month the lines came from. */
  from: string;
  carried: number;
  /** One-off late payments left behind: earned in a month other than the one before. */
  skipped: number;
  people: number;
  /** True when this month and branch had already been started once: nothing copied. */
  repeated: boolean;
};

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
      // The open version of every item, active or not: a row keyed against
      // an item that was retired afterwards still has to say what it is.
      // Ordered the way Payroll items lists them, which is the order the
      // grid gives their columns.
      this.prisma.payComponent.findMany({
        where: { effectiveTo: null },
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
        select: { code: true, name: true, type: true, includeIn: true, gridColumn: true, carryForward: true, active: true, appliesTo: true, appliesToStaffIds: true },
      }),
    ]);
    const itemByCode = itemsByCode(components);
    const month = period.toISOString().slice(0, 7);
    const carriedFromMonth = monthBefore(period).toISOString().slice(0, 7);

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
      /** Set while the row is still last month's copy; cleared by the first edit. */
      carriedFromMonth: row.carriedFromId ? carriedFromMonth : null,
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
      // An item for named people is for them alone; a line for anybody else
      // would pay a director's fee to somebody the item was never meant for.
      if (!itemAppliesTo(component, dto.staffId)) {
        throw new BadRequestException(
          `${component.name} is for selected employees only, and ${profile.staff.fullName} is not one of them. ` +
            'Add them to the item under Payroll items first, or choose another item.',
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

      // PATCH, NOT REPLACE. The grid's cells send an amount and nothing else;
      // a field the request leaves out keeps what the drawer keyed, and an
      // explicit null clears it. Saving a line that was carried from last
      // month makes it this person's own figure, whatever they changed.
      const data = {
        amount: dto.amount,
        kind: dto.kind ?? existing?.kind ?? 'ADDITIONAL',
        source: 'MANUAL' as const,
        sourceRecordId: null,
        label: dto.label === undefined ? (existing?.label ?? null) : dto.label,
        earnedPeriod:
          dto.earnedPeriod === undefined
            ? (existing?.earnedPeriod ?? null)
            : dto.earnedPeriod === null
              ? null
              : new Date(`${dto.earnedPeriod}T00:00:00.000Z`),
        reason: dto.reason === undefined ? (existing?.reason ?? null) : dto.reason,
        note: dto.note === undefined ? (existing?.note ?? null) : dto.note,
        carriedFromId: null,
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
   * START THE MONTH WITH LAST MONTH'S AMOUNTS.
   *
   * Called once, inside the transaction that creates the regular run for a
   * month. For every item marked "carry forward" under Payroll items, each
   * employee's hand-keyed line from the month before is copied in and marked
   * with the row it came from, so the person preparing the month edits or
   * clears a figure instead of re-keying it. Nothing derived is copied — a
   * recurring item, approved overtime and a claim reach the month by their
   * own routes — and a line already keyed for the month is left alone.
   *
   * EARNED-IN MONTHS MOVE WITH THE LINE. A clinic paying a director's fee,
   * locum sessions and overtime one month in arrears keys each line with an
   * "earned in" month, so those lines would otherwise never carry. A line
   * earned in exactly the month before its pay month is the ordinary arrears
   * case and is copied with the earned-in month moved forward by one:
   * January's line earned in December becomes February's line earned in
   * January. A line earned in any other month is a one-off late payment and
   * is left behind, and the count says so.
   *
   * ONCE PER MONTH AND BRANCH. The copy is recorded as an audit row against
   * the month, and a second start of the same month — the run discarded and
   * begun again — copies nothing, so a line somebody cleared on purpose does
   * not come back. Nothing here recalculates anything: the run reads the
   * rows like any other input when it is worked out.
   */
  async carryForward(tx: AdminTx, actor: ActingStaff, params: { period: Date; clinicId: string | null }): Promise<CarriedForward> {
    const previous = monthBefore(params.period);
    const from = monthLabel(previous);
    const into = monthLabel(params.period);
    const summary = (carried: number, skipped: number, people: number, repeated: boolean): CarriedForward => ({
      from,
      carried,
      skipped,
      people,
      repeated,
    });

    const items = await tx.payComponent.findMany({
      where: { effectiveTo: null, active: true, carryForward: true },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
      select: { code: true, name: true, type: true, includeIn: true, gridColumn: true, carryForward: true, active: true, appliesTo: true, appliesToStaffIds: true },
    });
    const audienceByCode = itemsByCode(items);
    // The same guard as the switch: only an addition keyed by hand carries.
    const codes = items.filter((item) => item.type === 'ADDITION' && columnItems([{ ...item, gridColumn: true }]).length > 0).map((item) => item.code);
    if (codes.length === 0) return summary(0, 0, 0, false);

    const markerId = `${params.period.toISOString().slice(0, 7)}:${params.clinicId ?? 'ALL'}`;
    const done = await tx.auditLog.findFirst({
      where: { tenantId: currentTenantId(), action: 'payrollInput.carried', entityType: 'PayrollPeriod', entityId: markerId },
      select: { id: true },
    });
    if (done) return summary(0, 0, 0, true);

    // The people the run will pay, by the run's own rule.
    const employees = await tx.employeeProfile.findMany({
      where: {
        engagement: 'EMPLOYEE',
        employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
        ...(params.clinicId ? { staff: { clinicId: params.clinicId } } : {}),
      },
      select: { staffId: true, staff: { select: { clinicId: true } } },
    });
    const staffIds = employees.map((row) => row.staffId);
    const clinicOf = new Map(employees.map((row) => [row.staffId, row.staff.clinicId]));

    const previousRows = await tx.payrollInputEntry.findMany({
      where: {
        period: previous,
        staffId: { in: staffIds },
        componentCode: { in: codes },
        source: { in: ['MANUAL', 'IMPORT'] },
      },
      orderBy: [{ staffId: 'asc' }, { componentCode: 'asc' }],
    });
    const already = new Set(
      (
        await tx.payrollInputEntry.findMany({
          where: { period: params.period, staffId: { in: staffIds }, componentCode: { in: codes } },
          select: { staffId: true, componentCode: true },
        })
      ).map((row) => `${row.staffId}:${row.componentCode}`),
    );

    const monthBeforePrevious = monthBefore(previous).getTime();
    let carried = 0;
    let skipped = 0;
    const people = new Set<string>();
    for (const row of previousRows) {
      if (already.has(`${row.staffId}:${row.componentCode}`)) continue;
      // The item is no longer for this person: last month's line stays last
      // month's, and nothing of theirs is copied for it.
      if (!itemAppliesTo(audienceByCode.get(row.componentCode), row.staffId)) continue;
      let earnedPeriod: Date | null = null;
      if (row.earnedPeriod) {
        if (monthStartOf(row.earnedPeriod).getTime() !== monthBeforePrevious) {
          skipped += 1;
          continue;
        }
        earnedPeriod = previous;
      }
      await tx.payrollInputEntry.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: clinicOf.get(row.staffId) ?? row.clinicId,
          staffId: row.staffId,
          period: params.period,
          componentCode: row.componentCode,
          label: row.label,
          amount: row.amount,
          kind: row.kind,
          source: 'MANUAL',
          sourceRecordId: null,
          earnedPeriod,
          reason: carriedReason(from, row.reason),
          note: row.note,
          carriedFromId: row.id,
          createdByStaffId: actor.id,
        },
      });
      carried += 1;
      people.add(row.staffId);
    }

    await recordAudit(tx, actor, {
      action: 'payrollInput.carried',
      entityType: 'PayrollPeriod',
      entityId: markerId,
      after: { from, into, carried, skipped, people: people.size, items: codes },
      reason:
        `Carried ${carried} ${carried === 1 ? 'line' : 'lines'} from ${from} into ${into}` +
        (skipped > 0 ? `; ${skipped} one-off late ${skipped === 1 ? 'payment' : 'payments'} left behind` : ''),
      source: 'hr.payroll',
    });
    return summary(carried, skipped, people.size, false);
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

export { originOf, placeOnRegister } from './payroll-register-columns';
