import { useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useCan } from '../../core/hooks/useCan';
import {
  usePayableInvoices,
  usePayables,
  useRecordSupplierInvoice,
  useRecordSupplierPayment,
  useSupplierPayments,
  useUpdateSupplierInvoice,
  useUpdateSupplierTerms,
} from '../hooks/useAdmin';
import type { PayableInvoiceRow, PayableSupplierRow } from '../types';

/**
 * WHAT DO WE OWE SUPPLIERS.
 *
 * Until this screen there was no answer to that question anywhere in Kuwick —
 * the system knew what had been ordered and what had arrived, and stopped. The
 * clinic answers it today with a workbook of thirty supplier tabs whose
 * headline roll-up sums the payment-DATE column instead of the balance column,
 * so the figure it reports is built from dates
 * (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §5, finding S-1).
 *
 * Two things this screen does that the workbook cannot:
 *
 *  - EVERY FIGURE IS DERIVED. What has been paid is the sum of the payments
 *    allocated to an invoice, never a typed column, so it cannot drift from the
 *    bank.
 *  - IT NAMES WHAT IT CANNOT SCHEDULE. An invoice on a supplier whose terms
 *    nobody recorded has no due date, is counted separately as "undated", and
 *    the supplier is named — rather than being filed under "not due yet",
 *    which is how a bill goes quietly unpaid for a quarter.
 */

const AGE_LABEL: Record<string, string> = {
  NOT_DUE: 'Not due',
  D1_30: '1–30 days over',
  D31_60: '31–60 days over',
  D61_90: '61–90 days over',
  D90_PLUS: 'Over 90 days',
};

type Tab = 'owed' | 'invoices' | 'payments';

export function PayablesPage() {
  const { message } = App.useApp();
  const [asOf, setAsOf] = useState(dayjs().format('YYYY-MM-DD'));
  const [tab, setTab] = useState<Tab>('owed');
  const [supplierFilter, setSupplierFilter] = useState<string | undefined>();

  const payables = usePayables({ asOf });
  const invoices = usePayableInvoices({ supplierId: supplierFilter, asOf });
  const payments = useSupplierPayments({ supplierId: supplierFilter });

  const mayEnterInvoice = useCan('supplierInvoice.manage');
  const mayPay = useCan('supplierPayment.record');

  const recordInvoice = useRecordSupplierInvoice();
  const updateInvoice = useUpdateSupplierInvoice();
  const recordPayment = useRecordSupplierPayment();
  const updateTerms = useUpdateSupplierTerms();

  const [entering, setEntering] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState({
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: dayjs().format('YYYY-MM-DD'),
    totalAmount: '',
    notes: '',
  });

  const [paying, setPaying] = useState<PayableSupplierRow | null>(null);
  const [payDraft, setPayDraft] = useState({ paidAt: dayjs().format('YYYY-MM-DD'), amount: '', method: '', reference: '' });
  const [payAllocations, setPayAllocations] = useState<Record<string, string>>({});

  const [disputing, setDisputing] = useState<PayableInvoiceRow | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  const [editingTerms, setEditingTerms] = useState<PayableSupplierRow | null>(null);
  const [termsDraft, setTermsDraft] = useState({ paymentTermDays: '', creditLimitAmount: '', deliverySlaDays: '' });

  const totals = payables.data?.totals;
  const supplierOptions = (payables.data?.bySupplier ?? []).map((row) => ({
    value: row.supplierId,
    label: row.supplierName,
  }));

  /** What is still owed on the invoices a payment could settle. */
  const payableForSupplier = (invoices.data ?? []).filter(
    (row) => row.supplierId === paying?.supplierId && row.outstanding > 0 && row.status !== 'CANCELLED',
  );
  const allocatedTotal = Object.values(payAllocations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const payAmount = Number(payDraft.amount) || 0;
  const allocationsBalance = Math.abs(allocatedTotal - payAmount) < 0.005 && payAmount > 0;

  return (
    <AdminShell
      error={firstError(payables, invoices, payments)}
      title="Supplier payables"
      subtitle="What the clinic owes, what falls due this week, and what has already been paid — every figure derived from the payments allocated against each invoice."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <DatePicker
            allowClear={false}
            size="small"
            value={dayjs(asOf)}
            onChange={(value) => value && setAsOf(value.format('YYYY-MM-DD'))}
          />
          <Tooltip title={mayEnterInvoice ? '' : 'Your account is not permitted to record supplier invoices.'}>
            <Button type="primary" size="small" disabled={!mayEnterInvoice} onClick={() => setEntering(true)}>
              Enter an invoice
            </Button>
          </Tooltip>
        </div>
      }
    >
      <StatStrip
        stats={[
          {
            label: 'Owed to suppliers',
            value: money(totals?.outstanding ?? 0),
            hint: `${totals?.invoices ?? 0} invoices · ${totals?.suppliers ?? 0} suppliers`,
            tone: 'warn',
          },
          {
            label: 'Overdue',
            value: money(totals?.overdue ?? 0),
            hint: `${totals?.overdueInvoices ?? 0} invoices past terms`,
            tone: (totals?.overdue ?? 0) > 0 ? 'bad' : 'good',
          },
          {
            label: 'Due this week',
            value: money(totals?.dueThisWeek ?? 0),
            hint: `${totals?.dueThisWeekInvoices ?? 0} invoices`,
            explain: 'The operating question the payable workbook exists to answer: what must I pay this week.',
          },
          {
            label: 'Disputed',
            value: money(totals?.disputed ?? 0),
            hint: 'Held out of overdue and due-this-week',
          },
          {
            label: 'Undated',
            value: money(totals?.undated ?? 0),
            hint: `${totals?.undatedInvoices ?? 0} on suppliers with no term`,
            tone: (totals?.undated ?? 0) > 0 ? 'warn' : 'good',
          },
        ]}
      />

      {payables.data && payables.data.suppliersWithoutTerms.length > 0 ? (
        <AdminNotice tone="warn">
          <strong>
            {payables.data.suppliersWithoutTerms.length} supplier(s) with money owed have no payment term recorded:
          </strong>{' '}
          {payables.data.suppliersWithoutTerms.join(', ')}. Their invoices have no due date, so nothing can tell you
          when they must be paid. Set the term with <strong>Edit terms</strong> below — Kuwick will not assume thirty
          days.
        </AdminNotice>
      ) : null}

      {payables.data && payables.data.overLimit.length > 0 ? (
        <AdminNotice tone="warn">
          Over the agreed credit limit with {payables.data.overLimit.join(', ')}. This is a warning, not a block —
          ordering is not stopped, because a clinic that cannot buy medication over a number in a settings screen is
          worse off than one that is told.
        </AdminNotice>
      ) : null}

      <div style={{ display: 'flex', gap: 8, margin: '4px 0 12px' }}>
        <Button size="small" type={tab === 'owed' ? 'primary' : 'default'} onClick={() => setTab('owed')}>
          By supplier
        </Button>
        <Button size="small" type={tab === 'invoices' ? 'primary' : 'default'} onClick={() => setTab('invoices')}>
          Invoices
        </Button>
        <Button size="small" type={tab === 'payments' ? 'primary' : 'default'} onClick={() => setTab('payments')}>
          Payments made
        </Button>
        <Select
          size="small"
          allowClear
          style={{ minWidth: 220 }}
          placeholder="All suppliers"
          value={supplierFilter}
          onChange={(value) => setSupplierFilter(value ?? undefined)}
          options={supplierOptions}
        />
      </div>

      {tab === 'owed' ? (
        <AdminSection title="What we owe, by supplier" padded={false}>
          <DataTable
            rows={payables.data?.bySupplier.filter((row) => row.invoices > 0)}
            loading={payables.isLoading}
            rowKey="supplierId"
            exportName="supplier-payables"
            searchFields={['supplierName' as never]}
            searchPlaceholder="Search supplier…"
            emptyText="No supplier invoices recorded"
            columns={[
              { title: 'Supplier', dataIndex: 'supplierName', key: 'supplierName' },
              {
                title: 'Term',
                dataIndex: 'paymentTermDays',
                key: 'paymentTermDays',
                render: (value: number | null) =>
                  value === null ? <span className="kw-warn">not set</span> : `${value} days`,
              },
              { title: 'Invoices', dataIndex: 'invoices', key: 'invoices', className: 'kw-num' },
              {
                title: 'Billed',
                dataIndex: 'billed',
                key: 'billed',
                className: 'kw-num',
                render: (value: number) => money(value),
              },
              {
                title: 'Paid',
                dataIndex: 'paid',
                key: 'paid',
                className: 'kw-num',
                render: (value: number) => money(value),
              },
              {
                title: 'Outstanding',
                dataIndex: 'outstanding',
                key: 'outstanding',
                className: 'kw-num',
                render: (value: number) => <strong>{money(value)}</strong>,
              },
              {
                title: 'Overdue',
                dataIndex: 'overdue',
                key: 'overdue',
                className: 'kw-num',
                render: (value: number, row) =>
                  value > 0 ? (
                    <Tooltip title={`${row.overdueInvoices} invoice(s) past terms`}>
                      <span className="kw-bad">{money(value)}</span>
                    </Tooltip>
                  ) : (
                    <span className="kw-muted">—</span>
                  ),
              },
              {
                title: 'Due this week',
                dataIndex: 'dueThisWeek',
                key: 'dueThisWeek',
                className: 'kw-num',
                render: (value: number) => (value > 0 ? money(value) : <span className="kw-muted">—</span>),
              },
              {
                title: 'Credit limit',
                key: 'creditLimit',
                className: 'kw-num',
                render: (_: unknown, row) =>
                  row.creditLimit === null ? (
                    <span className="kw-muted">not set</span>
                  ) : row.overCreditLimit ? (
                    <Tooltip title="Over the agreed limit. A warning, not a block.">
                      <Tag color="red">{money(row.creditLimit)}</Tag>
                    </Tooltip>
                  ) : (
                    <Tooltip title={`${money(row.creditHeadroom ?? 0)} headroom`}>
                      <span>{money(row.creditLimit)}</span>
                    </Tooltip>
                  ),
              },
              {
                // "Received date (max 1 week)" is an SLA that lives in a column
                // heading in the clinic's order queue, where nothing measures
                // it — so a supplier who is habitually late is a feeling.
                title: 'Delivery',
                key: 'delivery',
                render: (_: unknown, row) => {
                  if (row.deliveries === 0) {
                    return <span className="kw-muted">no deliveries yet</span>;
                  }
                  const average = `${row.averageDeliveryDays}d avg`;
                  if (row.slaOnTimePercent === null) {
                    return (
                      <Tooltip title="No delivery SLA recorded for this supplier, so nothing can say whether these were on time.">
                        <span>
                          {average} · <span className="kw-muted">no SLA set</span>
                        </span>
                      </Tooltip>
                    );
                  }
                  return (
                    <Tooltip
                      title={`${row.deliveries} deliveries measured against a ${row.deliverySlaDays}-day SLA; ${row.slaBreaches} late.`}
                    >
                      <span>
                        {average} ·{' '}
                        <Tag color={row.slaOnTimePercent >= 90 ? 'green' : row.slaOnTimePercent >= 70 ? 'gold' : 'red'}>
                          {row.slaOnTimePercent}% on time
                        </Tag>
                      </span>
                    </Tooltip>
                  );
                },
              },
              {
                title: '',
                key: 'actions',
                render: (_: unknown, row) => (
                  <>
                    {mayPay && row.outstanding > 0 ? (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => {
                          setPaying(row);
                          setPayAllocations({});
                          setPayDraft({
                            paidAt: dayjs().format('YYYY-MM-DD'),
                            amount: '',
                            method: 'Bank transfer',
                            reference: '',
                          });
                          setSupplierFilter(row.supplierId);
                        }}
                      >
                        Pay
                      </Button>
                    ) : null}
                    {mayEnterInvoice ? (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => {
                          setEditingTerms(row);
                          setTermsDraft({
                            paymentTermDays: row.paymentTermDays === null ? '' : String(row.paymentTermDays),
                            creditLimitAmount: row.creditLimit === null ? '' : row.creditLimit.toFixed(2),
                            deliverySlaDays: row.deliverySlaDays === null ? '' : String(row.deliverySlaDays),
                          });
                        }}
                      >
                        Edit terms
                      </Button>
                    ) : null}
                  </>
                ),
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {tab === 'invoices' ? (
        <AdminSection
          title="Invoices"
          description="Aged from the DUE date, not the invoice date — because that is the conversation a supplier has."
          padded={false}
        >
          <DataTable
            rows={invoices.data}
            loading={invoices.isLoading}
            rowKey="id"
            exportName="supplier-invoices"
            searchFields={['supplierName' as never, 'invoiceNumber' as never]}
            searchPlaceholder="Search supplier or invoice number…"
            emptyText="No supplier invoices recorded"
            columns={[
              { title: 'Supplier', dataIndex: 'supplierName', key: 'supplierName' },
              { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
              {
                title: 'Dated',
                dataIndex: 'invoiceDate',
                key: 'invoiceDate',
                render: (value: string) => dayjs(value).format('D MMM YY'),
              },
              {
                title: 'Due',
                dataIndex: 'dueDate',
                key: 'dueDate',
                render: (value: string | null, row) =>
                  value === null ? (
                    <Tooltip title="No payment term recorded for this supplier, so nothing can say when this is due.">
                      <span className="kw-warn">not set</span>
                    </Tooltip>
                  ) : row.overdue ? (
                    <span className="kw-bad">{dayjs(value).format('D MMM YY')}</span>
                  ) : (
                    dayjs(value).format('D MMM YY')
                  ),
              },
              {
                title: 'Age',
                dataIndex: 'ageBucket',
                key: 'ageBucket',
                render: (value: string | null) =>
                  value === null ? <span className="kw-muted">—</span> : AGE_LABEL[value] ?? value,
              },
              {
                title: 'Total',
                dataIndex: 'total',
                key: 'total',
                className: 'kw-num',
                render: (value: number) => money(value),
              },
              {
                title: 'Paid',
                dataIndex: 'paid',
                key: 'paid',
                className: 'kw-num',
                render: (value: number) => money(value),
              },
              {
                title: 'Outstanding',
                dataIndex: 'outstanding',
                key: 'outstanding',
                className: 'kw-num',
                render: (value: number) => <strong>{money(value)}</strong>,
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (value: string, row) =>
                  value === 'PAID' ? (
                    <Tag color="green">Paid</Tag>
                  ) : value === 'DISPUTED' ? (
                    <Tooltip title={row.disputeReason ?? undefined}>
                      <Tag color="orange">Disputed</Tag>
                    </Tooltip>
                  ) : value === 'CANCELLED' ? (
                    <Tag>Cancelled</Tag>
                  ) : (
                    <Tag color="blue">Open</Tag>
                  ),
              },
              {
                // THE THREE-WAY MATCH THE SPREADSHEET CANNOT DO. Nothing in the
                // clinic's payable listing links an invoice to the delivery it
                // is for, so "does this bill match what actually arrived" has no
                // answer there at all.
                title: 'Against delivery',
                key: 'match',
                render: (_: unknown, row) =>
                  row.receivedValue === null ? (
                    <Tooltip title="No goods receipt linked, or the receipt carries no unit costs.">
                      <span className="kw-muted">not matched</span>
                    </Tooltip>
                  ) : Math.abs(row.matchVariance ?? 0) < 0.005 ? (
                    <Tag color="green">matches</Tag>
                  ) : (
                    <Tooltip title={`Delivery valued at ${money(row.receivedValue)}; invoice asks ${money(row.total)}.`}>
                      <Tag color="red">{money(row.matchVariance ?? 0)} out</Tag>
                    </Tooltip>
                  ),
              },
              {
                title: 'Document',
                dataIndex: 'documentUrl',
                key: 'documentUrl',
                optional: true,
                render: (value: string | null) =>
                  value ? (
                    <a href={value} target="_blank" rel="noreferrer">
                      scan
                    </a>
                  ) : (
                    <span className="kw-muted">—</span>
                  ),
              },
              { title: 'Entered by', dataIndex: 'recordedBy', key: 'recordedBy', optional: true },
              {
                title: '',
                key: 'actions',
                render: (_: unknown, row) =>
                  mayEnterInvoice && row.status === 'OPEN' ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setDisputing(row);
                        setDisputeReason('');
                      }}
                    >
                      Dispute
                    </Button>
                  ) : null,
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {tab === 'payments' ? (
        <AdminSection
          title="Payments made"
          description="Each payment says which invoices it settled. The allocations must equal the payment exactly — the check the spreadsheet never had."
          padded={false}
        >
          <DataTable
            rows={payments.data}
            loading={payments.isLoading}
            rowKey="id"
            exportName="supplier-payments"
            emptyText="No supplier payments recorded"
            columns={[
              {
                title: 'Paid',
                dataIndex: 'paidAt',
                key: 'paidAt',
                render: (value: string) => dayjs(value).format('D MMM YY'),
              },
              { title: 'Supplier', dataIndex: 'supplierName', key: 'supplierName' },
              {
                title: 'Amount',
                dataIndex: 'amount',
                key: 'amount',
                className: 'kw-num',
                render: (value: number) => <strong>{money(value)}</strong>,
              },
              { title: 'Method', dataIndex: 'method', key: 'method' },
              { title: 'Reference', dataIndex: 'reference', key: 'reference' },
              {
                title: 'Settled',
                key: 'settled',
                render: (_: unknown, row) =>
                  row.settled.length === 0 ? (
                    <span className="kw-muted">—</span>
                  ) : (
                    row.settled.map((s) => `${s.invoiceNumber} ${money(s.amount)}`).join('; ')
                  ),
              },
              { title: 'Recorded by', dataIndex: 'recordedBy', key: 'recordedBy', optional: true },
            ]}
          />
        </AdminSection>
      ) : null}

      {/* --- Enter an invoice --- */}
      <Modal
        open={entering}
        title="Enter a supplier invoice"
        okText="Record it"
        confirmLoading={recordInvoice.isPending}
        okButtonProps={{
          disabled: !invoiceDraft.supplierId || !invoiceDraft.invoiceNumber || !invoiceDraft.totalAmount,
        }}
        onCancel={() => setEntering(false)}
        onOk={() =>
          recordInvoice.mutate(
            {
              supplierId: invoiceDraft.supplierId,
              invoiceNumber: invoiceDraft.invoiceNumber.trim(),
              invoiceDate: invoiceDraft.invoiceDate,
              totalAmount: invoiceDraft.totalAmount,
              notes: invoiceDraft.notes || undefined,
            },
            {
              onSuccess: (result: unknown) => {
                const reason = (result as { dueDateUnknownReason?: string | null } | undefined)
                  ?.dueDateUnknownReason;
                message.success(reason ? `Recorded. ${reason}` : 'Recorded');
                setEntering(false);
                setInvoiceDraft({ ...invoiceDraft, invoiceNumber: '', totalAmount: '', notes: '' });
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          The due date is worked out from this supplier's payment term. If no term is recorded, the invoice is entered
          with <strong>no due date</strong> and counted as undated — Kuwick does not assume thirty days.
        </AdminNotice>
        <div style={{ display: 'grid', gap: 8 }}>
          <Select
            style={{ width: '100%' }}
            placeholder="Supplier"
            value={invoiceDraft.supplierId || undefined}
            onChange={(value) => setInvoiceDraft({ ...invoiceDraft, supplierId: value })}
            options={supplierOptions}
          />
          <Input
            addonBefore="Invoice no"
            value={invoiceDraft.invoiceNumber}
            onChange={(event) => setInvoiceDraft({ ...invoiceDraft, invoiceNumber: event.target.value })}
          />
          <DatePicker
            style={{ width: '100%' }}
            allowClear={false}
            value={dayjs(invoiceDraft.invoiceDate)}
            onChange={(value) =>
              value && setInvoiceDraft({ ...invoiceDraft, invoiceDate: value.format('YYYY-MM-DD') })
            }
          />
          <Input
            addonBefore="Total"
            placeholder="0.00"
            value={invoiceDraft.totalAmount}
            onChange={(event) => setInvoiceDraft({ ...invoiceDraft, totalAmount: event.target.value })}
          />
          <Input.TextArea
            rows={2}
            placeholder="Notes (optional)"
            value={invoiceDraft.notes}
            onChange={(event) => setInvoiceDraft({ ...invoiceDraft, notes: event.target.value })}
          />
        </div>
      </Modal>

      {/* --- Pay a supplier --- */}
      <Modal
        open={paying !== null}
        width={640}
        title={`Pay ${paying?.supplierName ?? ''}`}
        okText="Record the payment"
        confirmLoading={recordPayment.isPending}
        okButtonProps={{ disabled: !allocationsBalance }}
        onCancel={() => setPaying(null)}
        onOk={() =>
          paying &&
          recordPayment.mutate(
            {
              supplierId: paying.supplierId,
              paidAt: payDraft.paidAt,
              amount: payDraft.amount,
              method: payDraft.method || undefined,
              reference: payDraft.reference || undefined,
              allocations: Object.entries(payAllocations)
                .filter(([, value]) => Number(value) > 0)
                .map(([supplierInvoiceId, amount]) => ({ supplierInvoiceId, amount })),
            },
            {
              onSuccess: (result: unknown) => {
                const settled = (result as { settledInvoices?: string[] } | undefined)?.settledInvoices ?? [];
                message.success(
                  settled.length > 0 ? `Payment recorded. Settled: ${settled.join(', ')}` : 'Payment recorded',
                );
                setPaying(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          A payment has to say which invoices it settled, and the amounts must add up to it exactly. That check is the
          one thing the payable spreadsheet has never had.
        </AdminNotice>
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          <DatePicker
            style={{ width: '100%' }}
            allowClear={false}
            value={dayjs(payDraft.paidAt)}
            onChange={(value) => value && setPayDraft({ ...payDraft, paidAt: value.format('YYYY-MM-DD') })}
          />
          <Input
            addonBefore="Amount"
            placeholder="0.00"
            value={payDraft.amount}
            onChange={(event) => setPayDraft({ ...payDraft, amount: event.target.value })}
          />
          <Input
            addonBefore="Method"
            value={payDraft.method}
            onChange={(event) => setPayDraft({ ...payDraft, method: event.target.value })}
          />
          <Input
            addonBefore="Reference"
            placeholder="Bank reference"
            value={payDraft.reference}
            onChange={(event) => setPayDraft({ ...payDraft, reference: event.target.value })}
          />
        </div>
        <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Which invoices does it settle?</div>
        {payableForSupplier.length === 0 ? (
          <p className="kw-muted" style={{ fontSize: 12.5 }}>
            Nothing outstanding on this supplier.
          </p>
        ) : (
          payableForSupplier.map((row) => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>
                {row.invoiceNumber}
                {row.dueDate ? ` · due ${dayjs(row.dueDate).format('D MMM YY')}` : ' · no due date'}
                {' · '}
                <strong>{money(row.outstanding)}</strong> outstanding
              </span>
              <Input
                size="small"
                style={{ width: 120 }}
                placeholder="0.00"
                value={payAllocations[row.id] ?? ''}
                onChange={(event) => setPayAllocations({ ...payAllocations, [row.id]: event.target.value })}
              />
              <Button size="small" onClick={() => setPayAllocations({ ...payAllocations, [row.id]: row.outstanding.toFixed(2) })}>
                All
              </Button>
            </div>
          ))
        )}
        <div style={{ marginTop: 8, fontSize: 12.5 }} className={allocationsBalance ? 'kw-good' : 'kw-warn'}>
          Allocated {money(allocatedTotal)} of {money(payAmount)}
          {allocationsBalance ? ' — balances' : ' — must match exactly before this can be recorded'}
        </div>
      </Modal>

      {/* --- Dispute --- */}
      <Modal
        open={disputing !== null}
        title={`Dispute ${disputing?.invoiceNumber ?? ''}`}
        okText="Mark it disputed"
        okButtonProps={{ disabled: disputeReason.trim().length < 5 }}
        confirmLoading={updateInvoice.isPending}
        onCancel={() => setDisputing(null)}
        onOk={() =>
          disputing &&
          updateInvoice.mutate(
            { id: disputing.id, status: 'DISPUTED', disputeReason },
            {
              onSuccess: () => {
                message.success('Marked disputed');
                setDisputing(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          A disputed invoice is still owed, and still shows in the outstanding total. What changes is that it drops out
          of <strong>overdue</strong> and <strong>due this week</strong>, so nobody pays a bill the clinic has already
          refused.
        </AdminNotice>
        <Input.TextArea
          rows={3}
          value={disputeReason}
          onChange={(event) => setDisputeReason(event.target.value)}
          placeholder="What the dispute is — the supplier will ask"
        />
      </Modal>

      {/* --- Supplier terms --- */}
      <Modal
        open={editingTerms !== null}
        title={`Terms — ${editingTerms?.supplierName ?? ''}`}
        okText="Save"
        confirmLoading={updateTerms.isPending}
        onCancel={() => setEditingTerms(null)}
        onOk={() =>
          editingTerms &&
          updateTerms.mutate(
            {
              id: editingTerms.supplierId,
              paymentTermDays: termsDraft.paymentTermDays === '' ? undefined : Number(termsDraft.paymentTermDays),
              creditLimitAmount: termsDraft.creditLimitAmount || undefined,
              deliverySlaDays: termsDraft.deliverySlaDays === '' ? undefined : Number(termsDraft.deliverySlaDays),
            },
            {
              onSuccess: () => {
                message.success('Terms saved. Invoices already entered keep the due date they were given.');
                setEditingTerms(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          Changing a term affects invoices entered from now on. Invoices already recorded keep the due date they were
          given — last month's bill was due on the terms in force when it arrived, not the ones agreed today.
        </AdminNotice>
        <div style={{ display: 'grid', gap: 8 }}>
          <Input
            addonBefore="Payment term"
            addonAfter="days"
            value={termsDraft.paymentTermDays}
            onChange={(event) => setTermsDraft({ ...termsDraft, paymentTermDays: event.target.value })}
          />
          <Input
            addonBefore="Credit limit"
            placeholder="0.00"
            value={termsDraft.creditLimitAmount}
            onChange={(event) => setTermsDraft({ ...termsDraft, creditLimitAmount: event.target.value })}
          />
          <Input
            addonBefore="Delivery SLA"
            addonAfter="days"
            value={termsDraft.deliverySlaDays}
            onChange={(event) => setTermsDraft({ ...termsDraft, deliverySlaDays: event.target.value })}
          />
        </div>
      </Modal>
    </AdminShell>
  );
}
