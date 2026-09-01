import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EmploymentStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { diffOf, recordAudit } from '../finance/admin-audit';
import { UpsertEmployeeDto } from './dto/upsert-employee.dto';

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
    const actor = await requirePermission(this.rawPrisma, 'hr.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;

    const staff = await this.prisma.staff.findMany({
      where: {
        ...(clinicId ? { clinicId } : {}),
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
        leavePolicy: { select: { id: true, name: true } },
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

    const [clinic, attendance, payrollLines] = await Promise.all([
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
    ]);

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
            payBasis: profile.basicSalary !== null ? 'MONTHLY' : profile.hourlyRate !== null ? 'HOURLY' : null,
            basicSalary: profile.basicSalary === null ? null : Number(profile.basicSalary),
            hourlyRate: profile.hourlyRate === null ? null : Number(profile.hourlyRate),
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
        epfApplicable: profile.epfApplicable,
        socsoApplicable: profile.socsoApplicable,
        eisApplicable: profile.eisApplicable,
        pcbApplicable: profile.pcbApplicable,
        note:
          'Identifiers and applicability flags only. Malaysian EPF/SOCSO/EIS/PCB rate schedules are not implemented in this system, so no contribution shown anywhere is derived from these fields.',
      },
      leavePolicy: profile.leavePolicy ? { id: profile.leavePolicy.id, name: profile.leavePolicy.name } : null,
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

  /** Salary, bank and statutory detail. Separate permission, on purpose. */
  async payrollView(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const profile = await this.prisma.employeeProfile.findUnique({ where: { staffId } });
    if (!profile) throw new NotFoundException('No employee profile for that staff member');
    return profile;
  }

  async upsert(staffId: string, dto: UpsertEmployeeDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const staff = await tx.staff.findUnique({ where: { id: staffId }, select: { id: true } });
      if (!staff) throw new NotFoundException('Staff member not found');

      const before = await tx.employeeProfile.findUnique({ where: { staffId } });

      // Salary is a SEPARATE permission even inside this one write. An HR clerk
      // maintaining records must not be able to change somebody's pay by
      // including it in the same form submission.
      const mayEditPay = actorCan(actor, 'hr.payroll.view');
      const payFields =
        dto.basicSalary !== undefined || dto.hourlyRate !== undefined || dto.bankAccountNo !== undefined;
      const data = {
        ...dto,
        ...(payFields && !mayEditPay
          ? { basicSalary: undefined, hourlyRate: undefined, bankAccountNo: undefined }
          : {}),
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

function redactSensitive(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = SENSITIVE.has(key) ? '[changed]' : value;
  }
  return out;
}
