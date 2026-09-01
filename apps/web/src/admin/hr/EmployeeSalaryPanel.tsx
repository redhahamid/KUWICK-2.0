import { useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice } from '../components/AdminShell';
import { money } from '../components/DataTable';
import { useRecordSalary, useSalaryHistory } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import type { SalaryHistoryRow } from '../types';

/**
 * WHAT THIS PERSON IS PAID, AND WHAT THEY WERE PAID.
 *
 * Stage 1 made salary effective-dated — a raise closes the old row rather than
 * overwriting it, so a payroll run for March still resolves March's rate after
 * an April raise. The API, the permission and the resolution rule all shipped;
 * the screen did not, which left the whole capability reachable only by
 * somebody willing to call the endpoint by hand.
 *
 * THREE THINGS THE TABLE HAS TO SAY, because each of them is a question
 * somebody asks in a dispute:
 *
 *   - which row is IN FORCE now, rather than leaving the reader to compare
 *     dates;
 *   - what each historical row was true OF, as a closed range;
 *   - WHO recorded it and WHY. A pay change with no author is not a record.
 *
 * The server refuses two things this form deliberately does not pre-empt: a
 * second salary starting on a day that already has one, and a change dated
 * into a period whose payroll is already approved. Both refusals carry a
 * sentence explaining the consequence, and both are shown here as the server
 * sent them rather than replaced with a generic failure — a person who has
 * just been told "what they were paid is settled" needs that wording, not
 * "Bad Request".
 */
export function EmployeeSalaryPanel({ staffId, canSeePay }: { staffId: string; canSeePay: boolean }) {
  const { message } = App.useApp();
  const history = useSalaryHistory(canSeePay ? staffId : undefined);
  const record = useRecordSalary();
  const mayManage = useCan('hr.employee.manage');

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<SalaryHistoryRow['basis']>('MONTHLY');
  const [from, setFrom] = useState(dayjs().add(1, 'month').startOf('month'));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canSeePay) {
    return (
      <p className="kw-muted" style={{ margin: 0 }}>
        Salary history needs the salary permission. It is not hidden on this screen — the server does not send it to
        this account.
      </p>
    );
  }

  const rows = history.data ?? [];
  const current = rows.find((r) => r.current);

  return (
    <div>
      {/* THE ANSWER FIRST. Everything below is the working. */}
      <div className="kw-salaryNow">
        <div>
          <div className="kw-salaryNow__label">In force now</div>
          <div className="kw-salaryNow__value">
            {current ? money(Number(current.amount)) : '—'}
            {current ? <span className="kw-salaryNow__basis">{BASIS_LABEL[current.basis]}</span> : null}
          </div>
          <div className="kw-muted" style={{ fontSize: 11.5 }}>
            {current
              ? `From ${dayjs(current.effectiveFrom).format('D MMM YYYY')} · recorded by ${current.recordedBy}`
              : 'No salary is on record, so this employee cannot be paid by a payroll run.'}
          </div>
        </div>
        {mayManage ? (
          <Button
            size="small"
            onClick={() => {
              setAmount(current?.amount ?? '');
              setBasis(current?.basis ?? 'MONTHLY');
              setFrom(dayjs().add(1, 'month').startOf('month'));
              setReason('');
              setError(null);
              setOpen(true);
            }}
          >
            Record a change
          </Button>
        ) : null}
      </div>

      <Table<SalaryHistoryRow>
        rowKey="id"
        size="small"
        pagination={false}
        loading={history.isLoading}
        dataSource={rows}
        locale={{ emptyText: 'No salary has ever been recorded for this employee.' }}
        rowClassName={(row) => (row.current ? 'kw-salaryRow--current' : '')}
        columns={[
          {
            title: 'In force',
            key: 'range',
            render: (_: unknown, row) => (
              <span>
                {dayjs(row.effectiveFrom).format('D MMM YYYY')}
                {' → '}
                {/* An open end is a fact, not a missing value. */}
                {row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : <em className="kw-muted">present</em>}
              </span>
            ),
          },
          {
            title: 'Amount',
            dataIndex: 'amount',
            align: 'right',
            width: 130,
            render: (v: string, row) => (
              <span className={row.current ? 'kw-salaryAmount--current' : undefined}>{money(Number(v))}</span>
            ),
          },
          { title: 'Basis', dataIndex: 'basis', width: 110, render: (b: SalaryHistoryRow['basis']) => BASIS_LABEL[b] },
          {
            title: 'Why, and who recorded it',
            key: 'provenance',
            render: (_: unknown, row) => (
              <div>
                <div>{row.reason ?? <span className="kw-muted">No reason given</span>}</div>
                <div className="kw-muted" style={{ fontSize: 11.5 }}>
                  {row.recordedBy} · {dayjs(row.recordedAt).format('D MMM YYYY')}
                  {row.note ? ` · ${row.note}` : ''}
                </div>
              </div>
            ),
          },
        ]}
      />

      <p className="kw-muted" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
        A raise closes the previous row rather than replacing it, so a payroll run for an earlier month still resolves
        the rate that was in force then.
      </p>

      <Modal
        open={open}
        title="Record a salary change"
        okText="Record"
        confirmLoading={record.isPending}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onOk={async () => {
          setError(null);
          // A STRING, MATCHING THE SERVER'S SHAPE. `RecordSalaryDto.amount` is
          // a string checked against /^\d{1,10}(\.\d{1,2})?$/, so sending
          // `Number(amount)` made every save fail validation — the form could
          // never once succeed. Checked here as well so an obviously wrong
          // entry is answered without a round trip.
          const cleaned = amount.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
          if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned)) {
            setError('Enter the amount as a number, with at most two decimal places.');
            return;
          }
          try {
            await record.mutateAsync({
              staffId,
              amount: cleaned,
              basis,
              effectiveFrom: from.format('YYYY-MM-DD'),
              reason: reason.trim() || undefined,
            });
            message.success('Recorded.');
            setOpen(false);
          } catch (e) {
            // The server's own sentence. Its refusals explain a consequence —
            // "what they were paid is settled" — and a generic message would
            // throw that away.
            setError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
          }
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label>
            <div className="kw-fieldLabel">New amount</div>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} prefix="RM" inputMode="decimal" />
          </label>
          <label>
            <div className="kw-fieldLabel">Basis</div>
            <Select
              value={basis}
              onChange={setBasis}
              style={{ width: '100%' }}
              options={[
                { value: 'MONTHLY', label: 'Monthly salary' },
                { value: 'DAILY', label: 'Daily rate' },
                { value: 'HOURLY', label: 'Hourly rate' },
              ]}
            />
          </label>
          <label>
            <div className="kw-fieldLabel">In force from</div>
            <DatePicker
              value={from}
              onChange={(v) => v && setFrom(v)}
              style={{ width: '100%' }}
              allowClear={false}
              format="D MMM YYYY"
            />
          </label>
          <label>
            <div className="kw-fieldLabel">Reason</div>
            <Input.TextArea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Annual review, promotion, correction…"
            />
          </label>
          <p className="kw-muted" style={{ margin: 0, fontSize: 11.5 }}>
            The row currently in force is closed the day before this date. Nothing already approved is changed.
          </p>
        </div>
      </Modal>
    </div>
  );
}

const BASIS_LABEL: Record<SalaryHistoryRow['basis'], string> = {
  MONTHLY: 'Monthly',
  DAILY: 'Daily',
  HOURLY: 'Hourly',
};
