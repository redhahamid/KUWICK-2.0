import { useState } from 'react';
import { App, InputNumber, Switch } from 'antd';
import { useSetPayDate } from '../hooks/useAdmin';
import type { PayComponentRow } from '../types';

/** "1st", "2nd", "3rd", "11th", "21st", "30th". */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/** "30th", "15th · a month in arrears" — short enough for a column. */
export function payDateLabel(rule: { payDay: number; paidInArrears: boolean }): string {
  return `${ordinal(rule.payDay)}${rule.paidInArrears ? ' · a month in arrears' : ''}`;
}

/** The days a clinic most often pays on, one press each. */
const QUICK = [30, 15, 1];

/**
 * WHEN AN ITEM IS PAID (UAT, 10 October 2026).
 *
 * The day is the item's DEFAULT pay date within the run's own month: the
 * owner can still move a date for one run on its Pay step, before that
 * date's listing is prepared. "A month in arrears" means the run pays what
 * was earned the month before: September's overtime in the October run,
 * counted in October's statutory figures and labelled as September's.
 *
 * Payment, not treatment: it saves at once, with no date and no reason, and
 * an approved month keeps what it was approved with. A deduction comes out of
 * the salary payment, so it has no date of its own; basic pay is the month's
 * own salary, so it is never in arrears.
 */
export function PayDateCell({ row, disabled }: { row: PayComponentRow; disabled: boolean }) {
  const { message } = App.useApp();
  const setPayDate = useSetPayDate();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(row.payDay);
  const [arrears, setArrears] = useState(row.paidInArrears);
  const [problem, setProblem] = useState<string | null>(null);

  if (row.type === 'DEDUCTION') {
    return <span className="hr-faint hr-small">From the salary payment</span>;
  }
  const mayBeInArrears = row.code !== 'BASIC';

  const save = (payDay: number, paidInArrears: boolean) => {
    setProblem(null);
    setPayDate.mutate(
      { code: row.code, payDay, paidInArrears },
      {
        onSuccess: () => {
          message.success(`${row.name}: paid on the ${payDateLabel({ payDay, paidInArrears })}.`);
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
          setArrears(row.paidInArrears);
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
            The day of the run&apos;s month it is paid on, unless the owner moves that date for one run on its Pay step. Each
            date gets its own payment listing. A day the month does not have is paid on its last day.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {QUICK.map((quick) => (
              <button
                key={quick}
                type="button"
                className="hr-btn hr-btn--sm"
                disabled={setPayDate.isPending}
                onClick={() => save(quick, mayBeInArrears ? arrears : false)}
              >
                {ordinal(quick)}
              </button>
            ))}
          </div>
          <label htmlFor={`payday-${row.id}`}>Or another day</label>
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
          {mayBeInArrears ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Switch size="small" checked={arrears} onChange={setArrears} aria-label="A month in arrears" />
                <span>A month in arrears</span>
              </div>
              <div className="hr-popover__hint" style={{ marginTop: 4 }}>
                The run pays what was earned the month before: September&apos;s in the October run, counted in October&apos;s
                statutory figures and labelled as September&apos;s.
              </div>
            </div>
          ) : null}
          {problem ? <div className="hr-small" style={{ color: 'var(--hr-red)', marginTop: 6 }}>{problem}</div> : null}
          <div className="hr-popover__actions">
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="hr-btn hr-btn--sm hr-btn--primary"
              disabled={setPayDate.isPending}
              onClick={() => save(day, mayBeInArrears ? arrears : false)}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
