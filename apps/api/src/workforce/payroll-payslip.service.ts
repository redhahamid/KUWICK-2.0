import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { payslipReleased } from './payslip-release';
import { chosenPayDate, payDateChoicesOf, paymentsOnChosenDates } from './pay-dates';
import { compareByEmployeeName } from './employee-order';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { PayrollService } from './payroll.service';
import { snapshotHash } from './payroll-snapshot';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';
import { ringgitInWords } from '../finance/money-words';
import {
  SnapshotEmployeeLine,
  SnapshotEmployer,
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
    private readonly payroll: PayrollService,
  ) {}

  /*
   * THE PAYSLIP PREVIEW (UAT, 14 October 2026): every payslip of a month on
   * screen, as the PDF prints it. An approved month shows its approved
   * record; a month not yet approved shows what approving now would freeze,
   * watermarked DRAFT. Nothing here changes a figure.
   */

  /** The month as a draft: the payload approval would freeze, unsaved. */
  private async loadDraft(runId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        legalEmployer: true,
        approvals: { orderBy: { sequence: 'asc' }, include: { staff: { select: { fullName: true } } } },
        createdBy: { select: { id: true, fullName: true, employeeProfile: { select: { position: true } } } },
        approvedBy: { select: { id: true, fullName: true, employeeProfile: { select: { position: true } } } },
        _count: { select: { snapshots: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const payload = await this.payroll.draftPayload(runId);
    const snapshot = { version: 0, hash: snapshotHash(payload), createdAt: new Date(), payload };
    return { run: { ...run, snapshotCount: run._count.snapshots }, snapshot, payload };
  }

  private async isDraft(runId: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run.status !== 'APPROVED' && run.status !== 'PAID';
  }

  /** Who is in the preview, in payslip order, with whether each was checked at today's figures. */
  async previewList(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const draft = await this.isDraft(runId);
    const { snapshot, payload } = draft ? await this.loadDraft(runId) : await this.loadApproved(runId, undefined);
    const checks = await this.prisma.payrollPayslipCheck.findMany({
      where: { payrollRunId: runId },
      include: { checkedBy: { select: { fullName: true } } },
    });
    const checkOf = new Map(checks.map((row) => [row.staffId, row]));
    const numbers = new Map(
      (
        await this.prisma.employeeProfile.findMany({
          where: { staffId: { in: payload.employees.map((line) => line.staffId) } },
          select: { staffId: true, employeeNo: true },
        })
      ).map((row) => [row.staffId, row.employeeNo]),
    );
    const payslips = payload.employees
      .map((line) => {
        const check = checkOf.get(line.staffId);
        const same = check ? check.grossCents === line.bases.grossCents && check.netCents === line.netCents : false;
        return {
          staffId: line.staffId,
          name: line.name,
          employeeNo: numbers.get(line.staffId) ?? null,
          netCents: line.netCents,
          checked: check && same ? { by: check.checkedBy.fullName, at: check.checkedAt.toISOString() } : null,
          // Checked, then the figures moved: looked at, but not at these figures.
          changedSinceCheck: Boolean(check && !same),
        };
      })
      .sort(compareByEmployeeName);
    return {
      runId,
      period: payload.period.slice(0, 7),
      draft,
      revision: draft ? null : snapshot.version,
      payslips,
      checked: payslips.filter((row) => row.checked).length,
      total: payslips.length,
    };
  }

  /** One payslip for the preview: the approved one, or the draft. Audited as viewed. */
  async previewOne(runId: string, staffId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      const draft = await this.isDraft(runId);
      const composed = await this.compose(runId, staffId, undefined, draft);
      await recordAudit(tx, actor, {
        action: 'payrollPayslip.viewed',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { staffId, snapshotVersion: composed.revision.version, draft, preview: true },
        source: 'hr.payroll',
      });
      return composed;
    });
  }

  /** Every payslip of the month, for one combined PDF. Audited once. */
  async previewAll(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      const draft = await this.isDraft(runId);
      const list = await this.previewList(runId);
      const slips = [];
      for (const row of list.payslips) slips.push(await this.compose(runId, row.staffId, undefined, draft));
      await recordAudit(tx, actor, {
        action: 'payrollPayslip.downloaded',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { all: true, count: slips.length, draft, snapshotVersion: list.revision },
        source: 'hr.payroll',
      });
      return { period: list.period, draft, slips };
    });
  }

  /** "Mark as checked", at the figures the payslip shows now; false clears it. */
  async markChecked(runId: string, staffId: string, checked: boolean) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      if (!actorCan(actor, 'hr.payroll.run') && !actorCan(actor, 'hr.payroll.approve')) {
        throw new ForbiddenException('Only somebody who runs or approves payroll can mark a payslip as checked.');
      }
      if (!checked) {
        await tx.payrollPayslipCheck.deleteMany({ where: { payrollRunId: runId, staffId } });
        return { staffId, checked: null };
      }
      const draft = await this.isDraft(runId);
      const { payload } = draft ? await this.loadDraft(runId) : await this.loadApproved(runId, undefined);
      const line = payload.employees.find((employee) => employee.staffId === staffId);
      if (!line) throw new NotFoundException('That person has no payslip this month.');
      const saved = await tx.payrollPayslipCheck.upsert({
        where: { payrollRunId_staffId: { payrollRunId: runId, staffId } },
        create: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          staffId,
          grossCents: line.bases.grossCents,
          netCents: line.netCents,
          checkedByStaffId: actor.id,
        },
        update: { grossCents: line.bases.grossCents, netCents: line.netCents, checkedByStaffId: actor.id, checkedAt: new Date() },
      });
      return { staffId, checked: { by: actor.fullName, at: saved.checkedAt.toISOString() } };
    });
  }

  /**
   * THE EMPLOYER AS IT STOOD AT APPROVAL. A record approved since 12 October
   * 2026 carries it. An older one is rebuilt from the audit trail: the first
   * change to the employer after the approval holds, in its `before`, what
   * the employer said that day; with no change since, today's record is the
   * same thing. The name frozen with every record wins over either.
   */
  private async employerAsApproved(
    payload: SnapshotPayload,
    current: ({ id: string } & Partial<SnapshotEmployer>) | null,
    approvedAt: Date,
  ): Promise<SnapshotEmployer | null> {
    if (payload.legalEmployer) return payload.legalEmployer;
    if (!current) return null;
    const changes = await this.prisma.auditLog.findMany({
      where: { entityType: 'LegalEmployer', entityId: current.id, action: 'legalEmployer.updated', createdAt: { gt: approvedAt } },
      orderBy: { createdAt: 'asc' },
      select: { before: true },
    });
    const then =
      changes.map((row) => row.before as Partial<SnapshotEmployer> | null).find((before) => before !== null && 'name' in before) ?? current;
    const pick = (key: keyof SnapshotEmployer) => (then[key] as string | null | undefined) ?? null;
    return {
      name: payload.legalEmployerName ?? pick('name') ?? '',
      registrationNo: pick('registrationNo'),
      epfEmployerNo: pick('epfEmployerNo'),
      socsoEmployerNo: pick('socsoEmployerNo'),
      lhdnEmployerNo: pick('lhdnEmployerNo'),
      addressLine1: pick('addressLine1'),
      addressLine2: pick('addressLine2'),
      postcode: pick('postcode'),
      city: pick('city'),
      state: pick('state'),
    };
  }

  /**
   * A PERSON'S NAME AS IT STOOD AT APPROVAL, for a record approved before
   * names were frozen with it: the first rename after the approval holds the
   * name of that day in its `before`; with no rename since, today's name is it.
   */
  private async nameAsApproved(staffId: string, current: string, approvedAt: Date): Promise<string> {
    const renamed = await this.prisma.auditLog.findFirst({
      where: { entityType: 'Staff', entityId: staffId, action: 'staff.renamed', createdAt: { gt: approvedAt } },
      orderBy: { createdAt: 'asc' },
      select: { before: true },
    });
    const before = renamed?.before as { fullName?: unknown } | null | undefined;
    return typeof before?.fullName === 'string' ? before.fullName : current;
  }

  /** The employer's logo for the PDF, from a payslip already authorised; null prints the initial. */
  async logoBytes(mediaId: string | null): Promise<Buffer | null> {
    if (!mediaId) return null;
    const row = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, kind: 'EMPLOYER_LOGO' }, select: { data: true } });
    return row ? Buffer.from(row.data) : null;
  }

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
      // The one order every payroll list uses (employee-order.ts); the
      // snapshot itself keeps the order it was frozen in.
      payslips: payload.employees
        .map((line) => ({
          staffId: line.staffId,
          name: line.name,
          netCents: line.netCents,
          grossCents: line.bases.grossCents,
          itemised: Boolean(line.payslip),
        }))
        .sort(compareByEmployeeName),
    };
  }

  /**
   * One employee's payslip dataset, composed entirely from the snapshot.
   * Audited like the PDF: it is the same figures through a different door,
   * and a trail that records only one of two identical exits records neither.
   */
  async payslip(runId: string, staffId: string, version?: number) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx, actor) => {
      const composed = await this.compose(runId, staffId, version);
      await recordAudit(tx, actor, {
        action: 'payrollPayslip.viewed',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { staffId, snapshotVersion: composed.revision.version },
        source: 'hr.payroll',
      });
      return composed;
    });
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

  /**
   * THE EMPLOYEE'S OWN PAYSLIP, for the portal.
   *
   * No HR permission: the check is identity — the line must be theirs — and
   * the salary must have gone out (`payslip-release.ts`), because the portal
   * shows a payslip once the money has, not while a corrected revision may
   * still follow approval.
   * Audited like every other download, with the employee as the actor.
   */
  async payslipForSelf(runId: string, staffId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      if (actor.id !== staffId) throw new ForbiddenException('That payslip is not yours.');
      const run = await tx.payrollRun.findUnique({ where: { id: runId }, select: { status: true, paymentDate: true } });
      if (!run || !payslipReleased(run)) throw new NotFoundException('No payslip of yours for that month.');
      const line = await tx.payrollLine.findFirst({ where: { payrollRunId: runId, staffId }, select: { id: true } });
      if (!line) throw new NotFoundException('No payslip of yours for that month.');
      const composed = await this.compose(runId, staffId, undefined);
      await recordAudit(tx, actor, {
        action: 'payrollPayslip.downloaded',
        entityType: 'PayrollRun',
        entityId: runId,
        after: { staffId, snapshotVersion: composed.revision.version, net: composed.figures.netCents, self: true },
        source: 'me.payslips',
      });
      return composed;
    });
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
        // WHO PREPARED AND WHO APPROVED — the two signatures on the slip
        // (payslip.html): the person who ran the month and the person who
        // locked it, each with the position on their own employee record.
        createdBy: { select: { id: true, fullName: true, employeeProfile: { select: { position: true } } } },
        approvedBy: { select: { id: true, fullName: true, employeeProfile: { select: { position: true } } } },
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

  private async compose(runId: string, staffId: string, version?: number, draft = false) {
    const { run, snapshot, payload } = draft ? await this.loadDraft(runId) : await this.loadApproved(runId, version);

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
      // The identity number (NRIC or passport) is write-only on every screen
      // and appears here because the payslip is the employee's own document.
      select: { epfNumber: true, socsoNumber: true, taxNumber: true, identifierType: true, identifierValue: true, bankAccountNo: true },
    });
    // WHERE THE PAY WENT (UAT, 12 October 2026): the account on this run's own
    // transfer list, or today's record where no list was prepared. Only the
    // last four digits ever leave this method.
    const paymentLine = await this.prisma.payrollPaymentLine.findFirst({
      where: { staffId, included: true, batch: { payrollRunId: runId } },
      orderBy: { batch: { createdAt: 'desc' } },
      select: { bankName: true, bankAccountNo: true },
    });
    const accountNo = paymentLine?.bankAccountNo ?? profile?.bankAccountNo ?? null;

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

    const approvedEmployer = await this.employerAsApproved(payload, run.legalEmployer, snapshot.createdAt);
    // PREPARED AND APPROVED BY, named as they were at approval (owner, 12
    // October 2026): a rename shows only on months approved after it.
    const preparedName =
      payload.signatories?.preparedBy?.name ?? (await this.nameAsApproved(run.createdBy.id, run.createdBy.fullName, snapshot.createdAt));
    const approvedName = run.approvedBy
      ? (payload.signatories?.approvedBy?.name ?? (await this.nameAsApproved(run.approvedBy.id, run.approvedBy.fullName, snapshot.createdAt)))
      : null;

    const classification = line.classification;
    const detail = line.payslip ?? null;
    const statutoryRows = this.statutoryRows(line);

    // WHICH OF THE MONTH'S TRANSFERS HAVE GONE: a payment the payslip lists
    // says the day it was paid once that transfer is recorded, and the day it
    // is due until then.
    const recorded = await this.prisma.payrollPaymentBatch.findMany({
      where: { payrollRunId: runId, status: 'RECORDED_PAID' },
      select: { payDate: true, paymentDate: true },
    });
    // The owner's dates for this run, where a default date was moved on the Pay step.
    const choices = payDateChoicesOf(run.payDates);
    const paidOn = (date: string) =>
      recorded.find((batch) => batch.payDate === null || batch.payDate.toISOString().slice(0, 10) === date)?.paymentDate
        ?.toISOString()
        .slice(0, 10) ?? null;

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
      /** Not approved: what approving now would freeze, printed with a DRAFT watermark. */
      draft,
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
        superseded: !draft && snapshot.version < run.snapshotCount,
        /** Approved, then reopened: a corrected version may follow. A draft preview is the correction itself. */
        reopenedSinceApproval: !draft && run.status !== 'APPROVED' && run.status !== 'PAID',
      },
      verification: {
        verdict: verification.verdict,
        hash: snapshot.hash,
        schemaVersion: verification.schemaVersion,
      },
      employer: {
        /**
         * AS IT STOOD WHEN THE MONTH WAS APPROVED (owner, 12 October 2026:
         * "Payslips are historical documents"). Name, registration, statutory
         * numbers and address; only a month approved after a change shows the
         * new details. The logo is today's.
         */
        name: approvedEmployer?.name ?? payload.legalEmployerName,
        logoMediaId: run.legalEmployer?.logoMediaId ?? null,
        registrationNo: approvedEmployer?.registrationNo ?? null,
        epfEmployerNo: approvedEmployer?.epfEmployerNo ?? null,
        socsoEmployerNo: approvedEmployer?.socsoEmployerNo ?? null,
        lhdnEmployerNo: approvedEmployer?.lhdnEmployerNo ?? null,
        addressLines: addressAsRecorded(approvedEmployer),
        detailsAsAt: 'APPROVAL' as const,
      },
      employee: {
        staffId: line.staffId,
        name: line.name,
        employeeNo: detail?.employeeNo ?? null,
        position: detail?.position ?? null,
        department: detail?.department ?? null,
        employmentType: detail?.employmentType ?? null,
        bankName: paymentLine?.bankName ?? detail?.bankName ?? null,
        bankAccountLastFour: accountNo ? accountNo.replace(/\s+/g, '').slice(-4) : null,
        epfNumber: profile?.epfNumber ?? null,
        socsoNumber: profile?.socsoNumber ?? null,
        taxNumber: profile?.taxNumber ?? null,
        /** NRIC or passport, as on the record today. */
        identifier: profile?.identifierValue
          ? { type: profile.identifierType ?? 'NRIC', value: profile.identifierValue }
          : null,
        identifiersAsAt: 'CURRENT' as const,
      },
      /**
       * THE SIGNATURES (payslip.html): who prepared the month and who approved
       * it, with their positions and dates. Typed names in the signature box —
       * no signature image is on record. Prepared is the last calculation;
       * approved is the run's own approval, or the last of several.
       */
      preparedBy: {
        name: preparedName,
        position: run.createdBy.employeeProfile?.position ?? null,
        at: (run.calculatedAt ?? run.createdAt).toISOString(),
      },
      approvedBy: run.approvedBy
        ? {
            name: approvedName ?? run.approvedBy.fullName,
            position: run.approvedBy.employeeProfile?.position ?? null,
            at: (run.approvedAt ?? snapshot.createdAt).toISOString(),
          }
        : payload.approvals && payload.approvals.length > 0
          ? { name: payload.approvals[payload.approvals.length - 1].name, position: null, at: snapshot.createdAt.toISOString() }
          : null,
      /** When the money went out, if it has. */
      paidAt: run.paidAt?.toISOString() ?? null,
      netInWords: ringgitInWords(line.netCents),
      /** Employer cost, for the strip above the net; null where not worked out or recorded. */
      hrdLevyCents: line.statutory.hrdLevyCents ?? null,
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
            // The date each amount is paid on (version 4+); null on an older record.
            .map((row) => ({
              code: row.code,
              label: row.label,
              amountCents: row.amountCents,
              payDate: row.payDate ? chosenPayDate(choices, row.payDate) : null,
            }))
        : null,
      /**
       * WHAT IS PAID ON EACH DATE (version 4+), adding up to the net. One
       * entry for a month paid on one date; null on an older record.
       */
      payments: line.payments
        ? paymentsOnChosenDates(line.payments, choices).map((payment) => ({
            date: payment.date,
            amountCents: payment.netCents,
            paidOn: paidOn(payment.date),
          }))
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

/**
 * THE ADDRESS AS RECORDED, each part once (UAT, 12 October 2026: "no
 * repeated city"). The lines are printed as typed; the postcode, city and
 * state are added only where the lines above do not already say them.
 */
export function addressAsRecorded(
  employer: { addressLine1?: string | null; addressLine2?: string | null; postcode?: string | null; city?: string | null; state?: string | null } | null | undefined,
): string[] {
  if (!employer) return [];
  const lines = [employer.addressLine1, employer.addressLine2].map((line) => line?.trim()).filter((line): line is string => Boolean(line));
  const said = (part: string | null | undefined) => {
    const wanted = part?.trim().toLowerCase();
    return !wanted || lines.some((line) => line.toLowerCase().includes(wanted));
  };
  const place = [said(employer.postcode) ? null : employer.postcode?.trim(), said(employer.city) ? null : employer.city?.trim()].filter(Boolean).join(' ');
  if (place) lines.push(place);
  if (!said(employer.state)) lines.push(employer.state!.trim());
  return lines;
}
