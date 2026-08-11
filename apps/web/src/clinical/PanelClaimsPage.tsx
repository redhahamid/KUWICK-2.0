import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleOutlined, DownloadOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePanelClinics } from './hooks/usePanelClinics';
import { useStaff } from '../hr/hooks/useStaff';
import {
  useClaimBatches,
  useCreateClaimBatch,
  useEligibleClaimInvoices,
  useOutstandingClaims,
  usePanelClaimLines,
  usePanelYearlySummary,
  useRecordClaimLinePayment,
  useReconcileClaimBatch,
  useSubmitClaimBatch,
} from './hooks/useClaimBatches';
import {
  ClaimBatch,
  ClaimBatchLine,
  ClaimSubmissionMethod,
  Invoice,
  OutstandingClaimBatch,
  PanelClaimLineRow,
  PanelYearlySummaryRow,
} from './types';
import { exportCsv } from '../reports/exportCsv';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

const { Text } = Typography;

const BATCH_STATUS_COLOR: Record<string, string> = {
  BATCHED: 'default',
  SUBMITTED: 'blue',
  PARTIALLY_PAID: 'gold',
  PAID: 'green',
  RECONCILED: 'purple',
};

const LINE_STATUS_COLOR: Record<string, string> = {
  UNCLAIMED: 'gold',
  BATCHED: 'default',
  SUBMITTED: 'blue',
  PENDING: 'default',
  ACCEPTED: 'blue',
  REJECTED: 'red',
  DEDUCTED: 'orange',
  PAID: 'green',
};

const SUBMISSION_METHOD_OPTIONS: { value: ClaimSubmissionMethod; label: string }[] = [
  { value: 'PORTAL', label: "Panel's Own Portal" },
  { value: 'COURIER', label: 'Courier' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'OTHER', label: 'Other' },
];

const LINE_SETTLE_OPTIONS = [
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DEDUCTED', label: 'Deducted' },
  { value: 'PAID', label: 'Paid' },
];

interface CreateBatchCardProps {
  panelClinicId: string;
}

function CreateBatchCard({ panelClinicId }: CreateBatchCardProps) {
  const { data: eligibleInvoices, isLoading } = useEligibleClaimInvoices(panelClinicId);
  const { data: staff } = useStaff();
  const { data: panels } = usePanelClinics();
  const createBatch = useCreateClaimBatch();
  const [selected, setSelected] = useState<string[]>([]);
  const [createdByStaffId, setCreatedByStaffId] = useState<string>();

  // D-041 — the fee comes from the panel's own configuration (Panel
  // Clinics screen), applied automatically server-side; shown here so
  // staff know what will be added.
  const panel = panels?.find((p) => p.id === panelClinicId);
  const feeLabel =
    panel?.claimFeeType && panel.claimFeeValue != null
      ? panel.claimFeeType === 'PERCENT'
        ? `${Number(panel.claimFeeValue)}% per claim`
        : `RM ${Number(panel.claimFeeValue).toFixed(2)} per claim`
      : null;

  const handleCreate = async () => {
    if (!createdByStaffId || selected.length === 0) return;
    try {
      await createBatch.mutateAsync({ panelClinicId, invoiceIds: selected, createdByStaffId });
      message.success('Claim batch created');
      setSelected([]);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create batch');
    }
  };

  return (
    <Card size="small" title="Create Claim Batch" style={{ marginBottom: 16 }}>
      {!isLoading && (!eligibleInvoices || eligibleInvoices.length === 0) ? (
        <Empty description="No PAID invoices for this panel are waiting to be claimed" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Table
            size="small"
            rowKey="id"
            loading={isLoading}
            pagination={false}
            dataSource={eligibleInvoices}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            columns={[
              { title: 'Invoice No.', dataIndex: 'invoiceNumber' },
              { title: 'Patient', render: (_: unknown, r: Invoice) => r.visit?.patient?.name ?? '—' },
              { title: 'Paid', render: (_: unknown, r: Invoice) => dayjs(r.paidAt).format('YYYY-MM-DD') },
              { title: 'Panel Covers (RM)', dataIndex: 'panelCoveredAmount' },
            ]}
          />
          <Space style={{ marginTop: 12 }} wrap>
            <Select
              showSearch
              style={{ width: 220 }}
              placeholder="Created By"
              value={createdByStaffId}
              onChange={setCreatedByStaffId}
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />
            {feeLabel && (
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                Fee: {feeLabel} (from panel settings)
              </Tag>
            )}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={createBatch.isPending}
              disabled={selected.length === 0 || !createdByStaffId}
              onClick={handleCreate}
            >
              Create Batch ({selected.length} invoice{selected.length === 1 ? '' : 's'})
            </Button>
          </Space>
        </>
      )}
    </Card>
  );
}

interface BatchCardProps {
  batch: ClaimBatch;
}

function BatchCard({ batch }: BatchCardProps) {
  const submitBatch = useSubmitClaimBatch();
  const recordLinePayment = useRecordClaimLinePayment();
  const reconcileBatch = useReconcileClaimBatch();
  const [submissionMethod, setSubmissionMethod] = useState<ClaimSubmissionMethod>('PORTAL');
  const [submissionReference, setSubmissionReference] = useState('');
  const [lineEdits, setLineEdits] = useState<
    Record<string, { status: string; paidAmount?: number; deductionReason?: string; remarks?: string }>
  >({});

  const claimedTotal = batch.lines.reduce((sum, line) => sum + Number(line.claimedAmount), 0);
  const feeTotal = batch.lines.reduce((sum, line) => sum + Number(line.feeAmount ?? 0), 0);

  const handleSubmit = async () => {
    try {
      await submitBatch.mutateAsync({ id: batch.id, dto: { submissionMethod, submissionReference: submissionReference || undefined } });
      message.success('Batch submitted');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to submit batch');
    }
  };

  const handleRecordLine = async (lineId: string) => {
    const edit = lineEdits[lineId];
    if (!edit?.status) return;
    try {
      await recordLinePayment.mutateAsync({
        id: batch.id,
        lineId,
        dto: {
          status: edit.status as 'ACCEPTED' | 'REJECTED' | 'DEDUCTED' | 'PAID',
          paidAmount: edit.paidAmount,
          deductionReason: edit.deductionReason,
          remarks: edit.remarks,
        },
      });
      message.success('Line updated');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to record line outcome');
    }
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space wrap>
          <Text strong>{batch.batchNumber}</Text>
          <Tag color={BATCH_STATUS_COLOR[batch.status]}>{batch.status}</Tag>
          {batch.submissionMethod && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              via {SUBMISSION_METHOD_OPTIONS.find((o) => o.value === batch.submissionMethod)?.label ?? batch.submissionMethod}
              {batch.submissionReference && ` (${batch.submissionReference})`}
            </Text>
          )}
        </Space>
      }
      extra={
        <Space>
          {batch.status === 'BATCHED' && (
            <>
              <Select size="small" style={{ width: 160 }} value={submissionMethod} onChange={setSubmissionMethod} options={SUBMISSION_METHOD_OPTIONS} />
              <Input
                size="small"
                style={{ width: 140 }}
                placeholder="Reference (optional)"
                value={submissionReference}
                onChange={(e) => setSubmissionReference(e.target.value)}
              />
              <Button size="small" type="primary" icon={<SendOutlined />} loading={submitBatch.isPending} onClick={handleSubmit}>
                Submit
              </Button>
            </>
          )}
          {(batch.status === 'PAID' || batch.status === 'PARTIALLY_PAID') && (
            <Popconfirm title="Reconcile this batch? This closes it out." onConfirm={() => reconcileBatch.mutate(batch.id)}>
              <Button size="small" icon={<CheckCircleOutlined />} loading={reconcileBatch.isPending}>
                Reconcile
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={batch.lines}
        columns={[
          { title: 'Invoice No.', render: (_: unknown, l: ClaimBatchLine) => l.invoice.invoiceNumber },
          { title: 'Claimed (RM)', dataIndex: 'claimedAmount' },
          { title: 'Fee (RM)', render: (_: unknown, l: ClaimBatchLine) => l.feeAmount ?? '0.00' },
          {
            title: 'To Receive (RM)',
            render: (_: unknown, l: ClaimBatchLine) =>
              (Number(l.claimedAmount) + Number(l.feeAmount ?? 0)).toFixed(2),
          },
          { title: 'Status', render: (_: unknown, l: ClaimBatchLine) => <Tag color={LINE_STATUS_COLOR[l.status]}>{l.status}</Tag> },
          { title: 'Paid (RM)', render: (_: unknown, l: ClaimBatchLine) => l.paidAmount ?? '—' },
          { title: 'Remarks', render: (_: unknown, l: ClaimBatchLine) => l.remarks ?? l.deductionReason ?? '—' },
          ...(batch.status === 'SUBMITTED' || batch.status === 'PARTIALLY_PAID'
            ? [
                {
                  title: 'Record Outcome',
                  render: (_: unknown, l: ClaimBatchLine) => (
                    <Space size={4} wrap>
                      <Select
                        size="small"
                        style={{ width: 100 }}
                        placeholder="Outcome"
                        value={lineEdits[l.id]?.status}
                        onChange={(status) => setLineEdits((prev) => ({ ...prev, [l.id]: { ...prev[l.id], status } }))}
                        options={LINE_SETTLE_OPTIONS}
                      />
                      <InputNumber
                        size="small"
                        style={{ width: 90 }}
                        placeholder="Amount"
                        value={lineEdits[l.id]?.paidAmount}
                        onChange={(v) =>
                          setLineEdits((prev) => ({ ...prev, [l.id]: { ...prev[l.id], paidAmount: v ?? undefined } }))
                        }
                      />
                      <Input
                        size="small"
                        style={{ width: 120 }}
                        placeholder="Remarks"
                        value={lineEdits[l.id]?.remarks}
                        onChange={(e) =>
                          setLineEdits((prev) => ({ ...prev, [l.id]: { ...prev[l.id], remarks: e.target.value } }))
                        }
                      />
                      <Button size="small" loading={recordLinePayment.isPending} onClick={() => handleRecordLine(l.id)}>
                        Save
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={1}>
              <Text strong>Total</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} colSpan={6}>
              <Text strong>
                Claimed RM {claimedTotal.toFixed(2)} + Fee RM {feeTotal.toFixed(2)} = To Receive RM{' '}
                {(claimedTotal + feeTotal).toFixed(2)}
              </Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Card>
  );
}

function ClaimBatchesTab({ panelClinicId }: { panelClinicId?: string }) {
  const { data: batches, isLoading } = useClaimBatches(panelClinicId);
  if (!panelClinicId) {
    return <Empty description="Select a panel to view its claim batches" />;
  }
  return (
    <div>
      <CreateBatchCard panelClinicId={panelClinicId} />
      {!isLoading && (!batches || batches.length === 0) ? (
        <Empty description="No claim batches yet for this panel" />
      ) : (
        batches?.map((batch) => <BatchCard key={batch.id} batch={batch} />)
      )}
    </div>
  );
}

function OutstandingAgingTab() {
  const { data: outstanding, isLoading } = useOutstandingClaims();
  return (
    <Table
      size="small"
      rowKey="id"
      loading={isLoading}
      dataSource={outstanding}
      locale={{ emptyText: 'Nothing outstanding — every submitted batch is fully paid or reconciled' }}
      columns={[
        { title: 'Panel', render: (_: unknown, r: OutstandingClaimBatch) => r.panelClinic?.name },
        { title: 'Batch No.', dataIndex: 'batchNumber' },
        { title: 'Status', render: (_: unknown, r: OutstandingClaimBatch) => <Tag color={BATCH_STATUS_COLOR[r.status]}>{r.status}</Tag> },
        { title: 'Claimed (RM)', render: (_: unknown, r: OutstandingClaimBatch) => r.claimedTotal.toFixed(2) },
        { title: 'Paid (RM)', render: (_: unknown, r: OutstandingClaimBatch) => r.paidTotal.toFixed(2) },
        { title: 'Outstanding (RM)', render: (_: unknown, r: OutstandingClaimBatch) => r.outstandingAmount.toFixed(2) },
        {
          title: 'Days Outstanding',
          sorter: (a: OutstandingClaimBatch, b: OutstandingClaimBatch) => a.daysOutstanding - b.daysOutstanding,
          // D-041 — overdue judged against the panel's own payment term.
          render: (_: unknown, r: OutstandingClaimBatch) => (
            <Space size={4}>
              {r.daysOutstanding}
              {r.paymentTermDays != null && (
                <Tag color={r.overdue ? 'red' : 'green'}>
                  {r.overdue ? `over ${r.paymentTermDays}-day term` : `term ${r.paymentTermDays}d`}
                </Tag>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}

// D-041 — the day-to-day working view, mirroring the owner's per-panel
// workbook sheet: one row per claim with month filter, due-days vs the
// panel's payment term, fee, and receivable.
function ClaimListingTab({ panelClinicId }: { panelClinicId?: string }) {
  const [month, setMonth] = useState<string>();
  const { data: lines, isLoading } = usePanelClaimLines(panelClinicId, month);
  if (!panelClinicId) {
    return <Empty description="Select a panel to view its claim listing" />;
  }
  const months = Array.from(new Set((lines ?? []).map((line) => line.monthKey))).sort().reverse();
  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Select
          allowClear
          style={{ width: 160 }}
          placeholder="All months"
          value={month}
          onChange={setMonth}
          options={months.map((m) => ({ value: m, label: m }))}
        />
        <Button
          icon={<DownloadOutlined />}
          disabled={!lines?.length}
          onClick={() => lines && exportCsv(`panel-claims-${month ?? 'all'}`, lines)}
        >
          CSV
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={lines}
        locale={{ emptyText: 'No claims yet for this panel' }}
        columns={[
          { title: 'Service Date', render: (_: unknown, r: PanelClaimLineRow) => dayjs(r.serviceDate).format('YYYY-MM-DD') },
          { title: 'Month', dataIndex: 'monthKey' },
          { title: 'Patient', dataIndex: 'patientName' },
          {
            title: 'Invoice / Claim No.',
            render: (_: unknown, r: PanelClaimLineRow) =>
              r.batchNumber ? `${r.invoiceNumber} · ${r.batchNumber}` : r.invoiceNumber,
          },
          { title: 'Claimed (RM)', render: (_: unknown, r: PanelClaimLineRow) => r.claimedAmount.toFixed(2) },
          { title: 'Fee (RM)', render: (_: unknown, r: PanelClaimLineRow) => r.feeAmount.toFixed(2) },
          { title: 'To Receive (RM)', render: (_: unknown, r: PanelClaimLineRow) => r.claimToReceive.toFixed(2) },
          { title: 'Paid (RM)', render: (_: unknown, r: PanelClaimLineRow) => r.paidAmount.toFixed(2) },
          { title: 'Receivable (RM)', render: (_: unknown, r: PanelClaimLineRow) => r.receivable.toFixed(2) },
          {
            title: 'Due Days',
            render: (_: unknown, r: PanelClaimLineRow) =>
              r.daysSinceSubmission == null ? (
                <Tag>{r.status === 'UNCLAIMED' ? 'to claim' : 'not submitted'}</Tag>
              ) : (
                <Space size={4}>
                  {r.daysSinceSubmission}
                  {r.overdue && <Tag color="red">overdue</Tag>}
                </Space>
              ),
          },
          { title: 'Status', render: (_: unknown, r: PanelClaimLineRow) => <Tag color={LINE_STATUS_COLOR[r.status]}>{r.status}</Tag> },
          { title: 'Remarks', render: (_: unknown, r: PanelClaimLineRow) => r.remarks ?? r.deductionReason ?? '—' },
        ]}
      />
    </div>
  );
}

// D-041 — the owner's SUMMARY PANEL CLAIMS sheet: per-panel yearly totals.
function YearlySummaryTab() {
  const [year, setYear] = useState(dayjs().year());
  const { data: rows, isLoading } = usePanelYearlySummary(year);
  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Select
          style={{ width: 120 }}
          value={year}
          onChange={setYear}
          options={[0, 1, 2].map((offset) => {
            const y = dayjs().year() - offset;
            return { value: y, label: String(y) };
          })}
        />
        <Button
          icon={<DownloadOutlined />}
          disabled={!rows?.length}
          onClick={() => rows && exportCsv(`panel-claims-summary-${year}`, rows)}
        >
          CSV
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="panelClinicId"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: `No claims recorded in ${year}` }}
        columns={[
          { title: 'Panel', dataIndex: 'panelName' },
          { title: 'Claims', dataIndex: 'claims' },
          { title: 'Claimed (RM)', render: (_: unknown, r: PanelYearlySummaryRow) => r.claimedTotal.toFixed(2) },
          { title: 'Fee (RM)', render: (_: unknown, r: PanelYearlySummaryRow) => r.feeTotal.toFixed(2) },
          { title: 'Receivable (RM)', render: (_: unknown, r: PanelYearlySummaryRow) => r.receivableTotal.toFixed(2) },
          { title: 'Paid (RM)', render: (_: unknown, r: PanelYearlySummaryRow) => r.paidTotal.toFixed(2) },
          {
            title: 'Outstanding (RM)',
            render: (_: unknown, r: PanelYearlySummaryRow) => (
              <Text type={r.outstandingTotal > 0 ? 'danger' : undefined}>{r.outstandingTotal.toFixed(2)}</Text>
            ),
          },
        ]}
        summary={(data) => {
          const totals = (data as readonly PanelYearlySummaryRow[]).reduce(
            (acc, r) => ({
              claimed: acc.claimed + r.claimedTotal,
              fee: acc.fee + r.feeTotal,
              receivable: acc.receivable + r.receivableTotal,
              paid: acc.paid + r.paidTotal,
              outstanding: acc.outstanding + r.outstandingTotal,
            }),
            { claimed: 0, fee: 0, receivable: 0, paid: 0, outstanding: 0 },
          );
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <Text strong>TOTAL (RM)</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2}>
                <Text strong>{totals.claimed.toFixed(2)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3}>
                <Text strong>{totals.fee.toFixed(2)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4}>
                <Text strong>{totals.receivable.toFixed(2)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5}>
                <Text strong>{totals.paid.toFixed(2)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6}>
                <Text strong>{totals.outstanding.toFixed(2)}</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    </div>
  );
}

// Clinical Operations, Phase 1e (Panel Claims Core). One claim-batch
// workflow for every panel (D-031) — batches with no fixed period, a
// submission-method field capturing per-panel variance as data. Lives
// under Management → Panel, alongside Panel Clinics (pricing/exclusions).
export function PanelClaimsPage() {
  const { data: panels } = usePanelClinics();
  const [panelClinicId, setPanelClinicId] = useState<string>();

  return (
    <div style={{ paddingTop: 24, paddingBottom: 24 }}>
      <PageHeader
        title="Panel Claims"
        extra={
          <>
            <Select
          showSearch
          style={{ width: 240 }}
          placeholder="Select panel"
          value={panelClinicId}
          onChange={setPanelClinicId}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
          options={panels?.map((p) => ({ value: p.id, label: p.name }))}
        />
          </>
        }
      />
      <Tabs
        items={[
          { key: 'batches', label: 'Claim Batches', children: <ClaimBatchesTab panelClinicId={panelClinicId} /> },
          { key: 'listing', label: 'Claim Listing', children: <ClaimListingTab panelClinicId={panelClinicId} /> },
          { key: 'aging', label: 'Outstanding Aging', children: <OutstandingAgingTab /> },
          { key: 'summary', label: 'Yearly Summary', children: <YearlySummaryTab /> },
        ]}
      />
    </div>
  );
}
