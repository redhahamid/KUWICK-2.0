import { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Radio, Select, Timeline } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, ringgit } from '../components/DataTable';
import { FilterBar, Filter } from '../components/FilterBar';
import { PersonCell } from '../components/Person';
import { StatusChip } from '../components/Chip';
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
 * CLAIMS — the fourth Time & Leave view, and drawn like the other three.
 *
 * It used to be the odd one out: its own Segmented control in the page header
 * rather than the shared filter bar, antd `Tag`s in five colours where the
 * rest of HR uses one chip vocabulary, and a bare "Person" column of text
 * where every other screen shows the person. Somebody moving from Leave to
 * Claims arrived at a different product, which is the exact thing the brief
 * says must not happen.
 *
 * WHAT DID NOT CHANGE is the reason the screen exists. A reimbursement used to
 * be a number somebody typed into a payroll run — no category, no receipt, no
 * approver, and nothing stopping the same receipt being paid with September's
 * salary and reimbursed again by Finance in October. The screen is built
 * around the one decision that prevents that: WHERE the money comes from, said
 * in words on every row.
 */
export function ClaimsPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<'SUBMITTED' | 'APPROVED' | 'ALL'>('SUBMITTED');
  const [route, setRouteFilter] = useState<'ALL' | PaymentRoute>('ALL');
  const claims = useStaffClaims(status === 'ALL' ? {} : { status });
  /**
   * THE COUNTS ARE NOT THE FILTER.
   *
   * These were computed from whatever the current tab had fetched, so opening
   * on "Awaiting decision" reported "being paid with salary: 0" while claims
   * were sitting on a payroll run. A count that reads zero because of a filter
   * the reader did not apply is worse than no count.
   */
  const everyClaim = useStaffClaims({});
  const decide = useDecideStaffClaim();
  const settle = useSettleStaffClaim();

  const [deciding, setDeciding] = useState<StaffClaimRow | null>(null);
  const [amount, setAmount] = useState('');
  const [payRoute, setPayRoute] = useState<PaymentRoute>('PAYROLL');
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<StaffClaimRow | null>(null);
  const history = useStaffClaimHistory(viewing?.id);

  const rows = useMemo(
    () => (claims.data ?? []).filter((row) => route === 'ALL' || row.paymentRoute === route),
    [claims.data, route],
  );

  const counts = useMemo(() => {
    const all = everyClaim.data ?? [];
    return {
      awaiting: all.filter((row) => row.status === 'SUBMITTED').length,
      withSalary: all.filter((row) => row.status === 'APPROVED' && row.paymentRoute === 'PAYROLL').length,
      owedByFinance: all.filter(
        (row) => row.status === 'APPROVED' && row.paymentRoute === 'FINANCE' && row.payoutStatus !== 'PAID',
      ).length,
      owedTotal: all
        .filter((row) => row.status === 'APPROVED' && row.paymentRoute === 'FINANCE' && row.payoutStatus !== 'PAID')
        .reduce((total, row) => total + Number(row.amountApproved ?? 0), 0),
    };
  }, [everyClaim.data]);

  return (
    <AdminShell
      error={firstError(claims, everyClaim)}
      title="Claims"
      subtitle="What staff spent that the clinic agreed to give back."
    >

      <StatStrip
        stats={[
          {
            label: 'Awaiting a decision',
            value: counts.awaiting,
            hint: 'Somebody is waiting to be paid back',
            tone: counts.awaiting > 0 ? 'warn' : 'good',
          },
          { label: 'Being paid with salary', value: counts.withSalary, hint: 'On the run for their period' },
          {
            label: 'Owed by Finance',
            value: counts.owedByFinance,
            hint: counts.owedByFinance > 0 ? ringgit(counts.owedTotal.toFixed(2)) : 'Nothing outstanding',
            tone: counts.owedByFinance > 0 ? 'warn' : 'neutral',
          },
        ]}
      />

      <FilterBar>
        <Filter label="Status">
          <Select
            size="small"
            style={{ width: 190 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'SUBMITTED', label: 'Awaiting a decision' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'ALL', label: 'All claims' },
            ]}
          />
        </Filter>
        <Filter label="Payment route">
          <Select
            size="small"
            style={{ width: 180 }}
            value={route}
            onChange={setRouteFilter}
            options={[
              { value: 'ALL', label: 'Any route' },
              { value: 'PAYROLL', label: 'With salary' },
              { value: 'FINANCE', label: 'By Finance' },
            ]}
          />
        </Filter>
      </FilterBar>

      <AdminNotice tone="info">
        Approving a claim chooses <strong>where it is paid from</strong>, and that cannot be changed once the money
        has moved. Kuwick refuses a second payment rather than relying on somebody noticing.
      </AdminNotice>

      <AdminSection padded={false}>
        <DataTable<StaffClaimRow>
          rowKey="id"
          loading={claims.isLoading}
          rows={rows}
          exportName="claims"
          searchFields={['staffName', 'description']}
          emptyText="No claims to show."
          scrollY={520}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'staffName',
              width: 210,
              render: (value: string, row) => (
                <PersonCell name={value} meta={CATEGORY_LABEL[row.category] ?? row.category} />
              ),
            },
            {
              title: 'Claim',
              dataIndex: 'description',
              render: (value: string, row) => (
                <span>
                  {value}
                  <span className="kw-cellMeta">Submitted by {row.submittedBy}</span>
                </span>
              ),
            },
            {
              title: 'Date',
              dataIndex: 'claimDate',
              width: 120,
              render: (value: string) => dayjs(value).format('D MMM YYYY'),
            },
            {
              title: 'Amount',
              dataIndex: 'amountClaimed',
              width: 130,
              align: 'right' as const,
              render: (value: string, row) => (
                <span className="kw-balanceCell">
                  <strong>{ringgit(row.amountApproved ?? value)}</strong>
                  {row.amountApproved && row.amountApproved !== value ? (
                    <span className="kw-cellMeta">of {ringgit(value)} claimed</span>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Payment route',
              width: 210,
              render: (_: unknown, row: StaffClaimRow) => <RouteChip row={row} />,
            },
            {
              title: 'Status',
              width: 140,
              render: (_: unknown, row: StaffClaimRow) =>
                row.status === 'SUBMITTED' ? (
                  <StatusChip tone="attention" dot>
                    Waiting
                  </StatusChip>
                ) : row.status === 'APPROVED' ? (
                  <StatusChip tone="ok" dot>
                    Approved
                  </StatusChip>
                ) : (
                  <StatusChip tone="neutral" dot>
                    {row.status === 'CANCELLED' ? 'Withdrawn' : 'Rejected'}
                  </StatusChip>
                ),
            },
            {
              title: '',
              width: 190,
              noExport: true,
              render: (_: unknown, row: StaffClaimRow) => (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <Button size="small" type="text" className="kw-rowAction" onClick={() => setViewing(row)}>
                    History
                  </Button>
                  {row.status === 'SUBMITTED' ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        setDeciding(row);
                        setAmount(row.amountClaimed);
                        setPayRoute('PAYROLL');
                        setReason('');
                      }}
                    >
                      Decide
                    </Button>
                  ) : null}
                  {row.status === 'APPROVED' && row.paymentRoute === 'FINANCE' && row.payoutStatus !== 'PAID' ? (
                    <Button size="small" onClick={() => recordPayment(row)}>
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
                { id: deciding.id, decision: 'APPROVED', amountApproved: amount, paymentRoute: payRoute, reason },
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
          Claimed {ringgit(deciding?.amountClaimed)} for{' '}
          {deciding ? dayjs(deciding.claimDate).format('D MMM YYYY') : ''}, submitted by {deciding?.submittedBy}.
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
          <Radio.Group value={payRoute} onChange={(event) => setPayRoute(event.target.value)}>
            <Radio value="PAYROLL">With their salary</Radio>
            <Radio value="FINANCE">Separately, by Finance</Radio>
          </Radio.Group>
          <div className="kw-muted" style={{ marginTop: 6, fontSize: 12 }}>
            {payRoute === 'PAYROLL'
              ? `Appears on the ${dayjs(deciding?.claimDate).format('MMMM YYYY')} payroll run and can never also be reimbursed by Finance.`
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

  function recordPayment(row: StaffClaimRow) {
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
  }
}

/**
 * The route, said in words rather than as an enum. "Where is this being paid
 * from" is the question a duplicate payment turns on, so it is never left to
 * the reader to work out from context.
 */
function RouteChip({ row }: { row: StaffClaimRow }) {
  if (row.status !== 'APPROVED') return <span className="kw-muted">Not decided</span>;
  if (row.paymentRoute === 'PAYROLL') {
    return row.payoutStatus === 'IN_PAYROLL' ? (
      <StatusChip tone="info" dot>
        On {dayjs(row.payrollPeriod ?? undefined).format('MMM YYYY')} payroll
      </StatusChip>
    ) : (
      <StatusChip tone="info" dot>
        With salary
      </StatusChip>
    );
  }
  return row.payoutStatus === 'PAID' ? (
    <StatusChip tone="ok" dot title={row.financeReference ?? undefined}>
      Finance · {row.financeReference}
    </StatusChip>
  ) : (
    <StatusChip tone="attention" dot>
      Finance, not yet paid
    </StatusChip>
  );
}
