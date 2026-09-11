import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Checkbox, Dropdown, Grid, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PersonCell } from '../components/Person';
import { StatusChip } from '../components/Chip';
import type { PayrollJourney } from '../types';

type PayRow = PayrollJourney['pay']['rows'][number];
type Totals = PayrollJourney['pay']['totals'];

/**
 * THE PAYROLL REGISTER — PEOPLE DOWN, MONEY ACROSS.
 *
 * The owner's verdict was that their Excel payroll was easier to understand
 * than this product, and they were right about why: a spreadsheet puts
 * everything needed to understand one person's salary on ONE ROW, and Kuwick
 * made you assemble that row in your head out of six screens.
 *
 * So this screen is the product. An owner should spend almost all of payroll
 * here, and should be able to answer "how did this person get this net
 * salary?" without leaving it.
 *
 * THREE BANDS, NOT SIXTEEN EQUAL COLUMNS. Person · what they earned · what
 * came off · what they are paid. A register that treats every column
 * identically is a wall of numbers; the grouped header is what makes it read
 * as an argument that arrives at a net figure.
 *
 * THE ROW ADDS UP LEFT TO RIGHT:
 *
 *     Basic − Unpaid leave + Additional + Overtime + Incentive = Gross
 *     Gross − EPF − SOCSO/EIS − PCB − other = Net
 *
 * Unpaid leave sits BEFORE gross because `grossPay` already nets it — s.18A
 * makes an incomplete month's wages smaller, it does not take a deduction from
 * them. It sat after Gross once, and the register visibly failed to foot: the
 * four additions came to RM41,094.88 against a printed gross of RM40,959.40.
 * Do not move it back.
 *
 * NOT ONE FIGURE IS COMPUTED HERE. Every cell and every total is a string the
 * server formatted from the payslip lines — including the grouped columns
 * ("Additional", "SOCSO/EIS") and the totals row, which foots on
 * `journey.pay.totals` rather than on a sum taken over what happens to be on
 * screen. The register this replaced summed its own columns in a `useMemo`,
 * which is a second payroll implementation waiting to disagree with the
 * payslip by a sen.
 *
 * ONE DEFINITION, TWO RENDERINGS. Each column names the totals key it foots
 * on, and the summary row is built from the SAME list in the SAME order.
 * `Table.Summary.Cell` is addressed by index, so a hand-kept parallel list
 * drifts by one the first time a column becomes optional — and every figure
 * slides left, putting PCB's total under NET PAY. That looks plausible, which
 * is the dangerous kind of wrong. It cannot happen here: there is no second
 * list to keep.
 *
 * A BLANK IS NOT A ZERO. Statutory figures are nullable on purpose: null means
 * "not worked out" — no rates configured, or a fact missing — and rendering it
 * as 0.00 tells a clinic it owes nothing, which is the one wrong answer that
 * gets acted on.
 */

/**
 * The detail switches. Each SPLITS a grouped column rather than adding a
 * second copy of money already on screen — showing "Allowances" beside an
 * "Additional" that contains allowances makes the row stop adding up.
 */
const SPLITS = [
  { key: 'additional', label: 'Allowances and claims separately' },
  { key: 'statutory', label: 'SOCSO and EIS separately' },
] as const;

const EXTRAS = [
  { key: 'lindung', label: 'LINDUNG 24 JAM' },
  { key: 'otherDeductions', label: 'Other deductions' },
  { key: 'employerCost', label: 'Cost to clinic' },
] as const;

type Toggle = (typeof SPLITS)[number]['key'] | (typeof EXTRAS)[number]['key'];

type Band = 'earnings' | 'deductions' | 'result';

/** A money column and the server total it foots on — declared once. */
interface MoneyColumn {
  band: Band;
  title: string;
  field: keyof PayRow;
  total: keyof Totals;
  width: number;
  /** Rendered in red with a minus, for figures that come off pay. */
  negative?: boolean;
  strong?: boolean;
  net?: boolean;
  hint?: string;
}

export function PayrollGrid({
  rows,
  totals,
  onOpenEmployee,
  selectedStaffId,
  onFix,
}: {
  rows: PayRow[];
  /** The server's own totals. The register never sums its own columns. */
  totals: Totals;
  onOpenEmployee: (row: PayRow) => void;
  selectedStaffId?: string;
  /** Opens the remedy for a row that is not ready. Undefined = read-only. */
  onFix?: (row: PayRow) => void;
}) {
  const screens = Grid.useBreakpoint();
  const [shown, setShown] = useState<Toggle[]>([]);
  const on = (key: Toggle) => shown.includes(key);

  /*
   * PHONES GET CARDS, NOT A SQUEEZED SPREADSHEET.
   *
   * Sixteen columns inside 390px can only be done by shrinking the type until
   * nobody can read it, which is not a responsive design, it is a smaller
   * unreadable one. On a phone the register becomes one card per person
   * carrying the figures that matter, and the drawer still holds the detail.
   */
  if (!screens.md) {
    return <PayrollCards rows={rows} totals={totals} onOpenEmployee={onOpenEmployee} onFix={onFix} />;
  }

  /*
   * IPAD PORTRAIT GETS A CONDENSED REGISTER, not a truncated one.
   *
   * At 820px the full set still scrolls sideways — but the pinned Net Pay
   * column sits over the columns beside it, so "Unpaid leave" rendered as a
   * lone "U" under the band header. A heading clipped to one letter is worse
   * than a column that is honestly not shown: the condensed set is the four
   * figures the month is read by, and the Columns menu and the drawer both
   * still reach everything else.
   */
  const condensed = !screens.lg;

  const money: MoneyColumn[] = [
    { band: 'earnings', title: 'Basic', field: 'basicSalary', total: 'basic', width: 112 },
    {
      band: 'earnings',
      title: 'Unpaid leave',
      field: 'unpaidLeaveDeduction',
      total: 'unpaidLeave',
      width: 122,
      negative: true,
      hint: 'An incomplete month earns smaller wages — this is already off the gross beside it, not taken from it.',
    },
    ...(on('additional')
      ? ([
          { band: 'earnings', title: 'Allowances', field: 'allowances', total: 'allowances', width: 118 },
          { band: 'earnings', title: 'Claims & other', field: 'otherEarnings', total: 'otherEarnings', width: 132 },
        ] as MoneyColumn[])
      : ([
          {
            band: 'earnings',
            title: 'Additional',
            field: 'additionalEarnings',
            total: 'additionalEarnings',
            width: 124,
            hint: 'Allowances, reimbursed claims and anything else that reached gross. Open the row for the detail.',
          },
        ] as MoneyColumn[])),
    ...(condensed
      ? []
      : ([
          { band: 'earnings', title: 'Overtime', field: 'overtimePay', total: 'overtime', width: 112 },
          {
            band: 'earnings',
            title: 'Incentive',
            field: 'incentive',
            total: 'incentive',
            width: 116,
            hint: 'Procedure incentives, commission and bonus.',
          },
        ] as MoneyColumn[])),
    { band: 'earnings', title: 'Gross', field: 'grossPay', total: 'gross', width: 124, strong: true },

    { band: 'deductions', title: 'EPF', field: 'epfEmployee', total: 'epfEmployee', width: 104 },
    ...(condensed
      ? []
      : on('statutory')
        ? ([
            { band: 'deductions', title: 'SOCSO', field: 'socsoEmployee', total: 'socsoEmployee', width: 106 },
            { band: 'deductions', title: 'EIS', field: 'eisEmployee', total: 'eisEmployee', width: 100 },
          ] as MoneyColumn[])
        : ([
            { band: 'deductions', title: 'SOCSO/EIS', field: 'socsoEis', total: 'socsoEis', width: 118 },
          ] as MoneyColumn[])),
    ...(on('lindung')
      ? ([
          { band: 'deductions', title: 'LINDUNG', field: 'lindungEmployee', total: 'lindung', width: 114 },
        ] as MoneyColumn[])
      : []),
    { band: 'deductions', title: 'PCB', field: 'pcb', total: 'pcb', width: 104 },
    ...(on('otherDeductions')
      ? ([
          {
            band: 'deductions',
            title: 'Other',
            field: 'otherDeductions',
            total: 'otherDeductions',
            width: 112,
            negative: true,
          },
        ] as MoneyColumn[])
      : []),

    ...(on('employerCost')
      ? ([
          { band: 'result', title: 'Cost to clinic', field: 'employerCost', total: 'employerCost', width: 136 },
        ] as MoneyColumn[])
      : []),
    { band: 'result', title: 'Net pay', field: 'netPay', total: 'net', width: 132, net: true },
  ];

  const inBand = (band: Band) =>
    money
      .filter((column) => column.band === band)
      .map((column) => ({
        title: column.hint ? <Tooltip title={column.hint}>{column.title}</Tooltip> : column.title,
        dataIndex: column.field,
        key: column.field as string,
        align: 'right' as const,
        width: column.width,
        ...(column.net ? { fixed: 'right' as const } : {}),
        render: (value: string | null) => <Money value={value} negative={column.negative} strong={column.strong} net={column.net} />,
      }));

  const columns: ColumnsType<PayRow> = [
    {
      title: 'Employee',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 252,
      render: (value: string, row) => (
        <PersonCell
          name={value}
          meta={row.position ?? undefined}
          size={26}
          trailing={<RowStatus row={row} onFix={onFix} />}
        />
      ),
    },
    /*
     * BAND LABELS ARE LEFT-ALIGNED, and `align` rather than CSS.
     *
     * antd centres a grouped header cell with a rule that beats a stylesheet,
     * and a centred label sits in the middle of its band — which for a
     * register wider than any laptop put "DEDUCTIONS" off the right edge while
     * EPF and PCB sat under no heading at all. `align` is passed through to the
     * cell itself, so it wins, and each band names itself the moment its first
     * column comes into view.
     */
    { title: 'Earnings', key: 'earnings', align: 'left', children: inBand('earnings') },
    { title: 'Deductions', key: 'deductions', align: 'left', children: inBand('deductions') },
    { title: 'Result', key: 'result', align: 'left', children: inBand('result') },
  ];

  return (
    <div className="kw-payrollGrid kw-payrollGrid--standalone">
      <div className="kw-payrollGrid__bar">
        <span className="kw-payrollGrid__hint">Open a row for one person’s full detail.</span>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'splits', type: 'group', label: 'Show separately', children: toggleItems(SPLITS, on, setShown) },
              { key: 'extras', type: 'group', label: 'Also show', children: toggleItems(EXTRAS, on, setShown) },
            ],
          }}
        >
          <Button size="small">Columns{shown.length ? ` · ${shown.length}` : ''}</Button>
        </Dropdown>
      </div>

      <Table<PayRow>
        rowKey="staffId"
        size="small"
        dataSource={rows}
        columns={columns}
        pagination={false}
        /*
         * ITS OWN BOX, WITH ITS OWN SCROLLBARS — like a sheet.
         *
         * Wide by nature, so it scrolls sideways with the person and their net
         * pay pinned: the two columns you must not lose sight of while reading
         * across. It scrolls DOWN inside itself too, which keeps the totals row
         * pinned to the bottom of the register instead of somewhere below the
         * fold.
         *
         * `sticky` is deliberately NOT set. antd's window-sticky header and an
         * internal `scroll.y` are mutually exclusive, and passing both meant
         * `y` was silently ignored: the register ran off the bottom of the page
         * and the totals — the row the whole screen argues towards — could only
         * be reached by scrolling past the fold, where the floating chat
         * launcher sits over the net pay column.
         */
        scroll={{ x: 'max-content', y: 460 }}
        onRow={(row) => ({ onClick: () => onOpenEmployee(row) })}
        /*
         * THE STATUS IS ON THE NAME, NOT ON THE WHOLE ROW.
         *
         * A blocked row was tinted red across all sixteen columns. With three
         * of ten people waiting on a tax profile the register read as an error
         * screen rather than a month of payroll — and red that covers a third
         * of the page stops meaning "stop". The chip sits in the pinned
         * Employee column, so it is on screen however far sideways you scroll,
         * which is what the tint was really for.
         */
        rowClassName={(row) =>
          [
            'kw-dataTable__row--clickable',
            row.staffId === selectedStaffId ? 'kw-payrollGrid__row--selected' : '',
          ]
            .filter(Boolean)
            .join(' ')
        }
        summary={() => (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row className="kw-payrollGrid__totals">
              <Table.Summary.Cell index={0}>
                <strong>
                  {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
                </strong>
              </Table.Summary.Cell>
              {money.map((column, index) => (
                <Table.Summary.Cell key={column.field as string} index={index + 1} align="right">
                  <strong className={column.net ? 'kw-num kw-payrollGrid__net' : 'kw-num'}>
                    {String(totals[column.total] ?? '')}
                  </strong>
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </div>
  );
}

function toggleItems(
  options: readonly { key: Toggle; label: string }[],
  on: (key: Toggle) => boolean,
  setShown: (fn: (current: Toggle[]) => Toggle[]) => void,
) {
  return options.map((option) => ({
    key: option.key,
    label: (
      <Checkbox
        checked={on(option.key)}
        onChange={(event) =>
          setShown((current) =>
            event.target.checked ? [...current, option.key] : current.filter((key) => key !== option.key),
          )
        }
      >
        {option.label}
      </Checkbox>
    ),
  }));
}

/** "—" for a figure that was not worked out; "0.00" for one that is genuinely nil. */
function Money({
  value,
  negative,
  strong,
  net,
}: {
  value: string | null;
  negative?: boolean;
  strong?: boolean;
  net?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <Tooltip title="Not worked out — see the statutory notice above">
        <span className="kw-muted">—</span>
      </Tooltip>
    );
  }
  if (negative && Number(value) !== 0) return <span className="kw-num kw-bad">−{value}</span>;
  if (net) return <strong className="kw-num kw-payrollGrid__net">{value}</strong>;
  if (strong) return <strong className="kw-num">{value}</strong>;
  return <span className="kw-num">{value}</span>;
}

/**
 * WHETHER THIS PERSON IS READY, BESIDE THIS PERSON.
 *
 * There used to be a Payroll Readiness PAGE listing everybody who was not
 * ready, which meant leaving the register, reading a list of names, and coming
 * back to find the row again. A problem belongs next to the thing it is a
 * problem with.
 *
 * Green ready · amber worth a look · red cannot be paid safely, and the Fix
 * goes straight to the remedy for the most serious one — never to Settings for
 * somebody to hunt through.
 */
function RowStatus({ row, onFix }: { row: PayRow; onFix?: (row: PayRow) => void }): ReactNode {
  if (row.blockers > 0) {
    return (
      <span className="kw-rowStatus">
        <Tooltip title={row.reason ?? undefined}>
          <span>
            <StatusChip tone="blocked" dot>
              {row.blockers === 1 ? 'Blocked' : `${row.blockers} blockers`}
            </StatusChip>
          </span>
        </Tooltip>
        <FixButton row={row} onFix={onFix} />
      </span>
    );
  }
  if (row.warnings > 0) {
    return (
      <span className="kw-rowStatus">
        <Tooltip title={row.reason ?? undefined}>
          <span>
            <StatusChip tone="attention" dot>
              {row.warnings === 1 ? 'Check' : `${row.warnings} to check`}
            </StatusChip>
          </span>
        </Tooltip>
        <FixButton row={row} onFix={onFix} label="Review" />
      </span>
    );
  }
  return (
    <StatusChip tone="ok" dot>
      Ready
    </StatusChip>
  );
}

function FixButton({ row, onFix, label = 'Fix' }: { row: PayRow; onFix?: (row: PayRow) => void; label?: string }) {
  if (row.fixLink) {
    return (
      <Link to={row.fixLink} onClick={(event) => event.stopPropagation()} className="kw-rowStatus__fix">
        {label}
      </Link>
    );
  }
  if (!onFix) return null;
  return (
    <button
      type="button"
      className="kw-rowStatus__fix"
      onClick={(event) => {
        event.stopPropagation();
        onFix(row);
      }}
    >
      {label}
    </button>
  );
}

/**
 * THE PHONE REGISTER — one card per person.
 *
 * Four figures and a status, which is what somebody checking payroll on a
 * phone actually needs; everything else is a tap away in the drawer.
 */
function PayrollCards({
  rows,
  totals,
  onOpenEmployee,
  onFix,
}: {
  rows: PayRow[];
  totals: Totals;
  onOpenEmployee: (row: PayRow) => void;
  onFix?: (row: PayRow) => void;
}) {
  return (
    <div className="kw-payCards">
      {rows.map((row) => (
        <div className="kw-payCard" key={row.staffId}>
          <div className="kw-payCard__head">
            <PersonCell name={row.name} meta={row.position ?? undefined} size={28} />
            <RowStatus row={row} onFix={onFix} />
          </div>
          <dl className="kw-payCard__figures">
            <div>
              <dt>Gross</dt>
              <dd className="kw-num">{row.grossPay}</dd>
            </div>
            <div>
              <dt>Deductions</dt>
              <dd className="kw-num">{row.deductionTotal}</dd>
            </div>
            <div className="kw-payCard__net">
              <dt>Net</dt>
              <dd className="kw-num">{row.netPay}</dd>
            </div>
          </dl>
          <button type="button" className="kw-payCard__more" onClick={() => onOpenEmployee(row)}>
            View details
          </button>
        </div>
      ))}
      <div className="kw-payCard kw-payCard--total">
        <span>
          {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
        </span>
        <strong className="kw-num">{totals.net}</strong>
      </div>
    </div>
  );
}
