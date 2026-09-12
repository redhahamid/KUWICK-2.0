import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Grid } from 'antd';
import { ringgit } from '../components/DataTable';
import { StatusChip } from './ui';
import { IconEdit } from './ui/icons';
import { initialsOf } from './ui/who';
import type { PayrollJourney } from '../types';

type PayRow = PayrollJourney['pay']['rows'][number];

/**
 * THE PAYROLL GRID — payroll.html.
 *
 * One row per person, money across. Three kinds of cell, and the legend
 * above the grid names them: GREY comes from records or is worked out (basic,
 * claims, gross, every statutory figure, net); WHITE you can edit (other
 * income, other deductions); a row being edited turns green. Hours of
 * overtime and days of unpaid leave are grey too — the design drew them
 * white, and §6 of the restructure says overtime reaches payroll only once it
 * is approved in Attendance and that nobody works it out by hand, so they
 * come from the records with a link to where they are corrected. Accepted as
 * a divergence from the mockup.
 *
 * NOT ONE FIGURE IS COMPUTED HERE. Every cell is a string the server formatted
 * from the payslip line — including "other income" and "claims", which the
 * journey service sums so the grid cannot disagree with the payslip by a sen.
 * What the grid does compute is the one thing only it can: what a typed
 * figure MEANS, in `planGridEdit` below.
 *
 * ONE DEFINITION. The columns are a list; the header, the rows, the legend
 * and the CSV export all read it, so a column cannot exist in one and not
 * another.
 *
 * A BLANK IS NOT A ZERO. A statutory figure the engine could not work out is
 * null and renders "—"; 0.00 would tell a clinic it owes nothing, which is
 * the one wrong answer that gets acted on.
 *
 * STATUTORY IS NEVER TYPED HERE. EPF and PCB can be overridden only on the
 * person's own payroll page, with a reason that is logged with a name.
 */

export type CellKind = 'record' | 'editable' | 'auto';
type Band = 'earnings' | 'deductions' | 'net';

export interface GridColumn {
  key: string;
  title: string;
  band: Band;
  kind: CellKind;
  /** The row field rendered; money fields are server-formatted strings. */
  field: keyof PayRow;
  /** The totals key the column foots on — for the stat cards and the export. */
  total: keyof PayrollJourney['pay']['totals'];
  money: boolean;
  strong?: boolean;
  net?: boolean;
  /** Where the figure is corrected when it is not editable here. */
  fixTo?: (row: PayRow) => string;
}

export const GRID_COLUMNS: GridColumn[] = [
  { key: 'basic', title: 'Basic', band: 'earnings', kind: 'record', field: 'basicSalary', total: 'basic', money: true },
  { key: 'otherIncome', title: 'Other income', band: 'earnings', kind: 'editable', field: 'otherIncome', total: 'otherIncome', money: true },
  {
    key: 'overtimeHours',
    title: 'OT h',
    band: 'earnings',
    kind: 'record',
    field: 'overtimeHours',
    total: 'overtimeHours',
    money: false,
    fixTo: (row) => `/admin/hr/attendance?staffId=${row.staffId}`,
  },
  {
    key: 'unpaidDays',
    title: 'Unpaid d',
    band: 'earnings',
    kind: 'record',
    field: 'unpaidDays',
    total: 'unpaidDays',
    money: false,
    fixTo: (row) => `/admin/hr/leave?staffId=${row.staffId}`,
  },
  { key: 'claims', title: 'Claims', band: 'earnings', kind: 'auto', field: 'claims', total: 'claims', money: true },
  { key: 'gross', title: 'Gross', band: 'earnings', kind: 'auto', field: 'grossPay', total: 'gross', money: true, strong: true },
  { key: 'epf', title: 'EPF', band: 'deductions', kind: 'auto', field: 'epfEmployee', total: 'epfEmployee', money: true },
  { key: 'socso', title: 'SOCSO', band: 'deductions', kind: 'auto', field: 'socsoEmployee', total: 'socsoEmployee', money: true },
  { key: 'eis', title: 'EIS', band: 'deductions', kind: 'auto', field: 'eisEmployee', total: 'eisEmployee', money: true },
  { key: 'pcb', title: 'PCB', band: 'deductions', kind: 'auto', field: 'pcb', total: 'pcb', money: true },
  { key: 'otherDeductions', title: 'Other', band: 'deductions', kind: 'editable', field: 'otherDeductions', total: 'otherDeductions', money: true },
  { key: 'net', title: 'Net pay', band: 'net', kind: 'auto', field: 'netPay', total: 'net', money: true, strong: true, net: true },
];

/** "4,200.00" — the server's figure, grouped, without the currency the column header implies. */
export const grouped = (value: string | null | undefined): string | null =>
  value === null || value === undefined ? null : ringgit(value).replace('RM', '');

const hours = (value: number) => value.toFixed(1);
const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** What the white cells of one row hold while it is being edited. */
export interface GridEdit {
  staffId: string;
  otherIncome: string;
  otherDeduction: string;
}

export interface GridChange {
  componentCode: 'ALLOWANCE' | 'OTHER_DEDUCTION';
  /** Null means the hand-keyed input is removed. */
  amount: string | null;
  existingId: string | null;
  label: string;
}

export const GRID_INCOME_LABEL = 'Other income (payroll grid)';
export const GRID_DEDUCTION_LABEL = 'Other deduction (payroll grid)';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const toCents = (value: string) => Math.round(Number(value) * 100);
const fromCents = (cents: number) => (cents / 100).toFixed(2);
const clean = (value: string) => value.trim().replace(/^RM\s*/i, '').replace(/,/g, '');

/**
 * WHAT A TYPED FIGURE MEANS.
 *
 * "Other income" on the row is a SUM: recurring items, incentives, a bonus
 * somebody added on the person's page — and, if there is one, a figure typed
 * into this cell before. Only the typed part is this cell's to change. So the
 * fixed part is what the row shows less the hand-keyed input behind it, and
 * the new hand-keyed input is what was typed less that. Below the fixed part
 * there is nothing to write: those items are corrected where they were
 * recorded, and the cell says so instead of writing a negative allowance.
 *
 * The hand-keyed income is the ALLOWANCE component and the hand-keyed
 * deduction is OTHER_DEDUCTION — one each per person per month, which is the
 * server's own rule for typed inputs. Anything that needs its own treatment
 * (a bonus, a commission, zakat) is added as its own item on the person's page.
 */
export function planGridEdit(row: PayRow, edit: GridEdit): { changes: GridChange[]; problem: string | null } {
  const changes: GridChange[] = [];
  const one = (
    typed: string,
    shown: string,
    componentCode: GridChange['componentCode'],
    fallbackLabel: string,
    what: string,
  ): string | null => {
    const value = clean(typed);
    if (!MONEY.test(value)) return `Enter ${what} as a number with at most two decimal places.`;
    const manual = row.items.find((item) => item.source === 'MANUAL' && item.componentCode === componentCode) ?? null;
    const manualCents = manual ? toCents(manual.amount) : 0;
    const fixedCents = toCents(shown) - manualCents;
    const wantCents = toCents(value) - fixedCents;
    if (wantCents < 0) {
      return (
        `${what[0].toUpperCase()}${what.slice(1)} cannot go below ${ringgit(fromCents(fixedCents))}: that part comes from ` +
        'records and recurring items, and is changed where it was recorded.'
      );
    }
    if (wantCents === manualCents) return null;
    changes.push({
      componentCode,
      amount: wantCents === 0 ? null : fromCents(wantCents),
      existingId: manual?.id ?? null,
      label: manual?.label ?? fallbackLabel,
    });
    return null;
  };
  const problem =
    one(edit.otherIncome, row.otherIncome, 'ALLOWANCE', GRID_INCOME_LABEL, 'other income') ??
    one(edit.otherDeduction, row.otherDeductions, 'OTHER_DEDUCTION', GRID_DEDUCTION_LABEL, 'the other deduction');
  return { changes: problem ? [] : changes, problem };
}

/** Somebody the run left out — no line, so no figures, but still a row with a reason and a Fix. */
export interface LeftOutRow {
  staffId: string;
  name: string;
  position: string | null;
  reason: string | null;
}

export function PayrollGrid({
  rows,
  leftOut = [],
  runId,
  canEdit,
  edit,
  onStartEdit,
  onEditChange,
  onSave,
  onCancel,
  saving,
}: {
  rows: PayRow[];
  leftOut?: LeftOutRow[];
  runId: string;
  canEdit: boolean;
  edit: GridEdit | null;
  onStartEdit: (row: PayRow) => void;
  onEditChange: (patch: Partial<GridEdit>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const screens = Grid.useBreakpoint();
  const employeeLink = (staffId: string) => `/admin/hr/payroll/${runId}/employees/${staffId}`;

  /*
   * PHONES GET CARDS, NOT A SQUEEZED SPREADSHEET. Fourteen columns inside
   * 390px can only be done by shrinking the type until nobody can read it.
   */
  if (!screens.md) {
    return <PayrollCards rows={rows} leftOut={leftOut} link={employeeLink} />;
  }

  const earnings = GRID_COLUMNS.filter((column) => column.band === 'earnings');
  const deductions = GRID_COLUMNS.filter((column) => column.band === 'deductions');

  return (
    <div className="kw-payrollGrid hr-scrollX">
      <table className="hr-grid">
        <thead>
          <tr className="hr-grid__grp">
            <th />
            <th />
            <th className="is-record">Record</th>
            <th colSpan={earnings.length - 1}>Earnings</th>
            <th colSpan={deductions.length}>Deductions</th>
            <th />
            <th />
          </tr>
          <tr>
            <th>Employee</th>
            <th>Status</th>
            {GRID_COLUMNS.map((column) => (
              <th key={column.key} className={`hr-num${column.kind === 'record' && column.key === 'basic' ? ' is-record' : ''}`}>
                {column.title}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const editing = edit?.staffId === row.staffId;
            return (
              <tr key={row.staffId} className={editing ? 'is-editing' : undefined}>
                <td>
                  <Link className="hr-who" to={employeeLink(row.staffId)}>
                    <span className="hr-who__avatar">{initialsOf(row.name)}</span>
                    <span>
                      <span className="hr-who__name">{row.name}</span>
                      <span className="hr-who__role">{row.position ?? 'No position recorded'}</span>
                    </span>
                  </Link>
                </td>
                <td>{editing ? <StatusChip tone="info">Editing</StatusChip> : <RowStatus row={row} />}</td>
                {GRID_COLUMNS.map((column) => (
                  <Cell key={column.key} column={column} row={row} editing={editing} edit={edit} onEditChange={onEditChange} />
                ))}
                <td>
                  {editing ? (
                    <>
                      <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" disabled={saving} onClick={onSave}>
                        Save
                      </button>{' '}
                      <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" disabled={saving} onClick={onCancel}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {canEdit ? (
                        <button type="button" className="hr-btn hr-btn--sm" disabled={edit !== null} onClick={() => onStartEdit(row)}>
                          <IconEdit />
                          Edit
                        </button>
                      ) : null}
                      {row.blockers > 0 && row.fixLink ? (
                        <Link className="hr-fixLink" to={row.fixLink}>
                          Fix
                        </Link>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {leftOut.map((row) => (
            <tr key={row.staffId}>
              <td>
                <Link className="hr-who" to={`/admin/hr/employees/${row.staffId}`}>
                  <span className="hr-who__avatar">{initialsOf(row.name)}</span>
                  <span>
                    <span className="hr-who__name">{row.name}</span>
                    <span className="hr-who__role">{row.position ?? 'No position recorded'}</span>
                  </span>
                </Link>
              </td>
              <td>
                <StatusChip tone="block">Blocked</StatusChip>
              </td>
              {GRID_COLUMNS.map((column) => (
                <td key={column.key} className={`hr-num ${column.kind === 'editable' ? 'is-editable' : column.kind === 'record' ? 'is-record' : 'is-auto'}`} title={row.reason ?? undefined}>
                  —
                </td>
              ))}
              <td>
                <Link className="hr-fixLink" to={`/admin/hr/employees/${row.staffId}`}>
                  Fix
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  column,
  row,
  editing,
  edit,
  onEditChange,
}: {
  column: GridColumn;
  row: PayRow;
  editing: boolean;
  edit: GridEdit | null;
  onEditChange: (patch: Partial<GridEdit>) => void;
}) {
  const kindClass = column.kind === 'editable' ? 'is-editable' : column.kind === 'record' ? 'is-record' : 'is-auto';
  const className = ['hr-num', kindClass, column.strong ? 'hr-strong' : '', column.net ? 'hr-net' : ''].filter(Boolean).join(' ');

  if (editing && column.kind === 'editable' && edit) {
    const isIncome = column.key === 'otherIncome';
    return (
      <td className={className}>
        <input
          className="hr-inp"
          inputMode="decimal"
          aria-label={`${column.title} for ${row.name}`}
          value={isIncome ? edit.otherIncome : edit.otherDeduction}
          onChange={(event) => onEditChange(isIncome ? { otherIncome: event.target.value } : { otherDeduction: event.target.value })}
        />
      </td>
    );
  }

  const raw = row[column.field];
  let shown: ReactNode;
  if (column.money) {
    const text = grouped(raw as string | null);
    shown = text === null ? <span title="Not worked out">—</span> : text;
  } else {
    shown = column.key === 'overtimeHours' ? hours(Number(raw)) : days(Number(raw));
  }
  return (
    <td className={className}>
      {shown}
      {editing && column.fixTo ? (
        <Link className="hr-fixLink" to={column.fixTo(row)} title="From the records. Correct it where it was recorded.">
          Fix
        </Link>
      ) : null}
    </td>
  );
}

/**
 * WHETHER THIS PERSON IS READY, BESIDE THIS PERSON. Green ready · gold worth
 * a look · red cannot be paid safely. The reason is on the chip, and Fix
 * goes straight to the remedy for the most serious thing wrong.
 */
function RowStatus({ row }: { row: PayRow }) {
  if (row.blockers > 0) {
    return (
      <span title={row.reason ?? undefined}>
        <StatusChip tone="block">Blocked</StatusChip>
      </span>
    );
  }
  if (row.warnings > 0) {
    return (
      <span title={row.reason ?? undefined}>
        <StatusChip tone="attn">Check</StatusChip>
      </span>
    );
  }
  return <StatusChip tone="done">Ready</StatusChip>;
}

/** The phone register — one card per person, four figures and a status. */
function PayrollCards({ rows, leftOut, link }: { rows: PayRow[]; leftOut: LeftOutRow[]; link: (staffId: string) => string }) {
  return (
    <div className="kw-payCards">
      {rows.map((row) => (
        <div className="kw-payCard" key={row.staffId}>
          <div className="kw-payCard__head">
            <span className="hr-who">
              <span className="hr-who__avatar">{initialsOf(row.name)}</span>
              <span>
                <span className="hr-who__name">{row.name}</span>
                <span className="hr-who__role">{row.position ?? ''}</span>
              </span>
            </span>
            <RowStatus row={row} />
          </div>
          <dl className="kw-payCard__figures">
            <div>
              <dt>Gross</dt>
              <dd className="kw-num">{grouped(row.grossPay)}</dd>
            </div>
            <div>
              <dt>Deductions</dt>
              <dd className="kw-num">{grouped(row.deductionTotal)}</dd>
            </div>
            <div className="kw-payCard__net">
              <dt>Net</dt>
              <dd className="kw-num">{grouped(row.netPay)}</dd>
            </div>
          </dl>
          <Link className="kw-payCard__more" to={link(row.staffId)}>
            View details
          </Link>
        </div>
      ))}
      {leftOut.map((row) => (
        <div className="kw-payCard" key={row.staffId}>
          <div className="kw-payCard__head">
            <span className="hr-who">
              <span className="hr-who__avatar">{initialsOf(row.name)}</span>
              <span>
                <span className="hr-who__name">{row.name}</span>
                <span className="hr-who__role">{row.reason ?? ''}</span>
              </span>
            </span>
            <StatusChip tone="block">Blocked</StatusChip>
          </div>
        </div>
      ))}
    </div>
  );
}
