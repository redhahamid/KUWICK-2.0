import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActingStaff } from '../clinical/clinical-actor';
import { computeInputStamps, diffInputStamps, storedInputStamps } from './payroll-input-stamps';
import { byEmployeeName } from './employee-order';
import { DEFAULT_PAY_DATE, splitByPayDate } from './pay-dates';
import {
  PayrollApprovalMode as PayrollApprovalModeEnum,
  PayrollException,
  PayrollRunStatus,
  Prisma,
  PayrollRunType as PayrollRunTypeEnum,
  StatutoryStatus,
  StatutoryVerificationStatus,
  SystemRole,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { editionsFor } from '../statutory/editions';
import {
  Permission,
  can,
  isCustomRoleGrantable,
  isIndividuallyGrantable,
} from '../core/permissions';
import {
  AdminTx,
  actorCan,
  requirePermission,
  requireScope,
  withAdminTx,
  withScopedAdminTx,
} from '../finance/admin-actor';
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
  materialiseRecurringItems,
  materialiseUnpaidLeave,
  planMaterialisation,
} from './payroll-materialisation';
import { computeLeaveBalance, leaveDaysInYear, proRateEntitlement } from './leave-balance';
import { describeProration, partMonthPay, prorationFor, workingWeek } from './proration';
import { classifyDay, combinePricing, describePricedDay, priceOvertime } from './overtime-pricing';
import { clinicRatesOf, multipliersOf, pcbProjectionOf, resolvePayrollPolicy } from './payroll-policy-resolution';
import { workforceCategoryOf } from './workforce-category';
import { CatalogueRow, ResolvedComponent, catalogueFor, checkOrdinaryRateBase } from './component-liability';
import {
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  MAX_HOURS_PER_DAY,
  checkOrdinaryRatePolicy,
  completeMonthsWorkedInYear,
  overtimeScope,
  OvertimeScope,
  proRatedAnnualLeaveOnExit,
  untakenLeavePayoutCents,
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
import { approvalGate, BuiltException, buildException, ExceptionSeverity, exceptionTitle, isYearPolicy } from './payroll-exception';
import { resolveSalaryForPayroll, SalaryRow } from './salary-resolution';

/** How long one calculation may hold its transaction. See `calculate`. */
const CALCULATION_BUDGET_MS = 120_000;
import {
  CLASSIFICATION_FIELDS,
  ContributionBasisRow,
  StatutoryClassificationRow,
  resolveClassificationForPayroll,
  resolveContributionBasisForPayroll,
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
import { PayrollInputService } from './payroll-input.service';
import { monthBefore, monthLabel } from './payroll-register-columns';
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
 * THE SCHEDULES GOVERN EVERYTHING HERE. Malaysian EPF, SOCSO, EIS, LINDUNG,
 * PCB and the HRD levy resolve from `src/statutory/registry.ts` — dated,
 * content-hashed transcriptions of the authorities' own documents — by the
 * period's last day, never by today. (They came from a tenant-configured
 * `StatutoryRuleSet` once; that table survives read-only for history.) A run
 * over a period no schedule reaches is NOT_CONFIGURED, its statutory columns
 * stay NULL rather than zero, and the payslip says so — because a wrong EPF
 * figure that looks right is worse than none.
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
    private readonly inputs: PayrollInputService,
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
  async yearToDate(staffId: string, taxYear: number, throughMonth?: number) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    if (!Number.isInteger(taxYear) || (throughMonth !== undefined && !(Number.isInteger(throughMonth) && throughMonth >= 1 && throughMonth <= 12))) {
      throw new BadRequestException('year must be a whole year, and throughMonth a month from 1 to 12.');
    }
    // THROUGH A MONTH, when asked: the year to date of a March payslip is
    // January to March, whatever has been approved since.
    const months = await this.prisma.employeeYtd.findMany({
      where: { staffId, taxYear, ...(throughMonth !== undefined ? { month: { lte: throughMonth } } : {}) },
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
        select: { staffId: true, legalEmployerId: true, startDate: true, staff: { select: { fullName: true } } },
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

      /*
       * THIS EMPLOYER'S OWN MONTHS ONLY. A month before somebody's start date
       * cannot be this employer's payroll — it is previous-employer money,
       * and its place is a TP3 record. Letting it in here is how the same
       * ringgit reaches the accumulators twice: once as an "opening month"
       * and once on the TP3, halving the remaining year's tax.
       */
      for (const row of dto.months) {
        const profile = profileOf.get(row.staffId)!;
        if (!profile.startDate) continue;
        const startYear = profile.startDate.getUTCFullYear();
        const startMonth = profile.startDate.getUTCMonth() + 1;
        if (row.taxYear < startYear || (row.taxYear === startYear && row.month < startMonth)) {
          throw new BadRequestException(
            `${profile.staff.fullName} started on ${profile.startDate.toISOString().slice(0, 10)}, so ` +
              `${row.taxYear}-${String(row.month).padStart(2, '0')} cannot be this employer's payroll. Pay from a ` +
              'previous employer is declared on Form TP3, not imported as an opening balance.',
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
          lindungEmployeeCents: row.lindungEmployeeCents,
          deductionsCents: row.deductionsCents,
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
    return withScopedAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor, scope) => {
      // THE BRANCH IS AUTHORISED, NOT JUST NAMED. Payroll was the one admin
      // module that took `clinicId` straight off the request — the exact
      // failure `admin-actor.ts` documents Finance and Stock being cured of —
      // so an account scoped to one branch could open, calculate and drive
      // another branch's payroll. A run for EVERY branch is a tenant-wide
      // act and needs tenant-wide scope.
      if (dto.clinicId) {
        scope.require(dto.clinicId);
      } else if (!scope.everyBranch) {
        throw new ForbiddenException(
          'A payroll run across every branch needs tenant-wide access. Name your branch, or ask the account owner.',
        );
      }
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

      /*
       * THE ORDINARY-RATE DIVISORS, FROZEN FROM THE CLINIC'S OWN ANSWER.
       *
       * `orpOvertimeDays`, `orpUnpaidLeaveDays` and `orpHoursPerDay` have been
       * read on every run since Stage 1 and NOTHING EVER WROTE THEM, so every
       * run in the system used the schema defaults 26 / 31 / 7.5 while the rule
       * set's own `overtimeDays`, `unpaidLeaveDays` and `overtimeHoursPerDay`
       * sat beside them and were applied to nothing. The payroll report even
       * printed "Clinic policy, frozen on this run" over a number the clinic
       * had never been asked for.
       *
       * ONE RUN HAS ONE SET OF DIVISORS, which is a fact about the schema and
       * about the arithmetic: the ordinary rate is how this employer turns a
       * monthly salary into a day and an hour. So where the rule sets pricing
       * this run's people disagree, the run is REFUSED rather than quietly
       * given one of the answers — exactly as the employing company above is
       * refused rather than picked when the branch holds two of them.
       */
      const forDivisors = await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(dto.clinicId ? { staff: { clinicId: dto.clinicId } } : {}),
          ...(legalEmployerId ? { legalEmployerId } : {}),
        },
        select: {
          payrollPolicyId: true,
          legalEmployerId: true,
          staff: { select: { role: true, professionalType: true } },
        },
      });
      const policies = await tx.payrollPolicy.findMany();
      const divisorsByPolicy = new Map<string, { name: string; overtimeDays: number; hoursPerDay: number }>();
      for (const employee of forDivisors) {
        const { policy } = resolvePayrollPolicy(policies, {
          payrollPolicyId: employee.payrollPolicyId,
          legalEmployerId: employee.legalEmployerId,
          category: workforceCategoryOf(employee.staff),
        });
        if (!policy) continue;
        const row = policies.find((candidate) => candidate.id === policy.id);
        if (!row) continue;
        divisorsByPolicy.set(`${row.overtimeDays}/${Number(row.overtimeHoursPerDay)}`, {
          name: row.name,
          overtimeDays: row.overtimeDays,
          hoursPerDay: Number(row.overtimeHoursPerDay),
        });
      }
      if (divisorsByPolicy.size > 1) {
        const named = [...divisorsByPolicy.values()]
          .map((row) => `${row.name} (${row.overtimeDays} days / ${row.hoursPerDay} hours)`)
          .join(', ');
        throw new BadRequestException(
          'The rule sets covering this run disagree about how a monthly salary becomes a day and an hour: ' +
            `${named}. One run carries one ordinary rate, so overtime, rest days and public holidays would all be ` +
            'priced from a divisor half these employees never agreed to. Make them match in Payroll policies, or run ' +
            'these groups separately.',
        );
      }
      // Nobody on a rule set means nothing to freeze, and the schema defaults
      // stand — the same numbers as before, now because no clinic answer exists
      // rather than because none was ever asked for.
      const chosen = [...divisorsByPolicy.values()][0] ?? null;

      /*
       * THE MONTH STARTS WITH LAST MONTH'S HAND-KEYED AMOUNTS for the items the
       * clinic marked to carry — once, here, when the regular run is begun,
       * and never on a recalculation. In the same transaction, so a refused
       * run copies nothing. See `PayrollInputService.carryForward`.
       */
      const carried = runType === 'REGULAR' ? await this.inputs.carryForward(tx, actor, { period, clinicId: dto.clinicId ?? null }) : null;

      const run = await tx.payrollRun.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? null,
          legalEmployerId,
          period,
          runType,
          sequence,
          notes: dto.notes ?? null,
          createdByStaffId: actor.id,
          ...(chosen
            ? {
                orpOvertimeDays: chosen.overtimeDays,
                orpHoursPerDay: chosen.hoursPerDay,
              }
            : {}),
        },
      });
      return { ...run, carried };
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
    /*
     * A MONTH IS NOT A FIVE-SECOND TRANSACTION.
     *
     * Prisma's default budget is five seconds. Working out a three-person
     * branch on a cold API took 5,095 ms, the transaction expired under it,
     * and the screen said "Internal server error" — after which the draft
     * looked permanently dead, because every press of the button did the
     * same thing. On a hosted database in another region it would not have
     * needed a cold start. Two minutes is a budget nobody's clinic reaches;
     * five seconds was a budget a small one did.
     */
    return this.withCalculationBudget(() =>
      withAdminTx(
        this.rawPrisma,
        'hr.payroll.run',
        async (tx, actor) => {
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
      // The last day INSIDE the wage period. `periodEnd` above is exclusive —
      // the first day of the following month — which is the right shape for a
      // range query (`lt: periodEnd`) and the wrong one for resolving an
      // effective-dated rule: `scheduleFor(…, periodEnd)` matched a schedule
      // commencing on that exact day, so a September 2025 run acquired the
      // October Third Schedule instead of blocking, and a May 2026 run charged
      // LINDUNG a month before the scheme existed. Salary, classification,
      // the employer profile and the catalogue already resolve on this day;
      // the statutory schedules now do too.
      const statutoryResolutionDay = new Date(periodEnd.getTime() - 86_400_000);

      // Which schedules govern is decided by the PERIOD, never by today: a
      // September run re-calculated in December must not acquire December's
      // rates.
      // THE EDITIONS IN FORCE FOR THE PERIOD: the built-in tables, or a later
      // one the platform added as data for a date on or before the period's
      // last day. Resolved by the period, never by today, like the schedules.
      const editions = editionsFor(statutoryResolutionDay, await tx.statutoryTableVersion.findMany());
      const statutoryContext: StatutoryContext = { periodEnd: statutoryResolutionDay, editions };
      const statutoryStatus = statutoryStatusOf(statutoryResolutionDay) as StatutoryStatus;
      // The schemes a payslip depends on, named ONCE in `statutory.ts`. This
      // list was written out again here and had drifted: LINDUNG was missing,
      // so a run stamped its provenance without recording which LINDUNG
      // schedule it had applied.
      const statutoryStamp = stampFor(PAYSLIP_SCHEMES, statutoryResolutionDay, editions);

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

      // Every holiday in the month, and which of them the clinic marked
      // festive: a festive day is a public holiday the rule set may price
      // above an ordinary one, never below.
      const holidays = await tx.publicHoliday.findMany({
        where: { date: { gte: period, lt: periodEnd } },
        select: { date: true, kind: true },
      });
      const publicHolidayDates = new Set(holidays.map((row) => row.date.toISOString().slice(0, 10)));
      const festiveHolidayDates = new Set(holidays.filter((row) => row.kind === 'FESTIVE').map((row) => row.date.toISOString().slice(0, 10)));
      // LAST MONTH'S TOO, for overtime this run pays from last month: a day is
      // priced as the kind of day it was when it was worked.
      for (const row of await tx.publicHoliday.findMany({
        where: { date: { gte: monthBefore(period), lt: period } },
        select: { date: true, kind: true },
      })) {
        publicHolidayDates.add(row.date.toISOString().slice(0, 10));
        if (row.kind === 'FESTIVE') festiveHolidayDates.add(row.date.toISOString().slice(0, 10));
      }

      // The ordinary rate of pay, frozen onto the run. One divisor: unpaid
      // leave is priced on the month's actual days by s.18A, never on a
      // configured figure, so there is no second one to freeze.
      const orpConfig = {
        overtimeDaysPerMonth: Number(run.orpOvertimeDays),
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
        include: {
          staff: { select: { id: true, fullName: true, active: true, clinicId: true, role: true, professionalType: true } },
        },
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

      // An employee with NO home branch is in no branch's run at all — this
      // one or any other — and their absence was previously silent: the run
      // was simply one line short, and the register footed perfectly around
      // the person it was missing. Named on every branch-scoped run until
      // resolved. A tenant-wide run (no branch) pays them, so it raises
      // nothing.
      const branchless = run.clinicId
        ? await tx.employeeProfile.findMany({
            where: {
              engagement: 'EMPLOYEE',
              employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
              staff: { clinicId: null, active: true },
            },
            include: { staff: { select: { id: true, fullName: true } } },
            orderBy: { staffId: 'asc' },
          })
        : [];

      // EXCEPTIONS ARE BUILT, NOT PARSED.
      //
      // They used to be free text that a regex mapped back onto the catalogue
      // on the way to the database — so the severity, consequence and remedy of
      // every blocker depended on a sentence surviving unchanged. A blocker
      // that has to carry four facts (what the salary was, what it became, the
      // day it changed, which month) cannot survive that round trip.
      /**
       * `acknowledged`: a policy warning already acknowledged for the year, so
       * the row is written acknowledged — the same row, by the same person,
       * with the same reason, as on the day it was acknowledged.
       */
      const exceptions: (BuiltException & {
        name: string;
        acknowledged?: { byStaffId: string | null; reason: string; at: Date };
      })[] = [];
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

      // TP1 FOR THE MONTH, TP3 FOR THE YEAR. The MTD engine has carried the
      // LP slots since it was transcribed; these are the records that fill
      // THE EMPLOYER-SELECTED EPF BASIS, where one is recorded — a dated
      // preference resolved like the salary beside it. No row means the
      // statutory assessment governs alone, which is every employee until
      // somebody deliberately selects otherwise.
      const basisRows = await tx.employeeContributionBasis.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) }, scheme: 'EPF' },
        orderBy: { effectiveFrom: 'asc' },
        include: { createdBy: { select: { fullName: true } } },
      });
      // A DISCREPANCY ALREADY ACKNOWLEDGED FOR THIS YEAR, per selection: the
      // warning is raised once per policy decision, then rides as a one-line
      // note until the selection changes or the year turns.
      const acknowledgedBasis = new Map<string, { by: string; on: string; reason: string; byStaffId: string | null; at: Date }>();
      for (const ack of await tx.payrollWarningAcknowledgement.findMany({
        where: { tenantId: currentTenantId(), code: 'EPF_BASIS_DISCREPANCY', year: period.getUTCFullYear() },
        include: { acknowledgedBy: { select: { fullName: true } } },
      })) {
        acknowledgedBasis.set(ack.subjectId, {
          by: ack.acknowledgedBy?.fullName ?? 'somebody no longer on the staff list',
          on: ack.createdAt.toISOString().slice(0, 10),
          reason: ack.reason,
          byStaffId: ack.acknowledgedByStaffId,
          at: ack.updatedAt,
        });
      }
      const basisByStaff = new Map<string, ContributionBasisRow[]>();
      // WHO CHOSE IT, WHEN, AND WHY — carried beside the resolution because a
      // selection that departs from the assessment has to be attributable on
      // the run itself, not only in an audit table somebody has to go and
      // find. Frozen into the line and the snapshot further down.
      const basisProvenance = new Map<string, { reason: string | null; selectedBy: string | null }>();
      for (const row of basisRows) {
        const list = basisByStaff.get(row.staffId) ?? [];
        list.push({
          id: row.id,
          mode: row.mode,
          includedComponentCodes: row.includedComponentCodes,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        });
        basisByStaff.set(row.staffId, list);
        basisProvenance.set(row.id, {
          reason: row.reason,
          selectedBy: row.createdBy?.fullName ?? null,
        });
      }

      // them. Loaded once for the run, resolved per employee below.
      const tp1Entries = await tx.employeeTp1Entry.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) }, period },
      });
      const tp1ByStaff = new Map(tp1Entries.map((row) => [row.staffId, row]));
      const tp3Records = await tx.employeeTp3Record.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) }, taxYear: period.getUTCFullYear() },
      });
      const tp3ByStaff = new Map<string, typeof tp3Records>();
      for (const row of tp3Records) {
        const list = tp3ByStaff.get(row.staffId) ?? [];
        list.push(row);
        tp3ByStaff.set(row.staffId, list);
      }
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
      const employerRows = await tx.legalEmployer.findMany({
        select: { id: true, name: true, hrdLevyBase: true, zakatThroughPayroll: true },
      });
      const employerNames = new Map<string, string>(employerRows.map((row) => [row.id, row.name]));
      // Two settings the employing company answers (UAT, 10 October 2026).
      const employerSettings = new Map(employerRows.map((row) => [row.id, row]));

      const lastDayOfPeriod = new Date(periodEnd.getTime() - 86400000);

      // WHICH RULE SET PRICES EACH EMPLOYEE'S EXTRA HOURS (§6). Read once for
      // the run and resolved per employee below: assigned by hand, then the
      // rule set for their workforce category, then the default, then the Act.
      const payrollPolicies = await tx.payrollPolicy.findMany();

      /*
       * THE EMPLOYER'S OWN DATED STANDING — today that is the HRD Corp
       * registration class, resolved for the period exactly as an employee's
       * classification is. The levy engine has existed since Stage 3 and was
       * wired into nothing, so a registered employer's cost was short by 1% of
       * leviable wages every month — an omission indistinguishable on screen
       * from a clinic that simply is not registered.
       *
       * Resolved PER EMPLOYING COMPANY, not from the run's own scope alone. A
       * run created before runs carried a company (every legacy run) has
       * legalEmployerId null, and resolving from that null priced the levy as
       * "not recorded" on every line — silently, because the warning below was
       * suppressed by the same null. Each employee's levy follows the company
       * that employs THEM where the run names none, exactly as writeYearToDate
       * keys their months; a scoped run resolves its own company as before
       * (its guard already excludes anyone employed elsewhere).
       *
       * UNRECORDED is not NOT_REGISTERED. No profile on record leaves the levy
       * uncomputed (null, with the reason) and raises one WARNING per affected
       * company; a registration that CHANGED mid-period blocks like any other
       * mid-month statutory change, because either answer looks correct on the
       * total.
       */
      const employerIdsToResolve = new Set<string>();
      if (run.legalEmployerId) {
        employerIdsToResolve.add(run.legalEmployerId);
      } else {
        for (const employee of employees) {
          if (employee.staff.active && employee.legalEmployerId) {
            employerIdsToResolve.add(employee.legalEmployerId);
          }
        }
      }
      const employerProfileRows = employerIdsToResolve.size
        ? await tx.legalEmployerStatutoryProfile.findMany({
            where: { legalEmployerId: { in: [...employerIdsToResolve] } },
            orderBy: { effectiveFrom: 'asc' },
          })
        : [];
      const hrdRegistrationByEmployer = new Map<
        string,
        'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED' | null
      >();
      for (const employerId of employerIdsToResolve) {
        const outcome = resolveEmployerProfileForPayroll(
          employerProfileRows
            .filter((row) => row.legalEmployerId === employerId)
            .map((row) => ({
              id: row.id,
              effectiveFrom: row.effectiveFrom,
              effectiveTo: row.effectiveTo,
              hrdRegistration: row.hrdRegistration,
            })),
          period,
          lastDayOfPeriod,
        );
        hrdRegistrationByEmployer.set(employerId, outcome.kind === 'RESOLVED' ? outcome.row.hrdRegistration : null);
        const employerName = employerNames.get(employerId) ?? 'this employer';
        if (outcome.kind === 'NONE_ON_RECORD') {
          exceptions.push({
            ...buildException('HRD_REGISTRATION_UNRECORDED', null, { runId, employerName }),
            name: employerName,
          });
        }
        if (outcome.kind === 'CHANGED_MID_PERIOD') {
          exceptions.push({
            ...buildException('HRD_REGISTRATION_CHANGED_MID_PERIOD', null, {
              runId,
              employerName,
              changedOn: outcome.changedOn.toISOString().slice(0, 10),
            }),
            name: employerName,
          });
        }
      }
      const periodLabel = period.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      const previousPeriodLabel = monthLabel(monthBefore(period));
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

      /*
       * THE APPROVALS GO WITH THE FIGURES THEY APPROVED — on recalculation
       * exactly as on reopen. Under DUAL_APPROVAL a run holds its first
       * sign-off while it waits for the second, and it stays CALCULATED, so
       * it could be recalculated — inputs changed, exceptions overridden —
       * with approval #1 still attached to figures that no longer existed.
       * The second approver then locked a run half of whose review never
       * happened: the exact control the second pair of eyes exists to
       * provide, bypassed without passing through reopen(). The audit log
       * keeps who had approved; the run needs approving from the start.
       */
      const staleApprovals = await tx.payrollRunApproval.deleteMany({ where: { payrollRunId: runId } });
      if (staleApprovals.count > 0) {
        await recordAudit(tx, actor, {
          action: 'payroll.calculated',
          entityType: 'PayrollRun',
          entityId: runId,
          before: { approvalsHeld: staleApprovals.count },
          after: { approvalsHeld: 0 },
          reason: 'Recalculation replaced the figures, so the approvals recorded against the old figures were cleared.',
          source: 'hr.payroll',
        });
      }

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

        const [attendance, leave, incentives, inputs, claims, recurringItems] = await Promise.all([
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
          // RECURRING ITEMS in force on any day of the month — what the
          // employee's record says they get every month. Read here, carried
          // into the period as inputs below, so the grid's "other income" is
          // the record and not a figure somebody retyped.
          tx.employeeRecurringItem.findMany({
            where: {
              staffId: employee.staffId,
              effectiveFrom: { lte: lastDayOfPeriod },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: period } }],
            },
            include: { createdBy: { select: { fullName: true } } },
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
        // THE RULE SET (§6), resolved here because it also says how a part
        // month is paid. It prices overtime further down.
        const policyResolution = resolvePayrollPolicy(payrollPolicies, {
          payrollPolicyId: employee.payrollPolicyId,
          legalEmployerId: employee.legalEmployerId,
          category: workforceCategoryOf(employee.staff),
        });
        // A PART MONTH BY THE RULE SET'S BASIS (UAT, 10 October 2026): s.18A's
        // calendar days unless the clinic chose working days, counted from
        // this person's own working week. Held against the calendar figure
        // either way, so a month that pays less than the Act says so.
        const partMonth = partMonthPay({
          monthlyCents: fullMonthlyCents,
          proration,
          window: { periodStart: period, periodEnd, daysInPeriod: days, startDate: employee.startDate, endDate: employee.endDate },
          basis: policyResolution.policy?.partMonthBasis ?? 'CALENDAR_DAYS',
          week: workingWeek({
            workDaysPerWeek: employee.workDaysPerWeek === null ? null : Number(employee.workDaysPerWeek),
            restDayOfWeek: classification.restDayOfWeek,
            restDayVaries: classification.restDayVaries,
          }),
        });
        const basicCents = partMonth.basicCents;
        const prorationNote = describeProration(proration, days, partMonth.workingDays);
        if (prorationNote) {
          // INFO, not a blocker. A part-month is a normal event; what is not
          // acceptable is it happening invisibly.
          raise('PART_MONTH', employee, {
            note: partMonth.fallback ? `${prorationNote} ${partMonth.fallback}` : prorationNote,
            basis: partMonth.basis,
          });
        }
        if (partMonth.basicCents < partMonth.calendarCents) {
          raise('PART_MONTH_BELOW_STATUTORY', employee, {
            ruleSet: policyResolution.policy?.name ?? 'rule set',
            paid: formatCents(partMonth.basicCents),
            statutory: formatCents(partMonth.calendarCents),
            short: formatCents(partMonth.calendarCents - partMonth.basicCents),
          });
        }

        // The Ordinary Rate of Pay is built from the earnings that COUNT toward
        // it — basic and ORP-liable allowances — and never from overtime, or an
        // hour of overtime would raise the rate paid for the next one.
        // THE FULL monthly wage, never the prorated one — see the s.18A note.
        const orpBase = fullMonthlyCents;
        // s.18A governs the unpaid-leave divisor, so the month's own length
        // goes in rather than a configured 31.
        const rates = ordinaryRates(orpBase, orpConfig, days);


        /*
         * SOMEBODY LEFT, AND THEIR UNTAKEN LEAVE IS STILL OWED.
         *
         * The part-month above was never the gap: `prorationFor` has always cut
         * a leaver's last month to the days served. The gap was that nothing
         * SAID the annual leave they never took is a debt the clinic still
         * carries — the leaver stopped appearing, the month footed without
         * them, and the payout was remembered or it was not.
         *
         * Section 60E(3) is the provision, and it reaches further than it looks:
         * it owes the ordinary rate of pay for every untaken day where EITHER
         * PARTY ends the contract. A resignation is covered exactly as a
         * dismissal, which is the reading the account holder confirmed against
         * the Act's own text. A clinic whose staff all resign is not outside it.
         *
         * Raised only for somebody whose last day falls inside this period, so
         * it fires once per leaver and never on an ordinary month. The days come
         * from the same ledger the Leave screen shows, so the two cannot
         * disagree about what was taken.
         */
        if (proration.leftOn) {
          const year = period.getUTCFullYear();
          const [annualPolicy, storedBalance, yearRequests] = await Promise.all([
            tx.employeeProfile
              .findUnique({
                where: { staffId: employee.staffId },
                select: {
                  leavePolicy: {
                    select: {
                      name: true,
                      proRateOnJoin: true,
                      payUntakenLeaveOnExit: true,
                      entitlements: { where: { leaveType: 'ANNUAL' } },
                    },
                  },
                },
              })
              .then((row) => row?.leavePolicy ?? null),
            tx.leaveBalance.findFirst({ where: { staffId: employee.staffId, leaveType: 'ANNUAL', benefitYear: year } }),
            tx.leaveRequest.findMany({
              where: {
                staffId: employee.staffId,
                leaveType: 'ANNUAL',
                status: 'APPROVED',
                startDate: { lt: new Date(Date.UTC(year + 1, 0, 1)) },
                endDate: { gte: new Date(Date.UTC(year, 0, 1)) },
              },
              select: { startDate: true, endDate: true, status: true },
            }),
          ]);
          const fullYear = Number(annualPolicy?.entitlements[0]?.daysPerYear ?? 0);
          const recordedEntitlement =
            storedBalance !== null
              ? Number(storedBalance.entitledDays)
              : annualPolicy?.proRateOnJoin
                ? proRateEntitlement(fullYear, year, employee.startDate, employee.endDate)
                : fullYear;

          /*
           * THE ACT'S OWN FLOOR UNDER THE FINAL YEAR'S ENTITLEMENT.
           *
           * Section 60E(2A): an employee who has not completed twelve months of
           * continuous service in the year the contract ends is entitled to
           * annual leave in proportion to the COMPLETE MONTHS they worked, a
           * fraction under half a day disregarded and half a day or more
           * rounded up to a whole one.
           *
           * Kuwick's own pro-rating is by calendar days to the nearest half
           * day, which is what the Leave screen has always shown and is usually
           * the more generous of the two. Usually is not always — sixteen days
           * over five complete months is 6.5 by calendar days and 7 under the
           * Act — so the two are compared and the employee gets the better,
           * which is all the Act ever asks.
           */
          const statutoryEntitlement = proRatedAnnualLeaveOnExit(
            fullYear,
            completeMonthsWorkedInYear(year, employee.startDate, employee.endDate),
          );
          const entitledDays = Math.max(recordedEntitlement, statutoryEntitlement);

          const balance = computeLeaveBalance({
            entitledDays,
            // DAYS CARRIED IN ARE WORTH WHAT THIS YEAR'S DAYS ARE WORTH. The Act
            // says nothing about carry-forward at all — the cap and the lapsing
            // are clinic policy — but once a day is in the balance it is a day
            // of paid annual leave the employee is entitled to and has not
            // taken, which is the only test s.60E(3) applies.
            carriedInDays: Number(storedBalance?.carriedInDays ?? 0),
            adjustmentDays: Number(storedBalance?.adjustmentDays ?? 0),
            year,
            requests: yearRequests.map((row) => ({
              startDate: row.startDate,
              endDate: row.endDate,
              status: row.status as 'PENDING' | 'APPROVED' | 'REJECTED',
            })),
          });

          // Nothing left is nothing owed, and the arithmetic below would print
          // a row about RM0.00.
          if (balance.remaining > 0) {
            const lastDay = proration.leftOn.toISOString().slice(0, 10);
            const payoutCents = untakenLeavePayoutCents(balance.remaining, rates.overtimeDailyCents);
            const ledger = {
              name: employee.staff.fullName,
              lastDay,
              entitled: balance.entitled,
              carriedIn: balance.carriedIn,
              adjustment: balance.adjustment,
              taken: balance.taken,
              days: balance.remaining,
              amount: formatCents(payoutCents),
              dailyRate: formatCents(rates.overtimeDailyCents),
            };

            if (annualPolicy === null) {
              /*
               * NO POLICY, SO NEITHER HALF OF THE ANSWER IS KNOWN. The days here
               * came from a balance row somebody keyed by hand; what is missing
               * is not only the entitlement but the clinic's decision about
               * paying it out, which lives on the policy. Blocking, and
               * overridable, because the override is the record of what was
               * actually done about it.
               */
              raise('LEAVER_UNTAKEN_LEAVE', employee, { ...ledger, remaining: balance.remaining });
            } else if (annualPolicy.payUntakenLeaveOnExit) {
              raise('LEAVER_LEAVE_PAYOUT_DUE', employee, ledger);
            } else {
              raise('LEAVER_LEAVE_PAYOUT_WITHHELD', employee, { ...ledger, policy: annualPolicy.name });
            }
          }
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
          !classification.restDayVaries &&
          fullMonthlyCents <= FIRST_SCHEDULE_WAGE_CEILING_CENTS &&
          attendance.some((row) => (row.workedMinutes ?? 0) > 0)
        ) {
          raise('NO_REST_DAY', employee);
        }
        // A REST DAY THAT VARIES is an answer, not a gap — but it is an answer
        // the engine cannot price from: no weekday is the rest day, so a day
        // worked is priced as a normal day. Said once per person per month,
        // as information, so rest-day pay is keyed by hand where it arises.
        if (
          !isBonusRun &&
          classification.restDayOfWeek === null &&
          classification.restDayVaries &&
          attendance.some((row) => (row.workedMinutes ?? 0) > 0)
        ) {
          raise('REST_DAY_VARIES', employee, { restDayRule: classification.restDayFollowsRoster ? 'ROSTER' : 'VARIES' });
        }

        // LINDUNG 24 JAM raises nothing for a blank participation: PERKESO
        // enrols everybody unless they opt out through its own form, so the
        // engine treats blank as enrolled and deducts it (owner's decision,
        // 1 October 2026). Only a wage no band covers is still unknown, and
        // the fail-safe below names that.

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
        // THE RULE SET (§6). An explicit "not paid" on the employee's own
        // standing wins over a group rule set: the person's record is the more
        // specific answer, and a doctor contracted with no overtime is not
        // put on clinic rates by being a doctor.
        const clinicRates =
          classification.overtimeContractPolicy === 'NOT_PAID' ? null : clinicRatesOf(policyResolution.policy);
        // A clinic-rate rule set IS the employer's undertaking for somebody the
        // Act does not reach, so the question OVERTIME_ENTITLEMENT_UNRECORDED
        // asks is answered by the rule set. Worked out per month's wages, so
        // last month's overtime is judged on last month's.
        const scopeFor = (monthlyCents: number, resolutionDay: Date): OvertimeScope => {
          const actScope = overtimeScope(monthlyCents, resolutionDay, classification.overtimeContractPolicy);
          return clinicRates && !actScope.withinFirstSchedule && actScope.basis === 'NONE'
            ? {
                withinFirstSchedule: false,
                basis: 'CONTRACTUAL',
                reason:
                  'Wages exceed the First Schedule limit of RM4,000 a month, so the Act’s overtime provisions do not apply. ' +
                  `Extra hours are paid at the clinic’s own rates under the "${clinicRates.ruleSet}" rule set.`,
              }
            : actScope;
        };
        const scope = scopeFor(fullMonthlyCents, statutoryResolutionDay);
        const workedAnyDay = attendance.some((row) => (row.workedMinutes ?? 0) > 0);
        if (!isBonusRun && workedAnyDay && !scope.withinFirstSchedule && !classification.overtimeContractPolicy && !clinicRates) {
          raise('OVERTIME_ENTITLEMENT_UNRECORDED', employee, {
            wages: formatCents(fullMonthlyCents),
          });
        }

        /*
         * OVERTIME A MONTH IN ARREARS (UAT, 10 October 2026).
         *
         * With Overtime set "a month in arrears", this run pays last month's
         * overtime, rest-day and public-holiday pay — September's in the
         * October run — counted in this run's statutory figures and labelled
         * as September's, priced on the salary in force when it was worked;
         * this month's waits for the next run.
         *
         * NEVER TWICE, NEVER LOST. A day another month's run already carries
         * is left out, which is what makes switching arrears on safe. Without
         * arrears a run still picks up last month's days no run has paid —
         * hours approved after last month was approved, or the month arrears
         * was switched off — but only where last month was run here: a month
         * paid elsewhere is not reached into.
         */
        const overtimeInArrears = !isBonusRun && (catalogue.get('OVERTIME')?.paidInArrears ?? false);
        const lastMonth = monthBefore(period);
        const lastMonthDays = isBonusRun ? [] : await unpaidDaysOfLastMonth(tx, employee.staffId, period, overtimeInArrears);
        const lastMonthEnd = new Date(period.getTime() - 86_400_000);
        const lastMonthSalary = resolveSalaryForPayroll(salaryByStaff.get(employee.staffId) ?? [], lastMonth, lastMonthEnd);
        const lastMonthlyCents =
          lastMonthSalary.kind === 'RESOLVED' && lastMonthSalary.row.basis === 'MONTHLY' ? lastMonthSalary.row.amountCents : fullMonthlyCents;
        const priceDays = (rows: typeof attendance, monthRates: typeof rates, monthScope: OvertimeScope) =>
          priceOvertime(
            rows.map((row) => ({
              attendanceId: row.id,
              date: row.workDate,
              workedMinutes: row.workedMinutes ?? 0,
              overtimeMinutes: row.overtimeMinutes,
              overtimeApproved: row.overtimeApproved,
            })),
            (date) => classifyDay(date, { publicHolidayDates, festiveHolidayDates, restDayOfWeek: classification.restDayOfWeek }),
            {
              basis: 'MONTHLY',
              scope: monthScope,
              normalHoursPerDay: orpConfig.hoursPerDay,
              dailyOrpCents: monthRates.overtimeDailyCents,
              hourlyOrpCents: monthRates.overtimeHourlyCents,
              clinicRates,
              // The clinic's own multipliers where it set any, the Act's where it
              // did not. Never below the Act's — refused before it is stored.
              multipliers: multipliersOf(policyResolution.policy),
            },
          );
        const pricing = combinePricing(
          priceDays(lastMonthDays, ordinaryRates(lastMonthlyCents, orpConfig, daysInMonth(lastMonth)), scopeFor(lastMonthlyCents, lastMonthEnd)),
          priceDays(overtimeInArrears ? [] : attendance, rates, scope),
        );
        const overtimeHours = pricing.normalDayHours;

        /*
         * WHO IS BEING PAID BELOW THE ACT THIS MONTH, BY NAME.
         *
         * The clinic's figure is paid — it set the rate and acknowledged what
         * it was doing — so this does not block. It is the record: within the
         * First Schedule, this employee, these days, what they got and what
         * the Act sets. It fires for a clinic RM rate and for a multiplier the
         * clinic put under the Act alike, because to the person short of the
         * money the two are the same event.
         *
         * `statutory` reads the FLOOR, not the total. The total is what was
         * paid now that the Act's figure is no longer substituted for it.
         */
        if (pricing.belowStatutoryFloor.length > 0) {
          raise('CLINIC_RATE_BELOW_STATUTORY', employee, {
            ruleSet: clinicRates?.ruleSet ?? policyResolution.policy?.name ?? 'the rule set in force',
            days: pricing.belowStatutoryFloor.length,
            clinic: formatCents(pricing.belowStatutoryFloor.reduce((sum, day) => sum + (day.clinicRateCents ?? day.totalCents), 0)),
            statutory: formatCents(pricing.belowStatutoryFloor.reduce((sum, day) => sum + (day.statutoryFloorCents ?? day.totalCents), 0)),
            wages: formatCents(fullMonthlyCents),
          });
        }

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
              dayType: row.dayType,
              amountCents: row.totalCents,
              description: describePricedDay(row),
              approverName: overtimeApprover ? (approverNames.get(overtimeApprover) ?? null) : null,
              // Worked last month: paid here, labelled with the month it was earned.
              earnedPeriod: row.date < period ? lastMonth : null,
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
          ...materialiseRecurringItems(
            recurringItems.map((item) => ({
              staffId: employee.staffId,
              itemId: item.id,
              componentCode: item.componentCode,
              componentName: catalogue.get(item.componentCode)?.label ?? item.componentCode,
              label: item.label,
              amountCents: toCents(item.amount),
              effectiveFrom: item.effectiveFrom,
              effectiveTo: item.effectiveTo,
              recordedBy: item.createdBy?.fullName ?? null,
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
            label: row.label,
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
              kind: want.kind ?? 'ADDITIONAL',
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

        // LINES COPIED FROM LAST MONTH THAT NOBODY HAS TOUCHED are paid at
        // last month's amount: right when the figure repeats, wrong when it
        // does not, and the run cannot tell which. So it says so, per person,
        // as an INFO row the reviewer reads before approving. Editing or
        // clearing the line takes it off this list.
        const carriedRows = materialised.filter((row) => row.carriedFromId !== null);
        if (carriedRows.length > 0 && !isBonusRun) {
          raise('CARRIED_FORWARD_UNCHECKED', employee, {
            count: carriedRows.length,
            from: previousPeriodLabel,
            items: carriedRows
              .map((row) => `${catalogue.get(row.componentCode)?.label ?? row.label ?? row.componentCode} RM${formatCents(toCents(row.amount))}`)
              .join(', '),
          });
        }

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

        // ZAKAT GOES THROUGH PAYROLL ONLY WHERE THE EMPLOYER SAYS SO. A Zakat
        // item on somebody's record while the setting is off is not taken, and
        // the month stops until the clinic decides which of the two is right.
        const zakatEmployerId = run.legalEmployerId ?? employee.legalEmployerId;
        const zakatOn = zakatEmployerId ? (employerSettings.get(zakatEmployerId)?.zakatThroughPayroll ?? false) : false;
        let zakatHeldCents = 0;

        for (const input of materialised) {
          if (input.componentCode === 'PCB') continue;
          if (input.componentCode === 'ZAKAT' && !zakatOn) {
            zakatHeldCents += toCents(input.amount);
            continue;
          }
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
            label: earnedInLabel(input.label ?? component.label, input.earnedPeriod, period),
            // The catalogue decides whether this reduces the wages or is
            // withheld from them; a negative amount still forces a withholding.
            kind: amountCents < 0 ? 'DEDUCTION' : component.kind,
            amount: fromCents(Math.abs(amountCents)),
            liability: component.liability,
          });
        }

        if (zakatHeldCents !== 0) {
          raise('ZAKAT_THROUGH_PAYROLL_OFF', employee, {
            amount: formatCents(zakatHeldCents),
            employerName: zakatEmployerId ? (employerNames.get(zakatEmployerId) ?? 'their employer') : 'their employer',
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
        // THE YEAR SO FAR = this employer's recorded months (approved runs
        // and the opening import) PLUS a mid-year joiner's previous
        // employment, declared on Form TP3. The two are different tables so
        // the same ringgit cannot arrive twice — the write paths refuse the
        // overlap at capture.
        const tp3Rows = tp3ByStaff.get(employee.staffId) ?? [];
        const ytdTotal = priorMonths.reduce(
          (total, row) => ({
            accumulatedGrossCents: total.accumulatedGrossCents + row.grossCents,
            accumulatedEpfCents: total.accumulatedEpfCents + row.epfEmployeeCents,
            // CP38 is tax paid under a direction and counts toward X alongside
            // ordinary MTD; leaving it out would over-deduct for the rest of
            // the year.
            accumulatedMtdPaidCents: total.accumulatedMtdPaidCents + row.pcbCents + row.cp38Cents,
            accumulatedZakatCents: total.accumulatedZakatCents + row.zakatCents,
            accumulatedDeductionsCents: total.accumulatedDeductionsCents + row.deductionsCents,
          }),
          {
            accumulatedGrossCents: tp3Rows.reduce((sum, row) => sum + row.grossCents, 0),
            accumulatedEpfCents: tp3Rows.reduce((sum, row) => sum + row.epfCents, 0),
            accumulatedMtdPaidCents: tp3Rows.reduce((sum, row) => sum + row.mtdPaidCents, 0),
            accumulatedZakatCents: tp3Rows.reduce((sum, row) => sum + row.zakatCents, 0),
            accumulatedDeductionsCents: tp3Rows.reduce((sum, row) => sum + row.deductionsCents, 0),
          },
        );

        const tp1Entry = tp1ByStaff.get(employee.staffId) ?? null;
        const tp1Capture = tp1Entry
          ? { deductionsCents: tp1Entry.deductionsCents, zakatSelfPaidCents: tp1Entry.zakatSelfPaidCents }
          : null;

        // The levy follows the employing company: the run's where the run
        // names one, otherwise the company employing THIS employee — a legacy
        // run carries none, and its people are no less employed for it.
        const levyEmployerId = run.legalEmployerId ?? employee.legalEmployerId;
        const hrdRegistration = levyEmployerId ? (hrdRegistrationByEmployer.get(levyEmployerId) ?? null) : null;

        /*
         * THE EMPLOYER-SELECTED EPF BASIS, resolved for the period. A change
         * part-way through the month blocks like a mid-month salary change —
         * either figure would look right on the total — and the month then
         * computes on the assessment so its figures stay determinate while
         * the block stands. A resolved selection DRIVES the calculation: the
         * month shows exactly what the owner asked for, and if that leaves
         * assessed wages out, the discrepancy below is what stops approval —
         * the preference is preserved, not obeyed into an under-contribution.
         */
        const basisOutcome = resolveContributionBasisForPayroll(
          basisByStaff.get(employee.staffId) ?? [],
          period,
          lastDayOfPeriod,
        );
        if (basisOutcome.kind === 'CHANGED_MID_PERIOD') {
          raise('EPF_BASIS_CHANGED_MID_PERIOD', employee, {
            changedOn: basisOutcome.changedOn.toISOString().slice(0, 10),
          });
        }
        const epfBasisSelection =
          basisOutcome.kind === 'RESOLVED'
            ? {
                mode: basisOutcome.row.mode,
                includedComponentCodes: basisOutcome.row.includedComponentCodes,
              }
            : null;

        const payslip = computePayslip(
          componentLines,
          statutoryContext,
          {
            age,
            // EVERY CLASSIFICATION COMES FROM THE VERSION IN FORCE FOR THIS
            // PERIOD, never from the employee profile. The rate passes
            // through AS RECORDED: null means no election and the Schedule's
            // own Part rate applies; a recorded figure — 0% included — is a
            // real election, judged downstream against the Part's printed
            // rate (11/5.5/0/2), not against a hardcoded 11. The old `?? 11`
            // default would have refused every Part E and Part F employee
            // the moment the guard learned the real Part rates.
            epfMembership: classification.epfMembership,
            epfEmployeeRate: classification.epfEmployeeRate,
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
            // EMPLOYER-LEVEL CONTEXT FOR THE LEVY, resolved per employing
            // company above. Full-time per PSMB s.2: permanent and contract
            // staff qualify; part-timers, interns (apprentice contracts are
            // on the guideline's excluded list) and locums do not.
            hrdRegistration,
            hrdLevyBase: levyEmployerId ? employerSettings.get(levyEmployerId)?.hrdLevyBase : undefined,
            hrdFullTimeEmployment:
              employee.employmentType === 'PERMANENT' || employee.employmentType === 'CONTRACT',
          },
          ytdTotal,
          tp1Capture,
          epfBasisSelection,
          // How this clinic estimates the months after this one for monthly
          // tax. The rule set's answer, or the specification's own default.
          pcbProjectionOf(policyResolution.policy),
        );

        /*
         * THE STATUTORY DISCREPANCY, where the employer's selection sits below
         * Kuwick's assessment. ADVISORY: the owner is entitled to run on the
         * basis they explicitly recorded, so this states the difference in
         * full — gross, assessed, selected, the gap, the components, and who
         * chose it when and why — and lets the month proceed. It never says
         * the selection is compliant, and it rides into the snapshot so the
         * statement survives with the approved record.
         */
        if (payslip.epfBasis && payslip.epfBasis.excluded.length > 0) {
          const provenance =
            basisOutcome.kind === 'RESOLVED' ? basisProvenance.get(basisOutcome.row.id) : undefined;
          /*
           * ONCE ACKNOWLEDGED FOR THE YEAR, the same selection is the same
           * warning, ALREADY ACKNOWLEDGED — not a different note. It used to
           * come back as an INFO row of another code, so an acknowledgement
           * looked one way on the day and another after any recalculation
           * (UAT, 6 October 2026). EPF_BASIS_ACKNOWLEDGED stays in the
           * catalogue for rows written before.
           */
          const acknowledged = basisOutcome.kind === 'RESOLVED' ? acknowledgedBasis.get(basisOutcome.row.id) : undefined;
          raise('EPF_BASIS_DISCREPANCY', employee, {
            acknowledgedBy: acknowledged?.by ?? '',
            acknowledgedOn: acknowledged?.on ?? '',
            acknowledgementReason: acknowledged?.reason ?? '',
            components: payslip.epfBasis.excluded
              .map((row) => `${row.label} RM${fromCents(row.amountCents).toFixed(2)}`)
              .join(', '),
            gross: fromCents(payslip.grossCents).toFixed(2),
            assessedBasis: fromCents(payslip.epfBasis.assessedEpfCents).toFixed(2),
            selectedBasis: fromCents(payslip.epfBasis.appliedEpfCents).toFixed(2),
            difference: fromCents(
              payslip.epfBasis.assessedEpfCents - payslip.epfBasis.appliedEpfCents,
            ).toFixed(2),
            effectiveFrom:
              basisOutcome.kind === 'RESOLVED'
                ? basisOutcome.row.effectiveFrom.toISOString().slice(0, 10)
                : 'an unrecorded date',
            selectedBy: provenance?.selectedBy ?? 'somebody no longer on the staff list',
            selectionReason: provenance?.reason ?? 'no reason recorded',
          });
          if (acknowledged) {
            exceptions[exceptions.length - 1].acknowledged = { byStaffId: acknowledged.byStaffId, reason: acknowledged.reason, at: acknowledged.at };
          }
        }

        // PCB IS calculated by the MTD engine when the tax profile is on
        // record; a null here means it could not be — profile missing, or a
        // K1 the EPF question left unknowable — and that is a BLOCKING
        // exception rather than a quiet null on a payslip somebody might pay
        // against. A hand-entered figure below completes the slip instead.
        //
        // Which path produced the figure is recorded as DATA, not only in the
        // note's wording — a report that derives "entered by hand" by pattern-
        // matching prose breaks the day the prose is rephrased.
        let pcbEnteredByHand = false;
        if (payslip.statutory.pcbCents === null) {
          if (pcbOverrideCents === null) {
            raise('PCB_MISSING', employee);
          } else {
            // A supplied figure completes the payslip. It is withheld from the
            // employee and reduces net pay exactly as a computed one would.
            pcbEnteredByHand = true;
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
        /*
         * ADDITIONAL PCB EACH MONTH, recorded on the standing: a CP38 direction
         * from LHDN or the employee's own request. On top of the COMPUTED
         * figure only — a hand-entered PCB is the month's whole figure — and
         * carried in the PCB line itself, so the year-to-date the MTD method
         * reads next month counts it as tax already paid, which it is.
         */
        const additionalPcbCents = classification.additionalPcbCents ?? 0;
        // What the MTD method produced, before anything is added to it: its own
        // line in the working, beside the additional PCB (UAT, 5 October 2026).
        const computedMtdCents = pcbEnteredByHand ? null : payslip.statutory.pcbCents;
        if (additionalPcbCents > 0 && payslip.statutory.pcbCents !== null && !pcbEnteredByHand) {
          payslip.statutory.pcbCents += additionalPcbCents;
          payslip.employeeDeductionCents += additionalPcbCents;
          payslip.netCents -= additionalPcbCents;
          const why = classification.additionalPcbNote ? ` (${classification.additionalPcbNote})` : '';
          payslip.statutory.pcbNote = `${payslip.statutory.pcbNote ? `${payslip.statutory.pcbNote} ` : ''}Includes RM${formatCents(additionalPcbCents)} additional PCB each month, as recorded on the statutory standing${why}.`;
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
        // LINDUNG rides in the same fail-safe. A blank participation is
        // enrolled and computes, so the only null left is a wage no band
        // covers or a future regression, and that still blocks: before this,
        // a null LINDUNG raised nothing, and a run could be approved with the
        // withholding silently left out of net.
        for (const [scheme, contribution] of [
          ['EPF', payslip.statutory.epf],
          ['SOCSO', payslip.statutory.socso],
          ['EIS', payslip.statutory.eis],
          ['LINDUNG', payslip.statutory.lindung],
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

        /*
         * THE COLUMNS PARTITION GROSS. Every earning line lands in exactly one
         * of the five earning columns and every withholding line in the
         * deductions column, summed from the same component lines the payslip
         * itemises. These three stayed at their schema default of 0 — so a
         * bonus month's register showed a gross no column explained, a claim
         * paid with salary was in no column at all, a zakat month's take-home
         * was lower than the columns could account for, and the year-to-date's
         * additional-remuneration split (which falls back to this bonus
         * column) recorded a bonus month as ordinary pay. The synthetic-month
         * reconciliation is what caught it.
         */
        const columnCents = (kind: 'EARNING' | 'DEDUCTION', accepts: (code: string) => boolean) =>
          componentLines
            .filter((row) => row.kind === kind && accepts(row.code))
            .reduce((sum, row) => sum + toCents(row.amount), 0);
        const allowanceColumnCents = columnCents(
          'EARNING',
          (code) => !['BASIC', 'OVERTIME', 'INCENTIVE', 'BONUS'].includes(code),
        );
        const bonusColumnCents = columnCents('EARNING', (code) => code === 'BONUS');
        const otherDeductionColumnCents = columnCents('DEDUCTION', () => true);

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
                restDayVaries: classification.restDayVaries,
                restDayFollowsRoster: classification.restDayFollowsRoster,
                overtimeContractPolicy: classification.overtimeContractPolicy,
                additionalPcbCents: classification.additionalPcbCents,
                additionalPcbNote: classification.additionalPcbNote,
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
            allowances: fromCents(allowanceColumnCents),
            bonus: fromCents(bonusColumnCents),
            otherDeductions: fromCents(otherDeductionColumnCents),
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
              //
              // Written in CENTS under the keys the snapshot builder reads.
              // They were ringgit under `epf`/`socso`/`eis` while the builder
              // read `epfCents ?? 0` — so every approved snapshot froze the
              // wage bases as zero, and the statutory listings printed a
              // wages column of 0.00 beside real contributions. The ringgit
              // keys stay for anything already reading them.
              bases: {
                epf: fromCents(payslip.bases.epfCents),
                socso: fromCents(payslip.bases.socsoCents),
                eis: fromCents(payslip.bases.eisCents),
                epfCents: payslip.bases.epfCents,
                socsoCents: payslip.bases.socsoCents,
                eisCents: payslip.bases.eisCents,
                ordinaryRateBaseCents: payslip.bases.ordinaryRateBaseCents,
                /*
                 * THE TAX BASE IN ITS TWO HALVES, WRITTEN DOWN.
                 *
                 * LHDN taxes ADDITIONAL remuneration — a bonus, a once-yearly
                 * incentive, anything the clinic marks as such — by a different
                 * part of the MTD method from normal monthly pay, and the
                 * cumulative method needs the year's additional total kept
                 * apart from the year's normal total.
                 *
                 * The calculation has always split them correctly. It never
                 * wrote the split down, so approval had nothing to read and
                 * fell back to `bonus + incentives`: two hardcoded columns that
                 * ignore the clinic's own additionalRemuneration flag. A
                 * component marked additional was taxed right in its own month
                 * and then vanished from the year, and every later month
                 * computed on a year that was missing it.
                 */
                pcbNormalCents: payslip.bases.pcbNormalCents,
                pcbAdditionalCents: payslip.bases.pcbAdditionalCents,
              },
              /*
               * THE EMPLOYER'S SELECTED EPF BASIS AS APPLIED — mode, the
               * codes that governed, the assessed wages beside the applied
               * wages, and every component the selection left out or ticked
               * to no effect. Absent when no selection is recorded: the
               * assessment governed alone and there is no second story to
               * tell. `bases.epfCents` above is the APPLIED figure — the
               * wages the contribution actually sits on — and the assessed
               * figure lives here, so the two can be compared for as long
               * as the row exists.
               */
              ...(payslip.epfBasis
                ? {
                    epfBasis: {
                      mode: payslip.epfBasis.mode,
                      includedCodes: payslip.epfBasis.includedCodes,
                      assessedEpfCents: payslip.epfBasis.assessedEpfCents,
                      appliedEpfCents: payslip.epfBasis.appliedEpfCents,
                      excluded: payslip.epfBasis.excluded,
                      ineffective: payslip.epfBasis.ineffective,
                      basisRowId: basisOutcome.kind === 'RESOLVED' ? basisOutcome.row.id : null,
                      // Attribution, frozen with the figures it explains: a
                      // month approved on a selection lower than the
                      // assessment must still name who chose it, from when,
                      // and why — years later, from the record alone.
                      effectiveFrom:
                        basisOutcome.kind === 'RESOLVED'
                          ? basisOutcome.row.effectiveFrom.toISOString().slice(0, 10)
                          : null,
                      selectedBy:
                        (basisOutcome.kind === 'RESOLVED'
                          ? basisProvenance.get(basisOutcome.row.id)?.selectedBy
                          : null) ?? null,
                      selectionReason:
                        (basisOutcome.kind === 'RESOLVED'
                          ? basisProvenance.get(basisOutcome.row.id)?.reason
                          : null) ?? null,
                    },
                  }
                : {}),
              components: payslip.lines.map((line) => ({
                code: line.code, label: line.label, kind: line.kind,
                amount: line.amount, liability: line.liability,
              })),
              ordinaryRateOfPay: {
                overtimeDays: orpConfig.overtimeDaysPerMonth,
                hoursPerDay: orpConfig.hoursPerDay,
                unpaidLeaveDaily: fromCents(rates.unpaidLeaveDailyCents),
                overtimeHourly: fromCents(rates.overtimeHourlyCents),
              },
              // WHICH RULE SET PRICED THE EXTRA HOURS, and how it was chosen
              // (§6). A payslip that says "RM500" has to be able to say "per
              // public holiday shift, Doctors rule set" a year later.
              overtimePolicy: {
                ruleSet: policyResolution.policy?.name ?? null,
                how: policyResolution.how,
                mode: clinicRates ? 'CLINIC_RATE' : 'STATUTORY',
                clinicRates: clinicRates
                  ? {
                      overtimeHourly: clinicRates.overtimeHourlyCents === null ? null : fromCents(clinicRates.overtimeHourlyCents),
                      publicHolidayShift:
                        clinicRates.publicHolidayShiftCents === null ? null : fromCents(clinicRates.publicHolidayShiftCents),
                      festiveHolidayShift:
                        clinicRates.festiveHolidayShiftCents == null ? null : fromCents(clinicRates.festiveHolidayShiftCents),
                      restDayShift: clinicRates.restDayShiftCents === null ? null : fromCents(clinicRates.restDayShiftCents),
                      session: clinicRates.sessionCents === null ? null : fromCents(clinicRates.sessionCents),
                    }
                  : null,
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
                        : row.dayType === 'FESTIVE_HOLIDAY'
                          ? 'festive holiday'
                          : 'public holiday'
                  }`,
                  hours: Math.round(row.excessHours * 100) / 100,
                  ordinaryRateDays: row.ordinaryRateDays,
                  hourlyRate: fromCents(row.excessHourlyRateCents),
                  dayPay: fromCents(row.dayPayCents),
                  dayType: row.dayType,
                  pricedBy: row.pricedBy,
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
              // HOW EACH STATUTORY FIGURE WAS WORKED OUT — the wages it was
              // read against, the table row or the formula step, the edition
              // — frozen with the figure so the payslip can show it later.
              workings: {
                epf: payslip.statutory.epf.working ?? null,
                socso: payslip.statutory.socso.working ?? null,
                eis: payslip.statutory.eis.working ?? null,
                lindung: payslip.statutory.lindung.working ?? null,
                pcb: pcbWorkingRows(payslip.statutory.pcbWorking, payslip.statutory.pcbNote ?? null, editions.sources.PCB.document, {
                  computedMtdCents,
                  additionalPcbCents,
                  additionalPcbNote: classification.additionalPcbNote ?? null,
                  deductedCents: payslip.statutory.pcbCents,
                }),
              },
              // CALCULATED from the official specification, or ENTERED by a
              // person. Null when there is no figure at all.
              pcbSource:
                payslip.statutory.pcbCents === null ? null : pcbEnteredByHand ? 'ENTERED' : 'CALCULATED',
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

      for (const orphan of branchless) {
        exceptions.push({
          ...buildException('EMPLOYEE_IN_NO_BRANCH', orphan.staffId, {
            staffId: orphan.staffId,
            runId,
            name: orphan.staff.fullName,
          }),
          name: orphan.staff.fullName,
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
      /*
       * AN ACKNOWLEDGEMENT THAT STILL APPLIES IS KEPT (UAT, 6 October 2026:
       * "acknowledged items must look the same whether acknowledged before or
       * after a recalculation"). The rows are rewritten on every calculation;
       * a warning that comes back IDENTICAL — same code, same person, same
       * words — keeps who acknowledged it, why and when. One that changed
       * (more hours unapproved, a different figure) asks again.
       */
      const keyOf = (row: { code: string; staffId: string | null; cause: string }) => `${row.code}|${row.staffId ?? ''}|${row.cause}`;
      const stillAcknowledged = new Map(
        (await tx.payrollException.findMany({ where: { payrollRunId: runId, overriddenByStaffId: { not: null } } })).map((row) => [keyOf(row), row]),
      );
      await tx.payrollException.deleteMany({ where: { payrollRunId: runId } });
      for (const built of exceptions) {
        const before = built.overridable ? stillAcknowledged.get(keyOf(built)) : undefined;
        const ack =
          built.acknowledged ??
          (before ? { byStaffId: before.overriddenByStaffId, reason: before.overrideReason ?? '', at: before.overriddenAt ?? new Date() } : undefined);
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
            ...(ack && ack.byStaffId ? { overriddenByStaffId: ack.byStaffId, overrideReason: ack.reason, overriddenAt: ack.at } : {}),
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

      /*
       * WHAT THIS DRAFT WAS WORKED OUT FROM, fingerprinted LAST — after the
       * claims are linked and the derived items written above, so the
       * calculation's own writes are part of what it was worked out from and
       * do not read as a change the moment it finishes.
       */
      const inputStamps = await computeInputStamps(tx, { clinicId: run.clinicId, period });
      await tx.payrollRun.update({ where: { id: runId }, data: { inputStamps: inputStamps as never } });

      return updated;
        },
        { timeout: CALCULATION_BUDGET_MS, maxWait: 10_000 },
      ),
    );
  }

  /**
   * A calculation that ran out of its budget is reported as that, in words,
   * rather than as a 500 — the difference between "try again in a moment" and
   * "this month is broken", which is how the 500 read.
   */
  private async withCalculationBudget<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
        throw new ServiceUnavailableException(
          `Working this month out took longer than ${CALCULATION_BUDGET_MS / 1000} seconds and was stopped before anything was written. ` +
            'Nothing has changed. Try again; if it keeps happening, the database is slow to answer and that is the thing to look at.',
        );
      }
      throw error;
    }
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

    // The month's TP1 captures: the LP each payslip applied, and zakat the
    // employee paid outside payroll — both feed the NEXT month's accumulators.
    const tp1Rows = await tx.employeeTp1Entry.findMany({
      where: { staffId: { in: lines.map((line) => line.staffId) }, period },
    });
    const tp1ByStaff = new Map(tp1Rows.map((row) => [row.staffId, row]));

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

      const breakdown = (line.breakdown ?? {}) as {
        additionalRemunerationCents?: number;
        bases?: { pcbAdditionalCents?: number };
        components?: { code: string; kind: string; amount: unknown }[];
      };
      const cents = (value: unknown) => (value === null || value === undefined ? 0 : toCents(value as never));

      /*
       * ZAKAT CONTINUITY. Zakat deducted through payroll reduced THIS month's
       * MTD, and the following months' Z must carry it — the specification
       * accumulates zakat exactly as it accumulates tax paid. This wrote a
       * literal 0, so every month after a zakat month over-deducted tax by
       * the rebate the year had already earned. Self-paid zakat claimed on
       * the month's TP1 joins it, for the same reason.
       */
      const zakatViaPayrollCents = (breakdown.components ?? [])
        .filter((row) => row.code === 'ZAKAT' && row.kind === 'DEDUCTION')
        .reduce((sum, row) => sum + cents(row.amount), 0);
      const tp1 = tp1ByStaff.get(line.staffId);

      const data = {
        tenantId: currentTenantId(),
        legalEmployerId,
        staffId: line.staffId,
        taxYear,
        month,
        grossCents: cents(line.grossPay),
        /*
         * ADDITIONAL REMUNERATION, AS THE RUN ACTUALLY COMPUTED IT.
         *
         * Taxed by a different part of the MTD method from normal monthly pay,
         * so the year has to keep the two apart rather than carry one total.
         *
         * Read from the run's own tax base. It used to be `bonus + incentives`
         * — two hardcoded columns — so a clinic that marked anything ELSE as
         * additional remuneration had it taxed correctly in its own month and
         * then dropped from the year, and every month afterwards computed on a
         * year that was missing it. The flag was obeyed for one month and
         * forgotten for the other eleven.
         *
         * The fallbacks are for rows approved before the split was written
         * down, in the order they became available. Nothing recalculates a
         * settled month, so an old year keeps the figure it was filed on.
         */
        additionalRemunerationCents:
          breakdown.bases?.pcbAdditionalCents ??
          breakdown.additionalRemunerationCents ??
          cents(line.bonus) + cents(line.incentives),
        pcbCents: cents(line.pcb),
        zakatCents: zakatViaPayrollCents + (tp1?.zakatSelfPaidCents ?? 0),
        epfEmployeeCents: cents(line.epfEmployee),
        epfEmployerCents: cents(line.epfEmployer),
        socsoEmployeeCents: cents(line.socsoEmployee),
        socsoEmployerCents: cents(line.socsoEmployer),
        eisEmployeeCents: cents(line.eisEmployee),
        eisEmployerCents: cents(line.eisEmployer),
        // LINDUNG's column existed since the scheme landed and was never
        // written; the payslip's year-to-date block read a permanent zero.
        lindungEmployeeCents: cents(line.lindungEmployee),
        // The LP this month applied, so ∑LP is read from the approved record.
        deductionsCents: tp1?.deductionsCents ?? 0,
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
   * Refuses four things: a run nobody calculated, a run with unresolved
   * exceptions, self-approval by the person who created it, and a run whose
   * figures came from statutory tables that no longer govern its period.
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

      // THE TABLES MUST STILL BE THE ONES IN FORCE FOR THE PERIOD. The run
      // was stamped with the editions that priced it when it was calculated.
      // When the registry or the platform's editions have changed for this
      // period since — a built-in table corrected, a platform edition added
      // for a date the period covers — the figures on screen came from tables
      // that no longer govern the month, and approving would freeze them
      // under a snapshot nothing re-prices. Only recalculation re-stamps.
      await this.refuseStaleStatutoryStamp(tx, run);

      // THE RECORDS MUST STILL BE THE ONES IT WAS WORKED OUT FROM (UAT,
      // 6 October 2026: "block approval until the month is worked out
      // again"). A salary, standing, item or attendance changed since the
      // calculation means the figures on screen are not what the records now
      // say, and approving would freeze them. Refused before any approval
      // row is written, for the first and the second approver alike.
      await this.refuseChangedRecords(tx, run);

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

      /*
       * THE INCOMPLETE-LINE GATE, from the FIGURES rather than the exception
       * rows. `computePayslip` has promised since it was written that "the run
       * cannot be approved while any line is incomplete" — and nothing
       * enforced it: the only gate was the exception rows, so a null figure
       * whose case the exception taxonomy missed (LINDUNG was one) sailed
       * through, net was paid without the withholding, and the null was
       * laundered into a zero in the year-to-date. Under an acknowledged
       * statutory gap incomplete lines are the point — the clinic's
       * accountant computes what Kuwick could not, on the record — so the
       * hard refusal binds only where the schedules say everything WAS
       * computable.
       */
      if (run.statutoryStatus === StatutoryStatus.CONFIGURED) {
        const lines = await tx.payrollLine.findMany({
          where: { payrollRunId: runId },
          select: { breakdown: true, staff: { select: { fullName: true } } },
        });
        const incomplete = lines.filter(
          (line) => Boolean((line.breakdown as { incomplete?: boolean } | null)?.incomplete),
        );
        if (incomplete.length > 0) {
          const names = incomplete
            .slice(0, 3)
            .map((line) => line.staff.fullName)
            .join(', ');
          throw new BadRequestException(
            `${incomplete.length} payslip(s) have a statutory figure that could not be worked out ` +
              `(${names}${incomplete.length > 3 ? ', …' : ''}) even though the period's schedules are in force. ` +
              'Recalculate and resolve the exceptions; a figure that is unknown must not be approved as though it were zero.',
          );
        }
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
   * Refuse approval when the schedules stamped on the run at calculation are
   * no longer the ones in force for its period: a different edition, or the
   * same edition with different figures (the hash). A scheme the old stamp
   * never recorded is not judged — the list of stamped schemes has grown over
   * time — and a run that carries no stamp at all is left to the other gates.
   */
  /**
   * Refuse to approve a month whose records changed after it was worked out:
   * the same comparison the workspace's banner makes (payroll-input-stamps.ts),
   * made again here so a stale screen or a direct call cannot approve it. A
   * run worked out before fingerprints existed has nothing to compare with
   * and is not refused on this ground.
   */
  private async refuseChangedRecords(tx: AdminTx, run: { period: Date; clinicId: string | null; inputStamps: unknown }) {
    const saved = storedInputStamps(run.inputStamps);
    if (!saved) return;
    const changed = diffInputStamps(saved, await computeInputStamps(tx, { clinicId: run.clinicId, period: run.period }));
    if (changed.length === 0) return;
    const names = new Map(
      (await tx.staff.findMany({ where: { id: { in: changed.map((c) => c.staffId) } }, select: { id: true, fullName: true } })).map(
        (row) => [row.id, row.fullName] as [string, string],
      ),
    );
    const list = changed
      .slice(0, 5)
      .map((c) => `${names.get(c.staffId) ?? 'an employee no longer on record'}: ${c.what.join(', ')}`)
      .join('; ');
    throw new ConflictException(
      `Records changed since this month was worked out (${list}${changed.length > 5 ? `; and ${changed.length - 5} more` : ''}). ` +
        'Work it out again, then approve.',
    );
  }

  private async refuseStaleStatutoryStamp(tx: AdminTx, run: { period: Date; statutorySnapshot: unknown }) {
    const stamped = (run.statutorySnapshot ?? null) as unknown as StatutoryStamp | null;
    if (!stamped || !Array.isArray(stamped.schedules)) return;
    // The same day the calculation resolves on: the last day inside the period.
    const resolutionDay = new Date(monthEnd(run.period).getTime() - 86_400_000);
    const editions = editionsFor(resolutionDay, await tx.statutoryTableVersion.findMany());
    const current = stampFor(PAYSLIP_SCHEMES, resolutionDay, editions);
    const changed = current.schedules.flatMap((now) => {
      const was = stamped.schedules.find((entry) => entry.scheme === now.scheme);
      if (!was || (was.scheduleId === now.scheduleId && was.contentHash === now.contentHash)) return [];
      return [`${now.scheme}: ${was.scheduleId ?? 'none'} is now ${now.scheduleId ?? 'none'}`];
    });
    if (changed.length === 0) return;
    throw new BadRequestException(
      `The statutory tables for ${run.period.toISOString().slice(0, 7)} have changed since this run was calculated ` +
        `(${changed.join('; ')}). Recalculate so the month is priced on the tables in force, then approve.`,
    );
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
      return {
        mode: existing.mode,
        allowOwnerSelfApproval: existing.allowOwnerSelfApproval,
        /** Settings says "Changed 14 Aug" on the card; this is where that comes from. */
        updatedAt: existing.updatedAt.toISOString(),
      };
    }
    const created = await tx.payrollApprovalPolicy.create({ data: { tenantId } });
    return { mode: created.mode, allowOwnerSelfApproval: created.allowOwnerSelfApproval, updatedAt: created.updatedAt.toISOString() };
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

  // `markPaid` is gone. It reached PAID with no batch, no payment date, no
  // reference and no reconciliation — everything `recordPaid` on the payment
  // service exists to demand — and a run marked paid that way could never be
  // reopened or explained. The word "paid" has exactly one path now.

  async list(params: { clinicId?: string; year?: number } = {}) {
    const { scope } = await requireScope(this.rawPrisma, 'hr.payroll.view');
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        // A requested branch is validated against the actor's scope; nothing
        // requested means "the branches this account manages", not "all".
        // Tenant-wide (clinicId null) runs stay visible only to tenant-wide
        // accounts, which is what the empty fragment resolves to for them.
        ...scope.where(params.clinicId),
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
    // The TP1 each payslip applied, frozen with it: the LP is inside the PCB
    // figure, and a record that cannot say so cannot defend the tax.
    const snapshotTp1Rows = await tx.employeeTp1Entry.findMany({
      where: { period: run.period, staffId: { in: paidStaffIds } },
    });
    const snapshotTp1ByStaff = new Map(snapshotTp1Rows.map((row) => [row.staffId, row]));

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
          payDate: resolved.payDate,
          paidInArrears: resolved.paidInArrears,
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
      // WHEN EACH LINE IS PAID, and what each date pays this person — by the
      // item's own pay date, with the month's deductions taken from the salary
      // payment first. Frozen here, so the listings and the payslip read the
      // dates the month was approved with whatever Settings says later.
      const split = splitByPayDate({
        period: run.period,
        lines: componentRows.map((row) => ({ code: row.code, kind: row.kind, amountCents: toCents(row.amount as never) })),
        netCents,
        ruleOf: (code) => resolvedCatalogue.get(code)?.payDate ?? DEFAULT_PAY_DATE,
      });
      const statutoryNoteRows = (breakdown.statutoryNotes ?? {}) as Record<string, string | null>;
      const overtimeRows = (breakdown.overtimeTiers ?? []) as {
        label: string;
        hours: number;
        hourlyRate: number;
        total: number;
        ordinaryRateDays?: number;
        provision?: string;
      }[];
      // The employer-selected EPF basis as the calculation applied it. Frozen
      // verbatim: an approved month must still say, years later, which wages
      // the employer chose to contribute on and what the assessment said.
      const epfBasisRow = breakdown.epfBasis as SnapshotPayslipDetail['epfBasis'] | undefined;
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
        componentLines: componentRows.map((row, index) => ({
          code: row.code,
          label: row.label,
          kind: row.kind,
          amountCents: toCents(row.amount as never),
          payDate: split.lineDates[index],
        })),
        statutoryNotes: {
          epf: statutoryNoteRows.epf ?? null,
          socso: statutoryNoteRows.socso ?? null,
          eis: statutoryNoteRows.eis ?? null,
          lindung: statutoryNoteRows.lindung ?? null,
          pcb: statutoryNoteRows.pcb ?? null,
        },
        // Day-priced rows (s.60(3), s.60D) carry their days: a frozen row of
        // "0 h @ RM33.00 … 200.00" was unexplainable to the person holding
        // the payslip it printed on.
        overtime: overtimeRows.map((row) => ({
          label: row.label,
          hours: row.hours,
          hourlyRate: row.hourlyRate,
          total: row.total,
          ...(row.ordinaryRateDays !== undefined ? { ordinaryRateDays: row.ordinaryRateDays } : {}),
          ...(row.provision !== undefined ? { provision: row.provision } : {}),
        })),
        ...(epfBasisRow ? { epfBasis: epfBasisRow } : {}),
      };

      return {
        staffId: line.staffId,
        name: String(snap.name ?? ''),
        salaryRowId: (snap.salaryRowId as string | undefined) ?? null,
        salaryBasis: (snap.salaryBasis as string | undefined) ?? null,
        salaryAmountCents: toCents(line.basicSalary),
        payslip: payslipDetail,
        tp1: (() => {
          const row = snapshotTp1ByStaff.get(line.staffId);
          return row ? { deductionsCents: row.deductionsCents, zakatSelfPaidCents: row.zakatSelfPaidCents } : null;
        })(),
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
        // The wage bases the schemes were computed on. The breakdown writes
        // them in cents; lines calculated before that change carried only the
        // ringgit keys, so those are the fallback — never a silent zero. A
        // zero here printed a wages column of 0.00 on every statutory listing
        // while the contributions beside it were real.
        bases: {
          grossCents,
          epfCents: bases.epfCents ?? (bases.epf !== undefined ? toCents(bases.epf) : 0),
          socsoCents: bases.socsoCents ?? (bases.socso !== undefined ? toCents(bases.socso) : 0),
          eisCents: bases.eisCents ?? (bases.eis !== undefined ? toCents(bases.eis) : 0),
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
        payments: split.payments,
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
      orp: { overtimeDays: Number(run.orpOvertimeDays), hoursPerDay: Number(run.orpHoursPerDay) },
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
    // The payload is every employee's frozen figures at once — audited, as
    // the payslip PDF and the listings are, because it is the largest single
    // pay disclosure the API serves.
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      const row = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId, version },
        include: { createdBy: { select: { fullName: true } } },
      });
      if (!row) throw new NotFoundException(`No snapshot version ${version} for this payroll run.`);

      const payload = row.payload as unknown as SnapshotPayload;
      await recordAudit(tx, actor, {
        action: 'payrollSnapshot.read',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { version, employees: payload.employees.length },
        source: 'hr.payroll',
      });
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
    });
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
      // A MONTH PAID IN PARTS IS PAID once any part has gone. The run still
      // reads APPROVED until its last transfer is recorded, so the status
      // check above lets it through; the money that left does not.
      const transferred = await tx.payrollPaymentBatch.findFirst({
        where: { payrollRunId: runId, status: 'RECORDED_PAID' },
        orderBy: { paymentDate: 'asc' },
      });
      if (transferred) {
        throw new ConflictException(
          `A transfer for this month was recorded on ${transferred.paymentDate?.toISOString().slice(0, 10) ?? 'an earlier date'}. ` +
            'Money has left the clinic; correct it with an adjustment rather than reopening it.',
        );
      }
      // The listings go with the figures they were composed from: none was
      // paid (above), and one left standing would pay last approval's amounts,
      // or a date the corrected month no longer pays on. Kept, superseded.
      const withdrawn = await tx.payrollPaymentBatch.updateMany({
        where: { payrollRunId: runId, status: { not: 'SUPERSEDED' } },
        data: { status: 'SUPERSEDED' },
      });

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
          paymentListingsWithdrawn: withdrawn.count,
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
   * THROW AN UNAPPROVED RUN AWAY.
   *
   * A month started too early — before the salaries, the standing or the
   * rest days were in — was a draft nobody could get rid of and nobody could
   * make live, so a clinic that pressed Start a week early was stuck with a
   * dead January for good. Reported from UAT as exactly that.
   *
   * DRAFT and CALCULATED are working documents: nothing has been paid or
   * filed from them, so the row goes, with its lines and exceptions, and the
   * audit entry is what remains of it. APPROVED and PAID are refused here
   * the way they are refused everywhere — money moved or a return was filed,
   * and the path for that is reopen or an adjustment, both of which leave the
   * figures. The month can then be started again: `create` already ignores
   * nothing but a live regular run, and the sequence moves on.
   */
  async discard(runId: string, reason?: string) {
    return withScopedAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor, scope) => {
      const run = await tx.payrollRun.findUnique({
        where: { id: runId },
        include: { clinic: { select: { name: true } }, _count: { select: { lines: true } } },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      // The branch the run is for has to be one this account manages — the
      // same rule that governs starting one.
      if (run.clinicId) {
        scope.require(run.clinicId);
      } else if (!scope.everyBranch) {
        throw new ForbiddenException('This run covers every branch, and discarding it needs tenant-wide access.');
      }
      if (run.status === PayrollRunStatus.APPROVED || run.status === PayrollRunStatus.PAID) {
        throw new ConflictException(
          run.status === PayrollRunStatus.PAID
            ? 'This run is marked paid. Money has left the clinic; it cannot be discarded, only corrected with an adjustment.'
            : 'This run is approved and locked. Reopen it to change it; an approved month is never discarded.',
        );
      }

      await tx.payrollRun.delete({ where: { id: runId } });

      const periodLabel = run.period.toISOString().slice(0, 7);
      await recordAudit(tx, actor, {
        action: 'payroll.discarded',
        entityType: 'PayrollRun',
        entityId: runId,
        before: {
          period: periodLabel,
          clinicId: run.clinicId,
          clinicName: run.clinic?.name ?? null,
          status: run.status,
          runType: run.runType,
          sequence: run.sequence,
          employeeCount: run.employeeCount,
          lines: run._count.lines,
          netTotal: String(run.netTotal),
          createdAt: run.createdAt.toISOString(),
          calculatedAt: run.calculatedAt?.toISOString() ?? null,
        },
        after: null,
        reason: reason?.trim() || `Discarded the ${run.status.toLowerCase()} ${periodLabel} run`,
        source: 'hr.payroll',
      });

      return { discarded: true, period: periodLabel, clinicId: run.clinicId };
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
    // Calculated figures or better, the same rule the variance REPORT uses.
    // Without the status filter this compared against a DRAFT — a run whose
    // lines may be empty or half-keyed — so the two variance surfaces could
    // answer "who moved" differently from the same data.
    const previous = await this.prisma.payrollRun.findFirst({
      where: {
        period: previousPeriod,
        clinicId: run.clinicId,
        runType: run.runType,
        status: { in: [PayrollRunStatus.CALCULATED, PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
      },
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
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { period: true } });
    const rows = await this.prisma.payrollException.findMany({
      where: { payrollRunId: runId },
      orderBy: [{ severity: 'asc' }, { code: 'asc' }],
      include: {
        staff: { select: { fullName: true } },
        overriddenBy: { select: { fullName: true } },
      },
    });
    /*
     * Within a kind, the people in the one employee order (employee-order.ts):
     * the database returned ties as it pleased, so a card's "3 staff: A, B, C"
     * read B, A, C after a recalculation (UAT, 6 October 2026).
     */
    const rank: Record<ExceptionSeverity, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 };
    const byName = byEmployeeName((row: (typeof rows)[number]) => ({ name: row.staff?.fullName ?? '', staffId: row.staffId ?? '' }));
    rows.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || byName(a, b));
    const gate = approvalGate(rows);
    return {
      /** The run's month, "YYYY-MM": the year a policy acknowledgement covers. */
      period: run ? run.period.toISOString().slice(0, 7) : null,
      exceptions: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        code: row.code,
        /** A few words for the card; cause, consequence and remedy sit behind Details. */
        title: exceptionTitle(row.code),
        /** Acknowledged once for the year, for everybody it applies to. */
        policy: isYearPolicy(row.code),
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

  /**
   * ACKNOWLEDGE EVERY OPEN WARNING OF ONE CODE IN A RUN, with one reason
   * (UAT, 6 October 2026: "group identical policy warnings into ONE card with
   * a single Acknowledge for 2026 button"). Each row is acknowledged exactly
   * as one at a time would be — the same audit row, the same year record for
   * a policy warning — inside one transaction, so it is all or none.
   */
  async acknowledgeExceptions(runId: string, code: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const rows = await tx.payrollException.findMany({
        where: { payrollRunId: runId, code, overridable: true, overriddenByStaffId: null },
      });
      if (rows.length === 0) throw new NotFoundException('Nothing of that kind is waiting to be acknowledged on this run.');
      for (const row of rows) await this.acknowledgeRow(tx, actor, row, reason);
      return { acknowledged: rows.length };
    });
  }

  /** Pass a warning deliberately, with a reason that stays on the record. */
  async overrideException(exceptionId: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const row = await tx.payrollException.findFirst({ where: { id: exceptionId } });
      if (!row) throw new NotFoundException('Exception not found');
      return this.acknowledgeRow(tx, actor, row, reason);
    });
  }

  /**
   * ONE ROW ACKNOWLEDGED, the same whether it is passed on its own or with
   * every other open row of its kind: the override on the row, the year
   * record for a policy warning, and the audit.
   */
  private async acknowledgeRow(tx: AdminTx, actor: ActingStaff, row: PayrollException, reason: string) {
    if (!row.overridable) {
      throw new BadRequestException(
        `"${row.code}" cannot be overridden. ${row.consequence} Resolve it rather than passing it.`,
      );
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Say why this is being passed. It becomes part of the payroll record.');
    }
    const saved = await tx.payrollException.update({
      where: { id: row.id },
      data: { overriddenByStaffId: actor.id, overrideReason: reason, overriddenAt: new Date() },
    });
    /*
     * AN EPF BASIS DISCREPANCY IS A POLICY DECISION, not a monthly accident:
     * acknowledging it once covers that selection for the year, and every
     * calculation after this one writes the warning already acknowledged, by
     * the same person with the same reason. Keyed by the dated basis row, so
     * a changed selection asks again.
     */
    if (row.code === 'EPF_BASIS_DISCREPANCY' && row.staffId) {
      const run = await tx.payrollRun.findUnique({ where: { id: row.payrollRunId }, select: { period: true } });
      if (run) {
        const periodEnd = new Date(Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth() + 1, 0));
        const rows = await tx.employeeContributionBasis.findMany({
          where: { staffId: row.staffId, scheme: 'EPF' },
          orderBy: { effectiveFrom: 'asc' },
        });
        const outcome = resolveContributionBasisForPayroll(
          rows.map((r) => ({ id: r.id, mode: r.mode, includedComponentCodes: r.includedComponentCodes, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo })),
          run.period,
          periodEnd,
        );
        if (outcome.kind === 'RESOLVED') {
          const year = run.period.getUTCFullYear();
          await tx.payrollWarningAcknowledgement.upsert({
            where: { tenantId_code_subjectId_year: { tenantId: currentTenantId(), code: row.code, subjectId: outcome.row.id, year } },
            create: { tenantId: currentTenantId(), code: row.code, subjectId: outcome.row.id, year, acknowledgedByStaffId: actor.id, reason },
            update: { acknowledgedByStaffId: actor.id, reason },
          });
          await recordAudit(tx, actor, {
            action: 'payrollWarning.acknowledged',
            entityType: 'EmployeeContributionBasis',
            entityId: outcome.row.id,
            after: { code: row.code, year, staffId: row.staffId },
            reason,
            source: 'hr.payroll',
          });
        }
      }
    }
    await recordAudit(tx, actor, {
      action: 'payrollException.overridden',
      entityType: 'PayrollException',
      entityId: row.id,
      after: { code: row.code, severity: row.severity },
      reason,
      source: 'hr.payroll',
    });
    return saved;
  }

}

/**
 * A LINE EARNED IN ANOTHER MONTH SAYS SO ON THE PAYSLIP: "Director's fee
 * (January 2026)" paid in March is arrears, and the label is where the
 * employee reads that. Same month, same label as before.
 */
/**
 * LAST MONTH'S ATTENDANCE NO RUN HAS PAID YET, for a run that pays overtime a
 * month in arrears or picks up what last month's run left. A day already
 * carried by another month's run is never paid again. Without arrears, only a
 * month this person was run for here is reached into.
 */
async function unpaidDaysOfLastMonth(tx: AdminTx, staffId: string, period: Date, inArrears: boolean) {
  const lastMonth = monthBefore(period);
  if (!inArrears) {
    const ranLastMonth = await tx.payrollLine.count({ where: { staffId, payrollRun: { period: lastMonth, runType: 'REGULAR' } } });
    if (ranLastMonth === 0) return [];
  }
  const earlier = await tx.attendanceRecord.findMany({
    where: { staffId, workDate: { gte: lastMonth, lt: period } },
    orderBy: { workDate: 'asc' },
  });
  if (earlier.length === 0) return [];
  const carried = await tx.payrollInputEntry.findMany({
    where: { componentCode: 'OVERTIME', sourceRecordId: { in: earlier.map((row) => row.id) }, NOT: { period } },
    select: { sourceRecordId: true },
  });
  const paid = new Set(carried.map((row) => row.sourceRecordId));
  return earlier.filter((row) => !paid.has(row.id));
}

function earnedInLabel(label: string, earnedPeriod: Date | null | undefined, period: Date): string {
  if (!earnedPeriod || earnedPeriod.getTime() === period.getTime()) return label;
  return `${label} (${earnedPeriod.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })})`;
}

/**
 * THE MTD WORKING AS ROWS: the specification's own letters, with the figure
 * each one took this month, so a payslip's PCB line can be followed back to
 * [(P − M) R + B] rather than taken on trust.
 */
function pcbWorkingRows(
  working: { pCents: number; mCents: number; ratePercent: number; bCents: number; n: number; k2Cents: number; totalReliefCents: number; pWithAdditionalCents?: number; yearTaxCents?: number; yearMtdCents?: number } | null | undefined,
  note: string | null,
  edition: string,
  /**
   * THE MONTH'S FIGURE, SPLIT. The MTD the method produced and the additional
   * PCB recorded on the standing are two lines here, not only a sentence in
   * the note, so the PCB on the payslip reads as their sum.
   */
  month: { computedMtdCents: number | null; additionalPcbCents: number; additionalPcbNote: string | null; deductedCents: number | null } = {
    computedMtdCents: null,
    additionalPcbCents: 0,
    additionalPcbNote: null,
    deductedCents: null,
  },
): Record<string, string | number | null> | null {
  if (!working) return null;
  const rm = (cents: number | undefined) => (cents === undefined ? null : `RM${formatCents(cents)}`);
  const added = month.computedMtdCents !== null && month.additionalPcbCents > 0;
  return {
    'P — chargeable income for the year': rm(working.pCents),
    'M — band floor': rm(working.mCents),
    'R — rate': `${working.ratePercent}%`,
    'B — band adjustment': rm(working.bCents),
    'n — months left after this one': working.n,
    'K2 — EPF relief spread over the months left': rm(working.k2Cents),
    'Reliefs (individual, spouse, children, disability)': rm(working.totalReliefCents),
    ...(working.yearTaxCents !== undefined ? { 'Year tax with additional remuneration, [(P − M) R + B]': rm(working.yearTaxCents) } : {}),
    ...(working.yearMtdCents !== undefined ? { 'MTD for the year so far plus this month': rm(working.yearMtdCents) } : {}),
    ...(working.pWithAdditionalCents !== undefined ? { 'P with additional remuneration': rm(working.pWithAdditionalCents) } : {}),
    ...(month.computedMtdCents !== null ? { 'MTD worked out for this month': rm(month.computedMtdCents) } : {}),
    ...(added
      ? {
          'Additional PCB each month (statutory standing)': `RM${formatCents(month.additionalPcbCents)}${month.additionalPcbNote ? ` · ${month.additionalPcbNote}` : ''}`,
          'PCB deducted this month': month.deductedCents === null ? null : rm(month.deductedCents),
        }
      : {}),
    Edition: edition,
    ...(note ? { Note: note } : {}),
  };
}

function nullableCents(cents: number | null): number | null {
  return cents === null ? null : fromCents(cents);
}

function numberOrNull(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value);
}


