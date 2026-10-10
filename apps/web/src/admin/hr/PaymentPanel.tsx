import { useRef, useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Steps, Tag, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { downloadFile } from '../../core/api-client';
import { useChoosePayDate, usePaymentStatus, usePreparePayment, useRecordPaymentPaid } from '../hooks/useAdmin';
import type { PaymentBatch, PaymentBatchLine, PayDateChoiceRow } from '../types';

/** "30 Oct 2026". */
const day = (iso: string) => dayjs(iso).format('D MMM YYYY');

/**
 * PAYING THE MONTH — without ever claiming what has not happened.
 *
 * Kuwick talks to no bank. The panel walks the three honest states: a
 * prepared listing (a DOCUMENT), a downloaded listing (a document somebody
 * took), and a recorded transfer (a human wrote down the bank reference and
 * the date money left).
 *
 * ONE LISTING PER PAY DATE (UAT, 10 October 2026). A month whose items are
 * paid on more than one date — salary on the 30th, a director's fee on the
 * 1st, overtime and claims on the 15th — is paid in that many transfers, and
 * each date walks the three states on its own. The run reads PAID once every
 * date is recorded; the employee sees the payslip once the salary is.
 *
 * THE OWNER'S DATES FOR THIS RUN (UAT, 10 October 2026). An item's "Paid on"
 * in Payroll items is only the default date within the run's month; the owner
 * changes it here, for this run alone, until its listing is prepared.
 *
 * Everyone a listing does NOT cover is on the screen with the reason — an
 * employee with no bank account is paid another way, not forgotten.
 */
export function PaymentPanel({ runId }: { runId: string }) {
  const { message } = App.useApp();
  const query = usePaymentStatus(runId);
  const prepare = usePreparePayment();
  const record = useRecordPaymentPaid();
  const choose = useChoosePayDate();
  // The date picker can report one choice twice (typed, then Enter): it is asked for once.
  const asked = useRef<string | null>(null);
  const [recording, setRecording] = useState<PaymentBatch | null>(null);
  const [paymentDate, setPaymentDate] = useState<Dayjs | null>(dayjs());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const data = query.data;
  if (!data) return null;
  const batches = data.batches ?? (data.batch ? [data.batch] : []);
  const schedule = data.schedule ?? [];
  const manyDates = schedule.length > 1 || batches.length > 1;
  const payDates = data.payDates ?? [];
  const range = data.payDateRange;
  const choosing = Boolean(data.mayChooseDates) && payDates.some((row) => !row.locked);

  const changeDate = (row: PayDateChoiceRow, value: Dayjs | null) => {
    if (!value) return;
    const payDate = value.format('YYYY-MM-DD');
    const key = `${row.defaultDate}:${payDate}`;
    if (payDate === row.payDate || asked.current === key) return;
    asked.current = key;
    choose.mutate(
      { runId, defaultDate: row.defaultDate, payDate },
      {
        onSuccess: () =>
          message.success(
            payDate === row.defaultDate
              ? `Back to ${day(payDate)}, the date in Payroll items.`
              : `For this run, what is due on ${day(row.defaultDate)} goes out on ${day(payDate)}.`,
          ),
        onError: (e: Error) => message.error(e.message),
        onSettled: () => {
          asked.current = null;
        },
      },
    );
  };

  const download = async (batch: PaymentBatch) => {
    setBusy(batch.id);
    try {
      await downloadFile(
        `/workforce/payroll/runs/${runId}/payment/listing${batch.payDate ? `?payDate=${batch.payDate}` : ''}`,
        `payment-instruction-listing${batch.payDate ? `-${batch.payDate}` : ''}.csv`,
      );
      void query.refetch();
    } catch (e) {
      message.error(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const prepareAll = () =>
    prepare.mutate(runId, {
      onError: (e: Error) => message.error(e.message),
    });

  const listing = (batch: PaymentBatch) => {
    const stepIndex = batch.status === 'GENERATED' ? 1 : batch.status === 'DOWNLOADED' ? 2 : 3;
    return (
      <div key={batch.id} className="kw-payDate" data-testid={`pay-date-${batch.payDate ?? 'month'}`}>
        {manyDates ? (
          <h4 className="kw-payDate__title">
            Paid on {batch.payDate ? day(batch.payDate) : 'one date'}
            {batch.carriesSalary ? <span className="kw-muted"> · the salary</span> : null}
          </h4>
        ) : null}
        <Steps
          size="small"
          current={stepIndex}
          style={{ marginBottom: 16, maxWidth: 720 }}
          items={[{ title: 'Prepare' }, { title: 'Download listing' }, { title: 'Pay at your bank' }, { title: 'Record the transfer' }]}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Tag
            color={batch.status === 'RECORDED_PAID' ? 'green' : batch.status === 'DOWNLOADED' ? 'blue' : 'default'}
            style={{ whiteSpace: 'normal', marginInlineEnd: 0 }}
          >
            {batch.status === 'RECORDED_PAID'
              ? `Transfer recorded${batch.paymentDate ? ` on ${day(batch.paymentDate)}` : ''} — ${batch.paymentReference}`
              : batch.status === 'DOWNLOADED'
                ? 'Listing downloaded — money has NOT been claimed as moved'
                : 'Prepared — a document exists, nothing has moved'}
          </Tag>
          <span className="kw-muted" style={{ fontSize: 12.5 }}>
            Batch {batch.version} · from approved record v{batch.snapshotVersion} · prepared by {batch.createdBy}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {data.mayPrepare && batch.status !== 'RECORDED_PAID' ? (
            <>
              <Button loading={busy === batch.id} onClick={() => void download(batch)}>
                Download instruction listing (CSV)
              </Button>
              <Tooltip title="Regenerate after fixing bank details or re-approving. The old listing is kept, superseded; a date already recorded stays as it is.">
                <Button loading={prepare.isPending} onClick={prepareAll}>
                  Regenerate
                </Button>
              </Tooltip>
            </>
          ) : null}
          {batch.status !== 'RECORDED_PAID' ? (
            <Button
              type="primary"
              onClick={() => {
                setError(null);
                setReference('');
                setPaymentDate(batch.payDate && dayjs(batch.payDate).isBefore(dayjs()) ? dayjs(batch.payDate) : dayjs());
                setRecording(batch);
              }}
            >
              Record the transfer
            </Button>
          ) : null}
        </div>

        <DataTable<PaymentBatchLine>
          rowKey="staffId"
          rows={batch.lines}
          emptyText="The listing is empty."
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            {
              title: 'Paid to',
              key: 'bank',
              render: (_: unknown, row: PaymentBatchLine) =>
                row.included ? (
                  <span>
                    {row.bankName} <span className="kw-muted">· ending {row.accountEnding}</span>
                  </span>
                ) : (
                  <span style={{ color: '#b45309' }}>{row.exclusionReason}</span>
                ),
            },
            {
              title: 'Amount',
              width: 140,
              align: 'right' as const,
              render: (_: unknown, row: PaymentBatchLine) =>
                row.included ? (
                  <strong>{money(row.amountCents / 100)}</strong>
                ) : (
                  <Tooltip title="Not in the listing total — pay this another way and keep your own record.">
                    <span className="kw-muted" style={{ textDecoration: 'line-through' }}>
                      {money(row.amountCents / 100)}
                    </span>
                  </Tooltip>
                ),
            },
          ]}
        />
        <p style={{ textAlign: 'right', margin: '10px 2px 0', fontSize: 13.5 }}>
          {manyDates && batch.payDate ? `Total for ${day(batch.payDate)}` : 'Batch total'} <strong>{money(batch.totalCents / 100)}</strong>
          {batch.excludedCount > 0 ? <span className="kw-muted"> · {batch.excludedCount} not in this listing</span> : null}
        </p>
      </div>
    );
  };

  return (
    <AdminSection
      title="Paying this month"
      description="Kuwick prepares a listing and records what you did — it does not move money, and nothing here reads as paid until you record the actual transfer."
    >
      {schedule.length > 1 ? (
        <AdminNotice tone="info">
          <span data-testid="pay-schedule">
            This month is paid on {schedule.length} dates:{' '}
            {schedule.map((entry) => `${entry.payDate ? day(entry.payDate) : 'one date'} ${money(entry.totalCents / 100)}`).join(' · ')}. Each
            date has its own listing and its own recorded transfer. The statutory figures and the payslip stay on the whole month.
          </span>
        </AdminNotice>
      ) : null}

      {choosing ? (
        <div className="kw-payDate kw-runPayDates" data-testid="run-pay-dates">
          <h4 className="kw-payDate__title">Pay dates for this run</h4>
          <p className="kw-muted" style={{ marginTop: 0 }}>
            Each date starts from the item&apos;s &ldquo;Paid on&rdquo; in Payroll items. Change it here for this run, before its
            listing is prepared. The amounts and the statutory figures stay as approved.
          </p>
          {payDates.map((row) => (
            // One row per date; on a phone the date wraps under what is paid on it.
            <div key={row.defaultDate} className="kw-runPayDates__row" data-testid={`run-pay-date-${row.defaultDate}`}>
              <div className="kw-runPayDates__what">
                <div>{row.items.length > 0 ? row.items.join(' · ') : 'Net pay'}</div>
                <div className="kw-muted" style={{ fontSize: 12.5 }}>
                  {money(row.totalCents / 100)} · {day(row.defaultDate)} in Payroll items
                </div>
              </div>
              <div className="kw-runPayDates__when">
                {row.locked ? (
                  <span>
                    {day(row.payDate)} <span className="kw-muted">· listing prepared</span>
                  </span>
                ) : (
                  <>
                    <DatePicker
                      aria-label={`Pay on, for what is due ${day(row.defaultDate)}`}
                      value={dayjs(row.payDate)}
                      format="D MMM YYYY"
                      allowClear={false}
                      disabled={choose.isPending}
                      disabledDate={(date) =>
                        range ? date.isBefore(dayjs(range.from), 'day') || date.isAfter(dayjs(range.to), 'day') : false
                      }
                      onChange={(value) => changeDate(row, value)}
                    />
                    {row.payDate !== row.defaultDate ? (
                      <span className="kw-muted" style={{ fontSize: 12.5 }}>
                        Changed for this run.{' '}
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          disabled={choose.isPending}
                          onClick={() => changeDate(row, dayjs(row.defaultDate))}
                        >
                          Back to {day(row.defaultDate)}
                        </Button>
                      </span>
                    ) : dayjs(row.payDate).isBefore(dayjs(), 'day') ? (
                      // A hint, never a block: money may well have gone on that day.
                      <span style={{ fontSize: 12.5, color: '#b45309' }}>
                        Already paid on {dayjs(row.payDate).format('D MMM')}? Record the transfer with that date.
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {batches.length === 0 ? (
        <>
          <Steps
            size="small"
            current={0}
            style={{ marginBottom: 16, maxWidth: 720 }}
            items={[{ title: 'Prepare' }, { title: 'Download listing' }, { title: 'Pay at your bank' }, { title: 'Record the transfer' }]}
          />
          <p className="kw-muted" style={{ marginTop: 0 }}>
            No payment listing has been prepared. Preparing composes {manyDates ? 'a listing for each date' : 'the listing'} from the
            approved record — the frozen figures — with each person's bank details as on file today.
          </p>
          {data.mayPrepare ? (
            <Button type="primary" loading={prepare.isPending} onClick={prepareAll}>
              {manyDates ? 'Prepare the payment listings' : 'Prepare the payment batch'}
            </Button>
          ) : (
            <AdminNotice tone="info">Preparing a payment batch needs the bank-export permission. Ask the clinic owner.</AdminNotice>
          )}
        </>
      ) : (
        <>
          {batches.some((batch) => batch.status !== 'RECORDED_PAID') ? (
            <AdminNotice tone="info">
              A listing is <strong>not a bank file</strong>: no verified bank format is on record. Key the payments at your bank&apos;s
              portal, then record the transfer here with its reference.
            </AdminNotice>
          ) : null}
          {batches.map(listing)}
        </>
      )}

      <Modal
        open={Boolean(recording)}
        title={recording?.payDate && manyDates ? `Record the transfer for ${day(recording.payDate)}` : 'Record the transfer'}
        okText="Record it"
        confirmLoading={record.isPending}
        onCancel={() => setRecording(null)}
        onOk={() => {
          setError(null);
          if (!paymentDate) {
            setError('When did the money leave the account?');
            return;
          }
          if (reference.trim().length < 3) {
            setError('The bank gave the transfer a reference. It is what makes this a record and not a claim.');
            return;
          }
          const others = batches.filter((batch) => batch.id !== recording?.id && batch.status !== 'RECORDED_PAID').length;
          record.mutate(
            {
              runId,
              payDate: recording?.payDate ?? undefined,
              paymentDate: paymentDate.format('YYYY-MM-DD'),
              reference: reference.trim(),
            },
            {
              onSuccess: () => {
                message.success(
                  others === 0
                    ? 'Recorded. The run now reads as paid.'
                    : `Recorded. ${others} more date${others === 1 ? '' : 's'} to pay this month.`,
                );
                setRecording(null);
              },
              onError: (e: Error) => setError(e.message),
            },
          );
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <p style={{ marginTop: 8 }}>
          This states that the transfer was actually made at your bank. It is recorded with your name and becomes part of the
          payroll record.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Date the money left</div>
            <DatePicker value={paymentDate} onChange={setPaymentDate} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Bank reference</div>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. IBG-20260728-000123" />
          </div>
        </div>
      </Modal>
    </AdminSection>
  );
}
