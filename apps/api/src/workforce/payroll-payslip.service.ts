import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import {
  SnapshotEmployeeLine,
  SnapshotPayload,
  verifySnapshot,
} from './payroll-snapshot';

/**
 * THE PAYSLIP, FROM THE APPROVED SNAPSHOT AND NOWHERE ELSE.
 *
 * A written statement of wages is a statutory record (Employment Act 1955
 * s.19). The one place its figures can safely come from is the immutable,
 * hashed snapshot the approval wrote — because a reopen REWRITES the run's
 * lines while that snapshot stands, and a payslip drawn from the lines at
 * that moment would show candidate figures under an approved letterhead.
 *
 * Three refusals, each preferable to the document it prevents:
 *  - no approved snapshot → no payslip (the web offers a watermarked DRAFT
 *    from the live run instead, which says what it is);
 *  - a snapshot that does not verify (TAMPERED / INCONSISTENT /
 *    UNVERIFIABLE_SCHEMA) → no payslip, with the verdict, because a statutory
 *    document must not be issued from a record that cannot be proven;
 *  - an employee the approved run did not pay → no payslip for them.
 *
 * What is NOT frozen is labelled. Statutory membership NUMBERS are identity
 * corrections, not dated state (a March filing wants the correct number, not
 * the typo that was on file in March), so they are read from the current
 * profile and the payload says `identifiersAsAt: 'CURRENT'`. The employer's
 * ADDRESS is likewise current master data — its effective dating is a tracked
 * gap — and is labelled the same way. Every FIGURE is the snapshot's.
 */
@Injectable()
export class PayrollPayslipService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The payslips an approved run can issue — one row per paid employee. */
  async list(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const { run, snapshot, payload } = await this.loadApproved(runId, undefined);
    const verification = verifySnapshot(payload, snapshot.hash);
    if (verification.verdict !== 'VERIFIED') {
      throw new ConflictException(this.verdictRefusal(verification.verdict, verification.reason));
    }
    return {
      runId,
      period: payload.period.slice(0, 7),
      snapshotVersion: snapshot.version,
      versions: run.snapshotCount,
      verdict: verification.verdict,
      reopenedSinceApproval: run.status === 'CALCULATED' || run.status === 'DRAFT',
      payslips: payload.employees.map((line) => ({
        staffId: line.staffId,
        name: line.name,
        netCents: line.netCents,
        grossCents: line.bases.grossCents,
        itemised: Boolean(line.payslip),
      })),
    };
  }

  /** One employee's payslip dataset, composed entirely from the snapshot. */
  async payslip(runId: string, staffId: string, version?: number) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return this.compose(runId, staffId, version);
  }

  /**
   * The same dataset, fetched for a PDF download — audited, because a payslip
   * leaving the system is an event with a who and a when, and reprints of a
   * corrected run must be attributable.
   */
  async payslipForDownload(runId: string, staffId: string, version?: number) {
    const data = await withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      const composed = await this.compose(runId, staffId, version);
      await recordAudit(tx, actor, {
        action: 'payrollPayslip.downloaded',
        entityType: 'PayrollRun',
        entityId: runId,
        after: {
          staffId,
          snapshotVersion: composed.revision.version,
          net: composed.figures.netCents,
        },
        source: 'hr.payroll',
      });
      return composed;
    });
    return data;
  }

  // -------------------------------------------------------------------------

  private verdictRefusal(verdict: string, reason: string): string {
    return (
      `No payslip can be issued from this record: its verification verdict is ${verdict}. ${reason} ` +
      'A statutory statement of wages must come from a record that can be proven to be what was approved.'
    );
  }

  private async loadApproved(runId: string, version: number | undefined) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        legalEmployer: true,
        approvals: { orderBy: { sequence: 'asc' }, include: { staff: { select: { fullName: true } } } },
        _count: { select: { snapshots: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run._count.snapshots === 0) {
      throw new ConflictException(
        'This run has never been approved, so there is no frozen record to issue a payslip from. ' +
          'A draft can be previewed from the run itself — watermarked as a draft, because it is one.',
      );
    }
    const snapshot = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId, ...(version ? { version } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!snapshot) throw new NotFoundException(`This run has no snapshot version ${version}.`);
    const payload = snapshot.payload as unknown as SnapshotPayload;
    return { run: { ...run, snapshotCount: run._count.snapshots }, snapshot, payload };
  }

  private async compose(runId: string, staffId: string, version?: number) {
    const { run, snapshot, payload } = await this.loadApproved(runId, version);

    const verification = verifySnapshot(payload, snapshot.hash);
    if (verification.verdict !== 'VERIFIED') {
      throw new ConflictException(this.verdictRefusal(verification.verdict, verification.reason));
    }

    const line = payload.employees.find((employee) => employee.staffId === staffId);
    if (!line) {
      throw new NotFoundException(
        'The approved record of this run does not include this employee, so there is no payslip to issue for them.',
      );
    }

    // Identity that is corrected rather than dated: membership numbers from
    // the CURRENT profile, labelled as such.
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { staffId },
      select: { epfNumber: true, socsoNumber: true, taxNumber: true },
    });

    // Year to date THROUGH the payslip's own month, from the table approval
    // writes — imported opening months included and said so.
    const periodDate = new Date(`${payload.period.slice(0, 10)}T00:00:00.000Z`);
    const taxYear = periodDate.getUTCFullYear();
    const month = periodDate.getUTCMonth() + 1;
    const ytdRows = await this.prisma.employeeYtd.findMany({
      where: { staffId, taxYear, month: { lte: month } },
      orderBy: { month: 'asc' },
    });
    const sumYtd = (pick: (row: (typeof ytdRows)[number]) => number) =>
      ytdRows.reduce((total, row) => total + pick(row), 0);
    const ytd =
      ytdRows.length === 0
        ? null
        : {
            months: ytdRows.length,
            importedMonths: ytdRows.filter((row) => row.source === 'OPENING_IMPORT').length,
            grossCents: sumYtd((row) => row.grossCents),
            epfEmployeeCents: sumYtd((row) => row.epfEmployeeCents),
            socsoEmployeeCents: sumYtd((row) => row.socsoEmployeeCents),
            eisEmployeeCents: sumYtd((row) => row.eisEmployeeCents),
            lindungEmployeeCents: sumYtd((row) => row.lindungEmployeeCents),
            pcbCents: sumYtd((row) => row.pcbCents),
            zakatCents: sumYtd((row) => row.zakatCents),
          };

    const classification = line.classification;
    const detail = line.payslip ?? null;
    const statutoryRows = this.statutoryRows(line);

    // THE SLIP CHECKS ITSELF, from the snapshot's own frozen figures: wages,
    // less everything withheld, must equal the net that was approved. The
    // snapshot was verified above with the run's own invariants, so a failure
    // here cannot happen quietly — but the payload still carries the check,
    // because the document renders it rather than asserting it.
    const derivedNetCents = line.bases.grossCents - line.deductionCents;

    return {
      runId,
      period: payload.period.slice(0, 7),
      periodLabel: periodDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      runType: payload.runType,
      sequence: payload.sequence,
      paymentDate: payload.paymentDate,
      runStatus: run.status,
      statutoryStatus: run.statutoryStatus,
      clinicName: run.clinic?.name ?? null,
      revision: {
        version: snapshot.version,
        of: run.snapshotCount,
        approvedAt: snapshot.createdAt.toISOString(),
        approvedBy: payload.approvals?.map((approval) => approval.name) ?? [],
        /** An older version than the latest is a superseded payslip. */
        superseded: snapshot.version < run.snapshotCount,
        /** Approved, then reopened: a corrected version may follow. */
        reopenedSinceApproval: run.status !== 'APPROVED' && run.status !== 'PAID',
      },
      verification: {
        verdict: verification.verdict,
        hash: snapshot.hash,
        schemaVersion: verification.schemaVersion,
      },
      employer: {
        /** The name as approved — frozen in the snapshot. */
        name: payload.legalEmployerName,
        registrationNo: run.legalEmployer?.registrationNo ?? null,
        epfEmployerNo: run.legalEmployer?.epfEmployerNo ?? null,
        socsoEmployerNo: run.legalEmployer?.socsoEmployerNo ?? null,
        lhdnEmployerNo: run.legalEmployer?.lhdnEmployerNo ?? null,
        addressLines: [
          run.legalEmployer?.addressLine1,
          run.legalEmployer?.addressLine2,
          [run.legalEmployer?.postcode, run.legalEmployer?.city].filter(Boolean).join(' ') || null,
          run.legalEmployer?.state,
        ].filter((value): value is string => Boolean(value)),
        /** Address and registrations are today's master data, not frozen. */
        detailsAsAt: 'CURRENT' as const,
      },
      employee: {
        staffId: line.staffId,
        name: line.name,
        employeeNo: detail?.employeeNo ?? null,
        position: detail?.position ?? null,
        department: detail?.department ?? null,
        employmentType: detail?.employmentType ?? null,
        bankName: detail?.bankName ?? null,
        epfNumber: profile?.epfNumber ?? null,
        socsoNumber: profile?.socsoNumber ?? null,
        taxNumber: profile?.taxNumber ?? null,
        identifiersAsAt: 'CURRENT' as const,
      },
      attendance: detail
        ? { workedDays: detail.workedDays, unpaidDays: detail.unpaidDays, overtimeHours: detail.overtimeHours }
        : null,
      /**
       * Version 3 snapshots itemise; a version-2 snapshot froze every figure
       * but not the line items, and its payslip says so instead of borrowing
       * rows from the run.
       */
      itemised: Boolean(detail),
      earnings: detail
        ? detail.componentLines
            .filter((row) => row.kind === 'EARNING')
            .map((row) => ({ code: row.code, label: row.label, amountCents: row.amountCents }))
        : null,
      wageReductions: detail
        ? detail.componentLines
            .filter((row) => row.kind === 'WAGE_REDUCTION')
            .map((row) => ({ code: row.code, label: row.label, amountCents: row.amountCents }))
        : null,
      otherDeductionLines: detail
        ? detail.componentLines
            .filter((row) => row.kind === 'DEDUCTION')
            .map((row) => ({ code: row.code, label: row.label, amountCents: row.amountCents }))
        : null,
      overtimeDetail: detail?.overtime ?? null,
      statutoryDeductions: statutoryRows.employee,
      employerContributions: statutoryRows.employer,
      figures: {
        salaryBasis: line.salaryBasis,
        salaryAmountCents: line.salaryAmountCents,
        grossCents: line.bases.grossCents,
        deductionCents: line.deductionCents,
        netCents: line.netCents,
        employerContributionCents: line.employerContributionCents,
        employerCostCents: line.employerCostCents,
        derivedNetCents,
        adds: derivedNetCents === line.netCents,
      },
      bases: {
        epfCents: line.bases.epfCents,
        socsoCents: line.bases.socsoCents,
        eisCents: line.bases.eisCents,
      },
      statutoryNotes: detail?.statutoryNotes ?? null,
      classification: classification
        ? {
            epfMembership: classification.epfMembership,
            lindungParticipation: classification.lindungParticipation,
            taxResidence: classification.taxResidence,
            effectiveFrom: classification.effectiveFrom,
          }
        : null,
      /** The schedules the figures came from, editions and hashes included. */
      schedules:
        payload.statutory?.schedules.map((schedule) => ({
          scheme: schedule.scheme,
          scheduleId: schedule.scheduleId,
          verification: schedule.verification,
          document: schedule.document,
        })) ?? [],
      ytd,
    };
  }

  /**
   * The statutory lines as a payslip must show them: amount, or the reason
   * there is none — never a zero standing in for unknown — and "not
   * applicable" (a fact about the employee) kept apart from "not calculated"
   * (a fact about the system).
   */
  private statutoryRows(line: SnapshotEmployeeLine) {
    const classification = line.classification;
    const applicable = {
      epf: classification?.epfApplicable !== false,
      socso: classification?.socsoApplicable !== false,
      eis: classification?.eisApplicable !== false,
      pcb: classification?.pcbApplicable !== false,
      lindung: classification?.lindungParticipation !== 'NOT_PARTICIPATING',
    };
    const notes = line.payslip?.statutoryNotes;
    const employee = [
      { key: 'EPF', label: 'EPF (employee)', amountCents: line.statutory.epfEmployeeCents, applicable: applicable.epf, note: notes?.epf ?? null },
      { key: 'SOCSO', label: 'SOCSO (employee)', amountCents: line.statutory.socsoEmployeeCents, applicable: applicable.socso, note: notes?.socso ?? null },
      { key: 'EIS', label: 'EIS (employee)', amountCents: line.statutory.eisEmployeeCents, applicable: applicable.eis, note: notes?.eis ?? null },
      {
        key: 'LINDUNG',
        label: 'LINDUNG 24 JAM',
        amountCents: line.statutory.lindungEmployeeCents,
        applicable: applicable.lindung,
        note: notes?.lindung ?? null,
      },
      { key: 'PCB', label: 'PCB / MTD', amountCents: line.statutory.pcbCents, applicable: applicable.pcb, note: notes?.pcb ?? null },
    ];
    const employer = [
      { key: 'EPF', label: 'EPF (employer)', amountCents: line.statutory.epfEmployerCents },
      { key: 'SOCSO', label: 'SOCSO (employer)', amountCents: line.statutory.socsoEmployerCents },
      { key: 'EIS', label: 'EIS (employer)', amountCents: line.statutory.eisEmployerCents },
      // Only where the snapshot recorded it (version 3+) and it is real money:
      // a nil levy row on every slip of an unregistered clinic is noise, and a
      // pre-levy snapshot has nothing truthful to print here.
      ...(line.statutory.hrdLevyCents !== undefined &&
      line.statutory.hrdLevyCents !== null &&
      line.statutory.hrdLevyCents > 0
        ? [{ key: 'HRD', label: 'HRD Corp levy (employer)', amountCents: line.statutory.hrdLevyCents }]
        : []),
    ];
    return { employee, employer };
  }
}

export type PayslipData = Awaited<ReturnType<PayrollPayslipService['payslip']>>;
