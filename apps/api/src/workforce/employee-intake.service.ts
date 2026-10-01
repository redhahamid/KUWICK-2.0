import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { withTenantTx } from '../clinical/clinical-actor';
import { actorCan, requireScope, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { EmployeeService } from './employee.service';
import { EmployeeSalaryService } from './employee-salary.service';
import { LegalEmployerService } from './legal-employer.service';
import { StatutoryClassificationService } from './statutory-classification.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { RecordSalaryDto } from './dto/record-salary.dto';
import { RecordStatutoryClassificationDto } from './dto/record-statutory-classification.dto';
import { EmployeeIntakeDto, EmployeeIntakeRowDto } from './dto/employee-intake.dto';
import { checkIntakeRow, createBodyOf, IntakeContext, IntakeReadiness, newSeen, RowProblem, salaryBodyOf, standingBodyOf } from './employee-intake';
import { nricDigits } from './nric';

export interface IntakeRowResult {
  index: number;
  problems: RowProblem[];
  readiness: IntakeReadiness;
  /** On a committed row: the person. */
  staffId?: string;
  /** On a committed row that stopped part way: which write refused, and why. The person exists; finish them on their record. */
  failedAt?: 'employee' | 'employer' | 'salary' | 'standing';
  error?: string;
}

export interface IntakeResult {
  /** True when nothing was written: a check, or a batch with a problem in it. */
  dryRun: boolean;
  rowCount: number;
  clean: boolean;
  created: number;
  results: IntakeRowResult[];
}

/**
 * THE INTAKE: check every row, then write the clean batch through the four
 * doors a single employee goes through — the staff row and profile, the
 * employing company, the salary, the dated standing — so the same refusals
 * apply and the same audit rows are left, person by person. A row that
 * stops part way is reported as such: the person exists, and the record
 * says what is still missing.
 */
@Injectable()
export class EmployeeIntakeService {
  constructor(
    private readonly rawPrisma: PrismaService,
    private readonly employees: EmployeeService,
    private readonly salaries: EmployeeSalaryService,
    private readonly standings: StatutoryClassificationService,
    private readonly employers: LegalEmployerService,
  ) {}

  async intake(dto: EmployeeIntakeDto): Promise<IntakeResult> {
    const { actor, scope } = await requireScope(this.rawPrisma, 'hr.employee.manage');
    const ctx = await this.contextFor(scope.clinicIds, scope.everyBranch, actorCan(actor, 'hr.payroll.view'), actorCan(actor, 'users.manage'));
    const seen = newSeen();
    const checks = [];
    for (const row of dto.rows) checks.push(await checkIntakeRow(row, ctx, seen));
    const results: IntakeRowResult[] = checks.map((check, index) => ({ index, problems: check.problems, readiness: check.readiness }));
    const clean = results.every((row) => row.problems.length === 0);
    if (!dto.commit || !clean) return { dryRun: true, rowCount: dto.rows.length, clean, created: 0, results };

    let created = 0;
    for (const [index, row] of dto.rows.entries()) {
      const result = results[index];
      const derived = checks[index].derived;
      const body = createBodyOf(row, derived) as unknown as CreateEmployeeDto;
      if (!body.clinicId && ctx.clinicIds.size === 1) body.clinicId = [...ctx.clinicIds][0];
      let step: IntakeRowResult['failedAt'] = 'employee';
      try {
        const person = (await this.employees.create(body)) as { staffId: string };
        result.staffId = person.staffId;
        created += 1;
        const employerId = row.legalEmployerId?.trim();
        if (employerId) {
          step = 'employer';
          await this.employers.assignEmployee(person.staffId, employerId, 'Recorded at hire');
        }
        const salary = salaryBodyOf(row);
        if (salary) {
          step = 'salary';
          await this.salaries.record(person.staffId, { ...salary, reason: 'Starting salary' } as RecordSalaryDto);
        }
        const standing = standingBodyOf(row);
        if (standing) {
          step = 'standing';
          await this.standings.record(person.staffId, standing as unknown as RecordStatutoryClassificationDto);
        }
      } catch (error) {
        result.failedAt = step;
        result.error = error instanceof Error ? error.message : String(error);
      }
    }

    // One row for the batch as a whole, beside the per-person rows each door left.
    await withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, who) => {
      await recordAudit(tx, who, {
        action: 'employee.intake',
        entityType: 'EmployeeIntake',
        entityId: `${new Date().toISOString()}:${dto.rows.length}`,
        after: {
          rows: dto.rows.length,
          created,
          stoppedPartWay: results.filter((row) => row.failedAt).map((row) => ({ staffId: row.staffId ?? null, failedAt: row.failedAt, error: row.error })),
        },
        reason: `Added ${created} of ${dto.rows.length} ${dto.rows.length === 1 ? 'employee' : 'employees'} through the intake`,
        source: 'hr.employees',
      });
    });
    return { dryRun: false, rowCount: dto.rows.length, clean, created, results };
  }

  private async contextFor(clinicIds: string[], everyBranch: boolean, mayRecordPay: boolean, mayCreateLogins: boolean): Promise<IntakeContext> {
    // One tenant transaction for the four reads, with room to spare: the
    // scoped client's five seconds per call is tight for the first request
    // after a cold start, and these are reads a batch of two hundred rows is
    // checked against once.
    const [employers, titles, profiles, users] = await withTenantTx(
      this.rawPrisma,
      (tx) =>
        Promise.all([
          tx.legalEmployer.findMany({ select: { id: true, name: true, active: true } }),
          tx.jobTitle.findMany({ select: { id: true, name: true, active: true } }),
          // Read for the duplicate check only; neither number leaves this method.
          tx.employeeProfile.findMany({ select: { employeeNo: true, identifierValue: true, identifierType: true } }),
          tx.user.findMany({ select: { email: true } }),
        ]),
      { timeout: 20_000 },
    );
    return {
      clinicIds: new Set(clinicIds),
      everyBranch,
      employers: new Map(employers.map((row) => [row.id, { name: row.name, active: row.active }])),
      jobTitles: new Map(titles.map((row) => [row.id, { name: row.name, active: row.active }])),
      existingEmployeeNos: new Set(profiles.map((row) => row.employeeNo?.toLowerCase()).filter((value): value is string => Boolean(value))),
      existingIcs: new Set(
        profiles
          .filter((row) => row.identifierValue && (row.identifierType ?? 'NRIC') !== 'PASSPORT')
          .map((row) => nricDigits(row.identifierValue as string))
          .filter((digits) => digits.length === 12),
      ),
      existingLoginEmails: new Set(users.map((row) => row.email.toLowerCase())),
      mayRecordPay,
      mayCreateLogins,
    };
  }
}

export type { EmployeeIntakeRowDto };
