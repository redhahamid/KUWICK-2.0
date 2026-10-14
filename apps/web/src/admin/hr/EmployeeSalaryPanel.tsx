import { useState } from 'react';
import { App, DatePicker, Input, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { money } from '../components/DataTable';
import { useCorrectSalary, useDeleteSalary, useRecordSalary, useSalaryHistory } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { PanelHead, StatusChip } from './ui';
import { ReasonPicker } from './ui/ReasonPicker';
import { SALARY_REASONS } from './ui/reasons';
import { Table } from './ui/Table';
import { IconEdit, IconHistory } from './ui/icons';
import type { SalaryHistoryRow } from '../types';

/**
 * SALARY — every change dated, as the mockup's table: in force from, the
 * figure, the reason, who changed it and when. The row in force is marked
 * Current; a change already recorded for a later date is Upcoming; closed
 * rows are history, folded away until asked for.
 *
 * A raise closes the old row rather than overwriting it, so a payroll run
 * for March still resolves March's rate after an April raise. The server
 * refuses two things this form does not pre-empt: a second salary starting
 * on a day that already has one, and a change dated into a month whose
 * payroll is approved. Both refusals are shown in the server's own words.
 *
 * CORRECT AND DELETE ON EACH ROW (UAT, 14 October 2026): "Correct" fixes a
 * keying error in a row's amount or basis, its dates unchanged; "Delete"
 * removes a row added by mistake, and the row before it runs on. Both need a
 * reason and are logged with the old and new values. The server refuses
 * either while an approved month this employee was paid from that row falls
 * inside it, naming the month; that refusal is shown as it is.
 */
export function EmployeeSalaryPanel({ staffId, canSeePay }: { staffId: string; canSeePay: boolean }) {
  const { message } = App.useApp();
  const history = useSalaryHistory(canSeePay ? staffId : undefined);
  const record = useRecordSalary();
  const mayManage = useCan('hr.employee.manage');
  const mayPay = useCan('hr.payroll.view');
  const correct = useCorrectSalary();
  const remove = useDeleteSalary();
  const [fixing, setFixing] = useState<{ row: SalaryHistoryRow; mode: 'correct' | 'delete' } | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<SalaryHistoryRow['basis']>('MONTHLY');
  const [from, setFrom] = useState(dayjs().add(1, 'month').startOf('month'));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const all = history.data ?? [];
  // In force today: started, and not ended before today. With a later change
  // already recorded, that is not the open row (UAT, 14 October 2026).
  const inForce = (row: SalaryHistoryRow) =>
    !dayjs(row.effectiveFrom).isAfter(dayjs(), 'day') && (!row.effectiveTo || !dayjs(row.effectiveTo).isBefore(dayjs(), 'day'));
  const upcoming = (row: SalaryHistoryRow) => dayjs(row.effectiveFrom).isAfter(dayjs(), 'day');
  const current = all.find(inForce) ?? all.find((row) => row.current);
  const closed = all.filter((row) => !inForce(row) && !upcoming(row));
  const rows = showHistory ? all : all.filter((row) => inForce(row) || upcoming(row));
  const usedLine = current
    ? `Every change is dated. ${dayjs().format('MMMM')} payroll uses the row in force on 1 ${dayjs().format('MMM')}.`
    : 'Every change is dated. No salary is on record, so payroll cannot pay this employee yet.';

  return (
    <>
      <PanelHead
        title="Salary"
        sub={canSeePay ? usedLine : 'Salary needs the salary permission, which this account does not have.'}
        actions={
          canSeePay ? (
            <>
              {closed.length > 0 ? (
                <button type="button" className="hr-btn hr-btn--sm" onClick={() => setShowHistory((value) => !value)}>
                  <IconHistory />
                  {showHistory ? 'Hide history' : 'History'}
                </button>
              ) : null}
              {mayManage ? (
                <button
                  type="button"
                  className="hr-btn hr-btn--sm hr-btn--primary"
                  onClick={() => {
                    setAmount(current?.amount ?? '');
                    setBasis(current?.basis ?? 'MONTHLY');
                    setFrom(dayjs().add(1, 'month').startOf('month'));
                    setReason('');
                    setError(null);
                    setOpen(true);
                  }}
                >
                  <IconEdit />
                  Change salary
                </button>
              ) : null}
            </>
          ) : null
        }
      />
      {canSeePay ? (
        <Table<SalaryHistoryRow>
          rowKey="id"
          loading={history.isLoading}
          rows={rows}
          emptyText="No salary has been recorded for this employee."
          emptyHint="Record one, dated from the day it applies, and payroll can pay them."
          columns={[
            {
              title: 'In force from',
              dataIndex: 'effectiveFrom',
              width: 220,
              render: (value: string, row) => (
                <span>
                  <span className={inForce(row) || upcoming(row) ? 'hr-strong' : undefined}>{dayjs(value).format('D MMM YYYY')}</span>{' '}
                  {inForce(row) ? <StatusChip tone="done">Current</StatusChip> : upcoming(row) ? <StatusChip tone="info">Upcoming</StatusChip> : null}
                </span>
              ),
            },
            {
              title: `${BASIS_HEAD.MONTHLY} (RM)`,
              dataIndex: 'amount',
              num: true,
              width: 140,
              render: (value: string, row) => (
                <span className={inForce(row) || upcoming(row) ? 'hr-strong' : undefined}>
                  {money(Number(value)).replace(/^RM\s?/, '')}
                  {row.basis !== 'MONTHLY' ? <span className="hr-faint hr-small"> {BASIS_LABEL[row.basis]}</span> : null}
                </span>
              ),
            },
            { title: 'Reason', dataIndex: 'reason', render: (value: string | null) => value ?? <span className="hr-faint">No reason given</span> },
            {
              title: 'Changed by',
              key: 'by',
              width: 300,
              render: (_: unknown, row) => (
                <span>
                  {row.recordedBy} · {dayjs(row.recordedAt).format('D MMM YYYY')}
                  {row.note ? <span className="hr-faint hr-small"> · {row.note}</span> : null}
                </span>
              ),
            },
            ...(mayManage && mayPay
              ? [
                  {
                    title: '',
                    key: 'fix',
                    width: 170,
                    render: (_: unknown, row: SalaryHistoryRow) => (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" onClick={() => setFixing({ row, mode: 'correct' })}>
                          Correct
                        </button>
                        <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" onClick={() => setFixing({ row, mode: 'delete' })}>
                          Delete
                        </button>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {fixing ? (
        <FixSalaryRow
          key={`${fixing.row.id}-${fixing.mode}`}
          row={fixing.row}
          mode={fixing.mode}
          previous={all.find((other) => dayjs(other.effectiveFrom).isBefore(dayjs(fixing.row.effectiveFrom))) ?? null}
          pending={correct.isPending || remove.isPending}
          onCancel={() => setFixing(null)}
          onSubmit={async (body) => {
            if (fixing.mode === 'correct') await correct.mutateAsync({ staffId, id: fixing.row.id, ...body });
            else await remove.mutateAsync({ staffId, id: fixing.row.id, reason: body.reason });
            message.success(fixing.mode === 'correct' ? 'Corrected.' : 'Deleted.');
            setFixing(null);
          }}
        />
      ) : null}

      <Modal
        open={open}
        title="Change salary"
        okText="Record"
        confirmLoading={record.isPending}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onOk={async () => {
          setError(null);
          // A STRING, MATCHING THE SERVER'S SHAPE: the DTO checks /^\d{1,10}(\.\d{1,2})?$/.
          const cleaned = amount.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
          if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
            setError('Enter the amount as a number, with at most two decimal places.');
            return;
          }
          try {
            await record.mutateAsync({ staffId, amount: cleaned, basis, effectiveFrom: from.format('YYYY-MM-DD'), reason: reason.trim() || undefined });
            message.success('Recorded.');
            setOpen(false);
          } catch (e) {
            // The server's own sentence — "what they were paid is settled" — beats a generic one.
            setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
          }
        }}
      >
        {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
        <div className="hr-form" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="salary-amount">New amount</label>
            <Input id="salary-amount" value={amount} onChange={(e) => setAmount(e.target.value)} prefix="RM" inputMode="decimal" />
          </div>
          <div className="hr-form__row">
            <div>
              <label htmlFor="salary-basis">Basis</label>
              <Select
                id="salary-basis"
                value={basis}
                onChange={setBasis}
                style={{ width: '100%' }}
                options={[
                  { value: 'MONTHLY', label: 'Monthly salary' },
                  { value: 'DAILY', label: 'Daily rate' },
                  { value: 'HOURLY', label: 'Hourly rate' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="salary-from">In force from</label>
              <DatePicker id="salary-from" value={from} onChange={(v) => v && setFrom(v)} style={{ width: '100%' }} allowClear={false} format="D MMM YYYY" />
            </div>
          </div>
          <div>
            <label htmlFor="salary-reason">Reason</label>
            <ReasonPicker id="salary-reason" value={reason} onChange={setReason} options={SALARY_REASONS} placeholder="Annual increment, promotion, correction…" />
            <div className="hr-form__help">The row currently in force is closed the day before this date. Nothing already approved is changed.</div>
          </div>
        </div>
      </Modal>
    </>
  );
}

const BASIS_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly salary' },
  { value: 'DAILY', label: 'Daily rate' },
  { value: 'HOURLY', label: 'Hourly rate' },
];

/**
 * "Correct" or "Delete" one salary row. History is newest first, so the row
 * before this one is the first older row; on delete it runs on over this
 * row's dates.
 */
function FixSalaryRow({
  row,
  mode,
  previous,
  pending,
  onCancel,
  onSubmit,
}: {
  row: SalaryHistoryRow;
  mode: 'correct' | 'delete';
  previous: SalaryHistoryRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (body: { amount: string; basis: string; reason: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(row.amount);
  const [basis, setBasis] = useState<SalaryHistoryRow['basis']>(row.basis);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const from = dayjs(row.effectiveFrom).format('D MMM YYYY');
  const until = row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : null;
  const figure = `${money(Number(row.amount))} ${BASIS_LABEL[row.basis]}`;

  return (
    <Modal
      open
      title={mode === 'correct' ? `Correct the salary from ${from}` : `Delete the salary from ${from}`}
      okText={mode === 'correct' ? 'Correct' : 'Delete'}
      okButtonProps={mode === 'delete' ? { danger: true } : undefined}
      confirmLoading={pending}
      onCancel={onCancel}
      onOk={async () => {
        setError(null);
        if (!reason.trim()) {
          setError('Say why: the reason is kept with the change.');
          return;
        }
        const cleaned = amount.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
        if (mode === 'correct' && !/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
          setError('Enter the amount as a number, with at most two decimal places.');
          return;
        }
        try {
          await onSubmit({ amount: cleaned, basis, reason: reason.trim() });
        } catch (e) {
          // The server names the approved month that stands in the way.
          setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
        }
      }}
    >
      {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
      <div className="hr-form" style={{ marginTop: 12 }}>
        {mode === 'correct' ? (
          <>
            <div className="hr-form__help">
              Now {figure}, from {from}
              {until ? ` to ${until}` : ''}. The dates stay; every month this row covers is paid the corrected figure.
            </div>
            <div className="hr-form__row">
              <div>
                <label htmlFor="salary-fix-amount">Correct amount</label>
                <Input id="salary-fix-amount" value={amount} onChange={(e) => setAmount(e.target.value)} prefix="RM" inputMode="decimal" />
              </div>
              <div>
                <label htmlFor="salary-fix-basis">Basis</label>
                <Select id="salary-fix-basis" value={basis} onChange={setBasis} style={{ width: '100%' }} options={BASIS_OPTIONS} />
              </div>
            </div>
          </>
        ) : (
          <div className="hr-form__help">
            {figure}, from {from}
            {until ? ` to ${until}` : ''}, is removed.{' '}
            {previous
              ? `${money(Number(previous.amount))} ${BASIS_LABEL[previous.basis]}, from ${dayjs(previous.effectiveFrom).format('D MMM YYYY')}, then runs on ${until ? `to ${until}` : 'with no end date'}.`
              : 'No salary is on record before it, so these dates will have none.'}
          </div>
        )}
        <div>
          <label htmlFor="salary-fix-reason">Why</label>
          <Input.TextArea id="salary-fix-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Keying error, added by mistake…" />
        </div>
      </div>
    </Modal>
  );
}

const BASIS_LABEL: Record<SalaryHistoryRow['basis'], string> = { MONTHLY: 'per month', DAILY: 'per day', HOURLY: 'per hour' };
const BASIS_HEAD = { MONTHLY: 'Basic' } as const;
