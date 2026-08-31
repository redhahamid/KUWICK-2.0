import { useState } from 'react';
import { App, Button, Checkbox, DatePicker, Input, InputNumber, Modal, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable, money, moneyOrDash } from '../components/DataTable';
import { useCan } from '../../core/hooks/useCan';
import {
  useAdjudicateClaim,
  useMarkBatchSubmitted,
  usePanelAwaitingPayment,
  usePanelReconciliation,
  usePanelSubmissionQueue,
  usePanelWorkQueue,
  useRecordRemittance,
  useResubmitClaim,
  useWriteOffClaim,
} from '../hooks/useAdmin';
import type { PanelAwaitingPaymentRow, PanelWorkQueueRow, SubmissionQueueRow } from '../types';
import { canRecordOutcome, canReclaim, canWriteOff } from './claimActions';

const STATUS_COLOUR: Record<string, string> = {
  READY: 'blue',
  NEEDS_INFORMATION: 'red',
  BATCHED: 'default',
  SUBMITTED: 'blue',
  ACKNOWLEDGED: 'cyan',
  APPROVED: 'green',
  PARTIALLY_APPROVED: 'gold',
  REJECTED: 'red',
  RESUBMISSION_REQUIRED: 'orange',
  RESUBMITTED: 'purple',
  PAID: 'green',
  PARTIALLY_PAID: 'gold',
  WRITTEN_OFF: 'default',
  CLOSED: 'default',
};

/**
 * PANEL — the module's first question, in the brief's own words:
 *
 *   "What has not been submitted, what was rejected, and what money is still
 *    outstanding?"
 *
 * So the page is those three, in that order, and the reconciliation identity is
 * shown as a CHECK rather than as a set of numbers a reader has to add up
 * themselves.
 *
 * And it says, on the screen and not just in a comment, that Kuwick does not
 * submit anything. The portal link and the checklist are what this system can
 * honestly offer; the keying-in is still a person's job.
 */
export function PanelWorkspacePage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<'submit' | 'work' | 'reconcile'>('submit');
  const queue = usePanelSubmissionQueue();
  /**
   * RESOLVED CLAIMS ARE HIDDEN BY DEFAULT AND FINDABLE ON DEMAND.
   *
   * A work queue that keeps settled claims in it stops being a work queue. But
   * "we resolved that in March" is a question somebody asks, and a queue that
   * can never show a resolved row cannot answer it — which is how a claim gets
   * chased twice.
   */
  const [includeResolved, setIncludeResolved] = useState(false);
  const work = usePanelWorkQueue({ includeResolved });
  const reconciliation = usePanelReconciliation({});

  const markSubmitted = useMarkBatchSubmitted();
  const adjudicate = useAdjudicateClaim();
  const resubmit = useResubmitClaim();
  const writeOff = useWriteOffClaim();
  const recordRemittance = useRecordRemittance();

  const maySubmit = useCan('panel.claim.submit');
  const mayManage = useCan('panel.claim.manage');
  const mayWriteOff = useCan('panel.writeOff');
  const mayRecordReceipt = useCan('panel.receipt.record');

  const [adjudicating, setAdjudicating] = useState<PanelWorkQueueRow | SubmissionQueueRow | null>(null);
  const [approved, setApproved] = useState('');
  const [rejected, setRejected] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [claimNo, setClaimNo] = useState('');

  const [resubmitting, setResubmitting] = useState<PanelWorkQueueRow | null>(null);
  const [resubmitReason, setResubmitReason] = useState('');

  const [writingOff, setWritingOff] = useState<PanelWorkQueueRow | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');

  /**
   * RECORDING A PANEL PAYMENT.
   *
   * This was the module's largest gap: every step up to the money worked, and
   * then the money itself was recorded nowhere. The endpoint has always been
   * there; nothing called it, so the clinic went back to the spreadsheet to
   * write down what a panel had actually paid.
   *
   * The server requires the allocations to total the net EXACTLY — a remittance
   * that does not add up is refused at entry rather than found weeks later in a
   * reconciliation. That is the right rule and this form is built around it:
   * the difference is shown live, "Allocate oldest first" does the arithmetic
   * a person would otherwise do by hand, and the submit button stays disabled
   * until the two agree.
   */
  const [receipting, setReceipting] = useState(false);
  const [receiptPanel, setReceiptPanel] = useState<string | undefined>();
  const [receiptDate, setReceiptDate] = useState<dayjs.Dayjs | null>(dayjs());
  const [receiptGross, setReceiptGross] = useState<number | null>(null);
  const [receiptWithheld, setReceiptWithheld] = useState<number | null>(null);
  const [receiptRef, setReceiptRef] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  const owed = usePanelAwaitingPayment({}, receipting);

  const [submitting, setSubmitting] = useState<SubmissionQueueRow | null>(null);
  const [method, setMethod] = useState('PORTAL');
  const [reference, setReference] = useState('');

  const totals = reconciliation.data?.totals;
  const aging = reconciliation.data?.aging;
  const notReady = queue.data?.filter((row) => !row.ready) ?? [];
  const overdue = work.data?.filter((row) => row.overdue) ?? [];
  const rejectedRows = work.data?.filter((row) => row.status === 'REJECTED' || row.status === 'PARTIALLY_APPROVED') ?? [];

  // Claims this panel still owes money on, oldest first — the order somebody
  // chasing a payment actually works in.
  //
  // From its OWN endpoint, not from the work queue. The work queue is the
  // PROBLEM queue — rejected, part-approved, overdue — so building the form on
  // it made a healthy approved claim unallocatable.
  const awaitingPayment = (owed.data ?? [])
    .filter((row) => row.panelClinicId === receiptPanel)
    .sort((a, b) => b.ageDays - a.ageDays);

  /**
   * WHAT A PANEL CAN ACTUALLY PAY, which is not what it owes.
   *
   * The reconciliation's outstanding figure counts claims that have been
   * batched but never submitted — genuinely receivable, and genuinely not
   * payable, because the panel has not been asked yet. Labelling the picker
   * "RM205.80 outstanding" and then offering RM60 of rows to allocate against
   * is the kind of quiet contradiction this module exists to avoid, so the
   * picker states the payable figure and the notice below explains the gap.
   */
  const payableByPanel = new Map<string, number>();
  for (const row of owed.data ?? []) {
    payableByPanel.set(
      row.panelClinicId,
      Math.round(((payableByPanel.get(row.panelClinicId) ?? 0) + row.outstanding) * 100) / 100,
    );
  }
  const selectedPanelTotals = (reconciliation.data?.byPanel ?? []).find((row) => row.panelClinicId === receiptPanel);
  const payableForSelected = receiptPanel ? (payableByPanel.get(receiptPanel) ?? 0) : 0;
  const notYetSubmitted = selectedPanelTotals
    ? Math.round((selectedPanelTotals.outstanding - payableForSelected) * 100) / 100
    : 0;
  const netToAllocate = Math.round(((receiptGross ?? 0) - (receiptWithheld ?? 0)) * 100) / 100;
  const allocatedTotal = Math.round(Object.values(allocations).reduce((sum, value) => sum + (value || 0), 0) * 100) / 100;
  const allocationDifference = Math.round((netToAllocate - allocatedTotal) * 100) / 100;
  const receiptReady = Boolean(receiptPanel) && netToAllocate > 0 && allocationDifference === 0 && Boolean(receiptDate);

  function resetReceipt() {
    setReceipting(false);
    setReceiptPanel(undefined);
    setReceiptGross(null);
    setReceiptWithheld(null);
    setReceiptRef('');
    setAllocations({});
    setReceiptDate(dayjs());
  }

  /** The arithmetic a person would otherwise do by hand, oldest claim first. */
  function allocateOldestFirst() {
    let left = netToAllocate;
    const next: Record<string, number> = {};
    for (const row of awaitingPayment) {
      if (left <= 0) break;
      const take = Math.min(left, row.outstanding);
      next[row.claimLineId] = Math.round(take * 100) / 100;
      left = Math.round((left - take) * 100) / 100;
    }
    setAllocations(next);
  }

  return (
    <AdminShell
      error={firstError(queue, work, reconciliation)}
      title="Panel Claims"
      subtitle="What has not been submitted, what was rejected, and what money is still outstanding."
      actions={
        <Button.Group size="small">
          <Button type={tab === 'submit' ? 'primary' : 'default'} onClick={() => setTab('submit')}>
            To submit ({queue.data?.length ?? 0})
          </Button>
          <Button type={tab === 'work' ? 'primary' : 'default'} onClick={() => setTab('work')}>
            Work queue ({work.data?.length ?? 0})
          </Button>
          <Button type={tab === 'reconcile' ? 'primary' : 'default'} onClick={() => setTab('reconcile')}>
            Reconciliation
          </Button>
        </Button.Group>
      }
    >
      <StatStrip
        stats={[
          {
            label: 'Expected receivable',
            value: money(totals?.expectedReceivable ?? 0),
            hint: `${totals?.claims ?? 0} claims`,
            explain: 'What the clinic asked panels for: claimed plus each panel’s admin fee.',
          },
          { label: 'Received', value: money(totals?.received ?? 0), tone: 'good' },
          {
            label: 'Outstanding',
            value: money(totals?.outstanding ?? 0),
            tone: (totals?.outstanding ?? 0) > 0 ? 'warn' : 'good',
            explain: 'Once a panel has adjudicated, this is what they APPROVED — not what was claimed. Chasing a rejected amount as receivable is how a ledger drifts above what will ever be banked.',
          },
          { label: 'Rejected', value: money(totals?.rejected ?? 0), tone: (totals?.rejected ?? 0) > 0 ? 'bad' : 'neutral' },
          { label: 'Written off', value: money(totals?.writtenOff ?? 0) },
          {
            label: 'Reconciles',
            value: reconciliation.data?.reconciles ? 'Yes' : 'NO',
            tone: reconciliation.data?.reconciles ? 'good' : 'bad',
            explain: 'received + outstanding + rejected + written off = claimed + fees. Computed, not assumed.',
          },
        ]}
      />

      {reconciliation.data && !reconciliation.data.reconciles ? (
        <AdminNotice tone="warn">
          The panel ledger does not reconcile. Received, outstanding, rejected and written-off amounts do not add up to
          what was claimed — investigate before relying on any figure on this page.
        </AdminNotice>
      ) : null}

      {tab === 'submit' ? (
        <>
          <AdminNotice>
            Kuwick does not submit to any panel portal. No panel in use here offers an interface it could submit to, so
            a staff member keys each claim in. What this screen does is tell you WHICH claims, check they are complete
            first, and record what the portal gave back.
          </AdminNotice>
          {notReady.length > 0 ? (
            <AdminNotice tone="warn">
              {notReady.length} claim(s) are missing something this panel requires. Fix them before opening the portal
              rather than after being rejected.
            </AdminNotice>
          ) : null}
          <AdminSection title="Ready to submit" padded={false}>
            <DataTable
              rows={queue.data}
              loading={queue.isLoading}
              rowKey="claimLineId"
              exportName="panel-submission-queue"
              searchFields={['panelName' as never, 'patientName' as never, 'invoiceNumber' as never]}
              searchPlaceholder="Search panel, patient or invoice…"
              emptyText="Nothing waiting to be submitted"
              columns={[
                {
                  title: '',
                  key: 'ready',
                  width: 34,
                  render: (_: unknown, row) =>
                    row.ready ? (
                      <Tag color="green">✓</Tag>
                    ) : (
                      <Tooltip title={row.missing.join('; ')}>
                        <Tag color="red">!</Tag>
                      </Tooltip>
                    ),
                },
                { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
                { title: 'Payer', dataIndex: 'payerName', key: 'payerName', optional: true },
                { title: 'Batch', dataIndex: 'batchNumber', key: 'batchNumber' },
                { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
                {
                  title: 'Service date',
                  dataIndex: 'serviceDate',
                  key: 'serviceDate',
                  render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : '—'),
                },
                { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
                { title: 'IC', dataIndex: 'patientIdentifier', key: 'patientIdentifier', optional: true },
                { title: 'Doctor', dataIndex: 'doctorName', key: 'doctorName', optional: true },
                {
                  title: 'Diagnosis',
                  dataIndex: 'diagnoses',
                  key: 'diagnoses',
                  optional: true,
                  render: (values: string[]) => values.join(', ') || <span className="kw-muted">none recorded</span>,
                },
                { title: 'Claimed', dataIndex: 'claimedAmount', key: 'claimedAmount', className: 'kw-num', render: (v: number) => money(v) },
                { title: 'Fee', dataIndex: 'feeAmount', key: 'feeAmount', className: 'kw-num', render: (v: number) => money(v) },
                {
                  title: 'Receivable',
                  dataIndex: 'expectedReceivable',
                  key: 'expectedReceivable',
                  className: 'kw-num',
                  render: (v: number) => <strong>{money(v)}</strong>,
                },
                {
                  title: 'Missing',
                  dataIndex: 'missing',
                  key: 'missing',
                  render: (values: string[]) =>
                    values.length === 0 ? <span className="kw-good">Complete</span> : <span className="kw-bad">{values.join('; ')}</span>,
                },
                {
                  title: '',
                  key: 'action',
                  noExport: true,
                  render: (_: unknown, row) => (
                    <>
                      {row.portalUrl ? (
                        <Button size="small" type="link" href={row.portalUrl} target="_blank" rel="noreferrer">
                          Open portal
                        </Button>
                      ) : null}
                      {maySubmit ? (
                        <Button size="small" type="link" onClick={() => setSubmitting(row)}>
                          Mark submitted
                        </Button>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
          </AdminSection>
        </>
      ) : null}

      {tab === 'work' ? (
        <>
          <ExceptionTiles
            tiles={[
              { key: 'rejected', label: 'Rejected or part-approved', count: rejectedRows.length, tone: 'bad' },
              { key: 'overdue', label: 'Past the panel’s payment term', count: overdue.length, tone: 'warn' },
              { key: 'all', label: 'Open work items', count: work.data?.length ?? 0, tone: 'info' },
            ]}
          />
          <AdminSection
            title="Work queue"
            description="Every claim that needs somebody to do something: rejected, partly approved, or overdue against the panel's own payment terms."
            padded={false}
          >
            <DataTable
              rows={work.data}
              loading={work.isLoading}
              rowKey="claimLineId"
              exportName="panel-work-queue"
              searchFields={['panelName' as never, 'patientName' as never, 'invoiceNumber' as never, 'panelClaimNo' as never]}
              searchPlaceholder="Search panel, patient, invoice or claim number…"
              emptyText="Nothing needs chasing"
              emptyHint="Every claim is either awaiting a panel inside its terms, or settled."
              scrollY={520}
              toolbar={
                <Checkbox checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)}>
                  Include resolved
                </Checkbox>
              }
              columns={[
                { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  key: 'status',
                  render: (value: string) => <Tag color={STATUS_COLOUR[value]}>{value.replace(/_/g, ' ')}</Tag>,
                },
                { title: 'Claim no', dataIndex: 'panelClaimNo', key: 'panelClaimNo' },
                {
                  // THE ORIGINAL CLAIM NUMBER. The sheet this replaces carries
                  // it beside the replacement, because six months later the
                  // argument with the panel is conducted in both references and
                  // "which claim was this instead of?" is the first question.
                  title: 'Replaces',
                  dataIndex: 'supersedes',
                  key: 'supersedes',
                  optional: true,
                  render: (value: PanelWorkQueueRow['supersedes']) =>
                    value ? (
                      <Tooltip title={value.rejectionReason ?? 'Re-claimed'}>
                        <Tag color="purple">{value.panelClaimNo ?? value.batchNumber}</Tag>
                      </Tooltip>
                    ) : (
                      '—'
                    ),
                },
                { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
                {
                  title: 'Service date',
                  dataIndex: 'serviceDate',
                  key: 'serviceDate',
                  render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : '—'),
                },
                { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
                {
                  title: 'Age',
                  dataIndex: 'ageDays',
                  key: 'ageDays',
                  className: 'kw-num',
                  sorter: (a, b) => a.ageDays - b.ageDays,
                  defaultSortOrder: 'descend',
                  render: (days: number, row) => (
                    <span className={row.overdue ? 'kw-bad' : days > 60 ? 'kw-warn' : undefined}>{days}d</span>
                  ),
                },
                {
                  title: 'Due',
                  dataIndex: 'dueDate',
                  key: 'dueDate',
                  render: (value: string | null, row) =>
                    value ? (
                      <Tooltip title={row.paymentTermDays ? `${row.paymentTermDays}-day payment term` : undefined}>
                        <span className={row.overdue ? 'kw-bad' : undefined}>{dayjs(value).format('D MMM YY')}</span>
                      </Tooltip>
                    ) : (
                      <span className="kw-muted">no term</span>
                    ),
                },
                {
                  // Terms per panel, because aging is judged against the panel's
                  // own promise rather than a fixed bucket.
                  title: 'Terms',
                  dataIndex: 'paymentTermDays',
                  key: 'paymentTermDays',
                  className: 'kw-num',
                  optional: true,
                  render: (days: number | null) => (days === null ? <span className="kw-muted">none set</span> : `${days}d`),
                },
                {
                  // CLAIMED, FEE AND RECEIVABLE ARE THREE NUMBERS.
                  //
                  // This column read `expectedReceivable` under the heading
                  // "Claimed", which is claimed PLUS the panel's admin fee. On
                  // a panel carrying an 8% fee that is RM108 displayed as the
                  // RM100 that was claimed — a heading and a value describing
                  // different quantities, on the screen whose entire purpose is
                  // reconciling against what the panel says it received.
                  title: 'Claimed',
                  dataIndex: 'claimedAmount',
                  key: 'claimedAmount',
                  className: 'kw-num',
                  render: (v: number) => money(v),
                },
                {
                  title: 'Fee',
                  dataIndex: 'feeAmount',
                  key: 'feeAmount',
                  className: 'kw-num',
                  render: (v: number) => (v === 0 ? <span className="kw-muted">—</span> : money(v)),
                },
                {
                  title: 'Receivable',
                  dataIndex: 'expectedReceivable',
                  key: 'expectedReceivable',
                  className: 'kw-num',
                  render: (v: number) => money(v),
                },
                {
                  title: 'Approved',
                  dataIndex: 'approvedAmount',
                  key: 'approvedAmount',
                  className: 'kw-num',
                  render: (value: number | null) => moneyOrDash(value),
                },
                {
                  title: 'Rejected',
                  dataIndex: 'rejectedAmount',
                  key: 'rejectedAmount',
                  className: 'kw-num',
                  render: (value: number | null) => (value ? <span className="kw-bad">{money(value)}</span> : '—'),
                },
                { title: 'Received', dataIndex: 'receivedAmount', key: 'receivedAmount', className: 'kw-num', render: (v: number | null) => moneyOrDash(v) },
                {
                  title: 'Outstanding',
                  dataIndex: 'outstanding',
                  key: 'outstanding',
                  className: 'kw-num',
                  render: (value: number) => <strong>{money(value)}</strong>,
                },
                {
                  title: 'Replaced by',
                  dataIndex: 'replacement',
                  key: 'replacement',
                  render: (value: PanelWorkQueueRow['replacement']) =>
                    value ? (
                      <Tooltip title={`Raised ${dayjs(value.raisedAt).format('D MMM YY')} · ${value.status.replace(/_/g, ' ')}`}>
                        <Tag color="purple">{value.panelClaimNo ?? value.batchNumber}</Tag>
                      </Tooltip>
                    ) : (
                      '—'
                    ),
                },
                {
                  // RESUBMITTED, not "re-claim exists". A replacement that has
                  // been raised but not sent is a claim nobody at the panel has
                  // seen, and this module's whole discipline is that preparing
                  // and sending are different events.
                  title: 'Resubmitted',
                  dataIndex: 'replacement',
                  key: 'resubmittedAt',
                  render: (value: PanelWorkQueueRow['replacement']) =>
                    !value ? (
                      '—'
                    ) : value.resubmittedAt ? (
                      dayjs(value.resubmittedAt).format('D MMM YY')
                    ) : (
                      <span className="kw-warn">not sent yet</span>
                    ),
                },
                {
                  // AFTER the re-claim chain, not before it. A free-text
                  // rejection reason is the widest column on this table, and
                  // sitting it in front of "Replaced by" and "Resubmitted"
                  // pushed both past the right edge — so the two columns that
                  // answer "has this been chased again, and when" were only
                  // reachable by scrolling a table nobody scrolls.
                  title: 'Reason',
                  dataIndex: 'rejectionReason',
                  key: 'rejectionReason',
                  ellipsis: true,
                  render: (value: string | null) =>
                    value ? <Tooltip title={value}>{value}</Tooltip> : <span className="kw-muted">—</span>,
                },
                {
                  title: 'Resolved',
                  dataIndex: 'resolvedAt',
                  key: 'resolvedAt',
                  optional: true,
                  render: (value: string | null, row) =>
                    value ? (
                      <Tooltip title={row.resolutionNote ?? undefined}>
                        <span className="kw-good">{dayjs(value).format('D MMM YY')}</span>
                      </Tooltip>
                    ) : (
                      <span className="kw-muted">open</span>
                    ),
                },
                {
                  title: '',
                  key: 'action',
                  noExport: true,
                  render: (_: unknown, row) => (
                    <>
                      {mayManage && canRecordOutcome(row) ? (
                        <Button size="small" type="link" onClick={() => { setAdjudicating(row); setApproved(''); setRejected(''); setRejectionReason(''); setClaimNo(row.panelClaimNo ?? ''); }}>
                          Record outcome
                        </Button>
                      ) : null}
                      {mayManage && canReclaim(row) ? (
                        <Button size="small" type="link" onClick={() => { setResubmitting(row); setResubmitReason(''); }}>
                          Re-claim
                        </Button>
                      ) : null}
                      {mayWriteOff && canWriteOff(row) ? (
                        <Button size="small" type="link" danger onClick={() => { setWritingOff(row); setWriteOffReason(''); }}>
                          Write off
                        </Button>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
          </AdminSection>
        </>
      ) : null}

      {tab === 'reconcile' ? (
        <>
          <AdminSection
            title="Money received"
            description="A panel payment settles specific claims. Recording which ones is what keeps the outstanding figure true."
            actions={
              <Tooltip title={mayRecordReceipt ? '' : 'Your account is not permitted to record panel receipts.'}>
                <Button type="primary" size="small" disabled={!mayRecordReceipt} onClick={() => setReceipting(true)}>
                  Record a payment
                </Button>
              </Tooltip>
            }
          >
            <AdminNotice>
              Kuwick does not read any panel’s bank file or statement. Somebody reads the remittance advice and enters
              it here. What this screen adds is the check the spreadsheet never did: the amounts allocated to individual
              claims must equal the payment exactly, or it is not accepted.
            </AdminNotice>
          </AdminSection>

          <AdminSection title="Outstanding by age" description="Aged from the day the claim was submitted, not the service date.">
            <ExceptionTiles
              tiles={[
                { key: 'c', label: `0–30 days · ${money(aging?.current ?? 0)}`, count: 0, tone: 'info' },
                { key: 'a', label: `31–60 days · ${money(aging?.d31_60 ?? 0)}`, count: 0, tone: 'warn' },
                { key: 'b', label: `61–90 days · ${money(aging?.d61_90 ?? 0)}`, count: 0, tone: 'warn' },
                { key: 'd', label: `Over 90 · ${money(aging?.d90_plus ?? 0)}`, count: 0, tone: 'bad' },
              ]}
            />
          </AdminSection>
          <AdminSection title="By panel" padded={false}>
            <DataTable
              rows={reconciliation.data?.byPanel}
              loading={reconciliation.isLoading}
              rowKey="panelClinicId"
              exportName="panel-reconciliation"
              emptyText="No claims yet"
              columns={[
                { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
                { title: 'Claims', dataIndex: 'claims', key: 'claims', className: 'kw-num' },
                { title: 'Expected', dataIndex: 'expectedReceivable', key: 'expectedReceivable', className: 'kw-num', render: (v: number) => money(v) },
                { title: 'Received', dataIndex: 'received', key: 'received', className: 'kw-num', render: (v: number) => money(v) },
                {
                  title: 'Outstanding',
                  dataIndex: 'outstanding',
                  key: 'outstanding',
                  className: 'kw-num',
                  sorter: (a, b) => a.outstanding - b.outstanding,
                  defaultSortOrder: 'descend',
                  render: (v: number) => <strong>{money(v)}</strong>,
                },
                {
                  title: 'Collected',
                  dataIndex: 'collectionRate',
                  key: 'collectionRate',
                  className: 'kw-num',
                  render: (rate: number | null) =>
                    rate === null ? '—' : <span className={rate < 80 ? 'kw-warn' : 'kw-good'}>{rate}%</span>,
                },
                { title: 'Overdue', dataIndex: 'overdueClaims', key: 'overdueClaims', className: 'kw-num' },
                {
                  title: 'Turnaround',
                  dataIndex: 'averageTurnaroundDays',
                  key: 'averageTurnaroundDays',
                  className: 'kw-num',
                  render: (days: number | null) => (days === null ? '—' : `${days}d`),
                },
              ]}
            />
          </AdminSection>
        </>
      ) : null}

      {/* --- Mark submitted --- */}
      <Modal
        open={submitting !== null}
        title={`Mark ${submitting?.batchNumber ?? ''} submitted`}
        okText="Record the submission"
        confirmLoading={markSubmitted.isPending}
        onCancel={() => setSubmitting(null)}
        onOk={() =>
          submitting &&
          markSubmitted.mutate(
            { batchId: submitting.batchId, submissionMethod: method, submissionReference: reference || undefined },
            {
              onSuccess: () => {
                message.success('Submission recorded');
                setSubmitting(null);
                setReference('');
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          This records that YOU submitted the claim. Kuwick did not: it has no connection to {submitting?.panelName}’s
          portal and receives no acknowledgement from it.
        </AdminNotice>
        {submitting?.documentRequirements?.length ? (
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 12.5 }}>{submitting.panelName} requires:</strong>
            <ul style={{ margin: '4px 0 0 18px', fontSize: 12.5 }}>
              {submitting.documentRequirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Select
          size="small"
          style={{ width: '100%', marginBottom: 8 }}
          value={method}
          onChange={setMethod}
          options={['PORTAL', 'EMAIL', 'COURIER', 'IN_PERSON', 'OTHER'].map((value) => ({ value, label: value }))}
        />
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Reference the portal gave back (optional)"
        />
      </Modal>

      {/* --- Adjudication --- */}
      <Modal
        open={adjudicating !== null}
        title="Record what the panel said"
        okText="Record"
        confirmLoading={adjudicate.isPending}
        onCancel={() => setAdjudicating(null)}
        onOk={() =>
          adjudicating &&
          adjudicate.mutate(
            {
              claimLineId: adjudicating.claimLineId,
              approvedAmount: approved || '0',
              rejectedAmount: rejected || undefined,
              rejectionReason: rejectionReason || undefined,
              panelClaimNo: claimNo || undefined,
            },
            {
              onSuccess: () => {
                message.success('Outcome recorded');
                setAdjudicating(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          Recording what a panel APPROVED is not recording money. The payment is a separate event, and the gap between
          the two is what the outstanding figure measures.
        </AdminNotice>
        <p style={{ fontSize: 12.5, marginBottom: 8 }}>
          Claimed: <strong>{money(adjudicating?.expectedReceivable ?? 0)}</strong>
        </p>
        <Input addonBefore="Approved" value={approved} onChange={(event) => setApproved(event.target.value)} placeholder="0.00" style={{ marginBottom: 8 }} />
        <Input addonBefore="Rejected" value={rejected} onChange={(event) => setRejected(event.target.value)} placeholder="0.00" style={{ marginBottom: 8 }} />
        <Input.TextArea
          rows={2}
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
          placeholder="The panel's reason (required if anything was rejected)"
          style={{ marginBottom: 8 }}
        />
        <Input addonBefore="Claim no" value={claimNo} onChange={(event) => setClaimNo(event.target.value)} />
      </Modal>

      {/* --- Resubmission --- */}
      <Modal
        open={resubmitting !== null}
        title="Re-claim under a new claim number"
        okText="Create the replacement claim"
        okButtonProps={{ disabled: resubmitReason.trim().length < 5 }}
        confirmLoading={resubmit.isPending}
        onCancel={() => setResubmitting(null)}
        onOk={() =>
          resubmitting &&
          resubmit.mutate(
            { claimLineId: resubmitting.claimLineId, reason: resubmitReason },
            {
              onSuccess: () => {
                message.success('Replacement claim created');
                setResubmitting(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <p style={{ fontSize: 12.5 }}>
          A new claim will be created for <strong>{money(resubmitting?.rejectedAmount ?? 0)}</strong> — the amount the
          panel refused, not the whole original, which would double-claim the half they already agreed to pay. The
          original is linked to it and stops being chased.
        </p>
        <Input.TextArea
          rows={3}
          value={resubmitReason}
          onChange={(event) => setResubmitReason(event.target.value)}
          placeholder="Why is this being re-claimed?"
        />
      </Modal>

      {/* --- Write-off --- */}
      <Modal
        open={writingOff !== null}
        title="Write off this receivable"
        okText="Write off"
        okButtonProps={{ danger: true, disabled: writeOffReason.trim().length < 5 }}
        confirmLoading={writeOff.isPending}
        onCancel={() => setWritingOff(null)}
        onOk={() =>
          writingOff &&
          writeOff.mutate(
            { claimLineId: writingOff.claimLineId, reason: writeOffReason },
            {
              onSuccess: () => {
                message.success('Written off');
                setWritingOff(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <p style={{ fontSize: 12.5 }}>
          Abandoning <strong>{money(writingOff?.outstanding ?? 0)}</strong> as uncollectable. It stays on the claim's
          record with your name and this reason against it.
        </p>
        <Input.TextArea
          rows={3}
          value={writeOffReason}
          onChange={(event) => setWriteOffReason(event.target.value)}
          placeholder="Why is this uncollectable?"
        />
      </Modal>

      <Modal
        open={receipting}
        title="Record a panel payment"
        okText="Record payment"
        okButtonProps={{ disabled: !receiptReady, loading: recordRemittance.isPending }}
        width={860}
        onCancel={resetReceipt}
        destroyOnHidden
        onOk={() => {
          if (!receiptPanel || !receiptDate) return;
          recordRemittance.mutate(
            {
              panelClinicId: receiptPanel,
              // Date-only: a receipt is dated to the day it was banked.
              receivedAt: receiptDate.format('YYYY-MM-DD'),
              grossAmount: (receiptGross ?? 0).toFixed(2),
              withheldAmount: receiptWithheld ? receiptWithheld.toFixed(2) : undefined,
              remittanceRef: receiptRef || undefined,
              allocations: Object.entries(allocations)
                .filter(([, amount]) => amount > 0)
                .map(([claimLineId, amount]) => ({ claimLineId, amount: amount.toFixed(2) })),
            },
            {
              onSuccess: () => {
                message.success('Payment recorded and allocated.');
                resetReceipt();
              },
              onError: (error: Error) => message.error(error.message),
            },
          );
        }}
      >
        <div className="kw-record">
          <label>
            Panel
            <Select
              value={receiptPanel}
              onChange={(value) => {
                setReceiptPanel(value);
                setAllocations({});
              }}
              placeholder="Which panel paid?"
              style={{ width: '100%' }}
              loading={owed.isLoading}
              options={(reconciliation.data?.byPanel ?? []).map((row) => ({
                value: row.panelClinicId,
                label: `${row.panelName} — ${money(payableByPanel.get(row.panelClinicId) ?? 0)} awaiting payment`,
              }))}
            />
          </label>
          <label>
            Received on
            <DatePicker value={receiptDate} onChange={setReceiptDate} style={{ width: '100%' }} allowClear={false} />
          </label>
          <label>
            Gross paid
            <InputNumber
              value={receiptGross}
              onChange={setReceiptGross}
              min={0}
              precision={2}
              prefix="RM"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            Withheld
            <InputNumber
              value={receiptWithheld}
              onChange={setReceiptWithheld}
              min={0}
              precision={2}
              prefix="RM"
              style={{ width: '100%' }}
              placeholder="Panel fee or tax"
            />
          </label>
          <label>
            Reference
            <Input value={receiptRef} onChange={(event) => setReceiptRef(event.target.value)} placeholder="Remittance advice no." />
          </label>
        </div>

        {receiptPanel ? (
          <>
            <div className="kw-countHead">
              <div>
                <strong>Net to allocate</strong> {money(netToAllocate)} · <strong>Allocated</strong>{' '}
                {money(allocatedTotal)} ·{' '}
                <span className={allocationDifference === 0 ? 'kw-good' : 'kw-bad'}>
                  {allocationDifference === 0 ? 'balanced' : `${money(Math.abs(allocationDifference))} ${allocationDifference > 0 ? 'unallocated' : 'over-allocated'}`}
                </span>
              </div>
              <Button size="small" onClick={allocateOldestFirst} disabled={netToAllocate <= 0}>
                Allocate oldest first
              </Button>
            </div>

            <DataTable<PanelAwaitingPaymentRow>
              rows={awaitingPayment}
              rowKey="claimLineId"
              pageSize={8}
              scrollY={260}
              loading={owed.isLoading}
              emptyText="This panel has nothing outstanding"
              emptyHint="Every claim for this panel has been paid, rejected or written off."
              columns={[
                { title: 'Claim', dataIndex: 'panelClaimNo', key: 'panelClaimNo', render: (value: string | null, row) => value ?? row.invoiceNumber },
                { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
                { title: 'Age', dataIndex: 'ageDays', key: 'ageDays', className: 'kw-num', render: (value: number, row) => (row.overdue ? <span className="kw-bad">{value}d</span> : `${value}d`) },
                { title: 'Outstanding', dataIndex: 'outstanding', key: 'outstanding', className: 'kw-num', render: (value: number) => money(value) },
                {
                  title: 'Allocate',
                  key: 'allocate',
                  noExport: true,
                  render: (_: unknown, row) => (
                    <InputNumber
                      size="small"
                      min={0}
                      max={row.outstanding}
                      precision={2}
                      value={allocations[row.claimLineId] ?? null}
                      onChange={(value) =>
                        setAllocations((current) => ({ ...current, [row.claimLineId]: value ?? 0 }))
                      }
                      style={{ width: 120 }}
                    />
                  ),
                },
              ]}
            />
            {notYetSubmitted > 0.005 ? (
              <AdminNotice tone="warn">
                This panel also has {money(notYetSubmitted)} on claims that have been batched but never submitted. That
                money is receivable, but no panel pays a claim it has not been sent — so those claims are not listed
                here and cannot be allocated against. Submit them first.
              </AdminNotice>
            ) : null}
            <AdminNotice>
              A claim can be settled for less than it asked for — a panel that approves part of a claim pays part of it.
              What the allocations may not do is total anything other than the payment itself.
            </AdminNotice>
          </>
        ) : null}
      </Modal>

    </AdminShell>
  );
}
