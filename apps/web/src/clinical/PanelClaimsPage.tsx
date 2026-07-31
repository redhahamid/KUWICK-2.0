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
import { CheckCircleOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePanelClinics } from './hooks/usePanelClinics';
import { useStaff } from '../hr/hooks/useStaff';
import {
  useClaimBatches,
  useCreateClaimBatch,
  useEligibleClaimInvoices,
  useOutstandingClaims,
  useRecordClaimLinePayment,
  useReconcileClaimBatch,
  useSubmitClaimBatch,
} from './hooks/useClaimBatches';
import { ClaimBatch, ClaimBatchLine, ClaimSubmissionMethod, Invoice, OutstandingClaimBatch } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const BATCH_STATUS_COLOR: Record<string, string> = {
  BATCHED: 'default',
  SUBMITTED: 'blue',
  PARTIALLY_PAID: 'gold',
  PAID: 'green',
  RECONCILED: 'purple',
};

const LINE_STATUS_COLOR: Record<string, string> = {
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
  const createBatch = useCreateClaimBatch();
  const [selected, setSelected] = useState<string[]>([]);
  const [createdByStaffId, setCreatedByStaffId] = useState<string>();

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
          <Space style={{ marginTop: 12 }}>
            <Select
              showSearch
              style={{ width: 220 }}
              placeholder="Created By"
              value={createdByStaffId}
              onChange={setCreatedByStaffId}
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />
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
  const [lineEdits, setLineEdits] = useState<Record<string, { status: string; paidAmount?: number; deductionReason?: string }>>({});

  const claimedTotal = batch.lines.reduce((sum, line) => sum + Number(line.claimedAmount), 0);

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
          { title: 'Status', render: (_: unknown, l: ClaimBatchLine) => <Tag color={LINE_STATUS_COLOR[l.status]}>{l.status}</Tag> },
          { title: 'Paid (RM)', render: (_: unknown, l: ClaimBatchLine) => l.paidAmount ?? '—' },
          { title: 'Deduction Reason', render: (_: unknown, l: ClaimBatchLine) => l.deductionReason ?? '—' },
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
            <Table.Summary.Cell index={1} colSpan={4}>
              <Text strong>RM {claimedTotal.toFixed(2)}</Text>
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
          dataIndex: 'daysOutstanding',
          sorter: (a: OutstandingClaimBatch, b: OutstandingClaimBatch) => a.daysOutstanding - b.daysOutstanding,
        },
      ]}
    />
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
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Panel Claims
        </Title>
        <Select
          showSearch
          style={{ width: 240 }}
          placeholder="Select panel"
          value={panelClinicId}
          onChange={setPanelClinicId}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
          options={panels?.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Space>
      <Tabs
        items={[
          { key: 'batches', label: 'Claim Batches', children: <ClaimBatchesTab panelClinicId={panelClinicId} /> },
          { key: 'aging', label: 'Outstanding Aging', children: <OutstandingAgingTab /> },
        ]}
      />
    </div>
  );
}
