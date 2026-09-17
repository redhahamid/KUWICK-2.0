import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, requireScope, withAdminTx } from '../finance/admin-actor';
import { diffOf, recordAudit } from '../finance/admin-audit';
import { UpsertEmployeeDto } from './dto/upsert-employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import * as bcrypt from 'bcryptjs';
import { formatCents, fromCents, toCents } from '../finance/money';
import { resolveSalaryForPayroll } from './salary-resolution';
import { resolveClassificationForPayroll } from './statutory-classification';
import { toClassificationRow } from './statutory-classification.service';
import { buildPayrollReadiness } from './payroll-readiness';
import { LINDUNG_EFFECTIVE_FROM } from '../statutory/lindung-24-jam';
import { credentialedClinicianFields } from '../core/credentialing';

/**
 * THE EMPLOYEE PROFILE — the employment half of a person.
 *
 * 1:1 with `Staff`, never a second identity. A person may hold a user account,
 * an employee profile and a clinical provider identity all at once, and none of
 * them is forced into another.
 *
 * TWO READS, DELIBERATELY. `list`/`get` need `hr.view` and return the directory
 * — names, positions, branches, status. `payrollView` needs `hr.payroll.view`
 * and is the only path that returns salary, bank details and statutory
 * identifiers. Splitting them means the ordinary HR screen cannot leak a salary
 * by rendering a field somebody forgot to hide.
 */
@Injectable()
export class EmployeeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { clinicId?: string; status?: EmploymentStatus; search?: string } = {}) {
    // The branch comes through the actor's SCOPE: a requested branch outside
    // it is refused, and no request means the branches this account manages.
    // The old `params.clinicId ?? actor.clinicId` accepted any branch the
    // request cared to name.
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');

    const today = new Date();
    const staff = await this.prisma.staff.findMany({
      where: {
        ...scope.where(params.clinicId),
        ...(params.search
          ? { fullName: { contains: params.search, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { fullName: 'asc' },
      include: {
        clinic: { select: { id: true, name: true } },
        employeeProfile: {
          include: { manager: { select: { id: true, fullName: true } }, leavePolicy: { select: { id: true, name: true } } },
        },
        roleAssignments: { select: { role: true, customRole: { select: { name: true } } } },
        // THE STANDING IN FORCE TODAY, one row, so the directory can say
        // whether EIS applies without a read per employee. The same table the
        // record resolves per period; here "today" is the only period asked.
        statutoryClassifications: {
          where: { effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { epfApplicable: true, socsoApplicable: true, eisApplicable: true },
        },
      },
    });

    return staff
      .filter((row) => !params.status || row.employeeProfile?.employmentStatus === params.status)
      .map((row) => ({
        staffId: row.id,
        fullName: row.fullName,
        legacyRole: row.role,
        roles: row.roleAssignments.map((assignment) => assignment.role ?? assignment.customRole?.name).filter(Boolean),
        active: row.active,
        clinicId: row.clinicId,
        clinicName: row.clinic?.name ?? null,
        // Provider identity travels beside employment, never merged into it.
        professionalType: row.professionalType,
        professionalActive: row.professionalActive,
        canSignClinicalNotes: row.canSignClinicalNotes,
        hasProfile: row.employeeProfile !== null,
        employeeNo: row.employeeProfile?.employeeNo ?? null,
        position: row.employeeProfile?.position ?? null,
        department: row.employeeProfile?.department ?? null,
        employmentType: row.employeeProfile?.employmentType ?? null,
        employmentStatus: row.employeeProfile?.employmentStatus ?? null,
        startDate: row.employeeProfile?.startDate ?? null,
        endDate: row.employeeProfile?.endDate ?? null,
        manager: row.employeeProfile?.manager?.fullName ?? null,
        leavePolicy: row.employeeProfile?.leavePolicy?.name ?? null,
        phone: row.employeeProfile?.phone ?? null,
        email: row.employeeProfile?.email ?? null,
        // PRESENCE, NOT THE NUMBERS. The directory's four dots: is the
        // reference number on file, is the bank account, and does the scheme
        // apply to this person under the standing in force today. NULL for
        // the schemes means nobody has recorded a standing — a different fact
        // from "does not apply".
        epfNumberOnFile: Boolean(row.employeeProfile?.epfNumber),
        socsoNumberOnFile: Boolean(row.employeeProfile?.socsoNumber),
        bankAccountOnFile: Boolean(row.employeeProfile?.bankAccountNo),
        schemes: row.statutoryClassifications[0]
          ? {
              epf: row.statutoryClassifications[0].epfApplicable,
              socso: row.statutoryClassifications[0].socsoApplicable,
              eis: row.statutoryClassifications[0].eisApplicable,
            }
          : null,
      }));
  }

  /** The full profile, MINUS anything payroll-sensitive. */
  async get(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { staffId },
      include: {
        staff: { select: { id: true, fullName: true, role: true, active: true, clinicId: true } },
        manager: { select: { id: true, fullName: true } },
        leavePolicy: { select: { id: true, name: true } },
      },
    });
    if (!profile) throw new NotFoundException('No employee profile for that staff member');
    const { basicSalary, hourlyRate, bankAccountNo, bankName, bankAccountName, epfNumber, socsoNumber, taxNumber, identifierValue, ...safe } =
      profile;
    return { ...safe, hasSalaryOnRecord: basicSalary !== null || hourlyRate !== null };
  }

  /**
   * ONE EMPLOYEE, EVERYTHING KNOWN ABOUT THEM — as a READ, not a record.
   *
   * The owner's finding was that an employee had no obvious place to hold
   * employment details, pay basis, statutory identifiers, leave entitlement,
   * attendance and payroll history. The wrong fix would have been a second
   * employee table with those columns on it. This is the right one: a single
   * composition over the tables that already own each fact — EmployeeProfile,
   * LeaveBalance/LeaveRequest, AttendanceRecord, PayrollLine — so the detail
   * screen has one call to make and NOTHING here can drift from the module
   * that writes it.
   *
   * PAY IS STILL GATED. `hr.view` gets the employment record; the pay block is
   * populated only for `hr.payroll.view`, and even then the bank account number
   * and the statutory identifier VALUES are never returned — the screen needs
   * to know whether an EPF number is on file, not what it is.
   */
  async record(staffId: string, params: { year?: number } = {}) {
    const actor = await requirePermission(this.rawPrisma, 'hr.view');
    const year = params.year ?? new Date().getUTCFullYear();
    const mayReadPay = actorCan(actor, 'hr.payroll.view');

    const profile = await this.prisma.employeeProfile.findUnique({
      where: { staffId },
      include: {
        staff: { select: { id: true, fullName: true, role: true, active: true, clinicId: true } },
        manager: { select: { id: true, fullName: true } },
        leavePolicy: { select: { id: true, name: true, entitlements: { select: { leaveType: true, daysPerYear: true } } } },
        // WHO EMPLOYS THEM, which is not where they work. Stage 1 made the
        // legal employer a real entity and assigned every person to one, and
        // then this record showed only the branch — so the fact that decides
        // whose EPF number an employee is filed under was invisible on the one
        // screen that claims to hold their whole employment.
        legalEmployer: { select: { id: true, name: true } },
      },
    });
    if (!profile) throw new NotFoundException('No employee profile for that staff member');

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));

    // STAGE 2.5 — what payroll actually needs from this person, and what it
    // has. Everything below is read here rather than assembled by the screen,
    // so the readiness a payroll run enforces and the readiness an employee
    // page reports are the same fact.
    const period = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));

    const [clinic, attendance, payrollLines, salaryRows, classificationRows, pcbInput, claims, priorYtdMonths] =
      await Promise.all([
      profile.staff.clinicId
        ? this.prisma.clinic.findUnique({ where: { id: profile.staff.clinicId }, select: { name: true } })
        : Promise.resolve(null),
      this.prisma.attendanceRecord.findMany({
        where: { staffId, workDate: { gte: yearStart, lte: yearEnd } },
        orderBy: { workDate: 'desc' },
        select: {
          id: true,
          workDate: true,
          status: true,
          clockInAt: true,
          clockOutAt: true,
          workedMinutes: true,
          lateMinutes: true,
          overtimeMinutes: true,
          overtimeApproved: true,
          correctedAt: true,
        },
      }),
      this.prisma.payrollLine.findMany({
        where: { staffId },
        orderBy: { payrollRun: { period: 'desc' } },
        take: 24,
        select: {
          id: true,
          grossPay: true,
          netPay: true,
          employerCost: true,
          epfEmployee: true,
          socsoEmployee: true,
          eisEmployee: true,
          pcb: true,
          payrollRun: { select: { id: true, period: true, status: true, statutoryStatus: true } },
        },
      }),
      this.prisma.employeeSalary.findMany({ where: { staffId }, orderBy: { effectiveFrom: 'desc' } }),
      // The DATED statutory standing, not the profile columns. Payroll stopped
      // reading those, so a checklist that still read them would report a
      // readiness the run does not share.
      this.prisma.employeeStatutoryClassification.findMany({ where: { staffId } }),
      this.prisma.payrollInputEntry.findFirst({ where: { staffId, period, componentCode: 'PCB' } }),
      this.prisma.staffClaim.findMany({
        where: { staffId },
        orderBy: { claimDate: 'desc' },
        take: 12,
        include: { decidedBy: { select: { fullName: true } } },
      }),
      // Whether any pay for the tax year is on record before this month —
      // approved runs or an opening import both count. Feeds the readiness
      // item that says monthly tax would treat the earlier months as unpaid.
      this.prisma.employeeYtd.count({
        where: { staffId, taxYear: period.getUTCFullYear(), month: { lt: period.getUTCMonth() + 1 } },
      }),
    ]);

    const salary = resolveSalaryForPayroll(
      salaryRows.map((row) => ({
        id: row.id,
        basis: row.basis,
        amountCents: toCents(row.amount),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      })),
      period,
      periodEnd,
    );

    /*
     * THE STANDING IN FORCE FOR THIS MONTH.
     *
     * `statutory` is what the run would resolve, so "ready" here means "the run
     * can pay them". Where nothing is on record, or two versions overlap the
     * month, every classification reads as unknown — which is what the run
     * does too, and is the only answer that does not overstate readiness.
     */
    const classificationOutcome = resolveClassificationForPayroll(
      classificationRows.map(toClassificationRow),
      period,
      periodEnd,
    );
    const statutory =
      classificationOutcome.kind === 'RESOLVED'
        ? classificationOutcome.row
        : {
            epfApplicable: true,
            epfMembership: null,
            epfEmployeeRate: null,
            socsoApplicable: true,
            eisApplicable: true,
            lindungParticipation: null,
            pcbApplicable: true,
            taxResidence: null,
            pcbCategory: null,
            qualifyingChildren: 0,
            disabledSelf: false,
            disabledSpouse: false,
            restDayOfWeek: null,
            overtimeContractPolicy: null,
          };

    const worked = attendance.filter((row) => row.workedMinutes !== null);
    const approvedOvertime = attendance.reduce(
      (total, row) => total + (row.overtimeApproved ? row.overtimeMinutes : 0),
      0,
    );

    return {
      staffId,
      year,
      identity: {
        // Three identities, still three. The account, the employment and the
        // clinical credential are reported side by side and never merged.
        fullName: profile.staff.fullName,
        legalName: profile.legalName,
        accountActive: profile.staff.active,
        accountRole: profile.staff.role,
        email: profile.email,
        phone: profile.phone,
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        nationality: profile.nationality,
        maritalStatus: profile.maritalStatus,
        address: profile.address,
        emergencyContactName: profile.emergencyContactName,
        emergencyContactPhone: profile.emergencyContactPhone,
        emergencyContactRelation: profile.emergencyContactRelation,
      },
      employment: {
        employeeNo: profile.employeeNo,
        position: profile.position,
        department: profile.department,
        employmentType: profile.employmentType,
        employmentStatus: profile.employmentStatus,
        clinicName: clinic?.name ?? null,
        /*
         * WHO EMPLOYS THEM — the id as well as the name.
         *
         * The name alone is enough to PRINT the fact and not enough to EDIT
         * it, which is how the record ended up displaying an employing
         * company that no screen could set. A payroll run refuses on
         * NO_LEGAL_EMPLOYER and the refusal is not overridable, so a person
         * added entirely through the screens could not be paid at all.
         */
        legalEmployerId: profile.legalEmployerId,
        legalEmployerName: profile.legalEmployer?.name ?? null,
        manager: profile.manager?.fullName ?? null,
        startDate: profile.startDate,
        confirmedDate: profile.confirmedDate,
        endDate: profile.endDate,
        endReason: profile.endReason,
        notes: profile.notes,
      },
      /**
       * NULL means "you may not see this", which is a different sentence from
       * "there is nothing on file" — `payVisible` says which.
       */
      payVisible: mayReadPay,
      pay: mayReadPay
        ? {
            // THE CANONICAL SALARY, resolved for this month exactly as payroll
            // resolves it. This read `EmployeeProfile.basicSalary`, so the
            // employee page could show one figure while the run paid another.
            payBasis: salary.kind === 'RESOLVED' ? salary.row.basis : null,
            basicSalary:
              salary.kind === 'RESOLVED' && salary.row.basis === 'MONTHLY'
                ? salary.row.amountCents / 100
                : null,
            hourlyRate:
              salary.kind === 'RESOLVED' && salary.row.basis === 'HOURLY'
                ? salary.row.amountCents / 100
                : null,
            salaryState: salary.kind,
            salaryNote: salary.reason,
            bankName: profile.bankName,
            // Presence, not the number. An HR detail screen has no reason to
            // display a bank account, and a screen that displays one is a
            // screenshot away from being a leak.
            bankAccountOnFile: Boolean(profile.bankAccountNo),
          }
        : null,
      statutory: {
        // Again presence, not values. And note what is NOT here: a rate, a
        // bracket or a computed contribution. Identifiers are stored so a
        // filing can be prepared; they never imply this system knows the
        // schedule that goes with them.
        epfNumberOnFile: Boolean(profile.epfNumber),
        socsoNumberOnFile: Boolean(profile.socsoNumber),
        taxNumberOnFile: Boolean(profile.taxNumber),
        taxCategory: profile.taxCategory,
        // EVERY CLASSIFICATION BELOW IS THE VERSION IN FORCE FOR THIS MONTH,
        // not the profile column. `classificationState` says which — RESOLVED,
        // NONE_ON_RECORD, or two versions overlapping the month — so a screen
        // never has to guess whether a nil means "no" or "nobody said".
        classificationState: classificationOutcome.kind,
        classificationNote: classificationOutcome.reason,
        classificationEffectiveFrom:
          classificationOutcome.kind === 'RESOLVED'
            ? classificationOutcome.row.effectiveFrom.toISOString().slice(0, 10)
            : null,
        taxResidence: statutory.taxResidence,
        pcbCategory: statutory.pcbCategory,
        qualifyingChildren: statutory.qualifyingChildren,
        restDayOfWeek: statutory.restDayOfWeek,
        overtimeContractPolicy: statutory.overtimeContractPolicy,
        epfMembership: statutory.epfMembership,
        lindungParticipation: statutory.lindungParticipation,
        epfApplicable: statutory.epfApplicable,
        socsoApplicable: statutory.socsoApplicable,
        eisApplicable: statutory.eisApplicable,
        pcbApplicable: statutory.pcbApplicable,
        note:
          'Membership numbers are corrections of one lifelong fact each, so they are not dated — the March submission wants the correct number, not the one that was on file in March. Everything that SELECTS a rule — EPF Part, scheme applicability, LINDUNG participation, the MTD profile, the rest day — is a dated version instead, and the values here are the version in force for this month. All four schemes are computed from the authorities’ own published schedules; a recorded TP1 enters the month as LP1, and a mid-year joiner’s TP3 carries their previous employment into the cumulative calculation.',
      },
      /**
       * EMPLOYEE OR CONTRACTOR. The fact everything statutory turns on, and the
       * one `employmentType` could not express: a locum may be either.
       */
      engagement: profile.engagement,
      /**
       * PAYROLL READINESS, as a checklist rather than a score.
       *
       * "4 of 5" tells somebody they have work to do and not what it is. Each
       * item names what is missing and what to do about it, and the list is
       * derived from the SAME facts the payroll run blocks on — a person this
       * says is ready is a person the run can pay.
       *
       * A CONTRACTOR is not measured against it: they are not on payroll, and
       * a permanent amber checklist against somebody who will never be paid
       * through it is noise.
       */
      payrollReadiness:
        profile.engagement === 'CONTRACTOR'
          ? null
          : buildPayrollReadiness({
              salary,
              // The salary AMOUNT rides on the pay permission. The checklist
              // used to print it into the salary item for anybody with
              // `hr.view`, which handed out the one figure `hr.salary.view`
              // exists to protect.
              mayReadPay,
              standing: statutory,
              legalEmployerName: profile.legalEmployer?.name ?? null,
              bankName: profile.bankName,
              bankAccountNo: profile.bankAccountNo,
              dateOfBirth: profile.dateOfBirth,
              epfNumberOnFile: Boolean(profile.epfNumber),
              socsoNumberOnFile: Boolean(profile.socsoNumber),
              pcbInputAmountCents: pcbInput ? toCents(pcbInput.amount) : null,
              lindungInForce:
                new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0)) >= LINDUNG_EFFECTIVE_FROM,
              ytd: {
                periodMonth: period.getUTCMonth() + 1,
                taxYear: period.getUTCFullYear(),
                hasPriorMonths: priorYtdMonths > 0,
                employedBeforePeriod: Boolean(profile.startDate && profile.startDate < period),
              },
            }),
      /**
       * SALARY AS PERIODS, not as effective-dated rows. "5 Mar 2026 → 30 Sep
       * 2026 · RM3,200" is a fact about somebody's employment; "effective_from
       * / effective_to" is a fact about a table.
       */
      salaryPeriods: mayReadPay
        ? salaryRows.map((row) => ({
            id: row.id,
            amount: formatCents(toCents(row.amount)),
            basis: row.basis,
            from: row.effectiveFrom.toISOString().slice(0, 10),
            to: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
            current: row.effectiveTo === null && row.effectiveFrom <= periodEnd,
            upcoming: row.effectiveFrom > periodEnd,
            reason: row.reason,
          }))
        : null,
      claims: claims.map((claim) => ({
        id: claim.id,
        category: claim.category,
        claimDate: claim.claimDate.toISOString().slice(0, 10),
        description: claim.description,
        status: claim.status,
        amountClaimed: formatCents(toCents(claim.amountClaimed)),
        amountApproved: claim.amountApproved === null ? null : formatCents(toCents(claim.amountApproved)),
        paymentRoute: claim.paymentRoute,
        payoutStatus: claim.payoutStatus,
        decidedBy: claim.decidedBy?.fullName ?? null,
      })),
      leavePolicy: profile.leavePolicy
        ? {
            id: profile.leavePolicy.id,
            name: profile.leavePolicy.name,
            // The policy's annual-leave days, so the record can say "16 days"
            // beside the policy's name. One figure per policy: the entitlement
            // table has no service-length tiers.
            annualLeaveDays: (() => {
              const annual = profile.leavePolicy.entitlements.find((row) => row.leaveType === 'ANNUAL');
              return annual ? Number(annual.daysPerYear) : null;
            })(),
          }
        : null,
      attendance: {
        daysRecorded: attendance.length,
        daysWorked: worked.length,
        absent: attendance.filter((row) => row.status === 'ABSENT').length,
        onLeave: attendance.filter((row) => row.status === 'ON_LEAVE').length,
        lateDays: attendance.filter((row) => (row.lateMinutes ?? 0) > 0).length,
        approvedOvertimeHours: Math.round((approvedOvertime / 60) * 100) / 100,
        corrected: attendance.filter((row) => row.correctedAt !== null).length,
        recent: attendance.slice(0, 30).map((row) => ({
          id: row.id,
          workDate: row.workDate,
          status: row.status,
          clockInAt: row.clockInAt,
          clockOutAt: row.clockOutAt,
          workedMinutes: row.workedMinutes,
          lateMinutes: row.lateMinutes,
          overtimeMinutes: row.overtimeMinutes,
          overtimeApproved: row.overtimeApproved,
          corrected: row.correctedAt !== null,
        })),
      },
      payrollHistory: payrollLines.map((line) => ({
        id: line.id,
        runId: line.payrollRun.id,
        period: line.payrollRun.period,
        runStatus: line.payrollRun.status,
        statutoryStatus: line.payrollRun.statutoryStatus,
        // Money is returned only to somebody who may read pay. A payroll
        // history with the amounts stripped is still useful — it says the
        // person was on the run — and one with them included is a salary.
        gross: mayReadPay ? Number(line.grossPay) : null,
        net: mayReadPay ? Number(line.netPay) : null,
        employerCost: mayReadPay ? Number(line.employerCost) : null,
        // NULL, not zero: the run did not compute it.
        epfEmployee: mayReadPay && line.epfEmployee !== null ? Number(line.epfEmployee) : null,
        socsoEmployee: mayReadPay && line.socsoEmployee !== null ? Number(line.socsoEmployee) : null,
        eisEmployee: mayReadPay && line.eisEmployee !== null ? Number(line.eisEmployee) : null,
        pcb: mayReadPay && line.pcb !== null ? Number(line.pcb) : null,
      })),
      /**
       * DOCUMENTS ARE NOT IMPLEMENTED and this says so rather than rendering an
       * empty list, which reads as "no documents uploaded" and is a different
       * claim entirely. There is no employee document store in this schema: no
       * model, no upload path, no retention rule.
       */
      documents: {
        implemented: false,
        note:
          'No employee document store exists in this system. Contracts, offer letters, IC copies, certificates and disciplinary records are not held here and this screen is not a record of them.',
      },
    };
  }

  /**
   * Salary, bank and statutory detail. Separate permission, on purpose.
   *
   * `basicSalary` and `hourlyRate` are the CANONICAL figures — resolved from
   * `employee_salaries` for today, exactly as payroll resolves them for the
   * period it is paying. They are not the legacy `EmployeeProfile` columns:
   * those are read-only history now, and a screen showing one while the run
   * pays the other is the disagreement this stage removed.
   *
   * Where no salary is on record they are null, never 0 — "nothing on file"
   * and "paid nothing" are different sentences and only one of them is true.
   */
  async payrollView(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    // A DELIBERATE projection, not `...profile`. Spreading the whole row sent
    // the full bank account number, the NRIC/passport value and everything
    // else on the profile to any `hr.payroll.view` holder — the exact fields
    // the `hr.view` read two methods up strips out on purpose. What payroll
    // needs is the salary resolution, the filing identifiers, and PRESENCE
    // plus last-four for the bank account; the full number lives only in the
    // audited bank-listing export.
    const [profile, salaryRows] = await Promise.all([
      this.prisma.employeeProfile.findUnique({
        where: { staffId },
        select: {
          staffId: true,
          employeeNo: true,
          position: true,
          department: true,
          employmentType: true,
          employmentStatus: true,
          startDate: true,
          endDate: true,
          legalEmployerId: true,
          identifierType: true,
          epfNumber: true,
          socsoNumber: true,
          taxNumber: true,
          bankName: true,
          bankAccountName: true,
          bankAccountNo: true,
          basicSalary: true,
          hourlyRate: true,
        },
      }),
      this.prisma.employeeSalary.findMany({ where: { staffId }, orderBy: { effectiveFrom: 'desc' } }),
    ]);
    if (!profile) throw new NotFoundException('No employee profile for that staff member');
    const { bankAccountNo, basicSalary: legacyBasic, hourlyRate: legacyHourly, ...safeProfile } = profile;

    const today = new Date();
    const salary = resolveSalaryForPayroll(
      salaryRows.map((row) => ({
        id: row.id,
        basis: row.basis,
        amountCents: toCents(row.amount),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      })),
      today,
      today,
    );
    const resolved = salary.kind === 'RESOLVED' ? salary.row : null;

    return {
      ...safeProfile,
      bankAccountOnFile: Boolean(bankAccountNo),
      bankAccountLastFour: bankAccountNo ? bankAccountNo.slice(-4) : null,
      basicSalary: resolved && resolved.basis === 'MONTHLY' ? fromCents(resolved.amountCents) : null,
      hourlyRate: resolved && resolved.basis === 'HOURLY' ? fromCents(resolved.amountCents) : null,
      payBasis: resolved?.basis ?? null,
      salaryEffectiveFrom: resolved?.effectiveFrom ?? null,
      salaryState: salary.kind,
      salaryNote: salary.reason,
      /**
       * WHAT THE OLD COLUMN STILL SAYS. Kept visible rather than deleted so
       * anyone reconciling against a pre-cutover export can see both numbers
       * and which one is now paid; nothing computes from it.
       */
      legacyBasicSalary: legacyBasic,
      legacyHourlyRate: legacyHourly,
    };
  }

  /**
   * HIRE SOMEBODY — one act, three records, one transaction.
   *
   * The staff row, the employment profile and (optionally) the login are
   * created together or not at all. Before this there was no single door: an
   * owner had to create a staff member on one screen, find them again on
   * another, and complete an employment profile there — and if they stopped
   * half way, which people do, the result was a staff row that looked like an
   * employee and could not be paid.
   *
   * The separation between the three is KEPT, because it is real. What changes
   * is that an owner no longer has to know about it to hire a receptionist.
   */
  async create(dto: CreateEmployeeDto) {
    const { fullName, role, clinicId, loginEmail, loginPassword, medicalRegistrationNo, bookable, ...profile } = dto;

    // An email with no password is an account nobody can use. Refused rather
    // than half-created, so there is no state where somebody appears to have a
    // login and cannot sign in.
    if (Boolean(loginEmail) !== Boolean(loginPassword)) {
      throw new BadRequestException(
        'A login needs both an email and a password. Leave both empty to add somebody who does not sign in yet.',
      );
    }

    const staffId = await withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      // CREATING AN ACCOUNT IS USER MANAGEMENT, a different permission from
      // maintaining employment records. An HR clerk may hire; giving somebody
      // the keys is the owner's act.
      if (loginEmail && !actorCan(actor, 'users.manage')) {
        throw new BadRequestException(
          'You may add an employee, but creating a login for them needs user-management access. Add them without one and ask an account holder to give them a login.',
        );
      }

      const tenantId = currentTenantId();
      let userId: string | null = null;
      if (loginEmail && loginPassword) {
        const existing = await tx.user.findFirst({ where: { email: loginEmail } });
        if (existing) throw new BadRequestException('Somebody already signs in with that email address.');
        const created = await tx.user.create({
          data: { tenantId, email: loginEmail, passwordHash: await bcrypt.hash(loginPassword, 10), status: 'active' },
        });
        userId = created.id;
      }

      const staff = await tx.staff.create({
        data: {
          tenantId,
          fullName,
          role,
          clinicId: clinicId ?? null,
          active: true,
          userId,
          // A REGISTRATION NUMBER IS WHAT MAKES A PROVIDER, not a job title.
          // Without one this is an employee with a clinical role, which is a
          // different and perfectly ordinary thing.
          //
          // Through the ONE definition of "credentialed" rather than by hand:
          // the eight fields were hand-written twice before and both times the
          // result was a doctor who could not, in fact, sign anything.
          ...(medicalRegistrationNo
            ? credentialedClinicianFields({
                registrationNo: medicalRegistrationNo,
                grantedByStaffId: actor.id,
              })
            : {}),
        },
      });

      await recordAudit(tx, actor, {
        action: 'employee.created',
        entityType: 'Staff',
        entityId: staff.id,
        after: { fullName, role, clinicId: clinicId ?? null, hasLogin: Boolean(userId), provider: Boolean(medicalRegistrationNo) },
        reason: `Added ${fullName}`,
        source: 'hr.employees',
      });

      return staff.id;
    });

    // The employment half, through the ONE path that writes it — so the same
    // refusals apply (salary and statutory classification are effective-dated
    // and belong to their own endpoints) and the same audit diff is recorded.
    await this.upsert(staffId, profile as UpsertEmployeeDto);
    return this.get(staffId);
  }

  /**
   * STAFF RECORDS WITH NO EMPLOYMENT PROFILE — the queue nobody could see.
   *
   * A staff row without one is legitimate and common: an account is created
   * before HR finishes the paperwork. What was missing was any screen that
   * said so, so people sat in that state indefinitely and were quietly left
   * out of payroll — not refused, simply absent, which is much harder to
   * notice than a refusal.
   */
  async incompleteProfiles() {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.staff.findMany({
      where: { ...scope.where(undefined), active: true, employeeProfile: null, role: { not: 'PATIENT_PORTAL' } },
      orderBy: { fullName: 'asc' },
      include: { clinic: { select: { name: true } } },
    });
    return rows.map((row) => ({
      staffId: row.id,
      fullName: row.fullName,
      role: row.role,
      clinicId: row.clinicId,
      clinicName: row.clinic?.name ?? null,
      hasLogin: row.userId !== null,
      createdAt: row.createdAt,
    }));
  }

  async upsert(staffId: string, dto: UpsertEmployeeDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const staff = await tx.staff.findUnique({ where: { id: staffId }, select: { id: true } });
      if (!staff) throw new NotFoundException('Staff member not found');

      const before = await tx.employeeProfile.findUnique({ where: { staffId } });

      /*
       * THE LEGACY SALARY COLUMN IS CLOSED FOR WRITING.
       *
       * Payroll resolves `employee_salaries` now. A salary written here would
       * be a number nobody is paid — silently, because the profile would show
       * one figure and the run would resolve another, which is the exact
       * failure the effective-dated table exists to prevent.
       *
       * Refused rather than quietly forwarded: this endpoint has no effective
       * date to forward it WITH, and inventing "from today" is the kind of
       * guess this stage removed everywhere else.
       */
      if (dto.basicSalary !== undefined || dto.hourlyRate !== undefined) {
        throw new BadRequestException(
          'Salary is recorded with the date it takes effect from, at ' +
            'POST /workforce/employees/:staffId/salary. Setting it here would leave the employee profile and the ' +
            'payroll run disagreeing about what somebody is paid.',
        );
      }

      /*
       * STATUTORY CLASSIFICATION IS CLOSED FOR WRITING HERE TOO, and for the
       * same reason one step further on.
       *
       * Payroll resolves `employee_statutory_classifications` now. A Third
       * Schedule Part written on this form would be a Part nobody contributed
       * under: the profile would show one and the run would resolve another,
       * silently, which is precisely what dating the record prevents.
       *
       * Refused rather than forwarded "from today", because a classification
       * has a date it became TRUE — the day permanent residence was granted,
       * the day an opt-in was signed — and this endpoint does not carry it.
       */
      const classificationFieldsSent = STATUTORY_CLASSIFICATION_FIELDS.filter(
        (field) => (dto as Record<string, unknown>)[field] !== undefined,
      );
      if (classificationFieldsSent.length > 0) {
        throw new BadRequestException(
          `${classificationFieldsSent.join(', ')} ${classificationFieldsSent.length === 1 ? 'is' : 'are'} recorded ` +
            'with the date they take effect from, at POST /workforce/employees/:staffId/statutory-classification. ' +
            'Setting them here would leave the employee record and the payroll run disagreeing about which ' +
            'statutory rules somebody was contributed under.',
        );
      }

      // Bank details are still a SEPARATE permission inside this one write. An
      // HR clerk maintaining records must not change where somebody's pay goes
      // by including it in the same form submission.
      const mayEditPay = actorCan(actor, 'hr.payroll.view');
      const payFields = dto.bankAccountNo !== undefined;
      const data = {
        ...dto,
        ...(payFields && !mayEditPay ? { bankAccountNo: undefined } : {}),
        ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
        ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
        ...(dto.confirmedDate ? { confirmedDate: new Date(dto.confirmedDate) } : {}),
        ...(dto.endDate ? { endDate: new Date(dto.endDate) } : {}),
      };

      const saved = before
        ? await tx.employeeProfile.update({ where: { staffId }, data })
        : await tx.employeeProfile.create({ data: { ...data, tenantId: currentTenantId(), staffId } });

      const changed = diffOf((before ?? {}) as Record<string, unknown>, data as Record<string, unknown>);
      await recordAudit(tx, actor, {
        action: 'employee.changed',
        entityType: 'EmployeeProfile',
        entityId: saved.id,
        // Salary and bank details are REDACTED in the audit payload: an audit
        // log that copies a bank account number is a second place it can leak
        // from. That a change happened, and by whom, is what an audit needs.
        before: redactSensitive(changed.before),
        after: redactSensitive(changed.after),
        source: 'hr.employees',
      });

      return saved;
    });
  }
}

/**
 * The classifications that now live on `employee_statutory_classifications`.
 *
 * Named here rather than derived from the DTO so that adding one to the DTO
 * without adding it to the dated table is a compile-time-visible omission
 * rather than a field that silently goes back to being untraceable.
 */
const STATUTORY_CLASSIFICATION_FIELDS = [
  'epfApplicable',
  'epfMembership',
  'epfEmployeeRate',
  'socsoApplicable',
  'eisApplicable',
  'lindungParticipation',
  'pcbApplicable',
  'taxResidence',
  'pcbCategory',
  'qualifyingChildren',
  'disabledSelf',
  'disabledSpouse',
  'restDayOfWeek',
  'overtimeContractPolicy',
] as const satisfies readonly (keyof UpsertEmployeeDto)[];

const SENSITIVE = new Set([
  'basicSalary',
  'hourlyRate',
  'bankAccountNo',
  'bankAccountName',
  'identifierValue',
  'epfNumber',
  'socsoNumber',
  'taxNumber',
]);

/** Grouped ringgit for a sentence a person reads. `1800000` -> `18,000.00`. */
function money(cents: number): string {
  const [whole, part] = formatCents(cents).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${part}`;
}

/** `2025-04-19` -> `19 April 2025`. A checklist sentence is prose, not a field. */
function longDate(value: Date): string {
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function redactSensitive(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = SENSITIVE.has(key) ? '[changed]' : value;
  }
  return out;
}
