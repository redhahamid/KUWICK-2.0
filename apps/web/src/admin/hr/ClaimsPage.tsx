import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Radio, Segmented, Tag, Timeline } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import {
  useDecideStaffClaim,
  useSettleStaffClaim,
  useStaffClaimHistory,
  useStaffClaims,
} from '../hooks/useAdmin';
import type { PaymentRoute, StaffClaimRow } from '../types';

const CATEGORY_LABEL: Record<string, string> = {
  MEDICAL: 'Medical',
  TRAVEL: 'Travel',
  MEAL: 'Meal',
  TRAINING: 'Training',
  EQUIPMENT: 'Equipment',
  PROFESSIONAL_FEE: 'Professional fee',
  OTHER: 'Other',
};

/**
 * STAFF CLAIMS.
 *
 * A reimbursement used to be a number somebody typed into a payroll run: no
 * category, no receipt, no approver, and nothing at all stopping the same
 * receipt being paid with September's salary and reimbursed again by Finance in
 * October.
 *
 * The screen is built around the one decision that prevents that — WHERE the
 * money comes from — and says the answer in words on every row rather than
 * leaving it to be inferred from which module the reader happens to be in.
 */
export function ClaimsPage() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<'SUBMITTED' | 'APPROVED' | 'ALL'>('SUBMITTED');
  const claims = useStaffClaims(tab === 'ALL' ? {} : { status: tab });
  const decide = useDecideStaffClaim();
  const settle = useSettleStaffClaim();

  const [deciding, setDeciding] = useState<StaffClaimRow | null>(null);
  const [amount, setAmount] = useState('');
  const [route, setRoute] = useState<PaymentRoute>('PAYROLL');
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<StaffClaimRow | null>(null);
  const history = useStaffClaimHistory(viewing?.id);

  const rows = claims.data ?? [];
  const counts = useMemo(() => {
    const awaiting = rows.filter((r) => r.status === 'SUBMITTED').length;
    const inPayroll = rows.filter((r) => r.payoutStatus === 'IN_PAYROLL').length;
    const owedByFinance = rows.filter(
      (r) => r.status === 'APPROVED' && r.paymentRoute === 'FINANCE' && r.payoutStatus !== 'PAID',
    ).length;
    return { awaiting, inPayroll, owedByFinance };
  }, [rows]);

  return (
    <AdminShell
      error={firstError(claims)}
      title="Staff claims"
      subtitle="What an employee spent that the clinic agreed to give back. Every approved claim is paid once, by one route."
      actions={
        <Segmented
          size="small"
          value={tab}
          onChange={(value) => setTab(value as typeof tab)}
          options={[
            { label: 'Awaiting decision', value: 'SUBMITTED' },
            { label: 'Approved', value: 'APPROVED' },
            { label: 'All', value: 'ALL' },
          ]}
        />
      }
    >
      <AdminNotice tone="info">
        Approving a claim chooses <strong>where it is paid from</strong>, and that choice cannot be changed once the
        money has moved. A claim paid with salary will never also be reimbursed by Finance — Kuwick refuses the second
        payment rather than relying on somebody noticing.
      </AdminNotice>

      <StatStrip
        stats={[
          {
            label: 'Awaiting a decision',
            value: counts.awaiting,
            hint: 'Somebody is waiting to be paid back',
            tone: counts.awaiting > 0 ? 'warn' : 'good',
          },
          {
            label: 'Being paid with salary',
            value: counts.inPayroll,
            hint: 'On a payroll run for their period',
          },
          {
            label: 'Owed by Finance',
            value: counts.owedByFinance,
            hint: 'Approved for separate reimbursement, not yet settled',
            tone: counts.owedByFinance > 0 ? 'warn' : 'neutral',
          },
        ]}
      />

      <AdminSection
        title="Claims"
        description="A claim is approved for an amount and a route. The approver may not be the claimant."
      >
        <DataTable<StaffClaimRow>
          rowKey="id"
          loading={claims.isLoading}
          rows={rows}
          searchFields={['staffName', 'description']}
          emptyText="No claims to show."
          columns={[
            { title: 'Date', dataIndex: 'claimDate', width: 110 },
            { title: 'Person', dataIndex: 'staffName', width: 180 },
            {
              title: 'Category',
              dataIndex: 'category',
              width: 140,
              render: (value: string) => CATEGORY_LABEL[value] ?? value,
            },
            { title: 'What for', dataIndex: 'description' },
            {
              title: 'Claimed',
              dataIndex: 'amountClaimed',
              width: 110,
              align: 'right' as const,
              render: (value: string) => `RM${value}`,
            },
            {
              title: 'Approved',
              dataIndex: 'amountApproved',
              width: 110,
              align: 'right' as const,
              render: (value: string | null) =>
                value ? <strong>RM{value}</strong> : <span className="kw-muted">—</span>,
            },
            {
              title: 'Paid from',
              width: 230,
              render: (_: unknown, row: StaffClaimRow) => <RouteTag row={row} />,
            },
            {
              title: '',
              width: 200,
              noExport: true,
              render: (_: unknown, row: StaffClaimRow) => (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => setViewing(row)}>
                    History
                  </Button>
                  {row.status === 'SUBMITTED' ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        setDeciding(row);
                        setAmount(row.amountClaimed);
                        setRoute('PAYROLL');
                        setReason('');
                      }}
                    >
                      Decide
                    </Button>
                  ) : null}
                  {row.status === 'APPROVED' && row.paymentRoute === 'FINANCE' && row.payoutStatus !== 'PAID' ? (
                    <Button
                      size="small"
                      onClick={() => {
                        let reference = '';
                        Modal.confirm({
                          title: 'Record the reimbursement',
                          content: (
                            <div>
                              <p style={{ marginTop: 0 }}>Finance's own reference for this payment.</p>
                              <Input
                                placeholder="e.g. PV-2026-0043"
                                onChange={(event) => {
                                  reference = event.target.value;
                                }}
                              />
                            </div>
                          ),
                          okText: 'Record as reimbursed',
                          onOk: () =>
                            new Promise<void>((resolve, reject) => {
                              if (!reference.trim()) {
                                message.error('A reference is required.');
                                reject();
                                return;
                              }
                              settle.mutate(
                                { id: row.id, financeReference: reference.trim() },
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

      <Modal
        open={deciding !== null}
        title={`${deciding?.staffName ?? ''} — ${CATEGORY_LABEL[deciding?.category ?? ''] ?? ''} claim`}
        okText="Approve"
        confirmLoading={decide.isPending}
        onCancel={() => setDeciding(null)}
        footer={[
          <Button key="cancel" onClick={() => setDeciding(null)}>
            Cancel
          </Button>,
          <Button
            key="reject"
            danger
            loading={decide.isPending}
            onClick={() => {
              if (!deciding) return;
              decide.mutate(
                { id: deciding.id, decision: 'REJECTED', reason },
                {
                  onSuccess: () => {
                    message.success('Rejected');
                    setDeciding(null);
                  },
                  onError: (error: Error) => message.error(error.message),
                },
              );
            }}
          >
            Reject
          </Button>,
          <Button
            key="approve"
            type="primary"
            loading={decide.isPending}
            onClick={() => {
              if (!deciding) return;
              decide.mutate(
                { id: deciding.id, decision: 'APPROVED', amountApproved: amount, paymentRoute: route, reason },
                {
                  onSuccess: () => {
                    message.success('Approved');
                    setDeciding(null);
                  },
                  onError: (error: Error) => message.error(error.message),
                },
              );
            }}
          >
            Approve
          </Button>,
        ]}
      >
        <p style={{ marginTop: 0 }}>{deciding?.description}</p>
        <p className="kw-muted">
          Claimed RM{deciding?.amountClaimed} for {deciding?.claimDate}, submitted by {deciding?.submittedBy}.
        </p>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Approve how much?</div>
          <Input addonBefore="RM" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <div className="kw-muted" style={{ marginTop: 4, fontSize: 12 }}>
            Part-approving is normal. Kuwick will not let you approve more than was claimed.
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Paid from where?</div>
          <Radio.Group value={route} onChange={(event) => setRoute(event.target.value)}>
            <Radio value="PAYROLL">With their salary</Radio>
            <Radio value="FINANCE">Separately, by Finance</Radio>
          </Radio.Group>
          <div className="kw-muted" style={{ marginTop: 6, fontSize: 12 }}>
            {route === 'PAYROLL'
              ? `This will appear on the payroll run for ${dayjs(deciding?.claimDate).format('MMMM YYYY')} and can never also be reimbursed by Finance.`
              : 'Finance reimburses this outside payroll. It will never reach a payslip.'}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Note (optional)</div>
          <Input.TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </Modal>

      <Modal
        open={viewing !== null}
        title={`History — ${viewing?.staffName ?? ''}`}
        footer={null}
        onCancel={() => setViewing(null)}
      >
        <p className="kw-muted" style={{ marginTop: 0 }}>
          {viewing?.routeExplanation}
        </p>
        <Timeline
          items={(history.data ?? []).map((event) => ({
            children: (
              <div>
                <strong style={{ textTransform: 'capitalize' }}>{event.event}</strong>
                {event.detail ? <div>{event.detail}</div> : null}
                <div className="kw-muted" style={{ fontSize: 12 }}>
                  {event.actor} · {dayjs(event.at).format('D MMM YYYY, HH:mm')}
                </div>
              </div>
            ),
          }))}
        />
      </Modal>
    </AdminShell>
  );
}

/**
 * The route, said in words rather than as an enum. "Where is this being paid
 * from" is the question a duplicate payment turns on, so it is never left to
 * the reader to work out from context.
 */
function RouteTag({ row }: { row: StaffClaimRow }) {
  if (row.status === 'REJECTED') return <Tag>Rejected</Tag>;
  if (row.status === 'CANCELLED') return <Tag>Withdrawn</Tag>;
  if (row.status !== 'APPROVED') return <Tag color="warning">Awaiting a decision</Tag>;
  if (row.paymentRoute === 'PAYROLL') {
    return row.payoutStatus === 'IN_PAYROLL' ? (
      <Tag color="processing">On {dayjs(row.payrollPeriod ?? undefined).format('MMM YYYY')} payroll</Tag>
    ) : (
      <Tag color="processing">With salary</Tag>
    );
  }
  return row.payoutStatus === 'PAID' ? (
    <Tag color="success">Finance · {row.financeReference}</Tag>
  ) : (
    <Tag color="warning">Finance, not yet paid</Tag>
  );
}
