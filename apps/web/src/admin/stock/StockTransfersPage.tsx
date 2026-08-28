import { useState } from 'react';
import { App, Button, InputNumber, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useReceiveTransfer, useSendTransfer, useStockTransfers } from '../hooks/useAdmin';
import type { StockTransferRow } from '../types';

const STATUS_TAGS: Record<string, { colour: string; label: string }> = {
  DRAFT: { colour: 'default', label: 'Draft' },
  SENT: { colour: 'blue', label: 'In transit' },
  RECEIVED: { colour: 'green', label: 'Received' },
  RECEIVED_WITH_DISCREPANCY: { colour: 'red', label: 'Discrepancy' },
  CANCELLED: { colour: 'default', label: 'Cancelled' },
};

/**
 * TRANSFERS — a document with two ends.
 *
 * The receiving form is the point of this screen. It shows what was SENT as
 * read-only text beside an input for what ARRIVED, because the sender's number
 * is not something the receiver edits — a difference between them is a
 * discrepancy to be explained, not a disagreement to be resolved by typing.
 */
export function StockTransfersPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const [direction, setDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const { data, isLoading, isError, error } = useStockTransfers({
    clinicId,
    direction: direction === 'ALL' ? undefined : direction,
  });
  const send = useSendTransfer();
  const receive = useReceiveTransfer();

  const [receiving, setReceiving] = useState<StockTransferRow | null>(null);
  const [counts, setCounts] = useState<Record<string, { quantityReceived: number; discrepancyReason?: string }>>({});

  const inTransit = data?.filter((row) => row.status === 'SENT') ?? [];
  const discrepancies = data?.filter((row) => row.status === 'RECEIVED_WITH_DISCREPANCY') ?? [];

  function openReceive(transfer: StockTransferRow) {
    setReceiving(transfer);
    setCounts(
      Object.fromEntries(transfer.lines.map((line) => [line.id, { quantityReceived: line.quantitySent }])),
    );
  }

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Stock Transfers"
      subtitle="Stock leaves one branch when it is sent and arrives at the other when it is received — in between it is in transit, on neither shelf."
      actions={
        <Button.Group size="small">
          {(['ALL', 'OUT', 'IN'] as const).map((value) => (
            <Button key={value} type={direction === value ? 'primary' : 'default'} onClick={() => setDirection(value)}>
              {value === 'ALL' ? 'All' : value === 'OUT' ? 'Sent from here' : 'Coming here'}
            </Button>
          ))}
        </Button.Group>
      }
    >
      <StatStrip
        stats={[
          { label: 'In transit', value: inTransit.length, tone: inTransit.length > 0 ? 'warn' : 'neutral', hint: 'Awaiting confirmation' },
          {
            label: 'Value in transit',
            value: money(inTransit.reduce((total, row) => total + row.value, 0)),
          },
          {
            label: 'Discrepancies',
            value: discrepancies.length,
            tone: discrepancies.length > 0 ? 'bad' : 'good',
            hint: 'Sent ≠ received',
          },
        ]}
      />

      {discrepancies.length > 0 ? (
        <AdminNotice tone="warn">
          {discrepancies.length} transfer(s) arrived with a count different from what was sent. Stock that left one
          branch and never reached the other STAYS missing — putting it back automatically would hide the loss. Resolve
          it with a stock adjustment once you know what happened.
        </AdminNotice>
      ) : null}

      <AdminSection title="Transfers" padded={false}>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey="id"
          exportName="stock-transfers"
          searchFields={['transferNumber' as never, 'fromClinicName' as never, 'toClinicName' as never]}
          searchPlaceholder="Search transfer or branch…"
          emptyText="No transfers"
          columns={[
            { title: 'Transfer', dataIndex: 'transferNumber', key: 'transferNumber' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => <Tag color={STATUS_TAGS[value]?.colour}>{STATUS_TAGS[value]?.label ?? value}</Tag>,
            },
            { title: 'From', dataIndex: 'fromClinicName', key: 'fromClinicName' },
            { title: 'To', dataIndex: 'toClinicName', key: 'toClinicName' },
            {
              title: 'Inter-company',
              dataIndex: 'interCompany',
              key: 'interCompany',
              optional: true,
              render: (value: boolean, row) =>
                value ? <Tag color="purple">{row.interCompanyReference ?? 'Yes'}</Tag> : <span className="kw-muted">No</span>,
            },
            { title: 'Lines', dataIndex: 'lineCount', key: 'lineCount', className: 'kw-num' },
            { title: 'Sent', dataIndex: 'totalSent', key: 'totalSent', className: 'kw-num' },
            {
              title: 'Received',
              dataIndex: 'totalReceived',
              key: 'totalReceived',
              className: 'kw-num',
              render: (value: number, row) =>
                row.status === 'SENT' ? <span className="kw-muted">—</span> : (
                  <span className={row.discrepancyCount > 0 ? 'kw-bad' : undefined}>{value}</span>
                ),
            },
            { title: 'Value', dataIndex: 'value', key: 'value', className: 'kw-num', render: (v: number) => money(v) },
            {
              title: 'Sent on',
              dataIndex: 'sentAt',
              key: 'sentAt',
              render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : '—'),
            },
            {
              title: '',
              key: 'action',
              noExport: true,
              render: (_: unknown, row) =>
                row.status === 'DRAFT' ? (
                  <Button
                    size="small"
                    type="link"
                    loading={send.isPending}
                    onClick={() =>
                      send.mutate(row.id, {
                        onSuccess: () => message.success(`${row.transferNumber} sent`),
                        onError: (error: Error) => message.error(error.message),
                      })
                    }
                  >
                    Send
                  </Button>
                ) : row.status === 'SENT' ? (
                  <Button size="small" type="link" onClick={() => openReceive(row)}>
                    Receive
                  </Button>
                ) : null,
            },
          ]}
        />
      </AdminSection>

      <Modal
        open={receiving !== null}
        width={700}
        title={`Receive ${receiving?.transferNumber ?? ''}`}
        okText="Confirm what arrived"
        confirmLoading={receive.isPending}
        onCancel={() => setReceiving(null)}
        onOk={() =>
          receiving &&
          receive.mutate(
            {
              id: receiving.id,
              lines: receiving.lines.map((line) => ({
                lineId: line.id,
                quantityReceived: counts[line.id]?.quantityReceived ?? 0,
                discrepancyReason: counts[line.id]?.discrepancyReason,
              })),
            },
            {
              onSuccess: () => {
                message.success('Transfer received');
                setReceiving(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <p className="kw-adminSection__desc" style={{ marginBottom: 12 }}>
          Count what physically arrived. The sent quantity is what the other branch recorded and cannot be changed from
          here — a difference is a discrepancy that needs an explanation.
        </p>
        <div className="kw-receiveForm">
          {receiving?.lines.map((line) => {
            const entry = counts[line.id];
            const differs = entry && entry.quantityReceived !== line.quantitySent;
            return (
              <div className="kw-receiveRow" key={line.id}>
                <div className="kw-receiveRow__item">
                  <strong>{line.itemName}</strong>
                  <small>{line.itemCode ?? ''} {line.unit ? `· ${line.unit}` : ''}</small>
                </div>
                <div className="kw-receiveRow__sent">
                  <small>Sent</small>
                  <span>{line.quantitySent}</span>
                </div>
                <InputNumber
                  size="small"
                  min={0}
                  value={entry?.quantityReceived}
                  onChange={(value) =>
                    setCounts((current) => ({
                      ...current,
                      [line.id]: { ...current[line.id], quantityReceived: value ?? 0 },
                    }))
                  }
                  style={{ width: 92 }}
                />
                {differs ? (
                  <input
                    className="kw-receiveRow__reason"
                    placeholder="Why the difference?"
                    value={entry?.discrepancyReason ?? ''}
                    onChange={(event) =>
                      setCounts((current) => ({
                        ...current,
                        [line.id]: { ...current[line.id], discrepancyReason: event.target.value },
                      }))
                    }
                  />
                ) : (
                  <span className="kw-muted" style={{ fontSize: 12 }}>Matches</span>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
    </AdminShell>
  );
}
