import { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Progress, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCan } from '../../core/hooks/useCan';
import {
  useApproveStockTake,
  useCreateStockTake,
  useRecordCounts,
  useStockTake,
  useStockTakes,
  useSubmitStockTake,
} from '../hooks/useAdmin';

const STATUS: Record<string, { colour: string; label: string }> = {
  DRAFT: { colour: 'default', label: 'Draft' },
  COUNTING: { colour: 'blue', label: 'Counting' },
  IN_REVIEW: { colour: 'gold', label: 'Awaiting approval' },
  POSTED: { colour: 'green', label: 'Posted' },
  CANCELLED: { colour: 'default', label: 'Cancelled' },
};

/**
 * STOCK TAKE — count, submit, approve, post.
 *
 * The one thing this screen must make unmistakable: TYPING A COUNT CHANGES
 * NOTHING. The banner says so while counting, the variance column is labelled
 * "would adjust by", and the only control that moves stock is the approval —
 * which is refused to the person who submitted the sheet.
 */
export function StockTakePage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const takes = useStockTakes(clinicId);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const detail = useStockTake(selectedId);

  const create = useCreateStockTake();
  const submit = useSubmitStockTake();
  const approve = useApproveStockTake();
  const record = useRecordCounts(selectedId ?? '');
  const mayApprove = useCan('stockTake.approve');

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const lines = detail.data?.lines ?? [];
  const counting = detail.data?.status === 'COUNTING';
  const inReview = detail.data?.status === 'IN_REVIEW';
  const posted = detail.data?.status === 'POSTED';

  const pendingVariance = useMemo(
    () =>
      lines.reduce((total, line) => {
        const counted = counts[line.id] ?? line.recountQuantity ?? line.countedQuantity;
        if (counted === null || counted === undefined) return total;
        return total + (counted - line.systemQuantity) * (line.unitCost ?? 0);
      }, 0),
    [lines, counts],
  );

  return (
    <AdminShell
      error={firstError(takes, detail)}
      title="Stock Take"
      subtitle="Count → submit → a second person approves → the ledger is corrected. Typing a count changes nothing on its own."
      actions={
        <Button size="small" type="primary" onClick={() => setCreateOpen(true)}>
          Start a stock take
        </Button>
      }
    >
      <AdminSection title="Stock takes" padded={false}>
        <DataTable
          rows={takes.data}
          loading={takes.isLoading}
          rowKey="id"
          emptyText="No stock takes yet"
          emptyHint="Starting one freezes what the system believes, so the variance is measured against what the counter was told."
          onRow={(row) => ({ onClick: () => setSelectedId(row.id) })}
          columns={[
            { title: 'Reference', dataIndex: 'takeNumber', key: 'takeNumber' },
            { title: 'Name', dataIndex: 'name', key: 'name' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => <Tag color={STATUS[value]?.colour}>{STATUS[value]?.label ?? value}</Tag>,
            },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            { title: 'Location', dataIndex: 'location', key: 'location', optional: true },
            {
              title: 'Counted',
              key: 'progress',
              render: (_: unknown, row) => (
                <Progress
                  percent={row.completionPercent}
                  size="small"
                  status={row.completionPercent === 100 ? 'success' : 'active'}
                  format={() => `${row.countedCount}/${row.lineCount}`}
                  style={{ minWidth: 120, marginBottom: 0 }}
                />
              ),
            },
            { title: 'Variances', dataIndex: 'varianceCount', key: 'varianceCount', className: 'kw-num' },
            {
              title: 'Value impact',
              dataIndex: 'varianceValue',
              key: 'varianceValue',
              className: 'kw-num',
              render: (value: number | null) =>
                value === null ? <span className="kw-muted">not posted</span> : (
                  <span className={value < 0 ? 'kw-bad' : 'kw-good'}>{money(value)}</span>
                ),
            },
            { title: 'Submitted by', dataIndex: 'submittedBy', key: 'submittedBy', optional: true },
            { title: 'Approved by', dataIndex: 'reviewedBy', key: 'reviewedBy', optional: true },
          ]}
        />
      </AdminSection>

      {detail.data ? (
        <AdminSection
          title={`${detail.data.takeNumber} · ${detail.data.name}`}
          description={
            posted
              ? `Posted on ${dayjs(detail.data.postedAt).format('D MMM YYYY')} by ${detail.data.reviewedBy}. The correction is on the movement ledger and can be read there like any other movement.`
              : undefined
          }
          actions={
            <>
              {counting ? (
                <>
                  <Button
                    size="small"
                    disabled={Object.keys(counts).length === 0}
                    loading={record.isPending}
                    onClick={() =>
                      record.mutate(
                        Object.entries(counts).map(([lineId, quantity]) => ({ lineId, quantity })),
                        {
                          onSuccess: () => {
                            message.success('Counts saved');
                            setCounts({});
                          },
                          onError: (error: Error) => message.error(error.message),
                        },
                      )
                    }
                  >
                    Save counts
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={submit.isPending}
                    onClick={() =>
                      submit.mutate(detail.data!.id, {
                        onSuccess: () => message.success('Submitted for approval'),
                        onError: (error: Error) => message.error(error.message),
                      })
                    }
                  >
                    Submit for approval
                  </Button>
                </>
              ) : null}
              {inReview ? (
                <Button
                  size="small"
                  type="primary"
                  disabled={!mayApprove}
                  loading={approve.isPending}
                  onClick={() =>
                    approve.mutate(
                      { id: detail.data!.id },
                      {
                        onSuccess: () => message.success('Approved and posted to the ledger'),
                        onError: (error: Error) => message.error(error.message),
                      },
                    )
                  }
                >
                  Approve and post
                </Button>
              ) : null}
            </>
          }
          padded={false}
        >
          {counting ? (
            <div style={{ padding: '12px 16px 0' }}>
              <AdminNotice>
                Nothing here changes live stock. Counts are saved against this sheet; the ledger is corrected once —
                when somebody other than you approves it.
                {pendingVariance !== 0 ? ` As counted so far, approval would adjust stock value by ${money(pendingVariance)}.` : ''}
              </AdminNotice>
            </div>
          ) : null}
          {inReview && !mayApprove ? (
            <div style={{ padding: '12px 16px 0' }}>
              <AdminNotice tone="warn">
                This sheet is waiting for approval. The person who counted cannot approve their own count, which is why
                this button is not available to you.
              </AdminNotice>
            </div>
          ) : null}
          <DataTable
            rows={lines}
            loading={detail.isLoading}
            rowKey="id"
            exportName={`stock-take-${detail.data.takeNumber}`}
            searchFields={['itemName' as never, 'itemCode' as never, 'category' as never]}
            searchPlaceholder="Search item…"
            emptyText="Nothing to count"
            scrollY={480}
            columns={[
              { title: 'Item', dataIndex: 'itemName', key: 'itemName' },
              { title: 'Code', dataIndex: 'itemCode', key: 'itemCode', optional: true },
              { title: 'Category', dataIndex: 'category', key: 'category', optional: true },
              {
                title: 'System said',
                dataIndex: 'systemQuantity',
                key: 'systemQuantity',
                className: 'kw-num',
              },
              {
                title: 'Counted',
                dataIndex: 'countedQuantity',
                key: 'countedQuantity',
                className: 'kw-num',
                render: (value: number | null, row) =>
                  counting ? (
                    <Input
                      size="small"
                      type="number"
                      style={{ width: 80, textAlign: 'right' }}
                      defaultValue={value ?? undefined}
                      placeholder="—"
                      onBlur={(event) => {
                        const next = event.target.value === '' ? undefined : Number(event.target.value);
                        if (next !== undefined && next !== value) {
                          setCounts((current) => ({ ...current, [row.id]: next }));
                        }
                      }}
                    />
                  ) : value === null ? (
                    <span className="kw-muted">not counted</span>
                  ) : (
                    value
                  ),
              },
              {
                title: posted ? 'Adjusted by' : 'Would adjust by',
                dataIndex: 'variance',
                key: 'variance',
                className: 'kw-num',
                render: (value: number | null, row) => {
                  const counted = counts[row.id] ?? row.recountQuantity ?? row.countedQuantity;
                  const variance = counted === null || counted === undefined ? null : counted - row.systemQuantity;
                  if (variance === null) return <span className="kw-muted">—</span>;
                  if (variance === 0) return <span className="kw-muted">0</span>;
                  return <span className={variance < 0 ? 'kw-bad' : 'kw-good'}>{variance > 0 ? `+${variance}` : variance}</span>;
                },
              },
              {
                title: 'Value',
                dataIndex: 'varianceValue',
                key: 'varianceValue',
                className: 'kw-num',
                render: (value: number) => (value === 0 ? <span className="kw-muted">—</span> : money(value)),
              },
              { title: 'Reason', dataIndex: 'varianceReason', key: 'varianceReason', ellipsis: true },
              { title: 'Counted by', dataIndex: 'countedBy', key: 'countedBy', optional: true },
            ]}
          />
        </AdminSection>
      ) : null}

      <Modal
        open={createOpen}
        title="Start a stock take"
        okText="Generate the count sheet"
        okButtonProps={{ disabled: newName.trim().length < 3 }}
        confirmLoading={create.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          create.mutate(
            { clinicId, name: newName },
            {
              onSuccess: (result) => {
                message.success('Count sheet generated');
                setCreateOpen(false);
                setNewName('');
                setSelectedId((result as { id: string }).id);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <p className="kw-adminSection__desc">
          The sheet freezes what the system believes right now, so the variance is measured against what the counter was
          told — not against a number that moved while they were on the shelf.
        </p>
        <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. August cold-room count" />
      </Modal>
    </AdminShell>
  );
}
