import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { StatusChip, humanise } from '../components/Chip';
import { ringgit } from '../components/DataTable';

/**
 * THE MONTH, IN FIVE NUMBERS, AT THE TOP OF THE MONTH.
 *
 * The owner's verdict on the previous build was that their spreadsheet was
 * easier. A spreadsheet opens on the month's totals; this product opened on a
 * page ABOUT payroll — a hero, three explanatory cards and a table of previous
 * runs — and the month's own figures were a click further in.
 *
 * So this is the first thing on the screen, and it answers the four questions
 * in the order they are asked: how many people, what they earned, what came
 * off, what the clinic pays on top, and what actually leaves the bank.
 *
 * NET IS THE LOUD ONE. It is the figure the month is judged by, and the only
 * one rendered at display size.
 *
 * EVERY FIGURE IS THE SERVER'S. `journey.pay.totals` is summed from the payslip
 * lines by `payroll-journey.service.ts`, including `employerContributions`,
 * which was the one number a screen used to work out for itself. Nothing here
 * adds, subtracts or rounds — a total that disagrees with the register would be
 * a second payroll implementation, and this component is not allowed to be one.
 *
 * A COUNT IS NOT A ZERO. When a statutory scheme could not be worked out for
 * somebody, the deductions figure carries the count of who is missing rather
 * than quietly summing them as nil. See `statutoryNotCalculated`.
 */
export function PayrollMonthHeader({
  periodLabel,
  status,
  provisional,
  employees,
  gross,
  deductions,
  employerContributions,
  net,
  notCalculated,
  right,
}: {
  periodLabel: string;
  status: string;
  provisional: boolean;
  employees: number;
  /** Null before the month is worked out — "—", never a claim of 0.00. */
  gross: string | null;
  deductions: string | null;
  employerContributions: string | null;
  net: string | null;
  /** How many people have a statutory figure that could not be worked out. */
  notCalculated?: number;
  /** The month selector, History, and the stage's primary action. */
  right?: ReactNode;
}) {
  return (
    <header className="kw-payMonth">
      <div className="kw-payMonth__id">
        <div className="kw-payMonth__title">
          <h2 className="kw-payMonth__month">{periodLabel}</h2>
          <StatusChip tone={provisional ? 'attention' : status === 'DRAFT' ? 'info' : 'ok'} dot>
            {provisional ? `${humanise(status)} · provisional` : humanise(status)}
          </StatusChip>
        </div>
        <p className="kw-payMonth__count">
          {employees} {employees === 1 ? 'employee' : 'employees'}
        </p>
      </div>

      <div className="kw-payMonth__figures">
        <Figure label="Gross pay" value={gross} />
        <Figure
          label="Employee deductions"
          value={deductions}
          note={
            notCalculated
              ? `${notCalculated} not worked out`
              : undefined
          }
          explain={
            notCalculated
              ? 'Some statutory figures could not be worked out. They are not in this total — see Review.'
              : undefined
          }
        />
        <Figure label="Employer contributions" value={employerContributions} />
        <Figure label="Net pay" value={net} lead />
      </div>

      {right ? <div className="kw-payMonth__actions">{right}</div> : null}
    </header>
  );
}

function Figure({
  label,
  value,
  note,
  explain,
  lead,
}: {
  label: string;
  value: string | null;
  note?: string;
  explain?: string;
  lead?: boolean;
}) {
  const body = (
    <div className={`kw-payFig${lead ? ' kw-payFig--lead' : ''}`}>
      <span className="kw-payFig__label">{label}</span>
      <span className="kw-payFig__value">{ringgit(value)}</span>
      {note ? <span className="kw-payFig__note">{note}</span> : null}
    </div>
  );
  return explain ? (
    <Tooltip title={explain} placement="bottom">
      {body}
    </Tooltip>
  ) : (
    body
  );
}
