import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { currentTenantId } from '../core/tenant-context';
import { SnapshotPayload, verifySnapshot } from './payroll-snapshot';

const SCHEMES = ['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'PCB', 'HRD'] as const;
export type OutputScheme = (typeof SCHEMES)[number];

/**
 * STATUTORY OUTPUTS — prepared and reconciled, never submitted.
 *
 * Everything here is a projection of the approved, verified snapshot: the
 * per-employee contributions each authority is owed for the month, beside the
 * employer's own registration identity and the schedule edition that produced
 * every figure. The boundary stands: CALCULATE → PREPARE → VALIDATE → EXPORT
 * → RECONCILE. No verified file format for any authority's upload is on
 * record, so what downloads is a LISTING for keying or cross-checking at the
 * authority's portal — labelled as such — and "submitted" exists in this
 * product only as a human's recorded statement that they filed it, with the
 * date and the reference the portal gave them.
 */
@Injectable()
export class PayrollStatutoryOutputService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async outputs(runId: string) {
    // Audited like the CSV listing: the JSON view carries the same
    // per-employee identifiers and amounts, and an exit that skips the trail
    // because of its content type is not a trail.
    return withAdminTx(this.rawPrisma, 'hr.payroll.export.statutory', async (tx, actor) => {
      const composed = await this.compose(runId);
      await recordAudit(tx, actor, {
        action: 'payrollStatutory.outputsViewed',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { schemes: composed.view.schemes.map((row) => row.scheme) },
        source: 'hr.payroll',
      });
      return composed.view;
    });
  }

  /** One scheme's rows as CSV — a listing, not any authority's file format. */
  async listing(runId: string, scheme: string) {
    const upper = scheme.toUpperCase() as OutputScheme;
    if (!SCHEMES.includes(upper)) {
      throw new NotFoundException(`No statutory output exists for "${scheme}".`);
    }
    return withAdminTx(this.rawPrisma, 'hr.payroll.export.statutory', async (tx, actor) => {
      const composed = await this.compose(runId);
      const block = composed.view.schemes.find((row) => row.scheme === upper);
      if (!block) throw new NotFoundException(`No ${upper} output on this run.`);

      await recordAudit(tx, actor, {
        action: 'payrollStatutory.listingDownloaded',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { scheme: upper, totalCents: block.totalCents, employees: block.rows.length },
        source: 'hr.payroll',
      });

      const escape = (value: string | null) =>
        value === null ? '' : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      const rows = [
        // `basis_note` is empty for everybody whose wages column is Kuwick's
        // own assessment, and states the difference for anybody whose employer
        // selected a lower EPF basis — so the person keying this into the
        // portal can see which figures are a decision rather than a reading.
        ['employee', 'identifier', 'membership_no', 'wages_rm', 'employee_rm', 'employer_rm', 'basis_note'].join(','),
        ...block.rows.map((row) =>
          [
            escape(row.name),
            escape(row.identifier),
            escape(row.membershipNo),
            row.wagesCents === null ? '' : (row.wagesCents / 100).toFixed(2),
            row.employeeCents === null ? '' : (row.employeeCents / 100).toFixed(2),
            row.employerCents === null ? '' : (row.employerCents / 100).toFixed(2),
            escape(row.basisNote),
          ].join(','),
        ),
        // A file whose rows include "not calculated" must not print a smaller
        // TOTAL as though it were the whole one — the reader is keying this
        // into an authority's portal.
        block.employeeTotalCents === null || block.employerTotalCents === null
          ? [
              'TOTAL',
              '',
              '',
              '',
              `NOT CALCULABLE — ${block.notComputed} employee(s) not calculated`,
              '',
              '',
            ].join(',')
          : [
              'TOTAL',
              '',
              '',
              '',
              (block.employeeTotalCents / 100).toFixed(2),
              (block.employerTotalCents / 100).toFixed(2),
              '',
            ].join(','),
      ];
      return {
        fileName: `${upper.toLowerCase()}-listing-${composed.view.period}.csv`,
        content:
          `# ${upper} contribution listing — ${composed.view.period}, ${composed.view.employerName ?? ''} ` +
          `(from approved record ${composed.snapshotHash.slice(0, 16)}…). This is NOT a submission file: no ` +
          `authority upload format is on record. Use it to key or cross-check the filing at the authority's own portal, ` +
          'then record the submission in Kuwick with its reference.\n' +
          rows.join('\n'),
      };
    });
  }

  /**
   * A human records that the filing was made. The only path to "submitted",
   * and it wants the two facts a later inspection asks for: when, and the
   * reference the authority's portal issued.
   */
  async recordSubmission(
    runId: string,
    scheme: string,
    body: { submittedDate: string; reference: string; note?: string },
  ) {
    const upper = scheme.toUpperCase() as OutputScheme;
    if (!SCHEMES.includes(upper)) {
      throw new NotFoundException(`No statutory output exists for "${scheme}".`);
    }
    await withAdminTx(this.rawPrisma, 'hr.payroll.export.statutory', async (tx, actor) => {
      // Validated INSIDE the permission boundary: an unauthorised caller gets
      // the 403 the permission owes them, not a validation hint.
      if (!body.reference || body.reference.trim().length < 3) {
        throw new ConflictException('Recording a submission needs the reference the authority’s portal issued.');
      }
      if (!body.submittedDate || Number.isNaN(new Date(body.submittedDate).getTime())) {
        throw new ConflictException('Recording a submission needs the date it was filed.');
      }
      const composed = await this.compose(runId);
      const existing = await tx.payrollStatutorySubmission.findFirst({
        where: { payrollRunId: runId, scheme: upper },
      });
      if (existing) {
        throw new ConflictException(
          `A ${upper} submission is already recorded for this run (${existing.reference}, ` +
            `${existing.submittedDate.toISOString().slice(0, 10)}). A filing is recorded once; add corrections at ` +
            'the authority, not as a second claim here.',
        );
      }
      const created = await tx.payrollStatutorySubmission.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          scheme: upper,
          snapshotVersion: composed.snapshotVersion,
          snapshotHash: composed.snapshotHash,
          submittedDate: new Date(`${body.submittedDate}T00:00:00.000Z`),
          reference: body.reference.trim(),
          note: body.note?.trim() || null,
          recordedByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'payrollStatutory.submissionRecorded',
        entityType: 'PayrollStatutorySubmission',
        entityId: created.id,
        after: { runId, scheme: upper, submittedDate: body.submittedDate, reference: body.reference.trim() },
        source: 'hr.payroll',
      });
    });
    return this.outputs(runId);
  }

  // -------------------------------------------------------------------------

  /**
   * The prepared month: per scheme, from the verified snapshot. Public so the
   * filing helper can regroup the SAME figures per agency rather than
   * computing a second set; it is not a route, and it writes no audit — the
   * caller that shows or files the figures does.
   */
  async compose(runId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { legalEmployer: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
      throw new ConflictException(
        `Statutory outputs are prepared from an APPROVED run. This one is ${run.status} — nothing unapproved is ` +
          'worth filing.',
      );
    }
    const snapshot = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
    });
    if (!snapshot) throw new ConflictException('This run has no approved record.');
    const payload = snapshot.payload as unknown as SnapshotPayload;
    const verification = verifySnapshot(payload, snapshot.hash);
    if (verification.verdict !== 'VERIFIED') {
      throw new ConflictException(
        `No statutory output can be prepared: the approved record's verification verdict is ${verification.verdict}. ` +
          verification.reason,
      );
    }

    const staffIds = payload.employees.map((employee) => employee.staffId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { staffId: { in: staffIds } },
      select: {
        staffId: true,
        epfNumber: true,
        socsoNumber: true,
        taxNumber: true,
        identifierType: true,
        identifierValue: true,
      },
    });
    const profileByStaff = new Map(profiles.map((profile) => [profile.staffId, profile]));
    const submissions = await this.prisma.payrollStatutorySubmission.findMany({
      where: { payrollRunId: runId },
      include: { recordedBy: { select: { fullName: true } } },
    });
    const submissionByScheme = new Map(submissions.map((row) => [row.scheme, row]));

    const scheduleFor = (scheme: string) =>
      payload.statutory?.schedules.find((schedule) => schedule.scheme === scheme) ?? null;

    interface OutputRow {
      staffId: string;
      name: string;
      identifier: string | null;
      membershipNo: string | null;
      wagesCents: number | null;
      employeeCents: number | null;
      employerCents: number | null;
      note: string | null;
      /**
       * EPF only: set where the employer SELECTED a contribution basis below
       * Kuwick's assessment, so the person keying this listing into KWSP can
       * see whose wages column is a deliberate selection rather than the
       * assessed figure. Deliberately NOT the `note` field above — that one
       * counts rows the run could not calculate, and a selected basis IS
       * calculated.
       */
      basisNote: string | null;
    }

    /**
     * Whose EPF wages column is an employer SELECTION rather than Kuwick's
     * assessment — read from the frozen snapshot, never recomputed, so the
     * listing says the same thing years later that the approved month did.
     */
    const basisNoteFor = (scheme: OutputScheme, line: SnapshotPayload['employees'][number]): string | null => {
      if (scheme !== 'EPF') return null;
      const basis = line.payslip?.epfBasis;
      if (!basis || basis.excluded.length === 0) return null;
      const assessed = (basis.assessedEpfCents / 100).toFixed(2);
      const applied = (basis.appliedEpfCents / 100).toFixed(2);
      const difference = ((basis.assessedEpfCents - basis.appliedEpfCents) / 100).toFixed(2);
      return (
        `Employer-selected basis RM${applied}; Kuwick assesses RM${assessed} (difference RM${difference}, ` +
        `excluding ${basis.excluded.map((row) => row.label).join(', ')}).`
      );
    };

    const buildScheme = (
      scheme: OutputScheme,
      pick: (line: SnapshotPayload['employees'][number]) => {
        wages: number | null;
        employee: number | null;
        employer: number | null;
      },
      membership: (profile: { epfNumber: string | null; socsoNumber: string | null; taxNumber: string | null } | undefined) =>
        string | null,
    ) => {
      const rows: OutputRow[] = payload.employees.map((line) => {
        const profile = profileByStaff.get(line.staffId);
        const picked = pick(line);
        return {
          staffId: line.staffId,
          name: line.name,
          identifier: profile?.identifierValue ?? null,
          membershipNo: membership(profile),
          wagesCents: picked.wages,
          employeeCents: picked.employee,
          employerCents: picked.employer,
          note:
            picked.employee === null && picked.employer === null
              ? 'Not calculated for this employee — see the run’s exceptions.'
              : null,
          basisNote: basisNoteFor(scheme, line),
        };
      });
      // Rows where the scheme genuinely takes nothing (0/0) stay visible: an
      // authority reconciles headcount as well as ringgit.
      //
      // A total over rows the run could not calculate is NOT a smaller total —
      // it is no total. Summing `?? 0` here printed an understated TOTAL line
      // on the very document a clinic keys into an authority's portal, while
      // the row's own note said "not calculated". Null survives instead, the
      // same rule the reports and the finance contract already follow.
      const notComputedRows = rows.filter((row) => row.note !== null).length;
      const employeeTotalCents =
        notComputedRows > 0 ? null : rows.reduce((sum, row) => sum + (row.employeeCents ?? 0), 0);
      const employerTotalCents =
        notComputedRows > 0 ? null : rows.reduce((sum, row) => sum + (row.employerCents ?? 0), 0);
      const submission = submissionByScheme.get(scheme);
      // The stamp records the levy under the registry's own scheme name.
      const schedule = scheduleFor(scheme === 'HRD' ? 'HRD_LEVY' : scheme);
      return {
        scheme,
        rows,
        employeeTotalCents,
        employerTotalCents,
        totalCents:
          employeeTotalCents === null || employerTotalCents === null
            ? null
            : employeeTotalCents + employerTotalCents,
        notComputed: notComputedRows,
        schedule: schedule
          ? {
              scheduleId: schedule.scheduleId,
              verification: schedule.verification,
              document: schedule.document,
            }
          : null,
        submission: submission
          ? {
              submittedDate: submission.submittedDate.toISOString().slice(0, 10),
              reference: submission.reference,
              recordedBy: submission.recordedBy.fullName,
              recordedAt: submission.createdAt.toISOString(),
              note: submission.note,
            }
          : null,
      };
    };

    const schemes = [
      buildScheme(
        'EPF',
        (line) => ({
          wages: line.bases.epfCents,
          employee: line.statutory.epfEmployeeCents,
          employer: line.statutory.epfEmployerCents,
        }),
        (profile) => profile?.epfNumber ?? null,
      ),
      buildScheme(
        'SOCSO',
        (line) => ({
          wages: line.bases.socsoCents,
          employee: line.statutory.socsoEmployeeCents,
          employer: line.statutory.socsoEmployerCents,
        }),
        (profile) => profile?.socsoNumber ?? null,
      ),
      buildScheme(
        'EIS',
        (line) => ({
          wages: line.bases.eisCents,
          employee: line.statutory.eisEmployeeCents,
          employer: line.statutory.eisEmployerCents,
        }),
        (profile) => profile?.socsoNumber ?? null,
      ),
      buildScheme(
        'LINDUNG',
        (line) => ({
          wages: line.bases.socsoCents,
          employee: line.statutory.lindungEmployeeCents,
          employer: line.statutory.lindungEmployeeCents === null ? null : 0,
        }),
        (profile) => profile?.socsoNumber ?? null,
      ),
      buildScheme(
        'PCB',
        (line) => ({
          wages: null,
          employee: line.statutory.pcbCents,
          employer: line.statutory.pcbCents === null ? null : 0,
        }),
        (profile) => profile?.taxNumber ?? null,
      ),
      buildScheme(
        'HRD',
        (line) => ({
          wages: null,
          employee: line.statutory.hrdLevyCents === undefined ? null : line.statutory.hrdLevyCents === null ? null : 0,
          employer: line.statutory.hrdLevyCents ?? null,
        }),
        () => null,
      ),
    ];

    const view = {
      runId,
      period: payload.period.slice(0, 7),
      employerName: payload.legalEmployerName,
      employerIdentity: {
        registrationNo: run.legalEmployer?.registrationNo ?? null,
        epfEmployerNo: run.legalEmployer?.epfEmployerNo ?? null,
        socsoEmployerNo: run.legalEmployer?.socsoEmployerNo ?? null,
        lhdnEmployerNo: run.legalEmployer?.lhdnEmployerNo ?? null,
        hrdRegistrationNo: run.legalEmployer?.hrdRegistrationNo ?? null,
        detailsAsAt: 'CURRENT' as const,
      },
      snapshotVersion: snapshot.version,
      snapshotHash: snapshot.hash,
      notASubmission:
        'These are the amounts the approved payroll owes each authority, prepared for filing at the authority’s own ' +
        'portal. Kuwick submits nothing: a scheme reads as submitted only when a person records the filing here, ' +
        'with its date and reference.',
      schemes,
    };
    return {
      view,
      snapshotVersion: snapshot.version,
      snapshotHash: snapshot.hash,
      payload,
      identifierOf: (staffId: string) => profileByStaff.get(staffId)?.identifierValue ?? null,
    };
  }
}
