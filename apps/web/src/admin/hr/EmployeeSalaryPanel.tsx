import { useState } from 'react';
import { App, DatePicker, Input, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { money } from '../components/DataTable';
import { useRecordSalary, useSalaryHistory } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { PanelHead, StatusChip } from './ui';
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
 * NO EDIT ON A ROW. The mockup draws Edit beside the upcoming row; the API
 * has no way to amend or withdraw a recorded salary — a wrong figure is
 * corrected by recording the right one from the same or a later date, which
 * the form does. Reported, not improvised.
 */
export function EmployeeSalaryPanel({ staffId, canSeePay }: { staffId: string; canSeePay: boolean }) {
  const { message } = App.useApp();
  const history = useSalaryHistory(canSeePay ? staffId : undefined);
  const record = useRecordSalary();
  const mayManage = useCan('hr.employee.manage');

  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<SalaryHistoryRow['basis']>('MONTHLY');
  const [from, setFrom] = useState(dayjs().add(1, 'month').startOf('month'));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const all = history.data ?? [];
  const current = all.find((row) => row.current);
  const closed = all.filter((row) => !row.current && dayjs(row.effectiveFrom).isBefore(dayjs()));
  const rows = showHistory ? all : all.filter((row) => row.current || dayjs(row.effectiveFrom).isAfter(dayjs()));
  const usedLine = current
    ? `Every change is dated. ${dayjs().format('MMMM')} payroll uses the row in force on 1 ${dayjs().format('MMM')}.`
    : 'Every change is dated. No salary is on record, so a payroll run cannot pay this employee yet.';

  return (
    <>
      <PanelHead
        title="Salary"
        sub={canSeePay ? usedLine : 'Salary needs the salary permission. The server does not send it to this account.'}
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
              render: (value: string, row) => {
                const upcoming = dayjs(value).isAfter(dayjs());
                return (
                  <span>
                    <span className={row.current || upcoming ? 'hr-strong' : undefined}>{dayjs(value).format('D MMM YYYY')}</span>{' '}
                    {row.current ? <StatusChip tone="done">Current</StatusChip> : upcoming ? <StatusChip tone="info">Upcoming</StatusChip> : null}
                  </span>
                );
              },
            },
            {
              title: `${BASIS_HEAD.MONTHLY} (RM)`,
              dataIndex: 'amount',
              num: true,
              width: 140,
              render: (value: string, row) => (
                <span className={row.current || dayjs(row.effectiveFrom).isAfter(dayjs()) ? 'hr-strong' : undefined}>
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
          ]}
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
            setError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
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
            <Input.TextArea id="salary-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Annual increment, promotion, correction…" />
            <div className="hr-form__help">The row currently in force is closed the day before this date. Nothing already approved is changed.</div>
          </div>
        </div>
      </Modal>
    </>
  );
}

const BASIS_LABEL: Record<SalaryHistoryRow['basis'], string> = { MONTHLY: 'per month', DAILY: 'per day', HOURLY: 'per hour' };
const BASIS_HEAD = { MONTHLY: 'Basic' } as const;
