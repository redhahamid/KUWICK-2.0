import { useState } from 'react';
import { App, InputNumber, Select } from 'antd';
import { useSetPayDate } from '../hooks/useAdmin';
import type { PayComponentRow } from '../types';

/** "1st", "2nd", "3rd", "11th", "21st", "30th". */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/** "30th", "1st, next month", "15th, next month" — short enough for a column. */
export function payDateLabel(rule: { payDay: number; payMonthOffset: number }): string {
  return `${ordinal(rule.payDay)}${rule.payMonthOffset === 1 ? ', next month' : ''}`;
}

/** The dates a clinic most often pays on, one press each. */
const QUICK = [
  { payDay: 30, payMonthOffset: 0 },
  { payDay: 1, payMonthOffset: 1 },
  { payDay: 15, payMonthOffset: 1 },
];

/**
 * WHEN AN ITEM IS PAID (UAT, 10 October 2026: one payroll month is paid on
 * three dates). A day of the month and which month, with the three dates a
 * clinic commonly uses one press away and any other day available.
 *
 * Payment, not treatment: it saves at once, with no date and no reason, and
 * an approved month keeps the dates it was approved with. A deduction comes
 * out of the salary payment, so it has no date of its own.
 */
export function PayDateCell({ row, disabled }: { row: PayComponentRow; disabled: boolean }) {
  const { message } = App.useApp();
  const setPayDate = useSetPayDate();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(row.payDay);
  const [offset, setOffset] = useState(row.payMonthOffset);
  const [problem, setProblem] = useState<string | null>(null);

  if (row.type === 'DEDUCTION') {
    return <span className="hr-faint hr-small">From the salary payment</span>;
  }

  const save = (payDay: number, payMonthOffset: number) => {
    setProblem(null);
    setPayDate.mutate(
      { code: row.code, payDay, payMonthOffset },
      {
        onSuccess: () => {
          message.success(`${row.name} is paid on the ${payDateLabel({ payDay, payMonthOffset })}.`);
          setOpen(false);
        },
        onError: (error: Error) => setProblem(error.message),
      },
    );
  };

  return (
    <span className="hr-anchor">
      <button
        type="button"
        className="hr-historyLink"
        disabled={disabled}
        aria-label={`When ${row.name} is paid: ${payDateLabel(row)}`}
        onClick={() => {
          setDay(row.payDay);
          setOffset(row.payMonthOffset);
          setProblem(null);
          setOpen(true);
        }}
      >
        {payDateLabel(row)}
      </button>
      {open ? (
        <div className="hr-popover" role="dialog" aria-label={`When ${row.name} is paid`}>
          <div className="hr-popover__title">When {row.name} is paid</div>
          <div className="hr-popover__hint">
            Each date gets its own payment listing. The payslip and the statutory figures stay on the whole month. A day the
            month does not have is paid on its last day.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {QUICK.map((rule) => (
              <button
                key={payDateLabel(rule)}
                type="button"
                className="hr-btn hr-btn--sm"
                disabled={setPayDate.isPending}
                onClick={() => save(rule.payDay, rule.payMonthOffset)}
              >
                {payDateLabel(rule)}
              </button>
            ))}
          </div>
          <label htmlFor={`payday-${row.id}`}>Or another day</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <InputNumber
              id={`payday-${row.id}`}
              aria-label="Day of the month"
              min={1}
              max={31}
              precision={0}
              value={day}
              onChange={(value) => setDay(typeof value === 'number' ? value : day)}
              style={{ width: 80 }}
            />
            <Select
              aria-label="Which month"
              value={offset}
              onChange={(value) => setOffset(value)}
              options={[
                { value: 0, label: 'of the payroll month' },
                { value: 1, label: 'of the next month' },
              ]}
              style={{ flex: 1 }}
            />
          </div>
          {problem ? <div className="hr-small" style={{ color: 'var(--hr-red)', marginTop: 6 }}>{problem}</div> : null}
          <div className="hr-popover__actions">
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="hr-btn hr-btn--sm hr-btn--primary"
              disabled={setPayDate.isPending}
              onClick={() => save(day, offset)}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
