import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PayrollApprovalMode as PayrollApprovalModeEnum,
  PayrollRunStatus,
  PayrollRunType as PayrollRunTypeEnum,
  StatutoryStatus,
  StatutoryVerificationStatus,
  SystemRole,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import {
  Permission,
  can,
  isCustomRoleGrantable,
  isIndividuallyGrantable,
} from '../core/permissions';
import { AdminTx, actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, fromCents, toCents } from '../finance/money';
import {
  LIABILITY_BY_STATUS_CODE,
  PayrollComponentLine,
  StatutoryContext,
  ageAt,
  computeOvertime,
  computePayslip,
  ordinaryRates,
  statutoryStatusOf,
  unpaidLeaveDeductionCents,
} from './payroll-calculation';
import {
  SCHEMES_WITHOUT_A_SCHEDULE,
  STATUTORY_SCHEDULES,
  meetsApprovalBar,
  stampFor,
} from '../statutory/registry';
import { PAYSLIP_SCHEMES } from './statutory';
import type { StatutoryStamp } from '../statutory/registry';
import { totalTimesheet } from './attendance-hours';
import {
  MaterialisedInput,
  materialiseClaim,
  materialiseIncentives,
  materialiseOvertimeDays,
  materialiseUnpaidLeave,
  planMaterialisation,
} from './payroll-materialisation';
import { leaveDaysInYear } from './leave-balance';
import { describeProration, proratedBasicCents, prorationFor } from './proration';
import { classifyDay, describePricedDay, priceOvertime } from './overtime-pricing';
import { LINDUNG_EFFECTIVE_FROM } from '../statutory/lindung-24-jam';
import { CatalogueRow, ResolvedComponent, catalogueFor, checkOrdinaryRateBase } from './component-liability';
import {
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  MAX_HOURS_PER_DAY,
  checkOrdinaryRatePolicy,
  overtimeScope,
} from '../statutory/employment-act';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollAdjustmentDto } from './dto/payroll-adjustment.dto';
import { ImportYtdOpeningDto } from './dto/import-ytd-opening.dto';
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';
import {
  ApprovalPolicy,
  PayrollApprovalMode,
  approvalsRequired,
  decideApproval,
  describeApprovalMode,
} from './payroll-approval-rule';
import { approvalGate, BuiltException, buildException, ExceptionSeverity } from './payroll-exception';
import { resolveSalaryForPayroll, SalaryRow } from './salary-resolution';
import {
  CLASSIFICATION_FIELDS,
  StatutoryClassificationRow,
  resolveClassificationForPayroll,
  resolveEmployerProfileForPayroll,
} from './statutory-classification';
import { toClassificationRow } from './statutory-classification.service';
import {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotClassification,
  SnapshotPayslipDetail,
  SnapshotComponent,
  SnapshotEmployeeLine,
  SnapshotPayload,
  SnapshotStatutory,
  diffSnapshots,
  snapshotHash,
  verifySnapshot,
} from './payroll-snapshot';
import { computeVariance, VarianceLine } from './payroll-variance';
import {
  EmployeeFigures,
  checkMembership,
  checkPayrollInvariants,
  describeViolations,
} from './payroll-invariants';

function monthStart(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function monthEnd(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}
function daysInMonth(start: Date): number {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * PAYROLL — a run, its exceptions, and the lock.
 *
 * THE STATUTORY RULE governs everything here. Malaysian EPF, SOCSO, EIS and PCB
 * rates are not hardcoded; they come from a tenant-configured, effective-dated
 * `StatutoryRuleSet`. A run over a period with no rule set is NOT_CONFIGURED,
 * its statutory columns stay NULL rather than zero, and the payslip says so —
 * because a wrong EPF figure that looks right is worse than none.
 *
 * EXCEPTIONS ARE SURFACED BEFORE APPROVAL, never silently zeroed. An employee
 * with no salary on record, or with an unapproved overtime claim, appears in
 * `exceptions` and the run refuses to be approved until each is dealt with.
 *
 * THE LOCK IS IN THE DATABASE. An approved run's lines cannot be updated at
 * all — a trigger refuses it. A correction is a `PayrollAdjustment` row.
 */
@Injectable()
export class PayrollService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  // --- Year to date ---------------------------------------------------------

  /**
   * What an employee has been paid and taxed so far this year.
   *
   * The substrate for PCB, Form EA and the mid-year migration, read in one
   * place so all three agree. Months are returned as they were recorded — the
   * running total is derived by the caller, because a stored running total is a
   * figure that can disagree with the months it came from.
   */
  async yearToDate(staffId: string, taxYear: number) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const months = await this.prisma.employeeYtd.findMany({
      where: { staffId, taxYear },
      orderBy: { month: 'asc' },
    });
    const sum = (pick: (row: (typeof months)[number]) => number) =>
      months.reduce((total, row) => total + pick(row), 0);
    return {
      staffId,
      taxYear,
      months: months.map((row) => ({
        month: row.month,
        source: row.source,
        payrollRunId: row.payrollRunId,
        note: row.note,
        grossCents: row.grossCents,
        additionalRemunerationCents: row.additionalRemunerationCents,
        pcbCents: row.pcbCents,
        cp38Cents: row.cp38Cents,
        zakatCents: row.zakatCents,
        epfEmployeeCents: row.epfEmployeeCents,
        socsoEmployeeCents: row.socsoEmployeeCents,
        eisEmployeeCents: row.eisEmployeeCents,
      })),
      total: {
        grossCents: sum((row) => row.grossCents),
        additionalRemunerationCents: sum((row) => row.additionalRemunerationCents),
        pcbCents: sum((row) => row.pcbCents + row.cp38Cents),
        zakatCents: sum((row) => row.zakatCents),
        epfEmployeeCents: sum((row) => row.epfEmployeeCents),
        socsoEmployeeCents: sum((row) => row.socsoEmployeeCents),
        eisEmployeeCents: sum((row) => row.eisEmployeeCents),
      },
      /**
       * Which months came from a Kuwick run and which were typed in. A PCB
       * computed on top of imported figures is only as good as the import, and
       * a screen that cannot tell the two apart cannot say so.
       */
      imported: months.filter((row) => row.source === 'OPENING_IMPORT').map((row) => row.month),
    };
  }

  /**
   * OPENING BALANCES for a clinic that starts using Kuwick mid-year.
   *
   * Without these, the rest of the year is computed as though the employee had
   * earned nothing and paid no tax — so PCB charges them from scratch on
   * income they have already been taxed on, and the Form EA at year end is
   * short by however many months the clinic ran elsewhere.
   *
   * TWO REFUSALS, both deliberate:
   *
   *  - A MONTH KUWICK ITSELF CALCULATED IS NEVER OVERWRITTEN. That row is
   *    backed by an approved run, a snapshot and a hash. Letting an import
   *    replace it would make the year-to-date disagree with the payslips
   *    underneath it, and the payslips are the ones the employee holds.
   *
   *  - AN EMPLOYEE ATTACHED TO A DIFFERENT EMPLOYER IS REFUSED. Year-to-date
   *    is keyed by employer because that is who files it; importing somebody
   *    else's months under this entity would put the figures on the wrong
   *    return.
   */
  async importYtdOpening(dto: ImportYtdOpeningDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const employer = await tx.legalEmployer.findUnique({ where: { id: dto.legalEmployerId } });
      if (!employer) throw new NotFoundException('That employing company is not on file.');

      const staffIds = [...new Set(dto.months.map((row) => row.staffId))];
      const profiles = await tx.employeeProfile.findMany({
        where: { staffId: { in: staffIds } },
        select: { staffId: true, legalEmployerId: true, staff: { select: { fullName: true } } },
      });
      const profileOf = new Map(profiles.map((row) => [row.staffId, row]));

      for (const staffId of staffIds) {
        const profile = profileOf.get(staffId);
        if (!profile) {
          throw new BadRequestException(`One of these rows names somebody with no employee record (${staffId}).`);
        }
        if (profile.legalEmployerId !== dto.legalEmployerId) {
          throw new BadRequestException(
            `${profile.staff.fullName} is employed by a different company, so their year-to-date cannot be imported under ${employer.name}. Statutory returns are filed by the employing entity.`,
          );
        }
      }

      const existing = await tx.employeeYtd.findMany({
        where: {
          legalEmployerId: dto.legalEmployerId,
          staffId: { in: staffIds },
          OR: dto.months.map((row) => ({ taxYear: row.taxYear, month: row.month })),
        },
      });
      const calculated = existing.filter((row) => row.source === 'CALCULATED');
      if (calculated.length > 0) {
        const worst = calculated[0];
        throw new ConflictException(
          `${profileOf.get(worst.staffId)?.staff.fullName ?? 'An employee'} already has ${worst.taxYear}-${String(worst.month).padStart(2, '0')} from a payroll run Kuwick approved. An opening balance cannot replace a month this system paid — the payslips behind it would stop agreeing with the year-to-date.`,
        );
      }

      let written = 0;
      for (const row of dto.months) {
        const data = {
          tenantId: currentTenantId(),
          legalEmployerId: dto.legalEmployerId,
          staffId: row.staffId,
          taxYear: row.taxYear,
          month: row.month,
          grossCents: row.grossCents,
          additionalRemunerationCents: row.additionalRemunerationCents,
          pcbCents: row.pcbCents,
          cp38Cents: row.cp38Cents,
          zakatCents: row.zakatCents,
          epfEmployeeCents: row.epfEmployeeCents,
          epfEmployerCents: row.epfEmployerCents,
          socsoEmployeeCents: row.socsoEmployeeCents,
          socsoEmployerCents: row.socsoEmployerCents,
          eisEmployeeCents: row.eisEmployeeCents,
          eisEmployerCents: row.eisEmployerCents,
          source: 'OPENING_IMPORT' as const,
          payrollRunId: null,
          note: dto.note ? `${dto.source} — ${dto.note}` : dto.source,
          createdByStaffId: actor.id,
        };
        await tx.employeeYtd.upsert({
          where: {
            legalEmployerId_staffId_taxYear_month: {
              legalEmployerId: dto.legalEmployerId,
              staffId: row.staffId,
              taxYear: row.taxYear,
              month: row.month,
            },
          },
          update: data,
          create: data,
        });
        written += 1;
      }

      await recordAudit(tx, actor, {
        action: 'payroll.ytdImported',
        entityType: 'EmployeeYtd',
        entityId: dto.legalEmployerId,
        after: { employees: staffIds.length, months: written, source: dto.source },
        reason: dto.note ?? dto.source,
        source: 'hr.payroll',
      });

      return { employees: staffIds.length, months: written, source: dto.source };
    });
  }

  // --- Statutory configuration ---------------------------------------------

  /**
   * The schedules that govern, which are no longer the tenant's to write.
   *
   * These rows used to come from `StatutoryRuleSet`: an effective-dated table a
   * clinic administrator could type rates into. The shape was right and the
   * ownership was wrong. EPF, SOCSO and EIS rates are not a tenant preference —
   * they are identical for every employer in Malaysia, and a screen that lets
   * one clinic enter different ones is a screen that lets a clinic under-
   * contribute by accident and call it configuration.
   *
   * They now come from `src/statutory/registry.ts`, transcribed from the
   * authorities' own documents and dated by when each took effect. The row
   * shape is unchanged so the settings page keeps working; what changed is that
   * `verified` is now a property of the evidence rather than a checkbox
   * somebody ticked.
   */
  async listStatutoryRuleSets() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return STATUTORY_SCHEDULES.map((schedule) => ({
      id: schedule.id,
      name: `${schedule.scheme} — ${schedule.section}`,
      jurisdiction: 'MY',
      effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: schedule.effectiveTo?.toISOString().slice(0, 10) ?? null,
      verified: meetsApprovalBar(schedule.verification),
      verifiedAt: null,
      verifiedBy: schedule.authority,
      verificationNote: schedule.evidence,
      verification: schedule.verification,
      authority: schedule.authority,
      document: schedule.document,
      contentHash: schedule.contentHash,
      hasEpf: schedule.scheme === 'EPF',
      hasSocso: schedule.scheme === 'SOCSO',
      hasEis: schedule.scheme === 'EIS',
      hasPcb: schedule.scheme === 'PCB',
      status: meetsApprovalBar(schedule.verification)
        ? ('CONFIGURED' as const)
        : ('PROVISIONAL' as const),
    }));
  }

  /** Schemes with no schedule at all, so a screen can name the gap. */
  async listStatutoryGaps() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return SCHEMES_WITHOUT_A_SCHEDULE.map((gap) => ({ ...gap }));
  }

  /**
   * Writing statutory rates is refused, and the refusal is the feature.
   *
   * This used to accept EPF, SOCSO, EIS and PCB tables as JSON and let whoever
   * held `hr.payroll.approve` mark them verified. Two things were wrong with
   * that. A clinic cannot legislate: the Third Schedule says what it says, and
   * a tenant-entered variant of it is not a configuration choice but an error
   * waiting to be discovered by KWSP. And "verified" meant a person had ticked
   * a box, which is indistinguishable on screen from a figure actually checked
   * against the authority's own document.
   *
   * Rates now come from `src/statutory/registry.ts`, so there is nothing here
   * to write. The endpoint stays rather than disappearing, because a 404 would
   * read as a bug to anyone who had bookmarked the old screen, while this says
   * what happened and where the numbers went.
   */
  async upsertStatutoryRules(_dto: UpsertStatutoryRulesDto) {
    await requirePermission(this.rawPrisma, 'hr.payroll.approve');
    throw new BadRequestException(
      'Statutory rates are no longer entered by hand. EPF, SOCSO, EIS and PCB come from the ' +
        'authorities’ own published schedules, which ship with Kuwick, are dated by when each took ' +
        'effect, and are stamped onto every payroll run so a payslip can always be traced back to the ' +
        'edition that produced it. Nothing here needs configuring.',
    );
  }


  // --- The run --------------------------------------------------------------

  async create(dto: CreatePayrollRunDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const period = monthStart(dto.period);
      const runType = (dto.runType ?? 'REGULAR') as PayrollRunTypeEnum;

      /*
       * ONE REGULAR PAYROLL A MONTH; THE OTHER KINDS SIT BESIDE IT.
       *
       * The check used to refuse a SECOND RUN OF ANY KIND for the month, which
       * is right for the regular payroll and wrong for everything else — and
       * since nothing ever set `runType`, the effect was that a bonus paid
       * off-cycle, a correction beside an approved month and a leaver's final
       * pay could not be created at all. The enum has been in the schema since
       * Stage 2 with no way to reach three of its four values.
       */
      if (runType === 'REGULAR') {
        const existing = await tx.payrollRun.findFirst({
          where: {
            period,
            clinicId: dto.clinicId ?? null,
            runType: 'REGULAR',
            status: { not: PayrollRunStatus.CANCELLED },
          },
        });
        if (existing) {
          throw new ConflictException(`A payroll run for ${dto.period} already exists at this branch.`);
        }
      }

      // Several runs of one kind in a month are legitimate — two bonus rounds,
      // two leavers — so the sequence distinguishes them rather than a refusal.
      const sequence =
        ((
          await tx.payrollRun.findFirst({
            where: { period, clinicId: dto.clinicId ?? null, runType },
            orderBy: { sequence: 'desc' },
            select: { sequence: true },
          })
        )?.sequence ?? 0) + 1;

      /*
       * WHICH COMPANY IS THIS RUN FOR?
       *
       * `PayrollRun.legalEmployerId` has been the scope for every statutory
       * output since Stage 1 and NOTHING EVER SET IT — every run was created
       * with it null, so the field that decides whose EPF number a submission
       * carries was empty on every run in the system. The calculation then
       * selected employees by BRANCH, and a group running two entities out of
       * one clinic had both companies' people in one run.
       *
       * Derived where there is exactly one answer, which is every single-entity
       * clinic. Where employees at this branch belong to more than one company
       * it is REFUSED rather than picked: the run would produce a submission
       * that no entity could file.
       */
      const employers = await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(dto.clinicId ? { staff: { clinicId: dto.clinicId } } : {}),
        },
        select: { legalEmployerId: true, legalEmployer: { select: { name: true } } },
      });
      const distinct = new Map(
        employers
          .filter((row): row is typeof row & { legalEmployerId: string } => row.legalEmployerId !== null)
          .map((row) => [row.legalEmployerId, row.legalEmployer?.name ?? row.legalEmployerId]),
      );

      let legalEmployerId = dto.legalEmployerId ?? null;
      if (legalEmployerId) {
        const named = await tx.legalEmployer.findUnique({ where: { id: legalEmployerId } });
        if (!named) throw new NotFoundException('That employing company is not on file.');
      } else if (distinct.size === 1) {
        legalEmployerId = [...distinct.keys()][0];
      } else if (distinct.size > 1) {
        throw new BadRequestException(
          `Employees here are employed by ${distinct.size} different companies (${[...distinct.values()].join(', ')}). ` +
            'Statutory returns are filed by the employing entity, so a run has to name one — pick the company this run is for.',
        );
      }

      return tx.payrollRun.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? null,
          legalEmployerId,
          period,
          runType,
          sequence,
          notes: dto.notes ?? null,
          createdByStaffId: actor.id,
        },
      });
    });
  }

  /**
   * Calculate every payslip in the run.
   *
   * Re-runnable while DRAFT or CALCULATED — a manager fixes a missing salary and
   * recalculates. Refused once APPROVED, by the database as well as by this
   * check.
   */
  async calculate(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status === PayrollRunStatus.APPROVED || run.status === PayrollRunStatus.PAID) {
        throw new ConflictException('This payroll run is locked. Record an adjustment instead.');
      }

      /*
       * WHAT KIND OF RUN THIS IS CHANGES WHAT IS COMPUTED.
       *
       *  - REGULAR and CORRECTION compute the whole month. A correction is the
       *    same arithmetic over the same period; what makes it a correction is
       *    that it sits beside a run already approved, and the snapshot of that
       *    one is untouched.
       *
       *  - OFF_CYCLE_BONUS pays only what was keyed for the period. It must NOT
       *    push a BASIC line or materialise attendance and leave: doing so pays
       *    somebody their salary twice in a month, and the second payslip would
       *    look exactly like the first.
       *
       *  - FINAL_PAY is REFUSED. A leaver's last payment is not a normal month:
       *    s.60E accrued annual leave must be paid out and notice pay may be
       *    due, and neither is modelled here. A final payment that quietly
       *    omitted them would be short by a real amount and look correct.
       */
      const isBonusRun = run.runType === 'OFF_CYCLE_BONUS';
      if (run.runType === 'FINAL_PAY') {
        throw new BadRequestException(
          'A final payment is not calculated by Kuwick yet. Accrued annual leave under section 60E of the ' +
            'Employment Act and any notice pay are not modelled, so this run would produce a figure that is short ' +
            'by a real amount and looks correct. Pay the final month as a regular run and record the leave payout ' +
            'and notice pay as payroll inputs, so both appear on the payslip with a reason.',
        );
      }

      const period = run.period;
      const periodEnd = monthEnd(period);
      const days = daysInMonth(period);

      // Which schedules govern is decided by the PERIOD, never by today: a
      // September run re-calculated in December must not acquire December's
      // rates.
      const statutoryContext: StatutoryContext = { periodEnd };
      const statutoryStatus = statutoryStatusOf(periodEnd) as StatutoryStatus;
      // The schemes a payslip depends on, named ONCE in `statutory.ts`. This
      // list was written out again here and had drifted: LINDUNG was missing,
      // so a run stamped its provenance without recording which LINDUNG
      // schedule it had applied.
      const statutoryStamp = stampFor(PAYSLIP_SCHEMES, periodEnd);

      // The month's public holidays, read ONCE for the run rather than per
      // employee. Work on one is paid at two days' ordinary rate under
      // s.60D(3), so this is not a display concern.
      // THE PAY COMPONENT CATALOGUE AS AT THIS PERIOD.
      //
      // The clinic's own effective-dated rows, not a hardcoded map. Read once
      // for the run: a correction to a component's EPF liability today must not
      // reprice a month already paid, so the resolution is by period.
      const catalogue = catalogueFor(
        (await tx.payComponent.findMany()) as unknown as CatalogueRow[],
        new Date(periodEnd.getTime() - 86_400_000),
      );
      if (catalogue.size === 0) {
        throw new BadRequestException(
          'No pay components are configured for this period, so nothing on a payslip could say what it is liable to. ' +
            'Seed the component catalogue in Payroll settings before running payroll.',
        );
      }
      const orpBaseProblem = checkOrdinaryRateBase(catalogue);
      if (orpBaseProblem) throw new BadRequestException(orpBaseProblem);

      const publicHolidayDates = new Set(
        (
          await tx.publicHoliday.findMany({
            where: { date: { gte: period, lt: periodEnd } },
            select: { date: true },
          })
        ).map((row) => row.date.toISOString().slice(0, 10)),
      );

      // Ordinary Rate of Pay, frozen onto the run. Two divisors, on purpose.
      const orpConfig = {
        overtimeDaysPerMonth: Number(run.orpOvertimeDays),
        unpaidLeaveDaysPerMonth: Number(run.orpUnpaidLeaveDays),
        hoursPerDay: Number(run.orpHoursPerDay),
      };

      // s.60I(2) — A CLINIC MAY USE ITS OWN METHOD, BUT NOT A WORSE ONE.
      //
      // The Act lets an employer adopt another formula for the ordinary rate
      // of pay "but the adoption of any other method or formula shall not
      // result in a rate which is less than" the statutory one. A divisor above
      // 26 makes each day worth less and underpays every hour of overtime,
      // every rest day and every public holiday priced from it.
      //
      // Refused at the run rather than raised per employee: it is one
      // configuration error affecting everybody, and a hundred identical
      // exceptions would bury the ones that are about people.
      const orpPolicyProblem = checkOrdinaryRatePolicy('MONTHLY', orpConfig.overtimeDaysPerMonth);
      if (orpPolicyProblem) throw new BadRequestException(orpPolicyProblem);
      if (orpConfig.hoursPerDay > MAX_HOURS_PER_DAY) {
        throw new BadRequestException(
          `Normal hours are set to ${orpConfig.hoursPerDay} a day. Section 60A(1) of the Employment Act caps them at ` +
            `${MAX_HOURS_PER_DAY}, and a longer normal day both breaches that and shrinks the hourly rate overtime is priced from.`,
        );
      }

      // EMPLOYEES ONLY.
      //
      // A contractor is paid under a contract FOR services. Their fee is a
      // payable, not salary; it attracts no EPF, SOCSO or EIS, and carrying
      // one into a payroll run does not merely misclassify them — it
      // contributes on their behalf to schemes they are not a member of.
      //
      // This is a WHERE clause rather than an exception on purpose. A
      // contractor is not an employee who cannot be paid; they are somebody
      // this run is not about, and a blocker for every locum every month would
      // train the owner to click past blockers.
      const employees = await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { id: true, fullName: true, active: true, clinicId: true, role: true } } },
        // Deterministic order, so two calculations of the same run produce the
        // same exception list in the same sequence.
        orderBy: { staffId: 'asc' },
      });

      // Who was left out, and why — visible on the run rather than only in the
      // absence of a payslip. An INFO row never blocks approval.
      const contractors = await tx.employeeProfile.findMany({
        where: {
          engagement: 'CONTRACTOR',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { fullName: true, active: true } } },
        orderBy: { staffId: 'asc' },
      });

      // EXCEPTIONS ARE BUILT, NOT PARSED.
      //
      // They used to be free text that a regex mapped back onto the catalogue
      // on the way to the database — so the severity, consequence and remedy of
      // every blocker depended on a sentence surviving unchanged. A blocker
      // that has to carry four facts (what the salary was, what it became, the
      // day it changed, which month) cannot survive that round trip.
      const exceptions: (BuiltException & { name: string })[] = [];
      const raise = (
        code: string,
        employee: { staffId: string; staff: { fullName: string } },
        ctx: Record<string, string | number> = {},
      ) => {
        exceptions.push({
          ...buildException(code, employee.staffId, { staffId: employee.staffId, runId, ...ctx }),
          name: employee.staff.fullName,
        });
      };

      // WHO WAS LEFT OUT, AND WHY — recorded where the decision is taken rather
      // than inferred afterwards.
      //
      // Not every exception excludes somebody. A missing punch or an
      // unapproved overtime hour is raised AGAINST a payslip that is still
      // produced; only the reasons below stop the calculation for that person.
      // Reading "has an exception" as "was not paid" would make every
      // still-paid employee with a warning look like a contradiction.
      const excluded: { staffId: string; reason: string }[] = [];
      const exclude = (
        code: string,
        employee: { staffId: string; staff: { fullName: string } },
        ctx: Record<string, string | number> = {},
      ) => {
        raise(code, employee, ctx);
        excluded.push({ staffId: employee.staffId, reason: code });
      };

      // CANONICAL SALARY. One query for the whole run rather than one per
      // employee, and `EmployeeProfile.basicSalary` is no longer read: what
      // somebody earned in March is the rate that was in force in March.
      const salaryRows = await tx.employeeSalary.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) } },
        orderBy: { effectiveFrom: 'asc' },
      });
      const salaryByStaff = new Map<string, SalaryRow[]>();
      for (const row of salaryRows) {
        const list = salaryByStaff.get(row.staffId) ?? [];
        list.push({
          id: row.id,
          basis: row.basis,
          amountCents: toCents(row.amount),
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        });
        salaryByStaff.set(row.staffId, list);
      }

      // CANONICAL STATUTORY CLASSIFICATION. Same discipline as salary, for
      // figures of the same size: which EPF Third Schedule Part an employee
      // falls under, whether they joined LINDUNG, their MTD category and the
      // rest day the employer designated are all facts WITH DATES now, and the
      // profile columns that used to hold them are no longer read here.
      // Recording somebody's permanent residence in September repriced March.
      const classificationRows = await tx.employeeStatutoryClassification.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) } },
        orderBy: { effectiveFrom: 'asc' },
      });
      const classificationByStaff = new Map<string, StatutoryClassificationRow[]>();
      for (const row of classificationRows) {
        const list = classificationByStaff.get(row.staffId) ?? [];
        list.push(toClassificationRow(row));
        classificationByStaff.set(row.staffId, list);
      }
      // Overtime approvers, resolved once. A name per attendance row would be
      // one query per employee per calculation for a value that repeats.
      const approverNames = new Map<string, string>(
        (
          await tx.staff.findMany({
            where: {
              overtimeApprovals: {
                some: { workDate: { gte: period, lt: periodEnd }, overtimeApproved: true },
              },
            },
            select: { id: true, fullName: true },
          })
        ).map((row) => [row.id, row.fullName]),
      );

      // Employing companies by id, for the sentence an excluded employee gets.
      const employerNames = new Map<string, string>(
        (await tx.legalEmployer.findMany({ select: { id: true, name: true } })).map((row) => [row.id, row.name]),
      );

      const lastDayOfPeriod = new Date(periodEnd.getTime() - 86400000);

      /*
       * THE EMPLOYER'S OWN DATED STANDING — today that is the HRD Corp
       * registration class, resolved for the period exactly as an employee's
       * classification is. The levy engine has existed since Stage 3 and was
       * wired into nothing, so a registered employer's cost was short by 1% of
       * leviable wages every month — an omission indistinguishable on screen
       * from a clinic that simply is not registered.
       *
       * UNRECORDED is not NOT_REGISTERED. No profile on record leaves the levy
       * uncomputed (null, with the reason) and raises one run-level WARNING; a
       * registration that CHANGED mid-period blocks like any other mid-month
       * statutory change, because either answer looks correct on the total.
       */
      const employerProfileRows = run.legalEmployerId
        ? await tx.legalEmployerStatutoryProfile.findMany({
            where: { legalEmployerId: run.legalEmployerId },
            orderBy: { effectiveFrom: 'asc' },
          })
        : [];
      const employerProfileOutcome = resolveEmployerProfileForPayroll(
        employerProfileRows.map((row) => ({
          id: row.id,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          hrdRegistration: row.hrdRegistration,
        })),
        period,
        lastDayOfPeriod,
      );
      const hrdRegistration =
        employerProfileOutcome.kind === 'RESOLVED' ? employerProfileOutcome.row.hrdRegistration : null;
      if (employerProfileOutcome.kind === 'NONE_ON_RECORD' && run.legalEmployerId) {
        const employerName = employerNames.get(run.legalEmployerId) ?? 'this employer';
        exceptions.push({
          ...buildException('HRD_REGISTRATION_UNRECORDED', null, { runId, employerName }),
          name: employerName,
        });
      }
      if (employerProfileOutcome.kind === 'CHANGED_MID_PERIOD' && run.legalEmployerId) {
        const employerName = employerNames.get(run.legalEmployerId) ?? 'this employer';
        exceptions.push({
          ...buildException('HRD_REGISTRATION_CHANGED_MID_PERIOD', null, {
            runId,
            employerName,
            changedOn: employerProfileOutcome.changedOn.toISOString().slice(0, 10),
          }),
          name: employerName,
        });
      }
      const periodLabel = period.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      // Every payslip's figures, kept so the run's own totals can be checked
      // against the rows that produced them rather than trusted.
      const paidEmployees: EmployeeFigures[] = [];
      let grossTotal = 0;
      let deductionTotal = 0;
      let netTotal = 0;
      let employerCostTotal = 0;
      let counted = 0;

      // Clear any previous calculation. Safe: the trigger refuses this once the
      // run is locked, so a locked run can never reach here.
      await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });

      for (const employee of employees) {
        if (!employee.staff.active) continue;

        /*
         * A RUN BELONGS TO AN EMPLOYING COMPANY, AND THE SELECTION ABOVE ASKS
         * ONLY WHICH BRANCH.
         *
         * `PayrollRun.legalEmployerId` has scoped every statutory output since
         * Stage 1, and the calculation never filtered on it: it filtered on
         * `clinicId`. For a group running two Sdn Bhds out of one clinic, every
         * employee of company B was computed into company A's run — and then
         * `writeYearToDate` keyed their months off THEIR OWN employer, so the
         * run said one entity and the year-to-date said another. The YTD
         * opening import has refused exactly this since it was written; the
         * calculation did not.
         *
         * EXCLUDED VISIBLY rather than filtered out of the query. Somebody
         * whose payslip is missing needs to be told which run they are in, and
         * an employee absent from a WHERE clause tells nobody anything.
         */
        if (run.legalEmployerId && employee.legalEmployerId && employee.legalEmployerId !== run.legalEmployerId) {
          exclude('EMPLOYED_BY_ANOTHER_COMPANY', employee, {
            employerName: employerNames.get(employee.legalEmployerId) ?? 'another company',
            runEmployerName: employerNames.get(run.legalEmployerId) ?? 'this run’s company',
          });
          continue;
        }

        const salary = resolveSalaryForPayroll(
          salaryByStaff.get(employee.staffId) ?? [],
          period,
          lastDayOfPeriod,
        );
        if (salary.kind === 'NO_SALARY') {
          exclude('NO_SALARY', employee);
          continue;
        }
        if (salary.kind === 'CHANGED_MID_PERIOD') {
          // Refuse rather than prorate. See SALARY_CHANGED_MID_PERIOD.
          exclude('SALARY_CHANGED_MID_PERIOD', employee, {
            previousAmount: formatCents(salary.previous.amountCents),
            nextAmount: formatCents(salary.next.amountCents),
            changedOn: salary.changedOn.toISOString().slice(0, 10),
            periodLabel,
          });
          continue;
        }
        if (salary.row.basis !== 'MONTHLY') {
          exclude('SALARY_BASIS_UNSUPPORTED', employee, { basis: salary.row.basis });
          continue;
        }

        const classificationOutcome = resolveClassificationForPayroll(
          classificationByStaff.get(employee.staffId) ?? [],
          period,
          lastDayOfPeriod,
        );
        if (classificationOutcome.kind === 'NONE_ON_RECORD') {
          exclude('NO_STATUTORY_CLASSIFICATION', employee, { periodLabel });
          continue;
        }
        if (classificationOutcome.kind === 'CHANGED_MID_PERIOD') {
          // Refuse rather than pick one. Same reasoning as a mid-period salary
          // change: both possible contributions look correct on a payslip.
          exclude('STATUTORY_CLASSIFICATION_CHANGED_MID_PERIOD', employee, {
            changed: classificationOutcome.changed.map((key) => CLASSIFICATION_FIELDS[key]).join(', '),
            changedOn: classificationOutcome.changedOn.toISOString().slice(0, 10),
            periodLabel,
          });
          continue;
        }
        const classification = classificationOutcome.row;

        const [attendance, leave, incentives, inputs, claims] = await Promise.all([
          tx.attendanceRecord.findMany({
            where: { staffId: employee.staffId, workDate: { gte: period, lt: periodEnd } },
          }),
          tx.leaveRequest.findMany({
            where: {
              staffId: employee.staffId,
              status: 'APPROVED',
              startDate: { lt: periodEnd },
              endDate: { gte: period },
            },
            include: { approvedBy: { select: { fullName: true } } },
          }),
          tx.incentiveResult.findMany({
            where: {
              staffId: employee.staffId,
              incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } },
            },
            include: { incentiveRun: { select: { approvedBy: { select: { fullName: true } } } } },
          }),
          // What a person supplied for this period: allowances, bonus and PCB —
          // which this system does not calculate.
          tx.payrollInputEntry.findMany({ where: { staffId: employee.staffId, period } }),
          // APPROVED claims the approver routed to PAYROLL. A claim routed to
          // FINANCE is deliberately not here: it is reimbursed separately, and
          // reading it would be the double payment the route exists to prevent.
          tx.staffClaim.findMany({
            where: {
              staffId: employee.staffId,
              status: 'APPROVED',
              paymentRoute: 'PAYROLL',
              payrollPeriod: period,
            },
            include: { decidedBy: { select: { fullName: true } } },
          }),
        ]);

        const timesheet = totalTimesheet(
          attendance.map((row) => ({
            status: row.status,
            workedMinutes: row.workedMinutes,
            lateMinutes: row.lateMinutes,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
          })),
        );

        if (timesheet.unapprovedOvertimeMinutes > 0) {
          raise('UNAPPROVED_OVERTIME', employee, {
            hours: Math.round(timesheet.unapprovedOvertimeMinutes / 6) / 10,
          });
        }
        if (timesheet.daysMissingPunch > 0) {
          raise('MISSING_PUNCH', employee, { days: timesheet.daysMissingPunch });
        }

        // s.18A — AN INCOMPLETE MONTH IS PAID BY DAYS.
        //
        // Nothing here consulted the date somebody started or finished, so a
        // joiner on the 20th was paid a whole month and so was a leaver who
        // went on the 3rd. Both figures reached a payslip looking correct.
        //
        // The divisor is the days in THIS wage period, not 26: s.60I(1A)'s 26
        // prices an hour of overtime and answers a different question. The
        // ordinary rate below therefore keeps using the FULL monthly wage, or a
        // joiner's first month of overtime would be cheaper than every month
        // after it.
        const proration = prorationFor({
          periodStart: period,
          periodEnd,
          daysInPeriod: days,
          startDate: employee.startDate,
          endDate: employee.endDate,
        });
        if (proration.outsidePeriod) {
          // Not a payslip for nought days — they simply are not on this
          // payroll. Usually a leaver whose record is still marked active.
          exclude('NOT_EMPLOYED_IN_PERIOD', employee, {
            startDate: employee.startDate?.toISOString().slice(0, 10) ?? '',
            endDate: employee.endDate?.toISOString().slice(0, 10) ?? '',
          });
          continue;
        }
        const fullMonthlyCents = salary.row.amountCents;
        const basicCents = proratedBasicCents(fullMonthlyCents, proration, days);
        const prorationNote = describeProration(proration, days);
        if (prorationNote) {
          // INFO, not a blocker. A part-month is a normal event; what is not
          // acceptable is it happening invisibly.
          raise('PART_MONTH', employee, { note: prorationNote });
        }

        // AGE DRIVES THE SCHEME, not just the rate: at 60 the employee's EPF
        // share goes to nil and the employer's to 4%, SOCSO moves to the Second
        // Category, and EIS ceases. An unknown date of birth is therefore a
        // BLOCKING exception, not a reason to assume "under 60" — assuming
        // would under-contribute for the whole workforce and nobody would see it.
        // WITHOUT A DESIGNATED REST DAY, A DAY WORKED CANNOT BE PRICED.
        //
        // s.59 makes the rest day the employer's to designate and to tell the
        // employee; it is not the day the clinic is shut and it is not a
        // default of Sunday. Raised only where there is something to price, so
        // a clinic whose staff never work extra days is not nagged about a
        // field that would change nothing.
        // Only where it changes an entitlement: an employee the Act does not
        // reach has no statutory rest-day pay to get wrong.
        if (
          !isBonusRun &&
          classification.restDayOfWeek === null &&
          fullMonthlyCents <= FIRST_SCHEDULE_WAGE_CEILING_CENTS &&
          attendance.some((row) => (row.workedMinutes ?? 0) > 0)
        ) {
          raise('NO_REST_DAY', employee);
        }

        // LINDUNG 24 JAM. Voluntary for locals, mandatory for foreign workers,
        // and neither answer is readable off any other field — so an employee
        // with nothing recorded is an open question rather than a nil.
        // Raised only once the scheme is in force, so historical runs are not
        // blocked by a rule that did not exist for them.
        if (!classification.lindungParticipation && periodEnd > LINDUNG_EFFECTIVE_FROM) {
          raise('LINDUNG_PARTICIPATION_UNRECORDED', employee);
        }

        // NO EMPLOYING COMPANY, NO FILING. EPF, SOCSO, EIS and PCB are all
        // submitted BY an entity, so an employee attached to none of them
        // produces a payslip whose contributions could never be filed.
        //
        // The exception has been in the catalogue as BLOCKING since Stage 1 and
        // nothing ever raised it, so the rule the system claimed to enforce was
        // enforced nowhere. Found while writing year-to-date, which has to be
        // keyed by employer and was silently skipping anybody without one.
        if (!employee.legalEmployerId) {
          raise('NO_LEGAL_EMPLOYER', employee);
        }

        const age = ageAt(employee.dateOfBirth, new Date(periodEnd.getTime() - 86400000));
        if (age === null) {
          exclude('NO_DOB', employee);
          continue;
        }

        // Unpaid leave, from the leave TYPE — a clinic's own policy decides
        // which types are unpaid, and this reads that rather than assuming.
        //
        // Kept PER REQUEST rather than summed straight to a number, so the
        // materialised deduction can name the request behind it and the person
        // who approved it. "1 unpaid day" with no way back to the leave record
        // is what made payroll feel like a second place to key facts.
        const unpaidTypes = new Set(['UNPAID']);
        const unpaidLeaveRows = leave
          .filter((row) => unpaidTypes.has(row.leaveType))
          .map((row) => ({
            id: row.id,
            leaveType: row.leaveType,
            startDate: row.startDate,
            endDate: row.endDate,
            approverName: row.approvedBy?.fullName ?? null,
            days: leaveDaysInYear(
              {
                startDate: row.startDate > period ? row.startDate : period,
                endDate: row.endDate < periodEnd ? row.endDate : new Date(periodEnd.getTime() - 86400000),
              },
              period.getUTCFullYear(),
            ),
          }));
        const unpaidDays = unpaidLeaveRows.reduce((total, row) => total + row.days, 0);

        // The Ordinary Rate of Pay is built from the earnings that COUNT toward
        // it — basic and ORP-liable allowances — and never from overtime, or an
        // hour of overtime would raise the rate paid for the next one.
        // THE FULL monthly wage, never the prorated one — see the s.18A note.
        const orpBase = fullMonthlyCents;
        // s.18A governs the unpaid-leave divisor, so the month's own length
        // goes in rather than a configured 31.
        const rates = ordinaryRates(orpBase, orpConfig, days);

        // -------------------------------------------------------------------
        // MATERIALISATION — upstream facts become reviewable rows.
        //
        // Overtime, unpaid leave, incentives and approved claims were read live
        // and turned straight into payslip lines, so the earnings step could
        // show a figure and nothing on screen could say where it came from, who
        // approved it, or when. Each is now a `payroll_input_entries` row
        // carrying its source, the upstream record id and a sentence of
        // provenance — and each is idempotent on that upstream row, so
        // recalculating cannot pay anybody twice.
        // -------------------------------------------------------------------
        const overtimeApprover =
          attendance.find((row) => row.overtimeApproved && row.overtimeApprovedByStaffId)?.overtimeApprovedByStaffId ??
          null;

        // WHICH KIND OF DAY EACH ONE WAS, and therefore what it is worth.
        //
        // Every approved minute in the month used to be pooled and paid at
        // 1.5×. The Act prices a rest day in DAYS of ordinary rate (s.60(3))
        // and a public holiday at two days regardless of hours worked
        // (s.60D(3)), so somebody who came in for two hours on Hari Raya was
        // paid three hours' worth against two days owed — an underpayment, and
        // the employer's liability.
        // DOES THE ACT REACH THIS EMPLOYEE AT ALL? The First Schedule limits
        // ss.60, 60A and 60D to wages not exceeding RM4,000 a month. Above
        // that, anything paid is the employer's undertaking rather than the
        // Act's requirement, and the two must not be presented as the same
        // thing on a payslip or in a dispute.
        const scope = overtimeScope(fullMonthlyCents, periodEnd, classification.overtimeContractPolicy);
        const workedAnyDay = attendance.some((row) => (row.workedMinutes ?? 0) > 0);
        if (!isBonusRun && workedAnyDay && !scope.withinFirstSchedule && !classification.overtimeContractPolicy) {
          raise('OVERTIME_ENTITLEMENT_UNRECORDED', employee, {
            wages: formatCents(fullMonthlyCents),
          });
        }

        const pricing = priceOvertime(
          attendance.map((row) => ({
            attendanceId: row.id,
            date: row.workDate,
            workedMinutes: row.workedMinutes ?? 0,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
          })),
          (date) => classifyDay(date, { publicHolidayDates, restDayOfWeek: classification.restDayOfWeek }),
          {
            basis: 'MONTHLY',
            scope,
            normalHoursPerDay: orpConfig.hoursPerDay,
            dailyOrpCents: rates.overtimeDailyCents,
            hourlyOrpCents: rates.overtimeHourlyCents,
          },
        );
        const overtimeHours = pricing.normalDayHours;

        // A BONUS RUN CARRIES NO ATTENDANCE. Overtime, unpaid leave and
        // incentives belong to the month's regular payroll and are already on
        // it; materialising them again here would pay them a second time.
        const desiredInputs = isBonusRun
          ? []
          : [
          ...materialiseOvertimeDays(
            pricing.days.map((row) => ({
              staffId: employee.staffId,
              attendanceId: row.attendanceId,
              amountCents: row.totalCents,
              description: describePricedDay(row),
              approverName: overtimeApprover ? (approverNames.get(overtimeApprover) ?? null) : null,
            })),
          ),
          materialiseUnpaidLeave(
            unpaidLeaveRows.map((row) => ({
              staffId: employee.staffId,
              leaveRequestId: row.id,
              leaveType: row.leaveType,
              unpaidDays: row.days,
              dailyRateCents: rates.unpaidLeaveDailyCents,
              approverName: row.approverName,
              startDate: row.startDate,
              endDate: row.endDate,
            })),
          ),
          materialiseIncentives(
            incentives.map((row) => ({
              staffId: employee.staffId,
              incentiveResultId: row.id,
              incentiveRunId: row.incentiveRunId,
              amountCents: toCents(row.amount),
              earnedPeriod: period,
              approverName: row.incentiveRun.approvedBy?.fullName ?? null,
            })),
          ),
          ...claims.map((claim) =>
            materialiseClaim({
              staffId: employee.staffId,
              claimId: claim.id,
              category: claim.category,
              amountCents: toCents(claim.amountApproved ?? 0),
              claimDate: claim.claimDate,
              approverName: claim.decidedBy?.fullName ?? null,
            }),
          ),
        ].filter((row): row is MaterialisedInput => row !== null);

        const plan = planMaterialisation(
          desiredInputs,
          inputs.map((row) => ({
            id: row.id,
            componentCode: row.componentCode,
            source: row.source,
            amountCents: toCents(row.amount),
            sourceRecordId: row.sourceRecordId,
          })),
        );

        for (const want of plan.create) {
          const created = await tx.payrollInputEntry.create({
            data: {
              tenantId: currentTenantId(),
              clinicId: run.clinicId,
              staffId: want.staffId,
              period,
              componentCode: want.componentCode,
              label: want.label,
              amount: fromCents(want.amountCents),
              source: want.source,
              sourceRecordId: want.sourceRecordId,
              kind: 'ADDITIONAL',
              reason: want.provenance,
              earnedPeriod: want.earnedPeriod,
              createdByStaffId: actor.id,
            },
          });
          if (want.source === 'CLAIM' && want.sourceRecordId) {
            await this.linkClaimToInput(tx, want.sourceRecordId, created.id, period);
          }
        }
        for (const change of plan.update) {
          await tx.payrollInputEntry.update({
            where: { id: change.id },
            data: {
              amount: fromCents(change.input.amountCents),
              label: change.input.label,
              reason: change.input.provenance,
              earnedPeriod: change.input.earnedPeriod,
            },
          });
        }
        if (plan.remove.length > 0) {
          // An upstream fact that no longer justifies an input — overtime
          // rejected after a first calculation, a claim withdrawn — must stop
          // being paid. The claim link is released first so the claim can be
          // routed again.
          await tx.staffClaim.updateMany({
            where: { payrollInputEntryId: { in: plan.remove } },
            data: { payrollInputEntryId: null, payoutStatus: 'PENDING' },
          });
          await tx.payrollInputEntry.deleteMany({ where: { id: { in: plan.remove } } });
        }

        // Re-read: the payslip is built from the MATERIALISED rows, not from the
        // in-memory derivation. One source of truth for what this period pays,
        // and the same rows the earnings screen shows.
        const materialised = await tx.payrollInputEntry.findMany({
          where: { staffId: employee.staffId, period },
        });

        const overtimeCents = materialised
          .filter((row) => row.componentCode === 'OVERTIME')
          .reduce((sum, row) => sum + toCents(row.amount), 0);
        const unpaidCents = materialised
          .filter((row) => row.componentCode === 'UNPAID_LEAVE')
          .reduce((sum, row) => sum + toCents(row.amount), 0);
        const incentiveCents = materialised
          .filter((row) => row.componentCode === 'INCENTIVE')
          .reduce((sum, row) => sum + toCents(row.amount), 0);

        // Components carry their own statutory liability, so the three bases
        // come out different — overtime is SOCSO and EIS wages but not EPF
        // wages. See docs/HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md section 1.3.
        //
        // EVERY LINE BUT BASIC PAY COMES FROM A MATERIALISED INPUT ROW. Overtime,
        // unpaid leave and incentives used to be pushed here from in-memory
        // derivations AND read again from the input table, which is how a
        // derived figure could be counted twice the moment it also existed as a
        // row. There is now one source: the rows.
        const componentLines: PayrollComponentLine[] = isBonusRun
          ? []
          : [
              {
                code: 'BASIC',
                label: catalogue.get('BASIC')?.label ?? 'Basic pay',
                kind: 'EARNING',
                amount: fromCents(basicCents),
                // From the catalogue like every other line. BASIC is guaranteed
                // present: `checkOrdinaryRateBase` refuses a run without it.
                liability: (catalogue.get('BASIC') as ResolvedComponent).liability,
              },
            ];

        /*
         * NOBODY IS PAID NOUGHT.
         *
         * On an off-cycle run an employee with nothing keyed for them has no
         * payslip to produce, and a zero one would sit in the register looking
         * like a payment that failed. Left out and said so, rather than
         * filtered out of a query where nobody could see the decision.
         */
        if (isBonusRun && materialised.every((row) => row.componentCode === 'PCB' || toCents(row.amount) === 0)) {
          exclude('NOTHING_TO_PAY_OFF_CYCLE', employee, { periodLabel });
          continue;
        }

        // PCB is a supplied amount, not a computed one, so it is taken out of
        // the component list and applied as an override further down.
        const pcbInput = materialised.find((row) => row.componentCode === 'PCB');
        const pcbOverrideCents = pcbInput ? toCents(pcbInput.amount) : null;

        for (const input of materialised) {
          if (input.componentCode === 'PCB') continue;
          const component = catalogue.get(input.componentCode);
          if (!component) {
            // An input naming a component the CATALOGUE does not cover for this
            // period would otherwise be paid with no statutory treatment behind
            // it — silently EPF-exempt, silently untaxed.
            raise('UNKNOWN_COMPONENT', employee, { componentCode: input.componentCode });
            continue;
          }
          const amountCents = toCents(input.amount);
          if (amountCents === 0) continue;
          componentLines.push({
            code: input.componentCode,
            label: input.label ?? component.label,
            // The catalogue decides whether this reduces the wages or is
            // withheld from them; a negative amount still forces a withholding.
            kind: amountCents < 0 ? 'DEDUCTION' : component.kind,
            amount: fromCents(Math.abs(amountCents)),
            liability: component.liability,
          });
        }

        // WHAT THE EMPLOYEE HAS ALREADY BEEN PAID AND TAXED THIS YEAR. The MTD
        // method is cumulative, so this is not decoration: without it every
        // month is computed as though it were January and the tax is wrong all
        // year. Months EARLIER than this one only — recalculating August must
        // not fold September's figures into August's cumulative base.
        const priorMonths = employee.legalEmployerId
          ? await tx.employeeYtd.findMany({
              where: {
                legalEmployerId: employee.legalEmployerId,
                staffId: employee.staffId,
                taxYear: period.getUTCFullYear(),
                month: { lt: period.getUTCMonth() + 1 },
              },
            })
          : [];
        const ytdTotal = priorMonths.reduce(
          (total, row) => ({
            accumulatedGrossCents: total.accumulatedGrossCents + row.grossCents,
            accumulatedEpfCents: total.accumulatedEpfCents + row.epfEmployeeCents,
            // CP38 is tax paid under a direction and counts toward X alongside
            // ordinary MTD; leaving it out would over-deduct for the rest of
            // the year.
            accumulatedMtdPaidCents: total.accumulatedMtdPaidCents + row.pcbCents + row.cp38Cents,
            accumulatedZakatCents: total.accumulatedZakatCents + row.zakatCents,
          }),
          { accumulatedGrossCents: 0, accumulatedEpfCents: 0, accumulatedMtdPaidCents: 0, accumulatedZakatCents: 0 },
        );

        const payslip = computePayslip(
          componentLines,
          statutoryContext,
          {
            age,
            // EVERY CLASSIFICATION COMES FROM THE VERSION IN FORCE FOR THIS
            // PERIOD, never from the employee profile. `?? 11` rather than
            // `? … : 11`: an election recorded as 0% is a real election, and
            // reading it as the Schedule's 11% would contribute against a
            // figure nobody chose. Anything but 11 is refused downstream.
            epfMembership: classification.epfMembership,
            epfEmployeeRate: classification.epfEmployeeRate ?? 11,
            epfApplicable: classification.epfApplicable,
            socsoApplicable: classification.socsoApplicable,
            eisApplicable: classification.eisApplicable,
            pcbApplicable: classification.pcbApplicable,
            lindungParticipation: classification.lindungParticipation,
            taxResidence: classification.taxResidence,
            pcbCategory:
              classification.pcbCategory === 'CATEGORY_1'
                ? 1
                : classification.pcbCategory === 'CATEGORY_2'
                  ? 2
                  : classification.pcbCategory === 'CATEGORY_3'
                    ? 3
                    : null,
            qualifyingChildren: classification.qualifyingChildren,
            disabledSelf: classification.disabledSelf,
            disabledSpouse: classification.disabledSpouse,
            // EMPLOYER-LEVEL CONTEXT FOR THE LEVY, resolved once for the run.
            // Full-time per PSMB s.2: permanent and contract staff qualify;
            // part-timers, interns (apprentice contracts are on the
            // guideline's excluded list) and locums do not.
            hrdRegistration,
            hrdFullTimeEmployment:
              employee.employmentType === 'PERMANENT' || employee.employmentType === 'CONTRACT',
          },
          ytdTotal,
        );

        // PCB is not calculated by this system, and that is a BLOCKING
        // exception rather than a quiet null on a payslip somebody might pay
        // against. See docs/MALAYSIA_PAYROLL_STATUTORY_SOURCES.md section 4.
        if (payslip.statutory.pcbCents === null) {
          if (pcbOverrideCents === null) {
            raise('PCB_MISSING', employee);
          } else {
            // A supplied figure completes the payslip. It is withheld from the
            // employee and reduces net pay exactly as a computed one would.
            payslip.statutory.pcbCents = pcbOverrideCents;
            payslip.statutory.pcbNote = `PCB of ${pcbInput?.label ?? 'this amount'} was entered by hand, not calculated.`;
            payslip.employeeDeductionCents += pcbOverrideCents;
            payslip.netCents -= pcbOverrideCents;
            payslip.incomplete =
              payslip.statutory.epf.employeeCents === null ||
              payslip.statutory.socso.employeeCents === null ||
              payslip.statutory.eis.employeeCents === null ||
              payslip.statutory.lindung.employeeCents === null;
          }
        }
        // THE FAIL-SAFE. A statutory figure that came back NULL is unknown, not
        // nil, and an unknown contribution must stop the run rather than reach
        // a payslip as a blank somebody reads as zero.
        //
        // Raised from the FIGURES rather than from the notes. The previous
        // version matched a regex against the note text, which meant the gate
        // depended on wording: rephrasing a message silently opened it, and
        // that is exactly what happened when the engines began reporting
        // "membership has to be recorded" instead of "the schedule is
        // incomplete".
        //
        // Run-level gaps are NOT raised here. "No schedule is in force for this
        // period" is a property of the run, carried by `statutoryStatus` and
        // gated by the acknowledge-the-gap flow on approval; repeating it once
        // per employee per scheme buried the real exceptions under noise.
        for (const [scheme, contribution] of [
          ['EPF', payslip.statutory.epf],
          ['SOCSO', payslip.statutory.socso],
          ['EIS', payslip.statutory.eis],
        ] as const) {
          if (contribution.employeeCents !== null && contribution.employerCents !== null) continue;
          if (statutoryStatus === 'NOT_CONFIGURED') continue;
          exceptions.push({
            ...buildException('STATUTORY_UNKNOWN', employee.staffId, {
              staffId: employee.staffId,
              runId,
              note: contribution.note ?? `${scheme} could not be worked out for this employee.`,
            }),
            name: employee.staff.fullName,
          });
        }

        await tx.payrollLine.create({
          data: {
            tenantId: currentTenantId(),
            payrollRunId: runId,
            staffId: employee.staffId,
            employeeSnapshot: {
              name: employee.staff.fullName,
              employeeNo: employee.employeeNo,
              position: employee.position,
              department: employee.department,
              employmentType: employee.employmentType,
              bankName: employee.bankName,
              // The account number is NOT snapshotted: a payslip does not need
              // it, and a JSON column is one more place it could leak from.
              /**
               * THE STATUTORY STANDING THIS PAYSLIP WAS COMPUTED ON, frozen.
               *
               * The version id and its effective date are here so the figures
               * can be traced to the record that produced them: "which EPF
               * Part was this?" is answerable from the payslip, not by reading
               * today's employee profile and hoping it never changed.
               */
              statutoryClassification: {
                id: classification.id,
                effectiveFrom: classification.effectiveFrom.toISOString().slice(0, 10),
                epfApplicable: classification.epfApplicable,
                epfMembership: classification.epfMembership,
                epfEmployeeRate: classification.epfEmployeeRate,
                socsoApplicable: classification.socsoApplicable,
                eisApplicable: classification.eisApplicable,
                lindungParticipation: classification.lindungParticipation,
                pcbApplicable: classification.pcbApplicable,
                taxResidence: classification.taxResidence,
                pcbCategory: classification.pcbCategory,
                qualifyingChildren: classification.qualifyingChildren,
                disabledSelf: classification.disabledSelf,
                disabledSpouse: classification.disabledSpouse,
                restDayOfWeek: classification.restDayOfWeek,
                overtimeContractPolicy: classification.overtimeContractPolicy,
              },
              /** Kept under its old key so existing readers do not break. */
              statutoryApplicability: {
                epf: classification.epfApplicable,
                socso: classification.socsoApplicable,
                eis: classification.eisApplicable,
                pcb: classification.pcbApplicable,
              },
            } as never,
            // NOUGHT ON A BONUS RUN. `basicCents` is still resolved above — the
            // ordinary rate of pay is priced from the full monthly wage — but
            // it is not paid here, and a payslip reading "Basic pay 3,000"
            // above a gross of 1,500 is a payslip that does not add up.
            basicSalary: fromCents(isBonusRun ? 0 : basicCents),
            overtimePay: fromCents(isBonusRun ? 0 : overtimeCents),
            incentives: fromCents(incentiveCents),
            grossPay: fromCents(payslip.grossCents),
            unpaidLeaveDeduction: fromCents(unpaidCents),
            epfEmployee: nullableCents(payslip.statutory.epf.employeeCents),
            epfEmployer: nullableCents(payslip.statutory.epf.employerCents),
            socsoEmployee: nullableCents(payslip.statutory.socso.employeeCents),
            socsoEmployer: nullableCents(payslip.statutory.socso.employerCents),
            eisEmployee: nullableCents(payslip.statutory.eis.employeeCents),
            // Employee-borne, so there is no employer figure to write.
            lindungEmployee: nullableCents(payslip.statutory.lindung.employeeCents),
            eisEmployer: nullableCents(payslip.statutory.eis.employerCents),
            // Employer cost, never a deduction. NULL means "could not be
            // worked out", and the reason is in the statutory notes below.
            hrdLevy: nullableCents(payslip.hrdLevyCents),
            pcb: nullableCents(payslip.statutory.pcbCents),
            netPay: fromCents(payslip.netCents),
            employerCost: fromCents(payslip.employerCostCents),
            workedDays: timesheet.daysPresent,
            unpaidDays,
            overtimeHours: Math.round((timesheet.approvedOvertimeMinutes / 60) * 100) / 100,
            breakdown: {
              // The THREE bases, not one. A payslip that shows a single
              // "statutory wage" cannot explain why EPF and SOCSO differ.
              bases: {
                epf: fromCents(payslip.bases.epfCents),
                socso: fromCents(payslip.bases.socsoCents),
                eis: fromCents(payslip.bases.eisCents),
              },
              components: payslip.lines.map((line) => ({
                code: line.code, label: line.label, kind: line.kind,
                amount: line.amount, liability: line.liability,
              })),
              ordinaryRateOfPay: {
                overtimeDays: orpConfig.overtimeDaysPerMonth,
                unpaidLeaveDays: orpConfig.unpaidLeaveDaysPerMonth,
                hoursPerDay: orpConfig.hoursPerDay,
                unpaidLeaveDaily: fromCents(rates.unpaidLeaveDailyCents),
                overtimeHourly: fromCents(rates.overtimeHourlyCents),
              },
              // ONE ROW PER DAY, naming the section that priced it. This used
              // to be a single synthesised "Normal day (1.5x)" line, which
              // could not explain why a two-hour public holiday is worth two
              // days — and a figure nobody can explain is a figure nobody can
              // check.
              overtimeTiers: pricing.days
                .filter((row) => row.totalCents > 0)
                .map((row) => ({
                  label: `${row.date.toISOString().slice(0, 10)} — ${
                    row.dayType === 'NORMAL_DAY'
                      ? 'normal day'
                      : row.dayType === 'REST_DAY'
                        ? 'rest day'
                        : 'public holiday'
                  }`,
                  hours: Math.round(row.excessHours * 100) / 100,
                  ordinaryRateDays: row.ordinaryRateDays,
                  hourlyRate: fromCents(Math.round(rates.overtimeHourlyCents * row.excessMultiplier)),
                  total: fromCents(row.totalCents),
                  provision: row.provision,
                })),
              // WHERE EVERY DERIVED FIGURE CAME FROM, on the payslip itself.
              // The earnings screen reads the same rows; this is so a payslip
              // printed today still explains itself in a year.
              provenance: materialised
                .filter((row) => row.source !== 'MANUAL')
                .map((row) => ({
                  component: row.componentCode,
                  amount: fromCents(toCents(row.amount)),
                  source: row.source,
                  sourceRecordId: row.sourceRecordId,
                  explanation: row.reason,
                  earnedPeriod: row.earnedPeriod?.toISOString().slice(0, 10) ?? null,
                })),
              age,
              statutoryNotes: {
                epf: payslip.statutory.epf.note ?? null,
                socso: payslip.statutory.socso.note ?? null,
                eis: payslip.statutory.eis.note ?? null,
                lindung: payslip.statutory.lindung.note ?? null,
                pcb: payslip.statutory.pcbNote ?? null,
                hrd: payslip.hrdNote ?? null,
              },
              incomplete: payslip.incomplete,
              hourlyRateUsed: fromCents(rates.overtimeHourlyCents),
              timesheet,
            } as never,
          },
        });

        paidEmployees.push({
          staffId: employee.staffId,
          name: employee.staff.fullName,
          grossCents: payslip.grossCents,
          employeeDeductionCents: payslip.employeeDeductionCents,
          netCents: payslip.netCents,
          employerContributionCents: payslip.employerContributionCents,
          employerCostCents: payslip.employerCostCents,
        });

        grossTotal += payslip.grossCents;
        deductionTotal += payslip.employeeDeductionCents;
        netTotal += payslip.netCents;
        employerCostTotal += payslip.employerCostCents;
        counted += 1;
      }

      // ---------------------------------------------------------------------
      // INVARIANTS. The arithmetic the run asserts about itself.
      //
      // A violation here is a BUG in the calculation, not a data problem: it
      // means the payslips and the totals written above them disagree. Failing
      // loudly is the only safe response, because a wrong total is
      // indistinguishable from a right one by looking at it.
      // ---------------------------------------------------------------------
      const violations = [
        ...checkPayrollInvariants(paidEmployees, {
          grossCents: grossTotal,
          deductionCents: deductionTotal,
          netCents: netTotal,
          employerCostCents: employerCostTotal,
          employeeCount: counted,
        }),
        ...checkMembership(
          paidEmployees.map((e) => e.staffId),
          excluded,
          employees.filter((e) => e.staff.active).map((e) => e.staffId),
        ),
      ];
      if (violations.length > 0) {
        throw new ConflictException(
          `${describeViolations(violations)} ` +
            violations.slice(0, 3).map((v) => v.message).join(' '),
        );
      }

      for (const contractor of contractors) {
        if (!contractor.staff.active) continue;
        exceptions.push({
          ...buildException('CONTRACTOR_EXCLUDED', contractor.staffId, {
            staffId: contractor.staffId,
            runId,
            name: contractor.staff.fullName,
          }),
          name: contractor.staff.fullName,
        });
      }

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.CALCULATED,
          statutoryStatus,
          // No tenant rule set drives a calculation any more; the column stays
          // for the runs that were calculated when one did.
          statutoryRuleSetId: null,
          // WHICH schedules produced these figures — id, effective date,
          // verification state and a hash of the actual bands, per scheme. The
          // hash is the part that matters: a version string can be edited to
          // say anything, whereas re-running a period against an edited table
          // produces a different hash and the mismatch is visible.
          statutorySnapshot: statutoryStamp as never,
          grossTotal: fromCents(grossTotal),
          deductionTotal: fromCents(deductionTotal),
          netTotal: fromCents(netTotal),
          employerCostTotal: fromCents(employerCostTotal),
          employeeCount: counted,
          // The legacy blob is DERIVED from the built exceptions rather than
          // being their source, so the two cannot disagree.
          exceptions: exceptions.map((e) => ({
            staffId: e.staffId,
            name: e.name,
            issue: e.cause,
          })) as never,
          calculatedAt: new Date(),
        },
      });

      // EXCEPTIONS AS ROWS.
      //
      // They were a JSON blob, so they could not be queried, counted by
      // severity, overridden individually or audited — and every one of them
      // blocked approval, which gave an informational observation the same
      // force as an unpayable employee.
      //
      // The blob above is still written so that nothing reading it breaks; the
      // rows are what the approval gate now consults.
      await tx.payrollException.deleteMany({ where: { payrollRunId: runId } });
      for (const built of exceptions) {
        await tx.payrollException.create({
          data: {
            tenantId: currentTenantId(),
            payrollRunId: runId,
            staffId: built.staffId,
            severity: built.severity as ExceptionSeverity,
            code: built.code,
            cause: built.cause,
            consequence: built.consequence,
            remediation: built.remediation,
            deepLink: built.deepLink,
            overridable: built.overridable,
          },
        });
      }

      await recordAudit(tx, actor, {
        action: 'payroll.calculated',
        entityType: 'PayrollRun',
        entityId: runId,
        after: {
          period: period.toISOString().slice(0, 10),
          employees: counted,
          gross: fromCents(grossTotal),
          net: fromCents(netTotal),
          statutoryStatus,
          exceptions: exceptions.length,
        },
        source: 'hr.payroll',
      });

      return updated;
    });
  }

  /**
   * Bind a claim to the input that carries it.
   *
   * The link is UNIQUE in the database, so a second attempt to materialise the
   * same claim — a re-run against a stale plan, two runs covering one period —
   * fails on the constraint rather than quietly paying it twice. The failure is
   * translated here into something a person can act on, because "unique
   * constraint violated" tells a clinic manager nothing.
   */
  private async linkClaimToInput(tx: AdminTx, claimId: string, inputId: string, period: Date) {
    const claim = await tx.staffClaim.findFirst({ where: { id: claimId } });
    if (!claim) return;
    if (claim.payrollInputEntryId && claim.payrollInputEntryId !== inputId) {
      throw new ConflictException(
        `Claim ${claimId} is already being paid through another payroll input. A claim is paid once, by one route.`,
      );
    }
    if (claim.paymentRoute !== 'PAYROLL') {
      throw new ConflictException(
        `Claim ${claimId} was approved for separate reimbursement by Finance, so it must not reach a payslip.`,
      );
    }
    await tx.staffClaim.update({
      where: { id: claimId },
      data: { payrollInputEntryId: inputId, payoutStatus: 'IN_PAYROLL', payrollPeriod: period },
    });
  }


  /**
   * One `EmployeeYtd` row per employee per month, from an approved run.
   *
   * IDEMPOTENT BY CONSTRUCTION. `payrollRunId` is stored on the row and the
   * unique key is (employer, staff, year, month), so reopening a run,
   * correcting it and approving again REPLACES the month rather than adding to
   * it. Accumulating instead would double somebody's year-to-date the first
   * time a clinic corrected a payroll, and the error would only surface at
   * year end in a Form EA nobody could reconcile.
   *
   * A NULL statutory figure is stored as it was computed — nought — but the
   * run that carried it could not have been approved without somebody
   * acknowledging the gap, and that acknowledgement is on the approval row.
   * The alternative, refusing to write YTD at all for such a run, leaves a hole
   * in the cumulative record that every later month would silently inherit.
   */
  private async writeYearToDate(tx: AdminTx, runId: string, period: Date, actorStaffId: string) {
    const lines = await tx.payrollLine.findMany({ where: { payrollRunId: runId } });
    if (lines.length === 0) return;

    const taxYear = period.getUTCFullYear();
    const month = period.getUTCMonth() + 1;
    const employers = await tx.employeeProfile.findMany({
      where: { staffId: { in: lines.map((line) => line.staffId) } },
      select: { staffId: true, legalEmployerId: true },
    });
    const employerOf = new Map(employers.map((row) => [row.staffId, row.legalEmployerId]));

    /*
     * ONE RUN, ONE FILING ENTITY.
     *
     * Year-to-date used to be keyed off each EMPLOYEE'S employer while the run
     * carried its own, so a person computed into the wrong company's run had
     * their months filed under a third answer. The calculation now excludes
     * anybody employed elsewhere, and this refuses rather than trusting that:
     * a split year-to-date surfaces at year end, in a Form EA nobody can
     * reconcile, long after the run that caused it.
     */
    const run = await tx.payrollRun.findUnique({ where: { id: runId }, select: { legalEmployerId: true } });

    for (const line of lines) {
      const employeeEmployerId = employerOf.get(line.staffId);
      // An employee with no legal employer cannot reach an approved run — the
      // calculation raises NO_LEGAL_EMPLOYER, which is blocking — so this is a
      // guard rather than a case.
      if (!employeeEmployerId) continue;
      if (run?.legalEmployerId && employeeEmployerId !== run.legalEmployerId) {
        throw new ConflictException(
          'A payslip in this run belongs to an employee of a different company. Year-to-date is filed by the ' +
            'employing entity, so approving this would split their year across two returns. Recalculate the run.',
        );
      }
      const legalEmployerId = run?.legalEmployerId ?? employeeEmployerId;

      const breakdown = (line.breakdown ?? {}) as { additionalRemunerationCents?: number };
      const cents = (value: unknown) => (value === null || value === undefined ? 0 : toCents(value as never));

      const data = {
        tenantId: currentTenantId(),
        legalEmployerId,
        staffId: line.staffId,
        taxYear,
        month,
        grossCents: cents(line.grossPay),
        // Bonus and incentive are ADDITIONAL remuneration for tax and are taxed
        // by a different part of the MTD method from normal monthly pay, so the
        // year-to-date has to keep them apart rather than only carrying a total.
        additionalRemunerationCents: breakdown.additionalRemunerationCents ?? cents(line.bonus) + cents(line.incentives),
        pcbCents: cents(line.pcb),
        zakatCents: 0,
        epfEmployeeCents: cents(line.epfEmployee),
        epfEmployerCents: cents(line.epfEmployer),
        socsoEmployeeCents: cents(line.socsoEmployee),
        socsoEmployerCents: cents(line.socsoEmployer),
        eisEmployeeCents: cents(line.eisEmployee),
        eisEmployerCents: cents(line.eisEmployer),
        source: 'CALCULATED' as const,
        payrollRunId: runId,
        createdByStaffId: actorStaffId,
      };

      await tx.employeeYtd.upsert({
        where: {
          legalEmployerId_staffId_taxYear_month: { legalEmployerId, staffId: line.staffId, taxYear, month },
        },
        update: data,
        create: data,
      });
    }
  }

  /**
   * Approve and LOCK.
   *
   * Refuses three things: a run nobody calculated, a run with unresolved
   * exceptions, and self-approval by the person who created it.
   */
  async approve(runId: string, acknowledgeStatutoryGap = false) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.CALCULATED) {
        throw new ConflictException(`A ${run.status.toLowerCase()} payroll run cannot be approved.`);
      }
      // SEPARATION OF DUTIES, from a setting rather than a hard-coded rule.
      //
      // This used to be "the maker cannot approve, unless they hold
      // settings.manage" — right for a group with a finance department, wrong
      // for a single-doctor clinic, and invisible to both. The clinic chooses
      // now, and the rule in force is recorded on the approval so a run
      // approved last year can still say what it was approved under.
      //
      // Read BEFORE the exception gate on purpose: "you may not approve your
      // own run" is a different conversation from "this run has problems", and
      // telling somebody to go fix five exceptions they were never going to be
      // allowed to approve wastes their afternoon.
      const policy = await this.readApprovalPolicy(tx);
      const priorApprovals = await tx.payrollRunApproval.findMany({
        where: { payrollRunId: runId },
        orderBy: { sequence: 'asc' },
        select: { staffId: true },
      });
      const decision = decideApproval(policy, {
        actorStaffId: actor.id,
        actorIsOwner: actorCan(actor, 'settings.manage'),
        makerStaffId: run.createdByStaffId,
        existing: priorApprovals,
      });
      if (decision.outcome === 'REFUSE') {
        throw new ForbiddenException(decision.reason);
      }

      // THE APPROVAL GATE, from exception ROWS.
      //
      // A deliberate, specified change from "any exception blocks": BLOCKING
      // gates approval, WARNING does not. That distinction is the entire reason
      // severities exist — an unapproved-overtime note and an employee with no
      // date of birth are not the same kind of problem, and treating them
      // alike made a run unapprovable for a reason nobody needed to fix.
      const exceptionRows = await tx.payrollException.findMany({ where: { payrollRunId: runId } });
      const gate = approvalGate(exceptionRows);
      if (!gate.canApprove) {
        throw new BadRequestException(
          `${gate.reason} Fix them and recalculate, or the run will pay the wrong amounts.`,
        );
      }

      // A run whose statutory figures could not be computed CAN be approved —
      // a clinic that files EPF through its accountant is a real case — but
      // only deliberately, and the acknowledgement is on the record.
      if (run.statutoryStatus !== StatutoryStatus.CONFIGURED && !acknowledgeStatutoryGap) {
        throw new BadRequestException(
          run.statutoryStatus === StatutoryStatus.NOT_CONFIGURED
            ? 'No statutory rates are configured for this period, so EPF, SOCSO, EIS and PCB have NOT been calculated. Confirm that this is intended before approving.'
            : 'The statutory rates used have not been verified against the authority’s published tables. Confirm before approving.',
        );
      }

      // ONE ROW PER APPROVER. Under DUAL_APPROVAL there are two, and the
      // unique constraint on (run, staff) is what makes them two DIFFERENT
      // people — approving twice cannot satisfy a rule whose entire purpose is
      // a second pair of eyes.
      await tx.payrollRunApproval.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          staffId: actor.id,
          sequence: decision.sequence,
          mode: policy.mode as PayrollApprovalModeEnum,
          usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
          statutoryGapAcknowledged: acknowledgeStatutoryGap,
        },
      });

      // A FIRST APPROVAL IS NOT AN APPROVAL. The run stays CALCULATED, nothing
      // locks, no snapshot is taken, and the response says who is still needed
      // — so nobody reads "approved" off a run one person has looked at.
      if (decision.outcome === 'RECORD_AND_WAIT') {
        await recordAudit(tx, actor, {
          action: 'payrollApproval.recorded',
          entityType: 'PayrollRun',
          entityId: runId,
          after: {
            sequence: decision.sequence,
            of: approvalsRequired(policy.mode),
            mode: policy.mode,
            usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
          },
          source: 'hr.payroll',
        });
        return {
          ...run,
          approvalState: {
            complete: false,
            given: decision.sequence,
            required: approvalsRequired(policy.mode),
            message: decision.reason,
          },
        };
      }

      const approved = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: PayrollRunStatus.APPROVED, approvedByStaffId: actor.id, approvedAt: new Date() },
      });

      // THE SNAPSHOT.
      //
      // The audited competitor freezes on approval and, on reopen, re-derives
      // from CURRENT master data while holding no snapshot anybody can inspect
      // — its own dialog warns the figures "could result in different amounts".
      // That leaves "what exactly did we approve in January?" unanswerable.
      //
      // Everything the calculation consumed is frozen here and hashed, so the
      // question has an answer years later and a correction can show a diff.
      const payload = await this.buildSnapshotPayload(tx, runId);
      const hash = snapshotHash(payload);

      /*
       * A SNAPSHOT THAT DOES NOT ADD UP IS NOT A RECORD OF ANYTHING.
       *
       * Checked BEFORE it is written, and the approval fails with it. The
       * database refuses to update or delete this table, so a snapshot whose
       * totals do not follow from its own rows would be permanently
       * unreconcilable — an approved payroll nobody could ever prove. Better
       * to refuse the approval and say which relationship failed.
       *
       * The same `checkPayrollInvariants` the calculation uses, so there is no
       * second implementation to drift from the first.
       */
      const verification = verifySnapshot(payload, hash);
      if (verification.verdict !== 'VERIFIED') {
        throw new ConflictException(
          `This run cannot be approved: the record of it would not reconcile with itself. ${verification.reason} ` +
            verification.violations.map((v) => v.message).join(' '),
        );
      }

      const version = (await tx.payrollSnapshot.count({ where: { payrollRunId: runId } })) + 1;
      const snapshot = await tx.payrollSnapshot.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          version,
          hash,
          payload: payload as never,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payrollSnapshot.created',
        entityType: 'PayrollSnapshot',
        entityId: snapshot.id,
        after: { version, hash: snapshot.hash, employees: payload.totals.employeeCount },
        source: 'hr.payroll',
      });

      // YEAR TO DATE, written from the run that was just approved.
      //
      // The table existed and nothing ever wrote to it, which is why a lawful
      // PCB was impossible in principle rather than merely unimplemented: the
      // Computerised Calculation method is cumulative, and there was no
      // cumulative anything.
      //
      // Written on APPROVAL rather than on calculation, because a calculation
      // is a draft that may be run five times before anybody agrees with it,
      // and year-to-date figures that move under a draft are worse than none.
      await this.writeYearToDate(tx, runId, run.period, actor.id);

      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { status: PayrollRunStatus.CALCULATED },
        after: {
          status: PayrollRunStatus.APPROVED,
          net: String(run.netTotal),
          employees: run.employeeCount,
          statutoryStatus: run.statutoryStatus,
          statutoryGapAcknowledged: acknowledgeStatutoryGap,
          approvalMode: policy.mode,
          approvals: decision.sequence,
          usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
        },
        source: 'hr.payroll',
      });
      return {
        ...approved,
        approvalState: {
          complete: true,
          given: decision.sequence,
          required: approvalsRequired(policy.mode),
          message: 'Approved and locked.',
        },
      };
    });
  }

  /**
   * THE APPROVAL RULE IN FORCE, created on first read.
   *
   * The defaults reproduce exactly what was hard-coded before the setting
   * existed — one approval, by somebody other than the person who ran it,
   * with the account owner exempt — so upgrading changes nobody's rule.
   */
  private async readApprovalPolicy(tx: AdminTx): Promise<ApprovalPolicy> {
    const tenantId = currentTenantId();
    const existing = await tx.payrollApprovalPolicy.findUnique({ where: { tenantId } });
    if (existing) {
      return { mode: existing.mode, allowOwnerSelfApproval: existing.allowOwnerSelfApproval };
    }
    const created = await tx.payrollApprovalPolicy.create({ data: { tenantId } });
    return { mode: created.mode, allowOwnerSelfApproval: created.allowOwnerSelfApproval };
  }

  /** What the payroll settings screen shows, and what the run header reads. */
  async approvalPolicy() {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx) => {
      const policy = await this.readApprovalPolicy(tx);
      const approvers = await this.countApprovers(tx);

      /*
       * WHETHER THE RULE CAN ACTUALLY BITE, computed rather than assumed.
       *
       * Setting a rule that cannot take effect is worse than having no rule:
       * the clinic believes two people are checking payroll and one is. Two
       * things can make a chosen rule inert, and the screen says which:
       *
       *   * only one account can approve payroll at all, so a rule needing a
       *     second person can never be satisfied; or
       *   * every account that can approve payroll is an account holder, and
       *     the owner exemption is on, so the separation never applies.
       *
       * The second is not a small print case today. `hr.payroll.approve` is
       * carried by the OWNER role alone — it is not individually grantable and
       * a custom role cannot hold it — so EVERY approver is an owner, and with
       * the exemption on, MAKER_CHECKER behaves exactly like STANDARD.
       */
      const needsASecondPerson = approvalsRequired(policy.mode) > 1 || policy.mode === 'MAKER_CHECKER';
      const inert: string[] = [];
      if (needsASecondPerson && approvers.total < 2) {
        inert.push(
          `Only ${approvers.total === 1 ? 'one account' : 'no account'} in this clinic can approve payroll, so a rule that needs a second person cannot be met. Give a colleague the owner role first.`,
        );
      }
      if (needsASecondPerson && policy.allowOwnerSelfApproval && approvers.total === approvers.owners) {
        inert.push(
          'Everybody who can approve payroll is an account holder, and account holders are allowed to approve their own runs, so this rule will not change who can approve anything. Turn that allowance off to make it take effect.',
        );
      }

      return {
        ...policy,
        approvalsRequired: approvalsRequired(policy.mode),
        description: describeApprovalMode(policy),
        approvers,
        /** Empty when the rule does what it says. */
        inert,
        /**
         * WHAT THIS SETTING DOES NOT DO. Named on the screen rather than
         * discovered by a clinic that assumed otherwise.
         */
        limits: [
          'Nobody is notified that a run is waiting for them. The second approver finds it on the payroll list.',
          'The rule does not vary by amount. A small correction run takes the same route as a full month.',
          'It governs the payroll run only. Claims, leave, overtime and incentives each have their own approval.',
          'Both approvers need the same permission. Kuwick has no notion of a more senior approver, so two approvals means two people, not two levels.',
          'Only an account holder can approve payroll. It cannot be given to an HR or finance colleague on its own, so a second approver has to be a second account holder.',
        ],
      };
    });
  }

  /**
   * HOW MANY PEOPLE COULD APPROVE A RUN, and how many of those are account
   * holders. Both numbers, because a rule needing two people and a clinic
   * having one is a different problem from a clinic where everybody is exempt.
   */
  private async countApprovers(tx: AdminTx) {
    const staff = await tx.staff.findMany({
      where: { active: true },
      include: {
        roleAssignments: { select: { role: true, customRole: { select: { permissions: true } } } },
        permissionGrants: { select: { permission: true } },
      },
    });
    let total = 0;
    let owners = 0;
    const names: string[] = [];
    for (const person of staff) {
      const roles = person.roleAssignments
        .map((row) => row.role)
        .filter((role): role is SystemRole => role !== null);
      const extra: Permission[] = [
        ...person.permissionGrants.map((row) => row.permission).filter(isIndividuallyGrantable),
        ...person.roleAssignments
          .flatMap((row) => row.customRole?.permissions ?? [])
          .filter(isCustomRoleGrantable),
      ];
      if (!can(person, 'hr.payroll.approve', roles, extra)) continue;
      total += 1;
      names.push(person.fullName);
      if (can(person, 'settings.manage', roles, extra)) owners += 1;
    }
    return { total, owners, names };
  }

  /** Change the rule. Owner-level, and audited with both the old and new rule. */
  async setApprovalPolicy(input: { mode?: PayrollApprovalMode; allowOwnerSelfApproval?: boolean }) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const tenantId = currentTenantId();
      const before = await this.readApprovalPolicy(tx);
      const after: ApprovalPolicy = {
        mode: input.mode ?? before.mode,
        allowOwnerSelfApproval: input.allowOwnerSelfApproval ?? before.allowOwnerSelfApproval,
      };
      await tx.payrollApprovalPolicy.update({
        where: { tenantId },
        data: {
          mode: after.mode as PayrollApprovalModeEnum,
          allowOwnerSelfApproval: after.allowOwnerSelfApproval,
          updatedByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'payrollApprovalPolicy.changed',
        entityType: 'PayrollApprovalPolicy',
        entityId: tenantId,
        before: { mode: before.mode, allowOwnerSelfApproval: String(before.allowOwnerSelfApproval) },
        after: { mode: after.mode, allowOwnerSelfApproval: String(after.allowOwnerSelfApproval) },
        source: 'hr.payroll',
      });
      return {
        ...after,
        approvalsRequired: approvalsRequired(after.mode),
        description: describeApprovalMode(after),
      };
    });
  }

  /** The ONLY way a locked run changes. */
  async adjust(runId: string, dto: PayrollAdjustmentDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
        throw new BadRequestException('An unlocked run is corrected by recalculating it, not by an adjustment.');
      }

      const adjustment = await tx.payrollAdjustment.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          staffId: dto.staffId,
          description: dto.description,
          amount: dto.amount,
          reason: dto.reason,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.adjusted',
        entityType: 'PayrollAdjustment',
        entityId: adjustment.id,
        after: { payrollRunId: runId, staffId: dto.staffId, amount: dto.amount, description: dto.description },
        reason: dto.reason,
        source: 'hr.payroll',
      });
      return adjustment;
    });
  }

  async markPaid(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictException('Only an approved run can be marked paid.');
      }
      // NO BANK INTEGRATION. This records that a human paid it, and nothing
      // here claims to have moved money (owner brief §5I).
      const paid = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: PayrollRunStatus.PAID, paidAt: new Date() },
      });
      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { status: PayrollRunStatus.APPROVED },
        after: { status: PayrollRunStatus.PAID, paidAt: paid.paidAt },
        source: 'hr.payroll',
      });
      return paid;
    });
  }

  async list(params: { clinicId?: string; year?: number } = {}) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        ...(params.clinicId ? { clinicId: params.clinicId } : {}),
        ...(params.year
          ? { period: { gte: new Date(Date.UTC(params.year, 0, 1)), lt: new Date(Date.UTC(params.year + 1, 0, 1)) } }
          : {}),
      },
      orderBy: { period: 'desc' },
      include: {
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { lines: true, adjustments: true } },
        // THE ROWS, not the blob. This column is the first thing anybody reads
        // about a run, and it has to be the same fact the Approve button acts
        // on. Selected down to the three fields the gate needs, so listing a
        // year of runs does not drag every cause string across the wire.
        exceptionRows: { select: { severity: true, overridable: true, overriddenByStaffId: true } },
      },
    });
    return runs.map((run) => ({
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicId: run.clinicId,
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      statutoryStatus: run.statutoryStatus,
      grossTotal: Number(run.grossTotal),
      deductionTotal: Number(run.deductionTotal),
      netTotal: Number(run.netTotal),
      employerCostTotal: Number(run.employerCostTotal),
      employeeCount: run.employeeCount,
      exceptions: approvalGate(run.exceptionRows),
      lines: run._count.lines,
      adjustments: run._count.adjustments,
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      approvedBy: run.approvedBy?.fullName ?? null,
      createdBy: run.createdBy.fullName,
      paidAt: run.paidAt,
    }));
  }

  async detail(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
        lines: { include: { staff: { select: { fullName: true } } }, orderBy: { staff: { fullName: 'asc' } } },
        adjustments: { include: { staff: { select: { fullName: true } }, createdBy: { select: { fullName: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    return {
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      statutoryStatus: run.statutoryStatus,
      // Stated in the payload, so the UI cannot forget to say it.
      statutoryNotice:
        run.statutoryStatus === StatutoryStatus.NOT_CONFIGURED
          ? 'No statutory rates were configured for this period. EPF, SOCSO, EIS and PCB have NOT been calculated and are shown as blank rather than zero.'
          : run.statutoryStatus === StatutoryStatus.PROVISIONAL
            ? 'The statutory rates used have not been verified against the authority’s published tables. Treat these figures as provisional.'
            : null,
      // WHICH SCHEDULES PRODUCED THESE FIGURES, as recorded at calculation.
      // Read from the run rather than re-resolved, so a payslip reprinted next
      // year shows the edition behind it and not the one in force at printing.
      statutorySnapshot: run.statutorySnapshot,
      grossTotal: Number(run.grossTotal),
      deductionTotal: Number(run.deductionTotal),
      netTotal: Number(run.netTotal),
      employerCostTotal: Number(run.employerCostTotal),
      employeeCount: run.employeeCount,
      // NO EXCEPTION STATE HERE, deliberately.
      //
      // It used to return the legacy JSON blob, which the banner rendered while
      // the approval gate read the `payroll_exceptions` rows — two stores of
      // one fact, free to disagree, and they did. The detail payload no longer
      // carries exceptions in any form, so the screen has nowhere to read them
      // from except `GET /payroll/runs/:id/exceptions`. A second source cannot
      // creep back in without adding a field back here first.
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      approvedBy: run.approvedBy?.fullName ?? null,
      createdBy: run.createdBy.fullName,
      paidAt: run.paidAt,
      lines: run.lines.map((line) => ({
        id: line.id,
        staffId: line.staffId,
        name: line.staff.fullName,
        snapshot: line.employeeSnapshot,
        basicSalary: Number(line.basicSalary),
        allowances: Number(line.allowances),
        overtimePay: Number(line.overtimePay),
        incentives: Number(line.incentives),
        bonus: Number(line.bonus),
        grossPay: Number(line.grossPay),
        unpaidLeaveDeduction: Number(line.unpaidLeaveDeduction),
        // Needed by the payslip: without it the deductions column does not sum
        // to the difference between gross and net, and a payslip that does not
        // add up is worse than no payslip.
        otherDeductions: Number(line.otherDeductions),
        // NULL travels through as null, never coerced to 0 — that is the whole
        // point of `StatutoryStatus`.
        epfEmployee: numberOrNull(line.epfEmployee),
        epfEmployer: numberOrNull(line.epfEmployer),
        socsoEmployee: numberOrNull(line.socsoEmployee),
        socsoEmployer: numberOrNull(line.socsoEmployer),
        eisEmployee: numberOrNull(line.eisEmployee),
        lindungEmployee: numberOrNull(line.lindungEmployee),
        hrdLevy: numberOrNull(line.hrdLevy),
        eisEmployer: numberOrNull(line.eisEmployer),
        pcb: numberOrNull(line.pcb),
        netPay: Number(line.netPay),
        employerCost: Number(line.employerCost),
        workedDays: numberOrNull(line.workedDays),
        unpaidDays: numberOrNull(line.unpaidDays),
        overtimeHours: numberOrNull(line.overtimeHours),
        breakdown: line.breakdown,
      })),
      adjustments: run.adjustments.map((adjustment) => ({
        id: adjustment.id,
        staffName: adjustment.staff.fullName,
        description: adjustment.description,
        amount: Number(adjustment.amount),
        reason: adjustment.reason,
        by: adjustment.createdBy.fullName,
        at: adjustment.createdAt,
      })),
    };
  }

  // =========================================================================
  // STAGE 2 — snapshot, reopen with a diff, and variance
  // =========================================================================

  /**
   * Freeze what the calculation consumed.
   *
   * Read from the run's own lines, so a snapshot is a picture of what was
   * approved rather than a re-derivation from master data that may since have
   * moved.
   */
  /**
   * EVERYTHING THE APPROVAL WAS MADE ON, FROZEN AND HASHED.
   *
   * Version 1 froze the FIGURES and almost nothing that produced them. It
   * recorded no statutory schedules — so the hash did not cover which EPF Third
   * Schedule the contributions came out of, which is the first question an
   * auditor asks; no employee classification, so which Part applied was
   * unanswerable; no component treatment, only a code and a version number
   * read from whatever was `active: true` TODAY rather than resolved for the
   * period; no approvals; and none of the blocking exceptions somebody had to
   * override to get here. It also scoped payroll inputs by PERIOD alone, so an
   * off-cycle run's snapshot carried the regular run's inputs and vice versa.
   *
   * Version 2 records the six things the approval actually rested on: the
   * inputs, the classifications, the component treatments, the statutory rule
   * versions and their content hashes, the calculations, and the approvals.
   */
  private async buildSnapshotPayload(tx: AdminTx, runId: string): Promise<SnapshotPayload> {
    const run = await tx.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        legalEmployer: { select: { id: true, name: true } },
        lines: { orderBy: { staffId: 'asc' } },
        approvals: { orderBy: { sequence: 'asc' }, include: { staff: { select: { fullName: true } } } },
        exceptionRows: { orderBy: [{ severity: 'asc' }, { code: 'asc' }, { staffId: 'asc' }] },
      },
    });

    /*
     * INPUTS BELONGING TO THIS RUN, not to this month.
     *
     * A clinic paying a bonus off-cycle has two runs over one period. Filtering
     * on the period alone put every input in both snapshots, so each claimed to
     * have consumed money the other paid.
     *
     * An input carries no run reference — it belongs to a person and a month —
     * so the scope that IS right is the period plus the employees this run
     * actually paid. Two runs over one period with different people now get
     * different inputs; a correction run over the same people legitimately
     * reprices the same ones.
     */
    const paidStaffIds = run.lines.map((line) => line.staffId);
    const inputs = await tx.payrollInputEntry.findMany({
      where: { period: run.period, staffId: { in: paidStaffIds } },
      orderBy: [{ staffId: 'asc' }, { componentCode: 'asc' }, { id: 'asc' }],
    });

    /*
     * THE COMPONENT CATALOGUE AS AT THE PERIOD, WITH ITS TREATMENT.
     *
     * Resolved the same way the calculation resolves it — by period, not by
     * `active` today — and carrying the liability flags, which ARE the
     * treatment. A version number alone says a row changed, not what it said.
     */
    const componentRows = (await tx.payComponent.findMany({
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'asc' }],
    })) as unknown as CatalogueRow[];
    const lastDay = new Date(monthEnd(run.period).getTime() - 86_400_000);
    const resolvedCatalogue = catalogueFor(componentRows, lastDay);
    const components: SnapshotComponent[] = [...resolvedCatalogue.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, resolved]) => {
        const row = componentRows.find(
          (candidate) =>
            candidate.code === code &&
            candidate.effectiveFrom <= lastDay &&
            (!candidate.effectiveTo || candidate.effectiveTo >= lastDay),
        );
        return {
          code,
          label: resolved.label,
          version: (row as unknown as { version?: number })?.version ?? 0,
          effectiveFrom: (row?.effectiveFrom ?? run.period).toISOString().slice(0, 10),
          effectiveTo: row?.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
          kind: resolved.kind,
          liability: {
            epfLiable: resolved.liability.epf,
            socsoLiable: resolved.liability.socso,
            eisLiable: resolved.liability.eis,
            pcbLiable: resolved.liability.pcb,
            includeInOrpBase: resolved.liability.ordinaryRateOfPay,
            additionalRemuneration: resolved.liability.additionalRemuneration ?? false,
          },
          verification: resolved.verification,
          sourceRef: resolved.sourceRef,
        };
      });

    /*
     * THE SCHEDULES, AS APPLIED. Written onto the run at calculation by
     * `stampFor` and copied here so the HASH COVERS THEM: a snapshot that does
     * not say which EPF edition produced its figures cannot be reconciled to
     * anything years later, and re-deriving the stamp at read time would answer
     * with today's registry rather than the run's.
     */
    const stamp = (run.statutorySnapshot ?? null) as unknown as StatutoryStamp | null;
    const statutory: SnapshotStatutory | null = stamp
      ? {
          resolvedAt: stamp.resolvedAt,
          approvable: stamp.approvable,
          blockers: [...stamp.blockers],
          schedules: stamp.schedules.map((schedule) => ({
            scheme: schedule.scheme,
            scheduleId: schedule.scheduleId ?? null,
            effectiveFrom: schedule.effectiveFrom ?? null,
            verification: schedule.verification ?? null,
            document: schedule.document ?? null,
            contentHash: schedule.contentHash ?? null,
            missing: schedule.missing,
            notYetInForce: schedule.notYetInForce,
          })),
        }
      : null;

    const employees: SnapshotEmployeeLine[] = run.lines.map((line) => {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      const mine = inputs.filter((i) => i.staffId === line.staffId);
      const breakdown = (line.breakdown ?? {}) as Record<string, unknown>;
      const bases = (breakdown.bases ?? {}) as Record<string, number>;
      const cents = (value: unknown) => (value === null || value === undefined ? null : toCents(value as never));

      const epfEmployeeCents = cents(line.epfEmployee);
      const epfEmployerCents = cents(line.epfEmployer);
      const socsoEmployeeCents = cents(line.socsoEmployee);
      const socsoEmployerCents = cents(line.socsoEmployer);
      const eisEmployeeCents = cents(line.eisEmployee);
      const eisEmployerCents = cents(line.eisEmployer);
      const lindungEmployeeCents = cents(line.lindungEmployee);
      const hrdLevyCents = cents(line.hrdLevy);
      const pcbCents = cents(line.pcb);

      const grossCents = bases.grossCents ?? toCents(line.grossPay);
      const netCents = toCents(line.netPay);
      const employerCostCents = toCents(line.employerCost);

      // VERSION 3 — the payslip detail. A payslip issued years later must come
      // from the snapshot alone: a reopen rewrites the run's lines while the
      // approved snapshot stands, and a slip drawn from the lines at that
      // moment would show candidate figures under an approved letterhead.
      const componentRows = (breakdown.components ?? []) as {
        code: string;
        label: string;
        kind: string;
        amount: unknown;
      }[];
      const statutoryNoteRows = (breakdown.statutoryNotes ?? {}) as Record<string, string | null>;
      const overtimeRows = (breakdown.overtimeTiers ?? []) as {
        label: string;
        hours: number;
        hourlyRate: number;
        total: number;
      }[];
      const payslipDetail: SnapshotPayslipDetail = {
        employeeNo: (snap.employeeNo as string | undefined) ?? null,
        position: (snap.position as string | undefined) ?? null,
        department: (snap.department as string | undefined) ?? null,
        employmentType: (snap.employmentType as string | undefined) ?? null,
        bankName: (snap.bankName as string | undefined) ?? null,
        workedDays: line.workedDays === null ? null : Number(line.workedDays),
        unpaidDays: line.unpaidDays === null ? null : Number(line.unpaidDays),
        overtimeHours: line.overtimeHours === null ? null : Number(line.overtimeHours),
        figures: {
          basicCents: toCents(line.basicSalary),
          allowancesCents: toCents(line.allowances),
          overtimeCents: toCents(line.overtimePay),
          incentivesCents: toCents(line.incentives),
          bonusCents: toCents(line.bonus),
          unpaidLeaveCents: toCents(line.unpaidLeaveDeduction),
          otherDeductionsCents: toCents(line.otherDeductions),
        },
        componentLines: componentRows.map((row) => ({
          code: row.code,
          label: row.label,
          kind: row.kind,
          amountCents: toCents(row.amount as never),
        })),
        statutoryNotes: {
          epf: statutoryNoteRows.epf ?? null,
          socso: statutoryNoteRows.socso ?? null,
          eis: statutoryNoteRows.eis ?? null,
          lindung: statutoryNoteRows.lindung ?? null,
          pcb: statutoryNoteRows.pcb ?? null,
        },
        overtime: overtimeRows.map((row) => ({
          label: row.label,
          hours: row.hours,
          hourlyRate: row.hourlyRate,
          total: row.total,
        })),
      };

      return {
        staffId: line.staffId,
        name: String(snap.name ?? ''),
        salaryRowId: (snap.salaryRowId as string | undefined) ?? null,
        salaryBasis: (snap.salaryBasis as string | undefined) ?? null,
        salaryAmountCents: toCents(line.basicSalary),
        payslip: payslipDetail,
        // The statutory standing this payslip was computed on, taken from the
        // line rather than from the employee record: the record moves, and the
        // whole point of freezing is that this must not.
        classification: (snap.statutoryClassification as SnapshotClassification | undefined) ?? null,
        inputs: mine.map((i) => ({
          id: i.id,
          componentCode: i.componentCode,
          amountCents: toCents(i.amount),
          source: i.source,
          sourceRecordId: i.sourceRecordId,
          kind: i.kind,
        })),
        bases: {
          grossCents,
          epfCents: bases.epfCents ?? 0,
          socsoCents: bases.socsoCents ?? 0,
          eisCents: bases.eisCents ?? 0,
          ordinaryRateBaseCents: bases.ordinaryRateBaseCents ?? toCents(line.basicSalary),
        },
        statutory: {
          epfEmployeeCents,
          epfEmployerCents,
          socsoEmployeeCents,
          socsoEmployerCents,
          eisEmployeeCents,
          eisEmployerCents,
          lindungEmployeeCents,
          hrdLevyCents,
          pcbCents,
        },
        // DERIVED FROM THE STORED FIGURES, so the snapshot can be checked
        // against itself years later without the run that made it.
        deductionCents: grossCents - netCents,
        employerContributionCents: employerCostCents - grossCents,
        netCents,
        employerCostCents,
      };
    });

    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      legalEmployerId: run.legalEmployer?.id ?? null,
      legalEmployerName: run.legalEmployer?.name ?? null,
      period: run.period.toISOString().slice(0, 10),
      runType: run.runType,
      sequence: run.sequence,
      paymentDate: run.paymentDate ? run.paymentDate.toISOString().slice(0, 10) : null,
      // Legacy, and null on every run this engine calculates. Kept so a
      // version-1 payload and a version-2 one have the same key set.
      statutoryRuleSetId: run.statutoryRuleSetId,
      statutoryVerificationStatus: null,
      statutory,
      components,
      approvals: run.approvals.map((approval) => ({
        staffId: approval.staffId,
        name: approval.staff.fullName,
        sequence: approval.sequence,
        mode: approval.mode,
        usedOwnerSelfApproval: approval.usedOwnerSelfApproval,
        statutoryGapAcknowledged: approval.statutoryGapAcknowledged,
        at: approval.createdAt.toISOString(),
      })),
      // WHAT WAS KNOWN WHEN SOMEBODY AGREED TO PAY IT. An approval read without
      // the blockers it was given over is an approval of an unstated thing.
      exceptions: run.exceptionRows.map((row) => ({
        code: row.code,
        severity: row.severity,
        staffId: row.staffId,
        cause: row.cause,
        overridden: row.overriddenAt !== null,
        overriddenByStaffId: row.overriddenByStaffId,
        overrideReason: row.overrideReason,
      })),
      orp: {
        overtimeDays: Number(run.orpOvertimeDays),
        unpaidLeaveDays: Number(run.orpUnpaidLeaveDays),
        hoursPerDay: Number(run.orpHoursPerDay),
      },
      employees,
      totals: {
        grossCents: toCents(run.grossTotal),
        deductionCents: toCents(run.deductionTotal),
        netCents: toCents(run.netTotal),
        employerCostCents: toCents(run.employerCostTotal),
        employeeCount: run.employeeCount,
      },
    };
  }

  /** Every snapshot ever taken of a run, newest first. */
  async snapshots(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payrollSnapshot.findMany({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });
    return rows.map((row) => {
      const payload = row.payload as unknown as SnapshotPayload;
      const verification = verifySnapshot(payload, row.hash);
      return {
        id: row.id,
        version: row.version,
        hash: row.hash,
        reason: row.reason,
        createdBy: row.createdBy.fullName,
        createdAt: row.createdAt.toISOString(),
        totals: payload.totals,
        // CHECKED ON EVERY READ, not stored. A verdict written once and read
        // forever would be the assertion, not the evidence.
        verdict: verification.verdict,
        verificationNote: verification.reason,
        schemaVersion: verification.schemaVersion,
      };
    });
  }

  /**
   * THE FULL RECORD OF ONE APPROVAL, AND WHETHER IT STILL HOLDS.
   *
   * Returns the frozen payload beside a fresh verification of it. Two separate
   * questions answered separately: is this the payload that was approved (the
   * hash), and does it add up (the invariants). A screen that showed the
   * figures without the verdict would present a stored blob as a proof.
   */
  async snapshot(runId: string, version: number) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const row = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId, version },
      include: { createdBy: { select: { fullName: true } } },
    });
    if (!row) throw new NotFoundException(`No snapshot version ${version} for this payroll run.`);

    const payload = row.payload as unknown as SnapshotPayload;
    return {
      id: row.id,
      version: row.version,
      hash: row.hash,
      reason: row.reason,
      createdBy: row.createdBy.fullName,
      createdAt: row.createdAt.toISOString(),
      verification: verifySnapshot(payload, row.hash),
      payload,
    };
  }

  /**
   * REOPEN AN APPROVED RUN.
   *
   * The prior snapshot is never erased. The run returns to CALCULATED so it can
   * be recalculated, and the next approval writes a NEW snapshot version — so
   * the history reads as a sequence of things that were true, not as one
   * mutable present.
   */
  async reopen(runId: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.reopen', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictException(
          run.status === PayrollRunStatus.PAID
            ? 'This run is marked paid. Money has left the clinic; correct it with an adjustment rather than reopening it.'
            : `A ${run.status.toLowerCase()} run is not open to reopening.`,
        );
      }
      if (!reason || reason.trim().length < 5) {
        throw new BadRequestException('Say why this run is being reopened. It becomes part of the payroll record.');
      }

      const latest = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId },
        orderBy: { version: 'desc' },
      });

      /*
       * THE APPROVALS GO WITH THE FIGURES THEY APPROVED.
       *
       * They used to survive a reopen, and under every mode that was wrong.
       * Under DUAL_APPROVAL the two existing sign-offs counted toward the
       * CORRECTED run, so a run could be changed after approval and reach
       * APPROVED again with nobody having looked at the change — the exact
       * control the second pair of eyes exists to provide, bypassed by the
       * workflow meant to preserve it. Under STANDARD the unique key on
       * (run, approver) meant the person who approved it could never approve
       * their own correction, so the run was stuck instead.
       *
       * Cleared here, therefore. The history is not lost: the audit log keeps
       * every `payroll.approved` entry, and the preserved snapshot keeps the
       * figures that were approved and their hash.
       */
      const cleared = await tx.payrollRunApproval.deleteMany({ where: { payrollRunId: runId } });

      const reopened = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.CALCULATED,
          approvedByStaffId: null,
          approvedAt: null,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.reopened',
        entityType: 'PayrollRun',
        entityId: runId,
        before: {
          status: PayrollRunStatus.APPROVED,
          snapshotVersion: latest?.version ?? null,
          snapshotHash: latest?.hash ?? null,
          approvalsHeld: cleared.count,
        },
        after: { status: PayrollRunStatus.CALCULATED, approvalsHeld: 0 },
        reason,
        source: 'hr.payroll',
      });

      return {
        run: reopened,
        preservedSnapshot: latest ? { version: latest.version, hash: latest.hash } : null,
        note: latest
          ? `Snapshot v${latest.version} is preserved. Recalculate, review the difference, then approve again to write v${latest.version + 1}. This run needs approving from the start again — the previous sign-offs were of figures that have now changed.`
          : 'This run was approved before snapshots existed, so there is nothing to compare against.',
      };
    });
  }

  /**
   * What a recalculation WOULD change, against the approved snapshot.
   *
   * Shown before anybody commits — which the audited competitor does not do:
   * it warns that figures may change and then shows nobody what did.
   */
  async candidateDiff(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const latest = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
    });
    if (!latest) {
      return { hasSnapshot: false, note: 'This run has never been approved, so there is nothing to compare against.' };
    }
    const candidate = await this.buildSnapshotPayload(this.prisma as unknown as AdminTx, runId);
    const before = latest.payload as unknown as SnapshotPayload;
    const diff = diffSnapshots(before, candidate);
    return {
      hasSnapshot: true,
      snapshotVersion: latest.version,
      snapshotHash: latest.hash,
      candidateHash: snapshotHash(candidate),
      diff,
      note: diff.identical
        ? 'The recalculation produces exactly what was approved.'
        : `${diff.changed.length} figure(s) differ from what was approved, across ${new Set(diff.changed.map((c) => c.staffId)).size} employee(s).`,
    };
  }

  /**
   * VARIANCE AGAINST THE PREVIOUS PERIOD.
   *
   * Payroll errors are rarely subtle in size and almost always invisible in a
   * grid of plausible-looking rows. This says which people MOVED.
   */
  async variance(runId: string, thresholdPercent = 20) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId },
      include: { lines: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    const previousPeriod = new Date(Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth() - 1, 1));
    const previous = await this.prisma.payrollRun.findFirst({
      where: { period: previousPeriod, clinicId: run.clinicId, runType: run.runType },
      include: { lines: true },
    });

    const byStaff = new Map<string, VarianceLine>();
    for (const line of previous?.lines ?? []) {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      byStaff.set(line.staffId, {
        staffId: line.staffId,
        name: String(snap.name ?? ''),
        previousNetCents: toCents(line.netPay),
        currentNetCents: null,
      });
    }
    for (const line of run.lines) {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      const found = byStaff.get(line.staffId);
      if (found) found.currentNetCents = toCents(line.netPay);
      else
        byStaff.set(line.staffId, {
          staffId: line.staffId,
          name: String(snap.name ?? ''),
          previousNetCents: null,
          currentNetCents: toCents(line.netPay),
        });
    }

    const report = computeVariance(
      [...byStaff.values()],
      previous
        ? [
            { field: 'grossCents', previous: toCents(previous.grossTotal), current: toCents(run.grossTotal) },
            { field: 'netCents', previous: toCents(previous.netTotal), current: toCents(run.netTotal) },
            {
              field: 'employerCostCents',
              previous: toCents(previous.employerCostTotal),
              current: toCents(run.employerCostTotal),
            },
          ]
        : [],
      thresholdPercent,
    );

    return {
      hasPrevious: Boolean(previous),
      previousPeriod: previousPeriod.toISOString().slice(0, 10),
      ...report,
      note: previous
        ? report.material.length === 0
          ? 'Nobody moved by more than the threshold.'
          : `${report.material.length} employee(s) moved beyond ${thresholdPercent}%. A movement that size is more often a data error than a real change.`
        : 'There is no previous period to compare against, so nothing here is unusual by definition.',
    };
  }

  /** The exception centre for a run. */
  async exceptions(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payrollException.findMany({
      where: { payrollRunId: runId },
      orderBy: [{ severity: 'asc' }, { code: 'asc' }],
      include: {
        staff: { select: { fullName: true } },
        overriddenBy: { select: { fullName: true } },
      },
    });
    const gate = approvalGate(rows);
    return {
      exceptions: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        code: row.code,
        staffId: row.staffId,
        staffName: row.staff?.fullName ?? null,
        cause: row.cause,
        consequence: row.consequence,
        remediation: row.remediation,
        deepLink: row.deepLink,
        overridable: row.overridable,
        overriddenBy: row.overriddenBy?.fullName ?? null,
        overrideReason: row.overrideReason,
        overriddenAt: row.overriddenAt?.toISOString() ?? null,
      })),
      gate,
    };
  }

  /** Pass a warning deliberately, with a reason that stays on the record. */
  async overrideException(exceptionId: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const row = await tx.payrollException.findFirst({ where: { id: exceptionId } });
      if (!row) throw new NotFoundException('Exception not found');
      if (!row.overridable) {
        throw new BadRequestException(
          `"${row.code}" cannot be overridden. ${row.consequence} Resolve it rather than passing it.`,
        );
      }
      if (!reason || reason.trim().length < 5) {
        throw new BadRequestException('Say why this is being passed. It becomes part of the payroll record.');
      }
      const saved = await tx.payrollException.update({
        where: { id: exceptionId },
        data: { overriddenByStaffId: actor.id, overrideReason: reason, overriddenAt: new Date() },
      });
      await recordAudit(tx, actor, {
        action: 'payrollException.overridden',
        entityType: 'PayrollException',
        entityId: exceptionId,
        after: { code: row.code, severity: row.severity },
        reason,
        source: 'hr.payroll',
      });
      return saved;
    });
  }

}

function nullableCents(cents: number | null): number | null {
  return cents === null ? null : fromCents(cents);
}

function numberOrNull(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value);
}


