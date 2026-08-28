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
