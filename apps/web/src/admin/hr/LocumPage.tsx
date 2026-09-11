import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, ringgit } from '../components/DataTable';
import {
  useApproveLocumSession,
  useLocumPayable,
  useLocumSessions,
  useSettleLocumSession,
  useUpdateLocumSession,
} from '../hooks/useAdmin';
import type { LocumSessionRow } from '../types';

/**
 * LOCUM SESSIONS — paying somebody who is NOT an employee.
 *
 * The clinic's locum used to appear in payroll runs alongside its staff. That
 * is not a classification nicety: it applies EPF, SOCSO and EIS treatment to a
 * person who is not a member of those schemes, and it puts a professional fee
 * on a payslip.
 *
 * This screen exists so that "who else am I paying this month" has an answer
 * that is not the payroll run. It deliberately looks like a payable and not
 * like payroll: no statutory columns, no payslips, and the route stated on
 * every row.
 */
export function LocumPage() {
  const { message, modal } = App.useApp();
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const from = `${month}-01`;
  const to = dayjs(from).endOf('month').format('YYYY-MM-DD');

  const sessions = useLocumSessions({ from, to });
  const payable = useLocumPayable({ from, to });
  const approve = useApproveLocumSession();
  const settle = useSettleLocumSession();
  const update = useUpdateLocumSession();

  const [approving, setApproving] = useState<LocumSessionRow | null>(null);
  const [amount, setAmount] = useState('');

  const rows = sessions.data ?? [];
  const awaiting = useMemo(() => rows.filter((r) => r.status === 'COMPLETED').length, [rows]);

  return (
    <AdminShell
      error={firstError(sessions, payable)}
      title="Locum sessions"
      subtitle="Work done by people the clinic engages but does not employ. These are professional fees paid by Finance — never payroll, and never subject to EPF, SOCSO or EIS."
      actions={
        <DatePicker
          picker="month"
          size="small"
          allowClear={false}
          value={dayjs(month)}
          onChange={(value) => value && setMonth(value.format('YYYY-MM'))}
        />
      }
    >
      <AdminNotice tone="info">
        A locum is a <strong>contractor</strong>: a payable, never a payslip, and no statutory contribution. Payroll
        follows the engagement on somebody&apos;s employment record, not the word &quot;locum&quot;.
      </AdminNotice>

      <StatStrip
        stats={[
          {
            label: 'Sessions this month',
            value: rows.length,
            hint: `${awaiting} waiting for a fee to be approved`,
            tone: awaiting > 0 ? 'warn' : 'neutral',
          },
          {
            label: 'Approved',
            value: payable.data ? ringgit(payable.data.totalApproved) : '—',
            hint: 'Fees the clinic has agreed to pay',
          },
          {
            label: 'Still outstanding',
            value: payable.data ? ringgit(payable.data.totalOutstanding) : '—',
            hint: 'Approved but not yet settled by Finance',
            tone: payable.data && payable.data.totalOutstanding !== '0.00' ? 'warn' : 'good',
          },
          {
            label: 'Paid through',
            value: 'Finance',
            hint: 'Not payroll. Stated so nobody has to infer it.',
            explain:
              'A contractor is paid under a contract for services. Routing that through payroll would apply employee statutory treatment to somebody who is not an employee.',
          },
        ]}
      />

      <AdminSection
        title="Sessions"
        description="Mark a session completed once the work is done, then approve the fee. Approving names the amount rather than confirming a computed one."
      >
        <DataTable<LocumSessionRow>
          rowKey="id"
          loading={sessions.isLoading}
          rows={rows}
          emptyText="No locum sessions recorded for this month."
          columns={[
            { title: 'Date', dataIndex: 'sessionDate', width: 110 },
            { title: 'Person', dataIndex: 'staffName' },
            { title: 'Branch', dataIndex: 'clinicName', width: 150 },
            {
              title: 'Basis',
              width: 190,
              render: (_: unknown, row: LocumSessionRow) =>
                row.sessionFee
                  ? `Flat fee ${ringgit(String(row.sessionFee))}`
                  : row.hours && row.hourlyRate
                    ? `${row.hours} hrs x ${ringgit(String(row.hourlyRate))}`
                    : '—',
            },
            {
              title: 'Computed',
              width: 110,
              align: 'right' as const,
              render: (_: unknown, row: LocumSessionRow) => (row.computedFee ? ringgit(row.computedFee) : '—'),
            },
            {
              title: 'Approved',
              width: 110,
              align: 'right' as const,
              render: (_: unknown, row: LocumSessionRow) =>
                row.approvedAmount ? <strong>{ringgit(row.approvedAmount)}</strong> : <span className="kw-muted">—</span>,
            },
            {
              title: 'Status',
              width: 150,
              render: (_: unknown, row: LocumSessionRow) => <SessionStatus row={row} />,
            },
            {
              title: '',
              width: 190,
              render: (_: unknown, row: LocumSessionRow) => (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {row.status === 'PLANNED' ? (
                    <Button
                      size="small"
                      onClick={() =>
                        update.mutate(
                          { id: row.id, status: 'COMPLETED' },
                          {
                            onSuccess: () => message.success('Marked completed'),
                            onError: (error: Error) => message.error(error.message),
                          },
                        )
                      }
                    >
                      Mark completed
                    </Button>
                  ) : null}
                  {row.status === 'COMPLETED' ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        setApproving(row);
                        setAmount(row.computedFee ?? '');
                      }}
                    >
                      Approve fee
                    </Button>
                  ) : null}
                  {row.status === 'APPROVED' && row.payoutStatus !== 'PAID' ? (
                    <Button
                      size="small"
                      onClick={() => {
                        let reference = '';
                        modal.confirm({
                          title: 'Record the Finance payment',
                          content: (
                            <div>
                              <p style={{ marginTop: 0 }}>
                                The clinic's own reference for this payment. It is required: "paid" with no trace is
                                not a record.
                              </p>
                              <Input
                                placeholder="e.g. PV-2026-0043"
                                onChange={(event) => {
                                  reference = event.target.value;
                                }}
                              />
                            </div>
                          ),
                          okText: 'Record as paid',
                          onOk: () =>
                            new Promise<void>((resolve, reject) => {
                              if (!reference.trim()) {
                                message.error('A reference is required.');
                                reject();
                                return;
                              }
                              settle.mutate(
                                { id: row.id, invoiceReference: reference.trim() },
                                {
                                  onSuccess: () => {
                                    message.success('Recorded');
                                    resolve();
                                  },
                                  onError: (error: Error) => {
                                    message.error(error.message);
                                    reject();
                                  },
                                },
                              );
                            }),
                        });
                      }}
                    >
                      Record payment
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </AdminSection>

      <AdminSection
        title="What the clinic owes"
        description="Per person, for this month. The equivalent of a payroll summary for the people who are not on payroll."
      >
        <DataTable
          rowKey="staffId"
          loading={payable.isLoading}
          rows={payable.data?.people ?? []}
          emptyText="Nothing owed to contractors this month."
          columns={[
            { title: 'Person', dataIndex: 'name' },
            { title: 'Sessions', dataIndex: 'sessions', width: 100, align: 'right' as const },
            {
              title: 'Waiting for approval',
              dataIndex: 'awaitingApproval',
              width: 170,
              align: 'right' as const,
              render: (value: number) =>
                value > 0 ? <Tag color="warning">{value}</Tag> : <span className="kw-muted">—</span>,
            },
            {
              title: 'Approved',
              dataIndex: 'approved',
              width: 130,
              align: 'right' as const,
              render: (value: string) => ringgit(value),
            },
            {
              title: 'Outstanding',
              dataIndex: 'outstanding',
              width: 130,
              align: 'right' as const,
              render: (value: string) => <strong>{ringgit(value)}</strong>,
            },
          ]}
        />
      </AdminSection>

      <Modal
        open={approving !== null}
        title={`Approve the fee for ${approving?.staffName ?? ''}`}
        okText="Approve"
        confirmLoading={approve.isPending}
        onCancel={() => setApproving(null)}
        onOk={() => {
          if (!approving) return;
          approve.mutate(
            { id: approving.id, approvedAmount: amount },
            {
              onSuccess: () => {
                message.success('Fee approved');
                setApproving(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          );
        }}
      >
        <p>
          The session on {approving?.sessionDate} computes to{' '}
          <strong>{ringgit(approving?.computedFee)}</strong>. Approving names the amount the clinic will actually pay,
          which may differ.
        </p>
        <Input
          addonBefore="RM"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
        />
        <p className="kw-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          This becomes a payable for Finance to settle. It will never appear on a payslip.
        </p>
      </Modal>
    </AdminShell>
  );
}

function SessionStatus({ row }: { row: LocumSessionRow }) {
  if (row.status === 'CANCELLED') return <Tag>Cancelled</Tag>;
  if (row.status === 'PLANNED') return <Tag>Planned</Tag>;
  if (row.status === 'COMPLETED') return <Tag color="warning">Fee not approved</Tag>;
  if (row.payoutStatus === 'PAID') {
    return <Tag color="success">Paid{row.invoiceReference ? ` · ${row.invoiceReference}` : ''}</Tag>;
  }
  return <Tag color="processing">Approved, owed</Tag>;
}
