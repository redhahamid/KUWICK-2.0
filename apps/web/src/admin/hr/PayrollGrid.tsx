import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Grid } from 'antd';
import { ringgit } from '../components/DataTable';
import { StatusChip } from './ui';
import { initialsOf } from './ui/who';
import type { PayrollJourney } from '../types';

type PayRow = PayrollJourney['pay']['rows'][number];
type OwnColumn = PayrollJourney['pay']['columns'][number];

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
 *
 * WHOSE MONEY EACH COLUMN IS. The group headers answer it, not a doubled set
 * of columns: EPF, SOCSO, EIS, PCB and Other sit under DEDUCTIONS — EMPLOYEE
 * because they come off the person's pay, and what the clinic pays on top has
 * its own group at the end, outside net. Gross less the deductions is still
 * net, read left to right.
 *
 * THE MONTH FOOTS. Every column adds up under itself — from the server's own
 * sums, never a column this grid added. The foot names what it covers,
 * because the total for the month and the total for a filtered view are
 * different numbers, and it prints the people a statutory column leaves out
 * rather than passing a short sum off as the whole answer.
 *
 * NO FIGURE IS MERGED TO SAVE WIDTH. Seventeen money columns do not fit on
 * any screen, and the answer is not to add two of them together: the clinic
 * files KWSP with the EPF employer share ALONE and PERKESO with SOCSO and EIS
 * APART, so a column holding their sum is a column nothing can be done with.
 * The grid scrolls instead, and the two columns that say whose row it is —
 * the name and the status — are pinned to the left edge so a figure is never
 * read against the wrong person.
 */

export type CellKind = 'record' | 'editable' | 'auto';
type Band = 'earnings' | 'deductions' | 'net' | 'employer';
type Totals = PayrollJourney['pay']['totals'];

export interface GridColumn {
  key: string;
  title: string;
  band: Band;
  kind: CellKind;
  /** The row field rendered; money fields are server-formatted strings. */
  field: keyof PayRow;
  /** The totals key the column foots on — for the stat cards and the export. */
  total: keyof Totals;
  /**
   * The name this column carries in the CSV, when its header alone would not
   * say whose money it is. A grid has a group header above the column to
   * answer that; an exported file has one header row and nothing else.
   */
  exportTitle?: string;
  /**
   * The totals key counting the people the column's total LEAVES OUT. Only a
   * statutory column has one: its sum runs over the rows where the scheme was
   * worked out, so a null row makes the figure smaller than what is owed.
   */
  missing?: keyof Totals;
  money: boolean;
  strong?: boolean;
  net?: boolean;
  /**
   * AN ITEM'S OWN COLUMN. Set for the columns a clinic switched on under
   * Payroll items; the figure is read from the row's `columns` by this code
   * and the cell is typed into, then saved in one batch.
   */
  itemCode?: string;
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
  },
  {
    key: 'unpaidDays',
    title: 'Unpaid d',
    band: 'earnings',
    kind: 'record',
    field: 'unpaidDays',
    total: 'unpaidDays',
    money: false,
  },
  { key: 'claims', title: 'Claims', band: 'earnings', kind: 'auto', field: 'claims', total: 'claims', money: true },
  { key: 'gross', title: 'Gross', band: 'earnings', kind: 'auto', field: 'grossPay', total: 'gross', money: true, strong: true },
  {
    key: 'epf',
    title: 'EPF',
    band: 'deductions',
    kind: 'auto',
    field: 'epfEmployee',
    total: 'epfEmployee',
    missing: 'epfNotCalculated',
    money: true,
    exportTitle: 'EPF (employee)',
  },
  {
    key: 'socso',
    title: 'SOCSO',
    band: 'deductions',
    kind: 'auto',
    field: 'socsoEmployee',
    total: 'socsoEmployee',
    missing: 'socsoNotCalculated',
    money: true,
    exportTitle: 'SOCSO (employee)',
  },
  {
    key: 'eis',
    title: 'EIS',
    band: 'deductions',
    kind: 'auto',
    field: 'eisEmployee',
    total: 'eisEmployee',
    missing: 'eisNotCalculated',
    money: true,
    exportTitle: 'EIS (employee)',
  },
  /*
   * SKBBK — LINDUNG 24 JAM. Act 4's own schedule prints it as a third column
   * beside SOCSO and EIS, and it is EMPLOYEE-borne: the engine takes it off
   * gross with EPF, SOCSO, EIS and PCB (payroll-calculation.ts), and the
   * payslip gives it its own line. A deduction a clinic can see on the
   * payslip and not in the register is a deduction they cannot check.
   */
  {
    key: 'lindung',
    title: 'SKBBK',
    band: 'deductions',
    kind: 'auto',
    field: 'lindungEmployee',
    total: 'lindung',
    missing: 'lindungNotDetermined',
    money: true,
    exportTitle: 'SKBBK / Lindung 24 Jam (employee)',
  },
  { key: 'pcb', title: 'PCB', band: 'deductions', kind: 'auto', field: 'pcb', total: 'pcb', missing: 'pcbMissing', money: true },
  {
    key: 'otherDeductions',
    title: 'Other',
    band: 'deductions',
    kind: 'editable',
    field: 'otherDeductions',
    total: 'otherDeductions',
    money: true,
    exportTitle: 'Other deductions',
  },
  { key: 'net', title: 'Net pay', band: 'net', kind: 'auto', field: 'netPay', total: 'net', money: true, strong: true, net: true },
  /*
   * WHAT THE CLINIC PAYS ON TOP — ITEMISED, because a clinic files with the
   * items and not with their sum.
   *
   * This was one "Contributions" column for a day. It could not be used for
   * anything: KWSP's form asks for the EPF employer share alone, PERKESO's
   * asks for SOCSO and EIS separately, and the levy is its own return. So the
   * four figures the engine already wrote on the line are four columns, and
   * together they still make the "Employer contributions" the month header
   * shows — `employerCost - gross`, which is exactly these four.
   *
   * They sit after net because none of them ever comes off anybody's pay.
   */
  {
    key: 'epfEmployer',
    title: 'EPF',
    band: 'employer',
    kind: 'auto',
    field: 'epfEmployer',
    total: 'epfEmployer',
    missing: 'epfNotCalculated',
    money: true,
    exportTitle: 'EPF (employer)',
  },
  {
    key: 'socsoEmployer',
    title: 'SOCSO',
    band: 'employer',
    kind: 'auto',
    field: 'socsoEmployer',
    total: 'socsoEmployer',
    missing: 'socsoNotCalculated',
    money: true,
    exportTitle: 'SOCSO (employer)',
  },
  {
    key: 'eisEmployer',
    title: 'EIS',
    band: 'employer',
    kind: 'auto',
    field: 'eisEmployer',
    total: 'eisEmployer',
    missing: 'eisNotCalculated',
    money: true,
    exportTitle: 'EIS (employer)',
  },
  /*
   * AND THE LEVY, which is the fourth thing in that sum. Without it the group
   * would be headed "Employer pays" over three figures that do not add up to
   * what the employer pays, for any clinic registered with HRD Corp.
   */
  {
    key: 'hrdLevy',
    title: 'HRD levy',
    band: 'employer',
    kind: 'auto',
    field: 'hrdLevy',
    total: 'hrdLevy',
    missing: 'hrdLevyNotDetermined',
    money: true,
    exportTitle: 'HRD levy (employer)',
  },
];

/**
 * THE COLUMNS FOR THIS RUN: the fixed list with the clinic's own-column items
 * between Basic and Other income, in Payroll items order. A director's fee
 * with a column of its own is not in Other income — the server takes it out
 * of that cell — so the row still reads left to right without double counting.
 */
export function gridColumnsFor(columns: OwnColumn[]): GridColumn[] {
  const own: GridColumn[] = columns.map((column) => ({
    key: `item:${column.code}`,
    title: column.name,
    band: 'earnings',
    kind: 'editable',
    field: 'columns',
    total: 'columns',
    money: true,
    itemCode: column.code,
    exportTitle: column.name,
  }));
  return [GRID_COLUMNS[0], ...own, ...GRID_COLUMNS.slice(1)];
}

/** One row's figure for a column — the server's string, for the cell and the export alike. */
export function cellValue(column: GridColumn, row: PayRow): string | number | null {
  if (column.itemCode) return row.columns?.[column.itemCode]?.amount ?? '0.00';
  return row[column.field] as string | number | null;
}

/** The month's total for a column, from the server's sums. */
function footValue(column: GridColumn, totals: Totals): unknown {
  if (column.itemCode) return totals.columns?.[column.itemCode] ?? '0.00';
  return totals[column.total];
}

/** "4,200.00" — the server's figure, grouped, without the currency the column header implies. */
export const grouped = (value: string | null | undefined): string | null =>
  value === null || value === undefined ? null : ringgit(value).replace('RM', '');

/*
 * TYPING INTO THE GRID. An own column's cell is a box: the amount is typed,
 * the row goes amber until "Save changes" sends every changed cell through
 * the same inputs endpoint the drawer uses — one line per person and item,
 * the same server rules — and then works the month out ONCE. A blank or a
 * nought clears the line. Nothing is summed here; after the save the figures
 * are the engine's again.
 */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const validAmount = (text: string) => MONEY.test(text.trim());
const cents = (text: string) => Math.round(Number(text) * 100);
const editKey = (staffId: string, code: string) => `${staffId}:${code}`;

export interface GridEdit {
  key: string;
  staffId: string;
  name: string;
  code: string;
  title: string;
  /** The row the cell holds today, if any — what a clear removes. */
  inputId: string | null;
  /** The amount to save, two decimals, or null to clear the line. */
  amount: string | null;
}

/** What the save could not do, per cell, so the grid keeps those drafts and says why. */
export type SaveOutcome = { failed: { key: string; message: string }[] } | void;

const said = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message)
    : 'The server refused the change and did not say why.';

const hours = (value: number) => value.toFixed(1);
const days = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/*
 * THE TWO WHITE CELLS OPEN THE MONTH'S ITEMS. They used to be text boxes:
 * whatever was typed became one hand-keyed Allowance line, and a month with
 * overtime, an incentive, an allowance, a locum fee and a director's fee went
 * onto the payslip as one figure with one statutory treatment. The cell now
 * shows the server's total and opens the drawer where each item is its own
 * line — see `PayrollInputsDrawer`.
 */
export type ItemsCell = 'income' | 'deductions';

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
  totals,
  counted,
  runId,
  onOpenItems,
  columns = [],
  canEdit = false,
  previousMonth = 'last month',
  onSaveCells,
}: {
  rows: PayRow[];
  leftOut?: LeftOutRow[];
  /** The server's sums for the WHOLE month — what the foot prints. */
  totals: Totals;
  /** How many people those sums cover, which is not always how many are shown. */
  counted: number;
  runId: string;
  /** A white cell was pressed: open this person's items for the month. */
  onOpenItems: (row: PayRow, cell: ItemsCell) => void;
  /** The items with a column of their own, in the order they are drawn. */
  columns?: OwnColumn[];
  /** Whether own-column cells may be typed into: the run is open and the person may run payroll. */
  canEdit?: boolean;
  /** "January 2026" — for the marker on a cell still carrying last month's amount. */
  previousMonth?: string;
  /** Save every changed cell, then work the month out once. */
  onSaveCells?: (edits: GridEdit[]) => Promise<SaveOutcome>;
}) {
  const screens = Grid.useBreakpoint();
  const employeeLink = (staffId: string) => `/admin/hr/payroll/${runId}/employees/${staffId}`;

  /** The drafts, keyed by person and item; a key is present only while the cell differs from what is saved. */
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * PHONES GET CARDS, NOT A SQUEEZED SPREADSHEET. Fourteen columns inside
   * 390px can only be done by shrinking the type until nobody can read it.
   */
  if (!screens.md) {
    return <PayrollCards rows={rows} leftOut={leftOut} totals={totals} counted={counted} link={employeeLink} onOpenItems={onOpenItems} columns={columns} />;
  }

  /*
   * A COLUMN NOBODY IN THIS LIST HAS AN AMOUNT IN IS FOLDED AWAY, so three or
   * four own columns do not turn every month into a wide empty sheet. "Show
   * all columns" brings them back for the first amount; a column being typed
   * into never folds.
   */
  const all = gridColumnsFor(columns);
  const empty = (column: GridColumn) =>
    column.itemCode !== undefined &&
    rows.every((row) => {
      const cell = row.columns?.[column.itemCode as string];
      return !cell || (cents(cell.amount) === 0 && (cell.entered === null || cents(cell.entered) === 0));
    }) &&
    !rows.some((row) => edits.has(editKey(row.staffId, column.itemCode as string)));
  const hidden = showAll ? [] : all.filter(empty);
  const visible = all.filter((column) => !hidden.includes(column));
  const earnings = visible.filter((column) => column.band === 'earnings');
  const deductions = visible.filter((column) => column.band === 'deductions');
  const employer = visible.filter((column) => column.band === 'employer');

  const onDraft = (row: PayRow, code: string, text: string) => {
    const key = editKey(row.staffId, code);
    const saved = row.columns?.[code]?.entered ?? '';
    setEdits((previous) => {
      const next = new Map(previous);
      // Back to what is saved is not a change.
      if (text === saved || (validAmount(text) && saved !== '' && cents(text) === cents(saved))) next.delete(key);
      else next.set(key, text);
      return next;
    });
    setProblem(null);
  };

  const discard = () => {
    setEdits(new Map());
    setProblem(null);
  };

  const save = async () => {
    if (!onSaveCells) return;
    const list: GridEdit[] = [];
    for (const [key, draft] of edits) {
      const [staffId, code] = key.split(':');
      const row = rows.find((candidate) => candidate.staffId === staffId);
      const column = columns.find((candidate) => candidate.code === code);
      const cell = row?.columns?.[code];
      if (!row || !column || !cell) continue;
      const text = draft.trim();
      if (text !== '' && !validAmount(text)) {
        setProblem(`${column.name} for ${row.name}: enter a number with at most two decimals, or leave the cell empty to clear it.`);
        return;
      }
      const clears = text === '' || cents(text) === 0;
      // Clearing a cell that holds no line is nothing to send.
      if (clears && !cell.inputId) continue;
      list.push({
        key,
        staffId,
        name: row.name,
        code,
        title: column.name,
        inputId: cell.inputId,
        amount: clears ? null : (cents(text) / 100).toFixed(2),
      });
    }
    setSaving(true);
    setProblem(null);
    try {
      const outcome = await onSaveCells(list);
      const failed = outcome?.failed ?? [];
      setEdits((previous) => {
        const next = new Map<string, string>();
        for (const failure of failed) {
          const draft = previous.get(failure.key);
          if (draft !== undefined) next.set(failure.key, draft);
        }
        return next;
      });
      if (failed.length > 0) setProblem(failed.map((failure) => failure.message).join(' '));
    } catch (error) {
      setProblem(said(error));
    } finally {
      setSaving(false);
    }
  };

  const changes = edits.size;
  const hiddenNames = hidden.map((column) => column.title);

  return (
    <>
      {columns.length > 0 && (hidden.length > 0 || showAll) ? (
        <div className="hr-gridBar" role="status">
          <span className="hr-small hr-muted">
            {showAll
              ? 'Showing every column, including the ones nobody in this list has an amount in.'
              : `${hidden.length} ${hidden.length === 1 ? 'column' : 'columns'} hidden (${hiddenNames.join(', ')}): nobody in this list has an amount ${hidden.length === 1 ? 'in it' : 'in them'}.`}
          </span>
          <span className="hr-spacer" />
          <button type="button" className="hr-btn hr-btn--sm" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Hide empty columns' : 'Show all columns'}
          </button>
        </div>
      ) : null}
      {changes > 0 ? (
        <div className="hr-gridBar hr-gridBar--dirty" role="status">
          <span className="hr-small">
            <strong>
              {changes} {changes === 1 ? 'change' : 'changes'} not saved.
            </strong>{' '}
            Save sends each cell as its own line and works the month out once.
          </span>
          {problem ? <span className="hr-small hr-gridBar__problem">{problem}</span> : null}
          <span className="hr-spacer" />
          <button type="button" className="hr-btn hr-btn--sm" onClick={discard} disabled={saving}>
            Discard
          </button>
          <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={() => void save()} disabled={saving || !onSaveCells}>
            {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      ) : null}
    <div className="kw-payrollGrid hr-scrollX">
      <table className="hr-grid">
        <thead>
          <tr className="hr-grid__grp">
            <th className="hr-grid__freeze hr-grid__freeze--who" />
            <th className="hr-grid__freeze hr-grid__freeze--status" />
            <th className="is-record">Record</th>
            <th colSpan={earnings.length - 1}>Earnings</th>
            <th colSpan={deductions.length}>Deductions — employee</th>
            <th />
            <th colSpan={employer.length}>Employer pays</th>
            <th />
          </tr>
          <tr>
            <th className="hr-grid__freeze hr-grid__freeze--who">Employee</th>
            <th className="hr-grid__freeze hr-grid__freeze--status">Status</th>
            {visible.map((column) => (
              <th key={column.key} className={`hr-num${column.kind === 'record' && column.key === 'basic' ? ' is-record' : ''}`}>
                {column.title}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            return (
              <tr key={row.staffId} className={columns.some((column) => edits.has(editKey(row.staffId, column.code))) ? 'is-editing' : undefined}>
                <td className="hr-grid__freeze hr-grid__freeze--who">
                  <Link className="hr-who" to={employeeLink(row.staffId)} title={row.name}>
                    <span className="hr-who__avatar">{initialsOf(row.name)}</span>
                    <span>
                      <span className="hr-who__name">{row.name}</span>
                      <span className="hr-who__role">{row.position ?? 'No position recorded'}</span>
                    </span>
                  </Link>
                </td>
                <td className="hr-grid__freeze hr-grid__freeze--status">
                  <RowStatus row={row} />
                </td>
                {visible.map((column) => (
                  <Cell
                    key={column.key}
                    column={column}
                    row={row}
                    onOpenItems={onOpenItems}
                    canEdit={canEdit && Boolean(onSaveCells)}
                    draft={column.itemCode ? edits.get(editKey(row.staffId, column.itemCode)) : undefined}
                    onDraft={onDraft}
                    previousMonth={previousMonth}
                  />
                ))}
                <td>
                  {row.blockers > 0 && row.fixLink ? (
                    <Link className="hr-fixLink" to={row.fixLink}>
                      Fix
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {leftOut.map((row) => (
            <tr key={row.staffId}>
              <td className="hr-grid__freeze hr-grid__freeze--who">
                <Link className="hr-who" to={`/admin/hr/employees/${row.staffId}`} title={row.name}>
                  <span className="hr-who__avatar">{initialsOf(row.name)}</span>
                  <span>
                    <span className="hr-who__name">{row.name}</span>
                    <span className="hr-who__role">{row.position ?? 'No position recorded'}</span>
                  </span>
                </Link>
              </td>
              <td className="hr-grid__freeze hr-grid__freeze--status">
                <Standing tone="block" label="Blocked" reason={row.reason} />
              </td>
              {visible.map((column) => (
                <td key={column.key} className={`hr-num ${column.kind === 'editable' ? 'is-editable' : column.kind === 'record' ? 'is-record' : 'is-auto'}`}>
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
        <tfoot>
          <tr>
            <th scope="row" className="hr-grid__freeze hr-grid__freeze--who">
              <span className="hr-grid__footLabel">Total</span>
              <span className="hr-grid__footWho">{covers(rows.length, counted, leftOut.length)}</span>
            </th>
            <td className="hr-grid__freeze hr-grid__freeze--status" />
            {visible.map((column) => (
              <Foot key={column.key} column={column} totals={totals} />
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

/**
 * WHAT THE FOOT COVERS, said plainly. The sums are the month's, so a filtered
 * view shows a total that is not the total of the rows above it — and people
 * the run left out have no line, so no figure of theirs is in it either.
 * Both are named rather than left to be discovered.
 */
export function covers(shown: number, counted: number, leftOut: number): string {
  const people = `All ${counted} ${counted === 1 ? 'employee' : 'employees'}`;
  const clauses = [shown === counted ? people : `${people}, not the ${shown} shown`];
  if (leftOut > 0) clauses.push(`${leftOut} left out ${leftOut === 1 ? 'has' : 'have'} no figures`);
  return clauses.join(' · ');
}

/** One column's foot — the server's sum, and the people it does not cover. */
function Foot({ column, totals }: { column: GridColumn; totals: Totals }) {
  const short = column.missing ? (totals[column.missing] as number) : 0;
  const className = ['hr-num', column.strong ? 'hr-strong' : '', column.net ? 'hr-net' : ''].filter(Boolean).join(' ');
  return (
    <td className={className}>
      {figure(column, footValue(column, totals))}
      {short > 0 ? (
        <span
          className="hr-grid__short"
          title={`${short} ${short === 1 ? 'person is' : 'people are'} not in this total: ${column.title} was not worked out for them.`}
        >
          {short} not worked out
        </span>
      ) : null}
    </td>
  );
}

/**
 * ONE COLUMN'S FIGURE, formatted the way that column formats — used by the
 * cell and by the foot, so a total cannot be printed differently from the
 * figures above it. A money null renders "—": a statutory figure the engine
 * could not work out is not nil.
 */
function figure(column: GridColumn, raw: unknown): ReactNode {
  if (!column.money) return column.key === 'overtimeHours' ? hours(Number(raw)) : days(Number(raw));
  const text = grouped(raw as string | null);
  return text === null ? <span title="Not worked out">—</span> : text;
}

function Cell({
  column,
  row,
  onOpenItems,
  canEdit,
  draft,
  onDraft,
  previousMonth,
}: {
  column: GridColumn;
  row: PayRow;
  onOpenItems: (row: PayRow, cell: ItemsCell) => void;
  canEdit: boolean;
  /** The unsaved text in this cell, if the person has typed. */
  draft?: string;
  onDraft: (row: PayRow, code: string, text: string) => void;
  previousMonth: string;
}) {
  const kindClass = column.kind === 'editable' ? 'is-editable' : column.kind === 'record' ? 'is-record' : 'is-auto';
  const className = ['hr-num', kindClass, column.strong ? 'hr-strong' : '', column.net ? 'hr-net' : ''].filter(Boolean).join(' ');

  if (column.itemCode) {
    const cell = row.columns?.[column.itemCode];
    if (!cell) return <td className={className}>—</td>;
    if (canEdit && cell.editable) {
      // THE CELL IS A BOX. What it shows is what was keyed for the item —
      // blank when nothing was — and the amber marker says when the line is
      // still last month's copy. The engine's figure is the same number once
      // the month has been worked out, and the foot below is always the
      // engine's.
      const saved = cell.entered ?? '';
      const text = draft ?? saved;
      const dirty = draft !== undefined;
      const invalid = dirty && text.trim() !== '' && !validAmount(text);
      const behind = !dirty && cell.entered !== null && cents(cell.entered) !== cents(cell.amount);
      return (
        <td className={`${className} is-input${cell.carried ? ' is-carried' : ''}`}>
          <input
            className={`hr-cellInput${dirty ? ' is-dirty' : ''}${invalid ? ' is-invalid' : ''}`}
            inputMode="decimal"
            value={text}
            placeholder="0.00"
            aria-label={`${column.title} for ${row.name}`}
            aria-invalid={invalid || undefined}
            title={cell.carried ? `Carried from ${previousMonth}. Edit or clear it if it should not repeat.` : undefined}
            onChange={(event) => onDraft(row, column.itemCode as string, event.target.value)}
          />
          {cell.carried && !dirty ? (
            <span className="hr-grid__carried" title={`Carried from ${previousMonth}. Edit or clear it if it should not repeat.`}>
              Carried
            </span>
          ) : null}
          {behind ? (
            <span className="hr-grid__short" title={`The month has not been worked out since this was entered; it pays ${grouped(cell.amount)} today.`}>
              Not worked out
            </span>
          ) : null}
        </td>
      );
    }
    // A derived line holds this item for this person — a recurring item,
    // say — or the run is locked: the figure opens the drawer, which says
    // where the line came from and, on an open run, where it is corrected.
    return (
      <td className={className}>
        <button
          type="button"
          className="hr-cellBtn"
          title={cell.editable ? "Open this month's items for this person" : 'This line comes from a record; open the items to see where.'}
          aria-label={`${column.title} for ${row.name}: open the month's items`}
          onClick={() => onOpenItems(row, 'income')}
        >
          {figure(column, cell.amount)}
        </button>
      </td>
    );
  }

  if (column.kind === 'editable') {
    // THE FIGURE IS THE BUTTON. It stays the server's total — the drawer it
    // opens is where the lines behind it are added, edited and removed.
    const cell: ItemsCell = column.key === 'otherIncome' ? 'income' : 'deductions';
    return (
      <td className={className}>
        <button
          type="button"
          className="hr-cellBtn"
          title="Open this month's items for this person"
          aria-label={`${column.title} for ${row.name}: open the month's items`}
          onClick={() => onOpenItems(row, cell)}
        >
          {figure(column, row[column.field])}
        </button>
      </td>
    );
  }

  return <td className={className}>{figure(column, row[column.field])}</td>;
}

/**
 * WHETHER THIS PERSON IS READY, BESIDE THIS PERSON. Green ready · gold needs
 * attention · red cannot be paid safely. Fix goes straight to the remedy for
 * the most serious thing wrong.
 *
 * AND WHAT IS WRONG, ON THE ROW. A status word can only ever say how serious
 * something is; it cannot say what it is, which is why "Check" told a reader
 * nothing they could act on. The server already sends the reason for the most
 * serious thing wrong, so the row PRINTS it under the chip instead of hiding
 * it in a hover a phone cannot perform — with the full text still on `title`
 * for the rare reason too long for the column.
 *
 * "Needs attention" is the name the server gives this state (NEEDS_ATTENTION),
 * so the screen and the API say the same word for the same thing.
 */
function RowStatus({ row }: { row: PayRow }) {
  if (row.blockers > 0) return <Standing tone="block" label="Blocked" reason={row.reason} />;
  if (row.warnings > 0) return <Standing tone="attn" label="Needs attention" reason={row.reason} />;
  return <StatusChip tone="done">Ready</StatusChip>;
}

function Standing({ tone, label, reason }: { tone: 'block' | 'attn'; label: string; reason: string | null }) {
  return (
    <span className="hr-standing">
      <StatusChip tone={tone}>{label}</StatusChip>
      {reason ? (
        <span className="hr-standing__why" title={reason}>
          {reason}
        </span>
      ) : null}
    </span>
  );
}

/** The phone register — one card per person, four figures and a status, then the month's. */
function PayrollCards({
  rows,
  leftOut,
  totals,
  counted,
  link,
  onOpenItems,
  columns,
}: {
  rows: PayRow[];
  leftOut: LeftOutRow[];
  totals: Totals;
  counted: number;
  link: (staffId: string) => string;
  onOpenItems: (row: PayRow, cell: ItemsCell) => void;
  columns: OwnColumn[];
}) {
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
              <dt>Other income</dt>
              <dd className="kw-num">
                <button
                  type="button"
                  className="kw-payCard__items"
                  aria-label={`Other income for ${row.name}: open the month's items`}
                  onClick={() => onOpenItems(row, 'income')}
                >
                  {grouped(row.otherIncome)}
                </button>
              </dd>
            </div>
            {/* THE OWN COLUMNS, read-only on a phone: typed on a wider screen or through the items. */}
            {columns
              .filter((column) => cents(row.columns?.[column.code]?.amount ?? '0') !== 0)
              .map((column) => (
                <div key={column.code}>
                  <dt>{column.name}</dt>
                  <dd className="kw-num">{grouped(row.columns[column.code].amount)}</dd>
                </div>
              ))}
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
      <div className="kw-payCard kw-payCard--total">
        <div className="kw-payCard__head">
          <span className="hr-who__name">Total</span>
          <span className="kw-payCard__covers">{covers(rows.length, counted, leftOut.length)}</span>
        </div>
        <dl className="kw-payCard__figures">
          <div>
            <dt>Gross</dt>
            <dd className="kw-num">{grouped(totals.gross)}</dd>
          </div>
          <div>
            <dt>Deductions</dt>
            <dd className="kw-num">{grouped(totals.deductions)}</dd>
          </div>
          <div className="kw-payCard__net">
            <dt>Net</dt>
            <dd className="kw-num">{grouped(totals.net)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
