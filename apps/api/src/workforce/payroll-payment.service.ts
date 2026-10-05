import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { compareByEmployeeName } from './employee-order';
import { PaymentBatchStatus, PayrollRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { currentTenantId } from '../core/tenant-context';
import { SnapshotPayload, verifySnapshot } from './payroll-snapshot';

/**
 * PAYMENT PREPARATION — and exactly what it may claim.
 *
 * Kuwick talks to no bank. What this service produces is a reconciled
 * INSTRUCTION LISTING from the approved snapshot: who is to be paid, into
 * which account, how much — for a human keying payments into their bank's own
 * portal. No verified bank file format is on record, so nothing here is
 * presented as one (the register's position on export formats stands).
 *
 * The status model is the honesty model:
 *   GENERATED      a document exists
 *   DOWNLOADED     somebody took it
 *   RECORDED_PAID  a human recorded that money moved — date and reference —
 *                  and ONLY this state claims a transfer
 *   SUPERSEDED     regenerated after a correction or a bank-detail fix
 *
 * AMOUNTS ARE FROZEN, ACCOUNTS ARE NOT. The amount somebody is owed is the
 * approved snapshot's net, and a batch stores the snapshot version and hash it
 * paid. The account it goes to is on-file master data at generation — paying
 * an old account because it was frozen with the run would send real money to
 * a closed account — so the listing is labelled "details as at generation"
 * and a regenerated batch supersedes, never overwrites.
 */
@Injectable()
export class PayrollPaymentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * The payment state of a run, for anyone who may see payroll. Carries no
   * account numbers — those stay behind `hr.payroll.export.bank`.
   */
  async status(runId: string) {
    const actor = await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, netTotal: true, paidAt: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const batch = await this.prisma.payrollPaymentBatch.findFirst({
      where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
      orderBy: { version: 'desc' },
      include: {
        createdBy: { select: { fullName: true } },
        lines: true,
      },
    });
    // The one order every payroll list uses: by name, the excluded where their
    // name falls, marked rather than moved (employee-order.ts).
    batch?.lines.sort(compareByEmployeeName);
    const mayPrepare = actorCan(actor, 'hr.payroll.export.bank');
    return {
      runStatus: run.status,
      runPaidAt: run.paidAt?.toISOString() ?? null,
      mayPrepare,
      batch: batch
        ? {
            id: batch.id,
            version: batch.version,
            status: batch.status,
            snapshotVersion: batch.snapshotVersion,
            totalCents: batch.totalCents,
            includedCount: batch.includedCount,
            excludedCount: batch.excludedCount,
            createdBy: batch.createdBy.fullName,
            createdAt: batch.createdAt.toISOString(),
            downloadedAt: batch.downloadedAt?.toISOString() ?? null,
            paidRecordedAt: batch.paidRecordedAt?.toISOString() ?? null,
            paymentDate: batch.paymentDate?.toISOString().slice(0, 10) ?? null,
            paymentReference: batch.paymentReference,
            lines: batch.lines.map((line) => ({
              staffId: line.staffId,
              name: line.name,
              bankName: line.bankName,
              /** Last four only on the status read; the full number is in the export. */
              accountEnding: line.bankAccountNo ? line.bankAccountNo.slice(-4) : null,
              amountCents: line.amountCents,
              included: line.included,
              exclusionReason: line.exclusionReason,
            })),
          }
        : null,
    };
  }

  /**
   * Compose a batch from the latest approved snapshot. Refuses an unapproved
   * run, an unverifiable snapshot, and — the reconciliation — a batch whose
   * included and excluded lines do not together equal the approved net total.
   */
  async prepare(runId: string) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.export.bank', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
        throw new ConflictException(
          'Payment can only be prepared from an APPROVED run. This one is ' +
            `${run.status} — nothing unapproved leaves as a payment instruction.`,
        );
      }
      const snapshot = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId },
        orderBy: { version: 'desc' },
      });
      if (!snapshot) throw new ConflictException('This run has no approved record to pay from.');
      const payload = snapshot.payload as unknown as SnapshotPayload;
      const verification = verifySnapshot(payload, snapshot.hash);
      if (verification.verdict !== 'VERIFIED') {
        throw new ConflictException(
          `No payment can be prepared from this record: its verification verdict is ${verification.verdict}. ` +
            verification.reason,
        );
      }

      // Bank details as on file NOW, labelled so. The amounts are frozen.
      const staffIds = payload.employees.map((employee) => employee.staffId);
      const profiles = await tx.employeeProfile.findMany({
        where: { staffId: { in: staffIds } },
        select: { staffId: true, bankName: true, bankAccountNo: true },
      });
      const bankByStaff = new Map(profiles.map((profile) => [profile.staffId, profile]));

      const lines = payload.employees.map((employee) => {
        const bank = bankByStaff.get(employee.staffId);
        const missing = !bank?.bankName || !bank?.bankAccountNo;
        const zero = employee.netCents <= 0;
        return {
          staffId: employee.staffId,
          name: employee.name,
          bankName: bank?.bankName ?? null,
          bankAccountNo: bank?.bankAccountNo ?? null,
          amountCents: employee.netCents,
          included: !missing && !zero,
          exclusionReason: missing
            ? 'No bank account is on file. Pay them another way, record it, and fix the employee record for next month.'
            : zero
              ? 'Net pay is nil, so there is nothing to transfer.'
              : null,
        };
      });

      const included = lines.filter((line) => line.included);
      const excluded = lines.filter((line) => !line.included);
      const totalCents = included.reduce((sum, line) => sum + line.amountCents, 0);
      const excludedCents = excluded.reduce((sum, line) => sum + line.amountCents, 0);

      // THE RECONCILIATION. Included plus excluded must be the approved net —
      // to the cent — or the batch is refused. A listing that quietly covers
      // less than the payroll is how somebody goes unpaid without anyone
      // noticing until they say so.
      if (totalCents + excludedCents !== payload.totals.netCents) {
        throw new ConflictException(
          `This batch does not reconcile: included RM${(totalCents / 100).toFixed(2)} plus excluded ` +
            `RM${(excludedCents / 100).toFixed(2)} is not the approved net RM${(payload.totals.netCents / 100).toFixed(2)}. ` +
            'Nothing was stored.',
        );
      }

      // Supersede any standing batch rather than overwriting it: the record of
      // what was generated earlier is part of the payment story.
      const standing = await tx.payrollPaymentBatch.findFirst({
        where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
        orderBy: { version: 'desc' },
      });
      if (standing?.status === PaymentBatchStatus.RECORDED_PAID) {
        throw new ConflictException(
          'A payment has already been recorded against this run. Preparing another batch would set up a double ' +
            'payment; reopen and correct the run instead if the figures are wrong.',
        );
      }
      if (standing) {
        await tx.payrollPaymentBatch.update({
          where: { id: standing.id },
          data: { status: PaymentBatchStatus.SUPERSEDED },
        });
      }

      const version = (await tx.payrollPaymentBatch.count({ where: { payrollRunId: runId } })) + 1;
      const batch = await tx.payrollPaymentBatch.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          version,
          snapshotVersion: snapshot.version,
          snapshotHash: snapshot.hash,
          totalCents,
          includedCount: included.length,
          excludedCount: excluded.length,
          createdByStaffId: actor.id,
          lines: {
            create: lines.map((line) => ({
              tenantId: currentTenantId(),
              staffId: line.staffId,
              name: line.name,
              bankName: line.bankName,
              bankAccountNo: line.bankAccountNo,
              amountCents: line.amountCents,
              included: line.included,
              exclusionReason: line.exclusionReason,
            })),
          },
        },
      });

      await recordAudit(tx, actor, {
        action: 'payrollPayment.batchPrepared',
        entityType: 'PayrollPaymentBatch',
        entityId: batch.id,
        after: {
          runId,
          version,
          snapshotVersion: snapshot.version,
          totalCents,
          included: included.length,
          excluded: excluded.length,
        },
        source: 'hr.payroll',
      });
    });
    // Read back OUTSIDE the transaction: a status read inside it sees the
    // pre-commit rows and reports a state the caller is about to falsify.
    return this.status(runId);
  }

  /**
   * The instruction listing, as CSV. Not a bank file, and it says so in its
   * name and header — no verified bank format is on record to produce.
   */
  async download(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.export.bank', async (tx, actor) => {
      const batch = await tx.payrollPaymentBatch.findFirst({
        where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
        orderBy: { version: 'desc' },
        include: { lines: true, payrollRun: true },
      });
      if (!batch) throw new NotFoundException('No payment batch has been prepared for this run.');
      // Same order as the screen and the payslips (employee-order.ts).
      batch.lines.sort(compareByEmployeeName);

      if (batch.status === PaymentBatchStatus.GENERATED) {
        await tx.payrollPaymentBatch.update({
          where: { id: batch.id },
          data: { status: PaymentBatchStatus.DOWNLOADED, downloadedAt: new Date(), downloadedByStaffId: actor.id },
        });
      }
      await recordAudit(tx, actor, {
        action: 'payrollPayment.listingDownloaded',
        entityType: 'PayrollPaymentBatch',
        entityId: batch.id,
        after: { runId, version: batch.version, totalCents: batch.totalCents },
        source: 'hr.payroll',
      });

      const escape = (value: string | null) =>
        value === null ? '' : /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      const period = batch.payrollRun.period.toISOString().slice(0, 7);
      const rows = [
        ['employee', 'bank', 'account_number', 'amount_rm', 'status', 'reason'].join(','),
        ...batch.lines.map((line) =>
          [
            escape(line.name),
            escape(line.bankName),
            escape(line.bankAccountNo),
            (line.amountCents / 100).toFixed(2),
            line.included ? 'PAY' : 'EXCLUDED',
            escape(line.exclusionReason),
          ].join(','),
        ),
        ['TOTAL TO PAY', '', '', (batch.totalCents / 100).toFixed(2), '', ''].join(','),
      ];
      return {
        fileName: `payment-instruction-listing-${period}-batch${batch.version}.csv`,
        // The first line inside the file restates what this is, so a copy
        // found on a desktop a year later cannot be mistaken for a bank file.
        content:
          `# Payment instruction listing — ${period}, batch ${batch.version}, from approved record ` +
          `${batch.snapshotHash.slice(0, 16)}… This is NOT a bank file: no verified bank format is on record. ` +
          'Key these payments in your bank portal and record the transfer in Kuwick afterwards.\n' +
          rows.join('\n'),
      };
    });
  }

  /**
   * A human records that money moved. The only path to RECORDED_PAID — and,
   * since the unreconciled `markPaid` endpoint was removed, the only path to
   * a run reading PAID at all. It demands the two facts a reconciliation
   * needs: when, and under what reference.
   */
  async recordPaid(runId: string, body: { paymentDate: string; reference: string; note?: string }) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      // Validated INSIDE the permission boundary: an unauthorised caller gets
      // the 403 the permission owes them, not a validation hint.
      if (!body.reference || body.reference.trim().length < 3) {
        throw new ConflictException('Recording a payment needs the bank reference of the actual transfer.');
      }
      if (!body.paymentDate || Number.isNaN(new Date(body.paymentDate).getTime())) {
        throw new ConflictException('Recording a payment needs the date the money actually left.');
      }
      const batch = await tx.payrollPaymentBatch.findFirst({
        where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
        orderBy: { version: 'desc' },
      });
      if (!batch) {
        throw new NotFoundException(
          'No payment batch exists for this run. Prepare the batch, make the transfer, then record it.',
        );
      }
      if (batch.status === PaymentBatchStatus.RECORDED_PAID) {
        throw new ConflictException('This batch is already recorded as paid.');
      }

      await tx.payrollPaymentBatch.update({
        where: { id: batch.id },
        data: {
          status: PaymentBatchStatus.RECORDED_PAID,
          paidRecordedAt: new Date(),
          paidRecordedByStaffId: actor.id,
          paymentDate: new Date(`${body.paymentDate}T00:00:00.000Z`),
          paymentReference: body.reference.trim(),
          note: body.note?.trim() || null,
        },
      });

      const run = await tx.payrollRun.findUniqueOrThrow({
        where: { id: runId },
        include: { lines: { select: { staffId: true } } },
      });
      const paymentDate = new Date(`${body.paymentDate}T00:00:00.000Z`);
      if (run.status === PayrollRunStatus.APPROVED) {
        await tx.payrollRun.update({
          where: { id: runId },
          // `paidAt` is when it was recorded; `paymentDate` is the day the
          // money left, which is the date a payslip and the portal show.
          data: { status: PayrollRunStatus.PAID, paidAt: new Date(), paymentDate },
        });
      }

      // A claim that rode on this run's lines has now been paid with the
      // salary. Say so on the claim, so the employee's portal and the claims
      // queue stop calling it "approved, will be paid with your salary".
      const paidClaims = await tx.staffClaim.updateMany({
        where: {
          payoutStatus: 'IN_PAYROLL',
          paymentRoute: 'PAYROLL',
          payrollPeriod: run.period,
          staffId: { in: run.lines.map((line) => line.staffId) },
        },
        data: { payoutStatus: 'PAID', paidAt: paymentDate },
      });

      await recordAudit(tx, actor, {
        action: 'payrollPayment.recordedPaid',
        entityType: 'PayrollPaymentBatch',
        entityId: batch.id,
        after: {
          runId,
          version: batch.version,
          paymentDate: body.paymentDate,
          reference: body.reference.trim(),
          totalCents: batch.totalCents,
          claimsPaidWithSalary: paidClaims.count,
        },
        source: 'hr.payroll',
      });
    });
    return this.status(runId);
  }
}
