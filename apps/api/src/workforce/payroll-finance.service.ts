import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from '../finance/admin-actor';
import { formatCents } from '../finance/money';
import { SnapshotPayload, verifySnapshot } from './payroll-snapshot';

/**
 * THE FINANCE CONTRACT — what payroll owes, certified, and nothing else.
 *
 * Finance needs three things from payroll every month: what is owed to
 * employees, what is owed to each statutory authority, and whether either has
 * actually been paid. It needs them WITHOUT holding an HR permission, and
 * without seeing a single person's pay — the boundary `hr.salary.view` draws
 * does not bend for the accounts department.
 *
 * So this endpoint is gated by `finance.view`, not `hr.*`, and serves
 * AGGREGATES ONLY, read from the APPROVED SNAPSHOT — the frozen record whose
 * hash is re-verified on every read. A run whose snapshot fails verification
 * has its figures WITHHELD, with the verdict, because handing Finance a total
 * from a record that no longer proves itself is how a wrong number gets a
 * journal entry.
 *
 * WHAT THIS DELIBERATELY IS NOT: an accounting treatment. No journal lines, no
 * accrual dates, no expense allocation — those are Finance's judgements, made
 * in Finance, from these canonical figures. A payroll module that posts its
 * own idea of the ledger is a second accounting system, and the two will
 * disagree in the month somebody finally reconciles them.
 */
@Injectable()
export class PayrollFinanceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async liabilities(year: number) {
    await requirePermission(this.rawPrisma, 'finance.view');
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        status: { in: ['APPROVED', 'PAID'] },
        period: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      include: {
        clinic: { select: { name: true } },
        legalEmployer: { select: { id: true, name: true } },
      },
      orderBy: [{ period: 'desc' }, { sequence: 'desc' }],
    });
    const runIds = runs.map((run) => run.id);
    const [snapshots, batches, submissions] = await Promise.all([
      this.prisma.payrollSnapshot.findMany({
        where: { payrollRunId: { in: runIds } },
        orderBy: { version: 'desc' },
      }),
      this.prisma.payrollPaymentBatch.findMany({ where: { payrollRunId: { in: runIds } } }),
      this.prisma.payrollStatutorySubmission.findMany({ where: { payrollRunId: { in: runIds } } }),
    ]);

    // Newest approved version per run — the standing record after any
    // correction. Ordered by version desc above, so first seen wins.
    const latestSnapshot = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latestSnapshot.has(snapshot.payrollRunId)) latestSnapshot.set(snapshot.payrollRunId, snapshot);
    }
    // ONE STANDING LISTING PER PAY DATE (UAT, 10 October 2026): a month whose
    // items are paid on several dates is paid in that many transfers.
    const standingBatches = new Map<string, (typeof batches)[number][]>();
    for (const batch of batches) {
      if (batch.status === 'SUPERSEDED') continue;
      standingBatches.set(batch.payrollRunId, [...(standingBatches.get(batch.payrollRunId) ?? []), batch]);
    }
    const progress: Record<string, number> = { GENERATED: 0, DOWNLOADED: 1, RECORDED_PAID: 2 };
    const submissionsByRun = new Map<string, (typeof submissions)[number][]>();
    for (const submission of submissions) {
      submissionsByRun.set(submission.payrollRunId, [
        ...(submissionsByRun.get(submission.payrollRunId) ?? []),
        submission,
      ]);
    }

    const rows = runs.map((run) => {
      const snapshot = latestSnapshot.get(run.id) ?? null;
      const base = {
        runId: run.id,
        period: run.period.toISOString().slice(0, 7),
        runType: run.runType,
        sequence: run.sequence,
        status: run.status,
        clinicName: run.clinic?.name ?? 'All branches',
        legalEmployer: run.legalEmployer ? { id: run.legalEmployer.id, name: run.legalEmployer.name } : null,
        approvedAt: run.approvedAt?.toISOString() ?? null,
      };
      if (snapshot === null) {
        // An approved run always writes a snapshot; a gap here is a defect,
        // and Finance is told so rather than being served the mutable lines.
        return {
          ...base,
          snapshot: null,
          liabilities: null,
          payment: null,
          submissions: [],
          withheld: 'This approved run has no snapshot on record. That should be impossible — report it. No figures are served from mutable data.',
        };
      }

      const payload = snapshot.payload as unknown as SnapshotPayload;
      const verification = verifySnapshot(payload, snapshot.hash);
      const verified = verification.verdict === 'VERIFIED';

      /**
       * Per-scheme totals from the frozen employee lines. NULL SURVIVES: a
       * scheme any employee's figure is missing for reports null with the
       * count, never a sum that silently understates the liability.
       */
      const scheme = (
        name: string,
        borneBy: 'EMPLOYEE' | 'EMPLOYER' | 'BOTH',
        pick: (line: SnapshotPayload['employees'][number]) => { employee: number | null; employer: number | null },
      ) => {
        let employee = 0;
        let employer = 0;
        let missing = 0;
        for (const line of payload.employees) {
          const picked = pick(line);
          if (
            (borneBy !== 'EMPLOYER' && picked.employee === null) ||
            (borneBy !== 'EMPLOYEE' && picked.employer === null)
          ) {
            missing += 1;
            continue;
          }
          employee += picked.employee ?? 0;
          employer += picked.employer ?? 0;
        }
        return {
          scheme: name,
          /** Withheld from employees — money the employer HOLDS to remit. */
          employeeCents: missing > 0 || borneBy === 'EMPLOYER' ? null : employee,
          /** The employer's own cost on top of wages. */
          employerCents: missing > 0 || borneBy === 'EMPLOYEE' ? null : employer,
          totalCents: missing > 0 ? null : employee + employer,
          notComputed: missing,
        };
      };

      const liabilities = !verified
        ? null
        : {
            /** Owed to employees, from the approved record. */
            netPayCents: payload.totals.netCents,
            netPay: formatCents(payload.totals.netCents),
            grossCents: payload.totals.grossCents,
            employerCostCents: payload.totals.employerCostCents,
            employeeCount: payload.totals.employeeCount,
            statutory: [
              scheme('EPF', 'BOTH', (line) => ({
                employee: line.statutory.epfEmployeeCents,
                employer: line.statutory.epfEmployerCents,
              })),
              scheme('SOCSO', 'BOTH', (line) => ({
                employee: line.statutory.socsoEmployeeCents,
                employer: line.statutory.socsoEmployerCents,
              })),
              scheme('EIS', 'BOTH', (line) => ({
                employee: line.statutory.eisEmployeeCents,
                employer: line.statutory.eisEmployerCents,
              })),
              scheme('LINDUNG', 'EMPLOYEE', (line) => ({
                employee: line.statutory.lindungEmployeeCents,
                employer: null,
              })),
              scheme('PCB', 'EMPLOYEE', (line) => ({
                employee: line.statutory.pcbCents,
                employer: null,
              })),
              scheme('HRD', 'EMPLOYER', (line) => ({
                employee: null,
                employer: line.statutory.hrdLevyCents ?? null,
              })),
            ],
          };

      const standing = (standingBatches.get(run.id) ?? []).sort(
        (a, b) => (a.payDate?.getTime() ?? 0) - (b.payDate?.getTime() ?? 0),
      );
      // The month stands where its least advanced transfer stands: it is paid
      // when the last one is recorded, never when the first one is.
      const batch = standing.reduce<(typeof standing)[number] | null>(
        (least, candidate) => (least === null || progress[candidate.status] < progress[least.status] ? candidate : least),
        null,
      );
      const recorded = standing.filter((candidate) => candidate.status === 'RECORDED_PAID');
      const single = standing.length === 1 ? standing[0] : null;
      return {
        ...base,
        snapshot: { version: snapshot.version, hash: snapshot.hash, verdict: verification.verdict },
        liabilities,
        withheld: verified
          ? null
          : `The approved record failed verification (${verification.verdict}), so its figures are withheld. Resolve the snapshot before posting anything.`,
        /**
         * THE HONESTY LADDER, VERBATIM. Finance accrues on approval and clears
         * on evidence of payment; "a listing was downloaded" is not that
         * evidence and is never presented as it.
         */
        payment: {
          state: batch === null ? 'NOT_PREPARED' : batch.status,
          stateMeans:
            batch === null
              ? 'No payment listing has been prepared. The net pay liability is fully outstanding.'
              : batch.status === 'RECORDED_PAID'
                ? standing.length > 1
                  ? `A person recorded each of the ${standing.length} transfers this month is paid in, with a date and reference. Those records are the evidence.`
                  : 'A person recorded that the employees were paid, with a date and reference. That record is the evidence.'
                : recorded.length > 0
                  ? `${recorded.length} of the ${standing.length} transfers this month is paid in are recorded, with a date and reference. Treat the rest of the net pay liability as outstanding.`
                  : 'A listing exists but nobody has recorded that money moved. Treat the net pay liability as outstanding.',
          totalCents: standing.length > 0 ? standing.reduce((sum, candidate) => sum + candidate.totalCents, 0) : null,
          excludedCount: standing.reduce((sum, candidate) => sum + candidate.excludedCount, 0),
          // One transfer: its date and reference. Several: the last date once all are recorded, and each reference.
          paymentDate: single
            ? (single.paymentDate?.toISOString().slice(0, 10) ?? null)
            : batch?.status === 'RECORDED_PAID'
              ? (recorded
                  .map((candidate) => candidate.paymentDate?.toISOString().slice(0, 10) ?? '')
                  .sort()
                  .pop() ?? null)
              : null,
          paymentReference: single
            ? single.paymentReference
            : recorded.length > 0
              ? recorded.map((candidate) => candidate.paymentReference).join(' · ')
              : null,
          /** Each transfer the month is paid in, earliest first. One for a month paid on one date. */
          transfers: standing.map((candidate) => ({
            payDate: candidate.payDate?.toISOString().slice(0, 10) ?? null,
            state: candidate.status,
            totalCents: candidate.totalCents,
            paymentDate: candidate.paymentDate?.toISOString().slice(0, 10) ?? null,
            paymentReference: candidate.paymentReference,
          })),
        },
        /** Statutory filings a person has recorded, per scheme. Absence means not filed. */
        submissions: (submissionsByRun.get(run.id) ?? []).map((submission) => ({
          scheme: submission.scheme,
          submittedDate: submission.submittedDate.toISOString().slice(0, 10),
          reference: submission.reference,
        })),
      };
    });

    return {
      contract: 'PAYROLL_FINANCE_LIABILITIES',
      year,
      runs: rows,
      /** The boundary, stated on the wire so neither side re-invents it. */
      contractNotes: [
        'Figures come from each run’s approved snapshot, re-verified on every read. A run whose record fails verification has its figures withheld.',
        'Aggregates only — per-employee pay never crosses this boundary. The employee-level record lives in Payroll behind its own permissions.',
        'Payroll states liabilities and payment evidence; the accounting treatment — journals, accruals, allocations — is Finance’s and is not duplicated here.',
      ],
    };
  }
}
