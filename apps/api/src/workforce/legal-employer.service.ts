import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { UpsertLegalEmployerDto } from './dto/upsert-legal-employer.dto';
import { hrdLevyRatePercent } from '../statutory/hrd-levy';

/**
 * THE LEGAL EMPLOYER.
 *
 * Payroll runs were scoped to `clinicId` — a BRANCH. A branch employs nobody
 * and files nothing: EPF, SOCSO, EIS and PCB submissions are all made by an
 * employer, against an employer number, and Kuwick had nowhere to put one.
 *
 * The audited competitor has the opposite problem: exactly one company per
 * account, with location reduced to a name and an address, so a group running
 * two Sdn Bhds cannot use it at all.
 *
 * A clinic with one entity configures one of these and never meets the concept
 * again. A group with three gets three, and every statutory output is scoped to
 * whichever one employs the person.
 */
@Injectable()
export class LegalEmployerService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.legalEmployer.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true, runs: true } } },
    });
    // The OPEN statutory version per employer — the class in force today.
    // Read in one query rather than per row.
    const open = await this.prisma.legalEmployerStatutoryProfile.findMany({
      where: { legalEmployerId: { in: rows.map((row) => row.id) }, effectiveTo: null },
      select: { legalEmployerId: true, hrdRegistration: true },
    });
    const hrdByEmployer = new Map(open.map((row) => [row.legalEmployerId, row.hrdRegistration]));
    const currentHrdOf = (id: string) => hrdByEmployer.get(id) ?? null;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      /**
       * WHEN SOMEBODY LAST CHANGED IT.
       *
       * Settings says "Changed 2 Sep" on each card, so a clinic can tell a
       * thing that was set up once from a thing that was edited last week.
       * The column has always been on the row; nothing read it.
       */
      updatedAt: row.updatedAt.toISOString(),
      registrationNo: row.registrationNo,
      epfEmployerNo: row.epfEmployerNo,
      socsoEmployerNo: row.socsoEmployerNo,
      lhdnEmployerNo: row.lhdnEmployerNo,
      hrdRegistrationNo: row.hrdRegistrationNo,
      /**
       * LEGACY, AND UNREAD. `hrd_category` was free text beside a hand-typed
       * `hrd_levy_rate`, neither dated, and no calculation ever used either.
       * The class now lives on `legal_employer_statutory_profiles` and the rate
       * is derived from it — 1% (s.14) and 0.5% (s.15) are the PSMB Act's
       * numbers. Kept visible so anyone reconciling against a pre-cutover
       * export can see both.
       */
      legacyHrdCategory: row.hrdCategory,
      legacyHrdLevyRate: row.hrdLevyRate ? Number(row.hrdLevyRate) : null,
      /** The class in force today, and what it costs. Null means none recorded. */
      hrdRegistration: currentHrdOf(row.id),
      hrdLevyRatePercent: (() => {
        const current = currentHrdOf(row.id);
        return current ? hrdLevyRatePercent(current) : null;
      })(),
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      postcode: row.postcode,
      city: row.city,
      state: row.state,
      bankName: row.bankName,
      /**
       * PRESENCE AND THE LAST FOUR, never the number. This list is `hr.view`
       * — the permission the legacy HR-clerk role holds — and a full employer
       * account number under it is a screenshot away from being a leak. The
       * full number is written here and read only by the audited bank-listing
       * export.
       */
      bankAccountOnFile: Boolean(row.bankAccountNo),
      bankAccountLastFour: row.bankAccountNo ? row.bankAccountNo.slice(-4) : null,
      bankAccountName: row.bankAccountName,
      active: row.active,
      employeeCount: row._count.employees,
      payrollRunCount: row._count.runs,
      /**
       * What is missing before this employer could file anything. Reported
       * rather than assumed, and NOT a blocker at this stage: no statutory
       * output exists yet to be blocked.
       */
      statutoryReadiness: this.readiness(row),
    }));
  }

  private readiness(row: {
    registrationNo: string | null;
    epfEmployerNo: string | null;
    socsoEmployerNo: string | null;
    lhdnEmployerNo: string | null;
    bankAccountNo: string | null;
  }) {
    const missing: string[] = [];
    if (!row.registrationNo) missing.push('Company registration number');
    if (!row.epfEmployerNo) missing.push('EPF employer number');
    if (!row.socsoEmployerNo) missing.push('SOCSO employer code');
    if (!row.lhdnEmployerNo) missing.push('LHDN employer number (E)');
    if (!row.bankAccountNo) missing.push('Bank account for payment');
    return {
      complete: missing.length === 0,
      missing,
      note:
        missing.length === 0
          ? 'Every identity a statutory submission needs is recorded.'
          : 'These are not needed to run a payroll, but no statutory file could name this employer without them.',
    };
  }

  async get(id: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const row = await this.prisma.legalEmployer.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Legal employer not found');
    // Same rule as the list: `return row` handed out the full account number
    // under `hr.view`, with no projection at all.
    const { bankAccountNo, ...safe } = row;
    return {
      ...safe,
      bankAccountOnFile: Boolean(bankAccountNo),
      bankAccountLastFour: bankAccountNo ? bankAccountNo.slice(-4) : null,
    };
  }

  async upsert(dto: UpsertLegalEmployerDto) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      const existing = dto.id ? await tx.legalEmployer.findFirst({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Legal employer not found');

      /*
       * THE HRD CLASS IS CLOSED FOR WRITING HERE.
       *
       * It was free text (`hrdCategory`) beside a hand-typed rate
       * (`hrdLevyRate`), neither dated. Section 14 is 1% and section 15 is
       * 0.5% — the PSMB Act's numbers, not the clinic's — and an employer
       * crossing the section 14 headcount moves class ON A DATE, so a levy
       * return for the months before it must keep the old class.
       */
      if (dto.hrdCategory !== undefined || dto.hrdLevyRate !== undefined) {
        throw new BadRequestException(
          'HRD Corp registration is recorded as a class with the date it takes effect from, at ' +
            'POST /workforce/legal-employers/:id/statutory-profile. The levy rate follows from the class — ' +
            '1% under section 14, 0.5% under section 15 — and is not typed in.',
        );
      }

      const clash = await tx.legalEmployer.findFirst({
        where: { name: dto.name, ...(dto.id ? { id: { not: dto.id } } : {}) },
      });
      if (clash) {
        throw new ConflictException(
          `Another legal employer is already called "${dto.name}". Two employers with one name cannot be told apart on a statutory file.`,
        );
      }

      const data = {
        name: dto.name,
        registrationNo: dto.registrationNo ?? null,
        epfEmployerNo: dto.epfEmployerNo ?? null,
        socsoEmployerNo: dto.socsoEmployerNo ?? null,
        lhdnEmployerNo: dto.lhdnEmployerNo ?? null,
        hrdRegistrationNo: dto.hrdRegistrationNo ?? null,
        // NOT written from this form any more. See the refusal above.
        hrdCategory: null,
        hrdLevyRate: null,
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        postcode: dto.postcode ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        bankName: dto.bankName ?? null,
        /**
         * WRITE-ONLY. The account number is never sent back out of this
         * service (the reads carry presence and the last four), so the form
         * cannot prefill it — and an edit that does not mention the field
         * must keep the number, not clear it. Absent = unchanged; a value =
         * replaced; an explicit empty string = cleared on purpose.
         */
        bankAccountNo:
          dto.bankAccountNo === undefined ? (existing?.bankAccountNo ?? null) : dto.bankAccountNo || null,
        bankAccountName: dto.bankAccountName ?? null,
        active: dto.active ?? true,
      };

      const saved = existing
        ? await tx.legalEmployer.update({ where: { id: existing.id }, data })
        : await tx.legalEmployer.create({ data: { ...data, tenantId: currentTenantId() } });

      await recordAudit(tx, actor, {
        action: existing ? 'legalEmployer.updated' : 'legalEmployer.created',
        entityType: 'LegalEmployer',
        entityId: saved.id,
        reason: `${existing ? 'Updated' : 'Created'} legal employer ${saved.name}`,
        // Presence, not the number — an audit row is readable by more seats
        // than may see an account number, and "changed" is the fact it needs.
        ...(existing
          ? {
              before: { ...existing, bankAccountNo: existing.bankAccountNo ? `on file (…${existing.bankAccountNo.slice(-4)})` : null },
              after: { ...saved, bankAccountNo: saved.bankAccountNo ? `on file (…${saved.bankAccountNo.slice(-4)})` : null },
            }
          : { after: { ...saved, bankAccountNo: saved.bankAccountNo ? `on file (…${saved.bankAccountNo.slice(-4)})` : null } }),
      });

      const { bankAccountNo: savedAccount, ...safeSaved } = saved;
      return {
        ...safeSaved,
        bankAccountOnFile: Boolean(savedAccount),
        bankAccountLastFour: savedAccount ? savedAccount.slice(-4) : null,
      };
    });
  }

  /**
   * Move an employee to an employer.
   *
   * REFUSED once the employee appears on an APPROVED run: their statutory
   * contributions have already been reported under the employer that was on the
   * run, and changing the profile afterwards would make the submission and the
   * record disagree with nobody able to tell which is right.
   */
  async assignEmployee(staffId: string, legalEmployerId: string | null) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      if (legalEmployerId) {
        const employer = await tx.legalEmployer.findFirst({ where: { id: legalEmployerId } });
        if (!employer) throw new NotFoundException('Legal employer not found');
        if (!employer.active) {
          throw new BadRequestException('That legal employer is archived. Reactivate it, or choose another.');
        }
      }

      if (profile.legalEmployerId && profile.legalEmployerId !== legalEmployerId) {
        const approved = await tx.payrollLine.count({
          where: { staffId, payrollRun: { status: { in: ['APPROVED', 'PAID'] } } },
        });
        if (approved > 0) {
          throw new ConflictException(
            `This employee appears on ${approved} approved payroll line(s) under their current employer. ` +
              'Moving them now would leave those submissions naming an employer the record no longer agrees with. ' +
              'Record the change from the start of a period that has not been approved.',
          );
        }
      }

      const saved = await tx.employeeProfile.update({
        where: { id: profile.id },
        data: { legalEmployerId },
      });

      await recordAudit(tx, actor, {
        action: 'employee.employerAssigned',
        entityType: 'EmployeeProfile',
        entityId: profile.id,
        reason: legalEmployerId
          ? `Assigned employee to legal employer ${legalEmployerId}`
          : 'Removed the employee from their legal employer',
        before: { legalEmployerId: profile.legalEmployerId },
        after: { legalEmployerId: saved.legalEmployerId },
      });

      return saved;
    });
  }
}
