import { useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Steps, Tag, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { downloadFile } from '../../core/api-client';
import { usePaymentStatus, usePreparePayment, useRecordPaymentPaid } from '../hooks/useAdmin';
import type { PaymentBatchLine } from '../types';

/**
 * PAYING THE MONTH — without ever claiming what has not happened.
 *
 * Kuwick talks to no bank. The panel walks the three honest states: a
 * prepared listing (a DOCUMENT), a downloaded listing (a document somebody
 * took), and a recorded transfer (a human wrote down the bank reference and
 * the date money left). The run reads PAID only after the third.
 *
 * Everyone the batch does NOT cover is on the screen with the reason —
 * an employee with no bank account is paid another way, not forgotten.
 */
export function PaymentPanel({ runId }: { runId: string }) {
  const { message } = App.useApp();
  const query = usePaymentStatus(runId);
  const prepare = usePreparePayment();
  const record = useRecordPaymentPaid();
  const [recordOpen, setRecordOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState<Dayjs | null>(dayjs());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = query.data;
  if (!data) return null;
  const batch = data.batch;

  const stepIndex = !batch ? 0 : batch.status === 'GENERATED' ? 1 : batch.status === 'DOWNLOADED' ? 2 : 3;

  const download = async () => {
    setBusy(true);
    try {
      await downloadFile(`/workforce/payroll/runs/${runId}/payment/listing`, 'payment-instruction-listing.csv');
      void query.refetch();
    } catch (e) {
      message.error(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminSection
      title="Paying this month"
      description="Kuwick prepares a listing and records what you did — it does not move money, and nothing here reads as paid until you record the actual transfer."
    >
      <Steps
        size="small"
        current={stepIndex}
        style={{ marginBottom: 16, maxWidth: 720 }}
        items={[
          { title: 'Prepare' },
          { title: 'Download listing' },
          { title: 'Pay at your bank' },
          { title: 'Record the transfer' },
        ]}
      />

      {!batch ? (
        <>
          <p className="kw-muted" style={{ marginTop: 0 }}>
            No payment batch has been prepared. Preparing composes the listing from the approved record — the frozen
            figures — with each person's bank details as on file today.
          </p>
          {data.mayPrepare ? (
            <Button type="primary" loading={prepare.isPending} onClick={() => prepare.mutate(runId, {
              onError: (e: Error) => message.error(e.message),
            })}>
              Prepare the payment batch
            </Button>
          ) : (
            <AdminNotice tone="info">
              Preparing a payment batch needs the bank-export permission. Ask the clinic owner.
            </AdminNotice>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <Tag color={batch.status === 'RECORDED_PAID' ? 'green' : batch.status === 'DOWNLOADED' ? 'blue' : 'default'}>
              {batch.status === 'RECORDED_PAID'
                ? `Transfer recorded — ${batch.paymentReference}`
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
                <Button loading={busy} onClick={() => void download()}>
                  Download instruction listing (CSV)
                </Button>
                <Tooltip title="Regenerate after fixing bank details or re-approving. The old batch is kept, superseded.">
                  <Button loading={prepare.isPending} onClick={() => prepare.mutate(runId, {
                    onError: (e: Error) => message.error(e.message),
                  })}>
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
                  setRecordOpen(true);
                }}
              >
                Record the transfer
              </Button>
            ) : null}
          </div>

          {batch.status !== 'RECORDED_PAID' ? (
            <AdminNotice tone="info">
              The listing is <strong>not a bank file</strong> — no verified bank format is on record. Key the payments
              in your bank's own portal, then record the transfer here with its reference.
            </AdminNotice>
          ) : null}

          <DataTable<PaymentBatchLine>
            rowKey="staffId"
            rows={batch.lines}
            emptyText="The batch is empty."
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
                    <Tooltip title="Not in the batch total — pay this another way and keep your own record.">
                      <span className="kw-muted" style={{ textDecoration: 'line-through' }}>
                        {money(row.amountCents / 100)}
                      </span>
                    </Tooltip>
                  ),
              },
            ]}
          />
          <p style={{ textAlign: 'right', margin: '10px 2px 0', fontSize: 13.5 }}>
            Batch total <strong>{money(batch.totalCents / 100)}</strong>
            {batch.excludedCount > 0 ? (
              <span className="kw-muted"> · {batch.excludedCount} paid outside the batch</span>
            ) : null}
          </p>
        </>
      )}

      <Modal
        open={recordOpen}
        title="Record the transfer"
        okText="Record it"
        confirmLoading={record.isPending}
        onCancel={() => setRecordOpen(false)}
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
          record.mutate(
            { runId, paymentDate: paymentDate.format('YYYY-MM-DD'), reference: reference.trim() },
            {
              onSuccess: () => {
                message.success('Recorded. The run now reads as paid.');
                setRecordOpen(false);
              },
              onError: (e: Error) => setError(e.message),
            },
          );
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <p style={{ marginTop: 8 }}>
          This states that the transfer was actually made at your bank. It is recorded with your name and becomes part
          of the payroll record.
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
