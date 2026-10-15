import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CSV_BOM, csvCell, csvTextCell } from './csv';
import { compareByEmployeeName } from './employee-order';
import { PaymentBatchStatus, PayrollRunStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { AdminTx, actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { currentTenantId } from '../core/tenant-context';
import { SnapshotPayload, verifySnapshot } from './payroll-snapshot';
import { chosenPayDate, DEFAULT_PAY_DATE, PayDateChoices, payDateChoicesOf, scheduledPayDate } from './pay-dates';

/** One date's money for everybody on the run: who, and how much on that date. */
export interface ScheduledPayment {
  /** YYYY-MM-DD, or null for a record approved before pay dates existed: one payment for the whole net. */
  date: string | null;
  people: { staffId: string; name: string; amountCents: number }[];
  totalCents: number;
  /** The record's own dates paid on this one: more than one where the owner moved two onto one day. */
  defaultDates: string[];
}

/**
 * THE MONTH'S PAYMENTS, FROM THE APPROVED RECORD. A record written with pay
 * dates says what each person is paid on each date; an older one is one
 * payment of everybody's net, exactly as before. The owner's dates for this
 * run move a date, or put two on one day, without touching an amount.
 */
export function scheduleOf(payload: SnapshotPayload, choices: PayDateChoices = {}): ScheduledPayment[] {
  const split = payload.employees.every((employee) => Array.isArray(employee.payments));
  if (!split) {
    const people = payload.employees.map((employee) => ({ staffId: employee.staffId, name: employee.name, amountCents: employee.netCents }));
    return [{ date: null, people, totalCents: people.reduce((sum, person) => sum + person.amountCents, 0), defaultDates: [] }];
  }
  const byDate = new Map<string, ScheduledPayment>();
  for (const employee of payload.employees) {
    for (const payment of employee.payments ?? []) {
      const date = chosenPayDate(choices, payment.date);
      const entry = byDate.get(date) ?? { date, people: [], totalCents: 0, defaultDates: [] };
      // Two of somebody's payments moved onto one day are one transfer to them.
      const person = entry.people.find((row) => row.staffId === employee.staffId);
      if (person) person.amountCents += payment.netCents;
      else entry.people.push({ staffId: employee.staffId, name: employee.name, amountCents: payment.netCents });
      entry.totalCents += payment.netCents;
      if (!entry.defaultDates.includes(payment.date)) entry.defaultDates.push(payment.date);
      byDate.set(date, entry);
    }
  }
  return [...byDate.values()]
    // A date nobody is paid anything on has nothing to transfer.
    .filter((entry) => entry.people.some((person) => person.amountCents !== 0))
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

/** The date the salary is paid on: the date basic pay goes out, from the record's own catalogue and the owner's dates. */
export function salaryDateOf(payload: SnapshotPayload, choices: PayDateChoices = {}): string | null {
  const basic = payload.components?.find((component) => component.code === 'BASIC');
  if (!basic?.payDate) return null;
  return chosenPayDate(
    choices,
    scheduledPayDate(new Date(`${payload.period.slice(0, 10)}T00:00:00.000Z`), {
      payDay: basic.payDate.payDay ?? DEFAULT_PAY_DATE.payDay,
      monthOffset: basic.payDate.monthOffset ?? 0,
    }),
  );
}

/** One of the record's own dates, from Payroll items: what is paid on it, and the date it goes out on for this run. */
export interface PayDateRow {
  defaultDate: string;
  payDate: string;
  /** The items paid on it, as the payslip names them. */
  items: string[];
  totalCents: number;
}

/**
 * THE RECORD'S OWN DATES, each with the date the owner chose for this run. A
 * record approved before pay dates existed has none: it is paid on one date.
 */
export function payDateRowsOf(payload: SnapshotPayload, choices: PayDateChoices = {}): PayDateRow[] {
  if (!payload.employees.every((employee) => Array.isArray(employee.payments))) return [];
  const rows = new Map<string, PayDateRow & { paid: boolean }>();
  for (const employee of payload.employees) {
    for (const payment of employee.payments ?? []) {
      const row = rows.get(payment.date) ?? {
        defaultDate: payment.date,
        payDate: chosenPayDate(choices, payment.date),
        items: [],
        totalCents: 0,
        paid: false,
      };
      row.totalCents += payment.netCents;
      row.paid ||= payment.netCents !== 0;
      rows.set(payment.date, row);
    }
    for (const line of employee.payslip?.componentLines ?? []) {
      const row = line.kind === 'EARNING' && line.payDate ? rows.get(line.payDate) : undefined;
      if (row && line.amountCents !== 0 && !row.items.includes(line.label)) row.items.push(line.label);
    }
  }
  return [...rows.values()]
    .filter((row) => row.paid)
    .sort((a, b) => (a.defaultDate < b.defaultDate ? -1 : 1))
    .map(({ defaultDate, payDate, items, totalCents }) => ({ defaultDate, payDate, items, totalCents }));
}

/** A date for this run is kept between the first day of its month and the last day of the next. */
export function payDateRangeOf(period: Date): { from: string; to: string } {
  const first = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  const last = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 2, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const dateKey = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * PAYMENT PREPARATION — and exactly what it may claim.
 *
 * Kuwick talks to no bank. What this service produces is a reconciled
 * INSTRUCTION LISTING from the approved snapshot: who is to be paid, into
 * which account, how much — for a human keying payments into their bank's own
 * portal. No verified bank file format is on record, so nothing here is
 * presented as one (the register's position on export formats stands).
 *
 * ONE LISTING PER PAY DATE (UAT, 10 October 2026). A month whose items are paid
 * on more than one date — salary on the 30th, a director's fee on the 1st,
 * overtime and claims on the 15th — is paid in that many transfers, each with
 * its own listing and its own recorded transfer. The approved record says what
 * each person is paid on each date; a record approved before pay dates existed
 * is one listing for the whole month, as before.
 *
 * The status model is the honesty model, per date:
 *   GENERATED      a document exists
 *   DOWNLOADED     somebody took it
 *   RECORDED_PAID  a human recorded that money moved — date and reference —
 *                  and ONLY this state claims a transfer
 *   SUPERSEDED     regenerated after a correction or a bank-detail fix
 *
 * The run reads PAID once every date is recorded. The payslip reaches the
 * employee's portal once the salary transfer is.
 *
 * AMOUNTS ARE FROZEN, ACCOUNTS ARE NOT. The amount somebody is owed is the
 * approved snapshot's, and a batch stores the snapshot version and hash it
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
      select: { id: true, status: true, period: true, netTotal: true, paidAt: true, payDates: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const choices = payDateChoicesOf(run.payDates);
    const current = await this.prisma.payrollPaymentBatch.findMany({
      where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
      orderBy: [{ payDate: 'asc' }, { version: 'desc' }],
      include: { createdBy: { select: { fullName: true } }, lines: true },
    });
    // The record's own schedule, so the screen can say "paid on three dates"
    // before anything is prepared.
    const snapshot = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
      select: { payload: true },
    });
    const payload = snapshot ? (snapshot.payload as unknown as SnapshotPayload) : null;
    const schedule = payload ? scheduleOf(payload, choices) : [];
    const salaryDate = payload ? salaryDateOf(payload, choices) : null;
    const mayPrepare = actorCan(actor, 'hr.payroll.export.bank');
    const batches = current.map((batch) => {
      // The one order every payroll list uses: by name, the excluded where their
      // name falls, marked rather than moved (employee-order.ts).
      batch.lines.sort(compareByEmployeeName);
      return {
        id: batch.id,
        /** The date this listing pays, or null for a month approved before pay dates existed. */
        payDate: dateKey(batch.payDate),
        /** The salary goes out on this date; recording it releases the payslip to the employee. */
        carriesSalary: batch.payDate === null || dateKey(batch.payDate) === salaryDate,
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
      };
    });
    return {
      runStatus: run.status,
      runPaidAt: run.paidAt?.toISOString() ?? null,
      mayPrepare,
      /** Whether the owner may still move a date: an approved run, by somebody who may prepare its listings. */
      mayChooseDates: mayPrepare && run.status === PayrollRunStatus.APPROVED,
      /** The dates a payment of this run may be moved to. */
      payDateRange: payDateRangeOf(run.period),
      /**
       * THE RECORD'S OWN DATES, from Payroll items, each with the date it goes
       * out on for this run. A date stands once its listing is prepared.
       */
      payDates: (payload ? payDateRowsOf(payload, choices) : []).map((row) => ({
        ...row,
        locked: batches.some((batch) => batch.payDate === row.payDate),
      })),
      /** The dates this run pays on, and how much on each. */
      schedule: schedule.map((entry) => ({
        payDate: entry.date,
        /** The record's own date for it, from Payroll items. */
        defaultDates: entry.defaultDates,
        /** Moved for this run by the owner. */
        moved: entry.date !== null && entry.defaultDates.some((date) => date !== entry.date),
        /** Its listing is prepared, so the date stands. */
        locked: batches.some((batch) => batch.payDate === entry.date),
        totalCents: entry.totalCents,
        people: entry.people.filter((person) => person.amountCents !== 0).length,
      })),
      salaryDate,
      batches,
      /** The first listing, for a month paid on one date. Kept for older readers of this route. */
      batch: batches[0] ?? null,
    };
  }

  /**
   * Compose the listings from the latest approved snapshot, one per pay date.
   * Refuses an unapproved run, an unverifiable snapshot, and — the
   * reconciliation — a listing whose included and excluded lines do not
   * together equal what the record pays on that date. A date already recorded
   * as paid is left exactly as it is.
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
      const schedule = scheduleOf(payload, payDateChoicesOf(run.payDates));

      // THE WHOLE MONTH FIRST. However many dates, together they must pay the
      // approved net to the sen, or nothing is stored.
      const scheduled = schedule.reduce((sum, entry) => sum + entry.totalCents, 0);
      if (scheduled !== payload.totals.netCents) {
        throw new ConflictException(
          `The pay dates do not add up: RM${(scheduled / 100).toFixed(2)} across ${schedule.length} date(s) is not the ` +
            `approved net RM${(payload.totals.netCents / 100).toFixed(2)}. Nothing was stored.`,
        );
      }

      // Bank details as on file NOW, labelled so. The amounts are frozen.
      const staffIds = payload.employees.map((employee) => employee.staffId);
      const profiles = await tx.employeeProfile.findMany({
        where: { staffId: { in: staffIds } },
        select: { staffId: true, bankName: true, bankAccountNo: true },
      });
      const bankByStaff = new Map(profiles.map((profile) => [profile.staffId, profile]));

      const standing = await tx.payrollPaymentBatch.findMany({
        where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
      });
      const standingFor = (date: string | null) => standing.find((batch) => dateKey(batch.payDate) === date);
      const open = schedule.filter((entry) => standingFor(entry.date)?.status !== PaymentBatchStatus.RECORDED_PAID);
      if (open.length === 0) {
        throw new ConflictException(
          'Every payment of this month has already been recorded. Preparing another listing would set up a double ' +
            'payment; reopen and correct the run instead if the figures are wrong.',
        );
      }

      // A listing for a date the record no longer pays on is withdrawn, not
      // left standing to be paid by mistake.
      const dates = new Set(schedule.map((entry) => entry.date));
      for (const stale of standing.filter((batch) => batch.status !== PaymentBatchStatus.RECORDED_PAID && !dates.has(dateKey(batch.payDate)))) {
        await tx.payrollPaymentBatch.update({ where: { id: stale.id }, data: { status: PaymentBatchStatus.SUPERSEDED } });
      }

      let version = await tx.payrollPaymentBatch.count({ where: { payrollRunId: runId } });
      for (const entry of open) {
        const lines = entry.people.map((person) => {
          const bank = bankByStaff.get(person.staffId);
          const missing = !bank?.bankName || !bank?.bankAccountNo;
          const zero = person.amountCents <= 0;
          return {
            staffId: person.staffId,
            name: person.name,
            bankName: bank?.bankName ?? null,
            bankAccountNo: bank?.bankAccountNo ?? null,
            amountCents: person.amountCents,
            included: !missing && !zero,
            exclusionReason: missing
              ? 'No bank account is on file. Pay them another way, record it, and fix the employee record for next month.'
              : zero
                ? entry.date
                  ? 'Nothing is paid to them on this date.'
                  : 'Net pay is nil, so there is nothing to transfer.'
                : null,
          };
        });
        const included = lines.filter((line) => line.included);
        const excluded = lines.filter((line) => !line.included);
        const totalCents = included.reduce((sum, line) => sum + line.amountCents, 0);
        const excludedCents = excluded.reduce((sum, line) => sum + line.amountCents, 0);

        // THE RECONCILIATION, per date. Included plus excluded must be what the
        // record pays on this date — to the cent — or the listing is refused. A
        // listing that quietly covers less than the payroll is how somebody goes
        // unpaid without anyone noticing until they say so.
        if (totalCents + excludedCents !== entry.totalCents) {
          throw new ConflictException(
            `The listing${entry.date ? ` for ${entry.date}` : ''} does not reconcile: included RM${(totalCents / 100).toFixed(2)} ` +
              `plus excluded RM${(excludedCents / 100).toFixed(2)} is not the RM${(entry.totalCents / 100).toFixed(2)} ` +
              'the approved record pays. Nothing was stored.',
          );
        }

        // Supersede the standing batch rather than overwriting it: the record of
        // what was generated earlier is part of the payment story.
        const previous = standingFor(entry.date);
        if (previous) {
          await tx.payrollPaymentBatch.update({ where: { id: previous.id }, data: { status: PaymentBatchStatus.SUPERSEDED } });
        }

        version += 1;
        const batch = await tx.payrollPaymentBatch.create({
          data: {
            tenantId: currentTenantId(),
            payrollRunId: runId,
            version,
            payDate: entry.date ? new Date(`${entry.date}T00:00:00.000Z`) : null,
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
            payDate: entry.date,
            snapshotVersion: snapshot.version,
            totalCents,
            included: included.length,
            excluded: excluded.length,
          },
          source: 'hr.payroll',
        });
      }
    });
    // Read back OUTSIDE the transaction: a status read inside it sees the
    // pre-commit rows and reports a state the caller is about to falsify.
    return this.status(runId);
  }

  /**
   * THE OWNER MOVES A DATE FOR THIS RUN (UAT, 10 October 2026): "the
   * component's Paid on is only the default date within that run's month, and
   * can be changed on the Pay step for each run before the listing is
   * prepared."
   *
   * Every payment the record puts on `defaultDate` goes out on `payDate`
   * instead, for this run alone; choosing the default again clears the choice,
   * and choosing a date the run already pays on makes the two one transfer.
   * No amount moves. Refused once the listing for either date is prepared: a
   * prepared listing is a document somebody may already have keyed at the
   * bank. A date is kept between the first day of the run's month and the last
   * day of the next, which catches a mistyped year without second-guessing the
   * clinic.
   */
  async choosePayDate(runId: string, body: { defaultDate: string; payDate: string }) {
    const changed = await withAdminTx(this.rawPrisma, 'hr.payroll.export.bank', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictException(
          run.status === PayrollRunStatus.PAID
            ? 'This run is paid. Its dates are the dates the money went.'
            : 'Pay dates are chosen for an approved run, on its Pay step.',
        );
      }
      const snapshot = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId },
        orderBy: { version: 'desc' },
        select: { payload: true },
      });
      if (!snapshot) throw new ConflictException('This run has no approved record to pay from.');
      const choices = payDateChoicesOf(run.payDates);
      const defaultDate = body.defaultDate.slice(0, 10);
      const payDate = body.payDate.slice(0, 10);
      const row = payDateRowsOf(snapshot.payload as unknown as SnapshotPayload, choices).find((entry) => entry.defaultDate === defaultDate);
      if (!row) {
        throw new BadRequestException(`Nothing in this run is due on ${defaultDate}. Choose one of the dates it pays on.`);
      }
      const range = payDateRangeOf(run.period);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate) || payDate < range.from || payDate > range.to) {
        throw new BadRequestException(`Choose a date from ${range.from} to ${range.to}: within this run's month or the month after it.`);
      }
      if (payDate === row.payDate) return false;
      const prepared = await tx.payrollPaymentBatch.findFirst({
        where: {
          payrollRunId: runId,
          status: { not: PaymentBatchStatus.SUPERSEDED },
          payDate: { in: [new Date(`${row.payDate}T00:00:00.000Z`), new Date(`${payDate}T00:00:00.000Z`)] },
        },
      });
      if (prepared) {
        throw new ConflictException(
          `The listing for ${dateKey(prepared.payDate)} is prepared, so that date stands. A date can be changed until its listing is prepared.`,
        );
      }

      const next: Record<string, string> = { ...choices };
      if (payDate === defaultDate) delete next[defaultDate];
      else next[defaultDate] = payDate;
      await tx.payrollRun.update({ where: { id: runId }, data: { payDates: next } });
      await recordAudit(tx, actor, {
        action: 'payrollPayment.payDateChosen',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { defaultDate, payDate: row.payDate },
        after: { defaultDate, payDate, totalCents: row.totalCents },
        reason: `For this run, payments due on ${defaultDate} go out on ${payDate}.`,
        source: 'hr.payroll',
      });
      return true;
    });
    return { changed, ...(await this.status(runId)) };
  }

  /** The standing listing for a date, or the only one when the month is paid on one date. */
  private async standingBatch(tx: AdminTx, runId: string, payDate: string | undefined) {
    const standing = await tx.payrollPaymentBatch.findMany({
      where: { payrollRunId: runId, status: { not: PaymentBatchStatus.SUPERSEDED } },
      orderBy: { payDate: 'asc' },
      include: { lines: true, payrollRun: true },
    });
    if (standing.length === 0) {
      throw new NotFoundException('No payment listing has been prepared for this run. Prepare it, make the transfer, then record it.');
    }
    if (payDate) {
      const found = standing.find((batch) => dateKey(batch.payDate) === payDate.slice(0, 10));
      if (!found) throw new NotFoundException(`No payment listing for ${payDate.slice(0, 10)} is standing on this run.`);
      return { batch: found, standing };
    }
    if (standing.length > 1) {
      throw new BadRequestException(
        `This month is paid on ${standing.length} dates (${standing.map((batch) => dateKey(batch.payDate)).join(', ')}). Say which one.`,
      );
    }
    return { batch: standing[0], standing };
  }

  /**
   * The instruction listing for one pay date, as CSV. Not a bank file, and it
   * says so in its name and header — no verified bank format is on record to
   * produce.
   */
  async download(runId: string, payDate?: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.export.bank', async (tx, actor) => {
      const { batch } = await this.standingBatch(tx, runId, payDate);
      // Same order as the screen and the payslips (employee-order.ts).
      batch.lines.sort(compareByEmployeeName);

      if (batch.status === PaymentBatchStatus.GENERATED) {
        await tx.payrollPaymentBatch.update({
          where: { id: batch.id },
          data: { status: PaymentBatchStatus.DOWNLOADED, downloadedAt: new Date(), downloadedByStaffId: actor.id },
        });
      }
      const paysOn = dateKey(batch.payDate);
      await recordAudit(tx, actor, {
        action: 'payrollPayment.listingDownloaded',
        entityType: 'PayrollPaymentBatch',
        entityId: batch.id,
        after: { runId, version: batch.version, payDate: paysOn, totalCents: batch.totalCents },
        source: 'hr.payroll',
      });

      const escape = csvCell;
      const period = batch.payrollRun.period.toISOString().slice(0, 7);
      // THE IC AND A REFERENCE (new-clinic UAT, 15 October 2026): bank portals
      // ask for the payee's IC and a payment reference on each transfer.
      const profiles = await tx.employeeProfile.findMany({
        where: { staffId: { in: batch.lines.map((line) => line.staffId) } },
        select: { staffId: true, identifierValue: true, passportNumber: true },
      });
      const idOf = new Map(profiles.map((row) => [row.staffId, row.identifierValue ?? row.passportNumber ?? null]));
      const reference = `Salary ${batch.payrollRun.period.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
      const rows = [
        ['employee', 'ic_or_passport', 'bank', 'account_number', 'amount_rm', 'payment_reference', 'status', 'reason'].join(','),
        ...batch.lines.map((line) =>
          [
            escape(line.name),
            csvTextCell(idOf.get(line.staffId) ?? null),
            escape(line.bankName),
            // A 12-digit account number opened in Excel became 5.12346E+11.
            csvTextCell(line.bankAccountNo),
            (line.amountCents / 100).toFixed(2),
            escape(reference),
            line.included ? 'PAY' : 'EXCLUDED',
            escape(line.exclusionReason),
          ].join(','),
        ),
        ['TOTAL TO PAY', '', '', '', (batch.totalCents / 100).toFixed(2), '', '', ''].join(','),
      ];
      return {
        fileName: `payment-instruction-listing-${period}${paysOn ? `-paid-${paysOn}` : ''}-batch${batch.version}.csv`,
        // The first line inside the file restates what this is, so a copy
        // found on a desktop a year later cannot be mistaken for a bank file.
        content:
          CSV_BOM +
          csvCell(
            `# Payment instruction listing — ${period}${paysOn ? `, paid on ${paysOn}` : ''}, batch ${batch.version}, ` +
              `from approved record ${batch.snapshotHash.slice(0, 16)}… This is NOT a bank file: no verified bank format ` +
              'is on record. Key these payments in your bank portal and record the transfer in Kuwick afterwards.',
          ) +
          '\n' +
          rows.join('\n'),
      };
    });
  }

  /**
   * A human records that money moved, for one pay date. The only path to
   * RECORDED_PAID — and the only path to a run reading PAID at all, which it
   * does once every date is recorded. It demands the two facts a
   * reconciliation needs: when, and under what reference.
   */
  async recordPaid(runId: string, body: { payDate?: string; paymentDate: string; reference: string; note?: string }) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      // Validated INSIDE the permission boundary: an unauthorised caller gets
      // the 403 the permission owes them, not a validation hint.
      if (!body.reference || body.reference.trim().length < 3) {
        throw new ConflictException('Recording a payment needs the bank reference of the actual transfer.');
      }
      if (!body.paymentDate || Number.isNaN(new Date(body.paymentDate).getTime())) {
        throw new ConflictException('Recording a payment needs the date the money actually left.');
      }
      const { batch, standing } = await this.standingBatch(tx, runId, body.payDate);
      if (batch.status === PaymentBatchStatus.RECORDED_PAID) {
        throw new ConflictException('This listing is already recorded as paid.');
      }
      const paymentDate = new Date(`${body.paymentDate.slice(0, 10)}T00:00:00.000Z`);

      await tx.payrollPaymentBatch.update({
        where: { id: batch.id },
        data: {
          status: PaymentBatchStatus.RECORDED_PAID,
          paidRecordedAt: new Date(),
          paidRecordedByStaffId: actor.id,
          paymentDate,
          paymentReference: body.reference.trim(),
          note: body.note?.trim() || null,
        },
      });

      const run = await tx.payrollRun.findUniqueOrThrow({
        where: { id: runId },
        include: { lines: { select: { staffId: true } } },
      });
      const snapshot = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId, version: batch.snapshotVersion },
        select: { payload: true },
      });
      const payload = snapshot ? (snapshot.payload as unknown as SnapshotPayload) : null;
      const paysOn = dateKey(batch.payDate);
      const choices = payDateChoicesOf(run.payDates);
      const carriesSalary = paysOn === null || (payload !== null && paysOn === salaryDateOf(payload, choices));
      const everyDateRecorded = standing.every((other) => other.id === batch.id || other.status === PaymentBatchStatus.RECORDED_PAID);

      if (run.status === PayrollRunStatus.APPROVED) {
        await tx.payrollRun.update({
          where: { id: runId },
          data: {
            // `paymentDate` is the day the SALARY left, which is the date a
            // payslip and the portal show, and what releases the payslip to
            // the employee. `paidAt` is when the last transfer was recorded.
            ...(carriesSalary || run.paymentDate === null ? { paymentDate } : {}),
            ...(everyDateRecorded ? { status: PayrollRunStatus.PAID, paidAt: new Date() } : {}),
          },
        });
      }

      // A claim that rode on this run's lines has now been paid — on the date
      // its item is paid. Say so on the claim, so the employee's portal and the
      // claims queue stop calling it "approved, will be paid with your salary".
      const claimDate = (staffId: string) => {
        const date = payload?.employees
          .find((employee) => employee.staffId === staffId)
          ?.payslip?.componentLines.find((line) => line.code === 'CLAIM_REIMBURSEMENT')?.payDate;
        return date ? chosenPayDate(choices, date) : null;
      };
      const paidStaff = run.lines
        .map((line) => line.staffId)
        .filter((staffId) => paysOn === null || claimDate(staffId) === paysOn || (claimDate(staffId) === null && carriesSalary));
      const paidClaims = await tx.staffClaim.updateMany({
        where: {
          payoutStatus: 'IN_PAYROLL',
          paymentRoute: 'PAYROLL',
          payrollPeriod: run.period,
          staffId: { in: paidStaff },
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
          payDate: paysOn,
          paymentDate: body.paymentDate,
          reference: body.reference.trim(),
          totalCents: batch.totalCents,
          claimsPaidWithSalary: paidClaims.count,
          runPaid: everyDateRecorded,
        },
        source: 'hr.payroll',
      });
    });
    return this.status(runId);
  }
}
