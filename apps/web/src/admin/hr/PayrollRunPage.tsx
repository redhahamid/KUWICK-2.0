import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App, Button, Grid, Modal, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, DataTableTotalRow, group, ringgit } from '../components/DataTable';
import {
  useApprovePayroll,
  useCalculatePayroll,
  usePayrollJourney,
  usePayrollVariance,
} from '../hooks/useAdmin';
import { ProvisionalBanner } from './ProvisionalBanner';
import { PayrollStepper, STEPS, type StepKey } from './PayrollStepper';
import type { PayrollJourney } from '../types';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => !/^(dr|mr|mrs|ms|puan|encik)$/i.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * THE MONTHLY PAYROLL RUN, in six steps.
 *
 * What this replaced was one dense page carrying every concept the payroll
 * engine has — exception codes, snapshot versions, verification states,
 * component liability — on the screen a clinic owner opens once a month to pay
 * five people.
 *
 * Each step answers ONE question and shows the figures that answer it. The
 * complexity has not gone anywhere; it is behind drill-downs, in Payroll
 * settings, and in the engine.
 */
export function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useSearchParams();
  const journey = usePayrollJourney(id);
  const step = (search.get('step') as StepKey) ?? 'employees';
  const stepMeta = STEPS.find((s) => s.key === step) ?? STEPS[0];
  const data = journey.data;

  const goTo = (key: StepKey) => {
    search.set('step', key);
    setSearch(search, { replace: true });
  };

  return (
    <AdminShell
      error={firstError(journey)}
      title={data ? `${stepMeta.heading} — ${data.run.periodLabel}` : 'Payroll run'}
      subtitle={stepMeta.blurb}
      actions={
        <Link to="/admin/hr/payroll">
          <Button size="small">Payroll home</Button>
        </Link>
      }
    >
      <ProvisionalBanner statutoryStatus={data?.run.statutoryStatus} />
      <PayrollStepper current={step} onChange={goTo} />

      {data ? (
        <>
          {step === 'employees' ? <EmployeesStep data={data} /> : null}
          {step === 'attendance' ? <AttendanceStep data={data} /> : null}
          {step === 'earnings' ? <EarningsStep data={data} /> : null}
          {step === 'deductions' ? <DeductionsStep data={data} /> : null}
          {step === 'review' ? <ReviewStep data={data} runId={id!} /> : null}
          {step === 'approve' ? <ApproveStep data={data} runId={id!} /> : null}
          <StepFooter data={data} step={step} onChange={goTo} runId={id!} />
        </>
      ) : null}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// STEP 1 — Employees
// ---------------------------------------------------------------------------

function EmployeesStep({ data }: { data: PayrollJourney }) {
  const { employees } = data;
  return (
    <>
      <StatStrip
        stats={[
          { label: 'Included', value: employees.included },
          { label: 'New joiners', value: employees.newJoiners },
          { label: 'Leavers', value: employees.leavers },
          {
            label: 'Needs setup',
            value: employees.needsSetup,
            tone: employees.needsSetup > 0 ? 'warn' : 'good',
          },
        ]}
      />

      <AdminSection
        title="Who is being paid this month"
        description="Everyone employed here this month. Somebody whose setup is not finished is left out of the totals rather than paid a figure nobody chose."
      >
        <DataTable
          rowKey="staffId"
          rows={employees.rows}
          emptyText="No employees are on this run."
          columns={[
            {
              title: 'Employee',
              render: (_: unknown, row: PayrollJourney['employees']['rows'][number]) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.name}</div>
                  <div className="kw-muted" style={{ fontSize: 11.5 }}>
                    {[row.position, row.employerName].filter(Boolean).join(' · ')}
                  </div>
                  {row.reason ? (
                    <div className="kw-provenance" style={{ marginTop: 3 }}>
                      {row.reason}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: 'Started',
              dataIndex: 'startDate',
              width: 120,
              render: (value: string | null) => (value ? dayjs(value).format('D MMM YYYY') : '—'),
            },
            {
              title: 'State',
              width: 170,
              render: (_: unknown, row: PayrollJourney['employees']['rows'][number]) =>
                row.state === 'READY' ? (
                  <Tag color="success">Ready</Tag>
                ) : row.state === 'NEEDS_ATTENTION' ? (
                  <Tag color="warning">Needs attention</Tag>
                ) : (
                  <Tag color="warning">Needs setup</Tag>
                ),
            },
            {
              title: '',
              width: 130,
              noExport: true,
              render: (_: unknown, row: PayrollJourney['employees']['rows'][number]) =>
                row.state === 'READY' ? null : (
                  <Link to={`/admin/hr/employees?staffId=${row.staffId}`}>
                    <Button size="small">Complete setup</Button>
                  </Link>
                ),
            },
          ]}
        />
      </AdminSection>

      {employees.contractors.length > 0 ? (
        <AdminNotice tone="info">
          {employees.contractors.map((c) => c.name).join(', ')}{' '}
          {employees.contractors.length === 1 ? 'is' : 'are'} engaged as contractors, so their sessions are paid as
          professional fees rather than payrolled. No EPF, SOCSO or EIS is contributed for them.{' '}
          <Link to="/admin/hr/locum">Open locum sessions</Link>
        </AdminNotice>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// STEP 2 — Attendance & leave
// ---------------------------------------------------------------------------

function AttendanceStep({ data }: { data: PayrollJourney }) {
  const { attendance } = data;
  return (
    <>
      <StatStrip
        stats={[
          { label: 'Working days', value: attendance.totalDaysWorked, hint: `across ${attendance.rows.length} people` },
          {
            label: 'Approved overtime',
            value: `${attendance.totalApprovedOvertimeHours} hrs`,
            hint: 'will be paid',
          },
          {
            label: 'Unapproved overtime',
            value: `${attendance.totalUnapprovedOvertimeHours} hrs`,
            hint: 'will NOT be paid',
            tone: attendance.totalUnapprovedOvertimeHours > 0 ? 'warn' : 'neutral',
          },
          {
            label: 'Unpaid leave',
            value: `${attendance.totalUnpaidLeaveDays} days`,
            hint: 'reduces pay',
            tone: attendance.totalUnpaidLeaveDays > 0 ? 'warn' : 'neutral',
          },
          {
            label: 'Missing punches',
            value: attendance.totalMissingPunchDays,
            hint: 'days with no clock-out',
            tone: attendance.totalMissingPunchDays > 0 ? 'warn' : 'neutral',
          },
        ]}
      />

      <AdminNotice tone="info">
        These figures come from the roster and the timesheet. Correct them there and this step follows — payroll never
        holds a second copy of somebody's hours. <Link to="/admin/hr/attendance">Open the timesheet</Link>
      </AdminNotice>

      <AdminSection title="What people worked">
        <DataTable
          rowKey="staffId"
          rows={attendance.rows}
          emptyText="No attendance recorded for this month."
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            { title: 'Days worked', dataIndex: 'daysWorked', width: 120, align: 'right' as const },
            {
              title: 'Overtime',
              width: 210,
              render: (_: unknown, row: PayrollJourney['attendance']['rows'][number]) => (
                <div>
                  {row.approvedOvertimeHours > 0 ? `${row.approvedOvertimeHours} hrs approved` : '—'}
                  {row.unapprovedOvertimeHours > 0 ? (
                    <div className="kw-provenance" style={{ color: '#b45309' }}>
                      {row.unapprovedOvertimeHours} hrs waiting for approval — will not be paid
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: 'Unpaid leave',
              width: 240,
              render: (_: unknown, row: PayrollJourney['attendance']['rows'][number]) =>
                row.unpaidLeaveDays > 0 ? (
                  <div>
                    <strong>
                      {row.unpaidLeaveDays} day{row.unpaidLeaveDays === 1 ? '' : 's'}
                    </strong>{' '}
                    will reduce this month's pay
                    {row.unpaidLeaveRequests.map((request) => (
                      <div key={request.id} className="kw-provenance">
                        {dayjs(request.from).format('D MMM')}–{dayjs(request.to).format('D MMM')}
                        {request.approvedBy ? `, approved by ${request.approvedBy}` : ''}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="kw-muted">—</span>
                ),
            },
            {
              title: '',
              width: 130,
              noExport: true,
              render: (_: unknown, row: PayrollJourney['attendance']['rows'][number]) =>
                row.unapprovedOvertimeHours > 0 || row.missingPunchDays > 0 ? (
                  <Link to={`/admin/hr/attendance?staffId=${row.staffId}`}>
                    <Button size="small">Open timesheet</Button>
                  </Link>
                ) : null,
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// STEP 3 — Earnings
// ---------------------------------------------------------------------------

/**
 * THE EARNINGS COLUMNS COME FROM THE PAYSLIP, NOT FROM A RE-DERIVATION.
 *
 * Two versions of this table were wrong in the same way. The first showed only
 * Salary, Overtime and Incentive, so an employee with a fixed allowance had a
 * row whose visible figures did not reach its own total — RM3,200 plus RM98.48
 * arriving at RM3,548.48, with the missing RM250 nowhere on the screen. The
 * second built the columns from the materialised input rows while the total
 * still came from the payroll line, so any run those rows did not fully explain
 * — a seeded one, an imported one — showed columns totalling nothing beside a
 * five-figure gross.
 *
 * Both are the defect the run's own invariants exist to catch, committed by the
 * UI instead of the engine. So the columns are the payslip's own fields, and
 * the last addition column is a RESIDUAL: whatever gross is that the named
 * columns have not accounted for. The row cannot fail to add up, and anything
 * unexpected shows up as a number in a column called "Other" rather than
 * silently vanishing.
 */
const EARNING_CODES = new Set([
  'BASIC', 'ALLOWANCE', 'ATTENDANCE_ALLOWANCE', 'OVERTIME', 'INCENTIVE',
  'COMMISSION', 'BONUS', 'MILEAGE', 'CLAIM_REIMBURSEMENT',
]);

// `allowances` on the payload is a formatted string; here it is a number, so
// the payload's version is dropped rather than shadowed.
type EarningRow = Omit<PayrollJourney['pay']['rows'][number], 'allowances'> & {
  /** Basic pay less any unpaid leave — what the month's salary actually is. */
  salaryEarned: number;
  allowances: number;
  overtime: number;
  incentive: number;
  /** Gross the named columns do not account for: claims, bonuses, anything new. */
  other: number;
  unpaid: number;
  gross: number;
};

function toEarningRows(rows: PayrollJourney['pay']['rows']): EarningRow[] {
  return rows.map((row) => {
    const unpaid = Number(row.unpaidLeaveDeduction);
    const salaryEarned = Number(row.basicSalary) - unpaid;
    const allowances = Number(row.allowances);
    const overtime = Number(row.overtimePay);
    const incentive = Number(row.incentives) + Number(row.bonus);
    const gross = Number(row.grossPay);
    // Rounded to the sen: these are two-decimal strings from the API, and a
    // residual of 0.0000000001 would render as a column of RM0.00 that is not
    // really there.
    const other = Math.round((gross - salaryEarned - allowances - overtime - incentive) * 100) / 100;
    return { ...row, salaryEarned, allowances, overtime, incentive, other, unpaid, gross };
  });
}

function EarningsStep({ data }: { data: PayrollJourney }) {
  const rows = useMemo(() => toEarningRows(data.pay.rows), [data.pay.rows]);
  const sum = (pick: (row: EarningRow) => number) =>
    Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;
  const totals = {
    salary: sum((row) => row.salaryEarned),
    allowances: sum((row) => row.allowances),
    overtime: sum((row) => row.overtime),
    incentive: sum((row) => row.incentive),
    other: sum((row) => row.other),
    unpaid: sum((row) => row.unpaid),
    gross: sum((row) => row.gross),
  };
  const additions = Math.round((totals.allowances + totals.overtime + totals.incentive + totals.other) * 100) / 100;

  const amountColumn = (title: string, pick: (row: EarningRow) => number) => ({
    title,
    width: 125,
    align: 'right' as const,
    render: (_: unknown, row: EarningRow) => {
      const value = pick(row);
      return value !== 0 ? ringgit(value.toFixed(2)) : <span className="kw-muted">—</span>;
    },
  });

  return (
    <>
      <StatStrip
        stats={[
          { label: 'Total earnings', value: ringgit(totals.gross.toFixed(2)) },
          { label: 'Salary earned', value: ringgit(totals.salary.toFixed(2)), hint: 'after unpaid leave' },
          {
            label: 'Additions',
            value: ringgit(additions.toFixed(2)),
            hint: 'allowances, overtime, incentives, claims',
          },
          {
            label: 'Unpaid leave',
            value: `−${ringgit(totals.unpaid.toFixed(2))}`,
            tone: totals.unpaid > 0 ? 'warn' : 'neutral',
          },
        ]}
      />

      <AdminSection
        title="What each person earns this month"
        description="Open a row to see where every figure came from. A figure that came from the timesheet, a leave record, an incentive run or a claim is corrected there, not here."
      >
        <DataTable<EarningRow>
          rowKey="staffId"
          rows={rows}
          emptyText="Nothing has been calculated yet."
          expandable={{
            expandedRowRender: (row: EarningRow) => (
              <ItemBreakdown items={row.items.filter((item) => EARNING_CODES.has(item.componentCode))} name={row.name} />
            ),
          }}
          summary={(shown) => {
            const s = shown as readonly EarningRow[];
            const total = (pick: (row: EarningRow) => number) =>
              ringgit((Math.round(s.reduce((t, row) => t + pick(row), 0) * 100) / 100).toFixed(2));
            return (
              <DataTableTotalRow
                cells={[
                  // The expand-icon column has no header but does have a cell,
                  // so the totals row starts one to its left or every figure
                  // lands under the wrong heading.
                  { value: '', colSpan: 1, align: 'left' },
                  { value: `${s.length} employee${s.length === 1 ? '' : 's'}`, align: 'left' },
                  { value: total((row) => row.salaryEarned) },
                  { value: total((row) => row.allowances) },
                  { value: total((row) => row.overtime) },
                  { value: total((row) => row.incentive) },
                  { value: total((row) => row.other) },
                  { value: total((row) => row.gross), strong: true },
                ]}
              />
            );
          }}
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            {
              title: 'Salary earned',
              width: 165,
              align: 'right' as const,
              render: (_: unknown, row: EarningRow) => (
                <div>
                  {ringgit(row.salaryEarned.toFixed(2))}
                  {row.unpaid > 0 ? (
                    <div className="kw-provenance" style={{ color: '#b42318' }}>
                      {ringgit(Number(row.basicSalary).toFixed(2))} less {ringgit(row.unpaid.toFixed(2))} unpaid leave
                    </div>
                  ) : null}
                </div>
              ),
            },
            amountColumn('Allowances', (row) => row.allowances),
            amountColumn('Overtime', (row) => row.overtime),
            amountColumn('Incentive', (row) => row.incentive),
            amountColumn('Claims & other', (row) => row.other),
            {
              title: 'Earnings',
              width: 145,
              align: 'right' as const,
              render: (_: unknown, row: EarningRow) => <strong>{ringgit(row.gross.toFixed(2))}</strong>,
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

/**
 * WHERE EVERY FIGURE CAME FROM.
 *
 * A derived figure shows the sentence the materialiser wrote when it carried
 * the upstream fact into this period, and is not editable here. Correcting it
 * means correcting the timesheet, the leave record or the claim — editing the
 * derived amount instead would make the payslip and its own source disagree.
 */
function ItemBreakdown({ items, name }: { items: PayrollJourney['pay']['rows'][number]['items']; name: string }) {
  if (items.length === 0) return <p className="kw-muted">Nothing beyond basic pay for {name} this month.</p>;
  return (
    <div className="kw-breakdown">
      {items.map((item) => (
        <div key={item.id} className="kw-breakdown__row">
          <div className="kw-breakdown__label">
            {item.label}
            {item.provenance ? <div className="kw-provenance">{item.provenance}</div> : null}
            {!item.editable ? (
              <div className="kw-provenance">Corrected where it was recorded, not here.</div>
            ) : null}
          </div>
          <div className="kw-breakdown__amount">{ringgit(item.amount)}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STEP 4 — Deductions
// ---------------------------------------------------------------------------

function DeductionsStep({ data }: { data: PayrollJourney }) {
  const rows = data.pay.rows;
  const pcbMissing = rows.filter((row) => row.pcb === null).length;
  const statutoryTotal = rows.reduce((sum, row) => sum + Number(row.statutoryEmployee ?? 0), 0);
  const pcbTotal = rows.reduce((sum, row) => sum + Number(row.pcb ?? 0), 0);
  const deductionTotal = Number(data.run.deductionTotal);

  return (
    <>
      <StatStrip
        stats={[
          { label: 'Total deductions', value: ringgit(deductionTotal.toFixed(2)) },
          { label: 'Statutory', value: ringgit(statutoryTotal.toFixed(2)), hint: 'EPF, SOCSO, EIS' },
          {
            label: 'Monthly tax (PCB)',
            value: pcbMissing > 0 ? `${pcbMissing} missing` : ringgit(pcbTotal.toFixed(2)),
            hint: 'entered by hand',
            tone: pcbMissing > 0 ? 'bad' : 'neutral',
          },
          {
            label: 'Other',
            value: ringgit((deductionTotal - statutoryTotal - pcbTotal).toFixed(2)),
            hint: 'unpaid leave, advances',
          },
        ]}
      />

      {pcbMissing > 0 ? (
        <AdminNotice tone="warn">
          <strong>Kuwick does not work out monthly tax for you.</strong> PCB has to be entered for each employee who
          pays it — from your accountant, or from LHDN's own calculator. {pcbMissing} person
          {pcbMissing === 1 ? '' : 's'} still {pcbMissing === 1 ? 'needs' : 'need'} a figure, and the run cannot be
          finished without {pcbMissing === 1 ? 'it' : 'them'}.
        </AdminNotice>
      ) : null}

      <AdminSection title="What comes off each person's pay">
        <DataTable
          rowKey="staffId"
          rows={rows}
          emptyText="Nothing has been calculated yet."
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            {
              title: 'EPF · SOCSO · EIS',
              width: 170,
              align: 'right' as const,
              render: (_: unknown, row: PayrollJourney['pay']['rows'][number]) =>
                row.statutoryEmployee === null ? (
                  <Tooltip title="No statutory rates are configured for this period, so these are blank rather than zero.">
                    <span className="kw-muted">Not calculated</span>
                  </Tooltip>
                ) : (
                  ringgit(row.statutoryEmployee)
                ),
            },
            {
              title: 'Monthly tax',
              width: 150,
              align: 'right' as const,
              render: (_: unknown, row: PayrollJourney['pay']['rows'][number]) =>
                row.pcb === null ? (
                  <span style={{ color: '#b45309', fontWeight: 600 }}>Not entered</span>
                ) : (
                  ringgit(row.pcb)
                ),
            },
            {
              title: 'Unpaid leave',
              dataIndex: 'unpaidLeaveDeduction',
              width: 140,
              align: 'right' as const,
              render: (value: string) => (Number(value) > 0 ? ringgit(value) : <span className="kw-muted">—</span>),
            },
            {
              title: 'Take-home',
              dataIndex: 'netPay',
              width: 140,
              align: 'right' as const,
              render: (value: string) => <strong>{ringgit(value)}</strong>,
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// STEP 5 — Review. The primary owner control screen.
// ---------------------------------------------------------------------------

function ReviewStep({ data, runId }: { data: PayrollJourney; runId: string }) {
  const variance = usePayrollVariance(runId);
  const attention = data.review.attention.filter((item) => item.severity !== 'INFO');
  const [whole, cents] = data.run.netTotal.split('.');

  return (
    <>
      <div className="kw-reviewFigures">
        <div className="kw-reviewFigure">
          <div className="kw-reviewFigure__label">TAKE-HOME PAY</div>
          <div className="kw-reviewFigure__value">
            RM{group(whole)}
            <span className="kw-reviewFigure__cents">.{cents}</span>
          </div>
          <div className="kw-reviewFigure__hint">
            What leaves the clinic to your staff
            {data.run.paymentDate ? ` on ${dayjs(data.run.paymentDate).format('D MMMM')}` : ''}.
          </div>
        </div>
        <div className="kw-reviewFigure">
          <div className="kw-reviewFigure__label">EMPLOYEES</div>
          <div className="kw-reviewFigure__value">{data.run.employeeCount}</div>
          <div className="kw-reviewFigure__hint">
            {data.employees.needsSetup > 0
              ? `${data.employees.needsSetup} more not ready to be paid.`
              : 'Everyone employed here this month.'}
          </div>
        </div>
        <div className="kw-reviewFigure">
          <div className="kw-reviewFigure__label">TOTAL COST TO THE CLINIC</div>
          <div className="kw-reviewFigure__value">
            RM{group(data.run.employerCostTotal.split('.')[0])}
            <span className="kw-reviewFigure__cents">.{data.run.employerCostTotal.split('.')[1]}</span>
          </div>
          <div className="kw-reviewFigure__hint">Pay plus the clinic's own EPF, SOCSO and EIS.</div>
        </div>
      </div>

      <AdminSection
        title="Needs attention"
        actions={
          <span className="kw-muted" style={{ fontSize: 12.5 }}>
            {data.review.mustFix > 0
              ? `${data.review.mustFix} must be sorted before this run can be finished`
              : 'Nothing is stopping this run'}
          </span>
        }
      >
        {attention.length === 0 ? (
          <p className="kw-muted" style={{ margin: 0 }}>
            Nothing needs your attention this month.
          </p>
        ) : (
          attention.map((item) => (
            <div
              key={item.id}
              className={`kw-attention${item.blocksApproval ? ' kw-attention--blocking' : ''}`}
            >
              <div className="kw-attention__avatar">{item.name ? initials(item.name) : '!'}</div>
              <div className="kw-attention__body">
                <div className="kw-attention__what">
                  {item.name ? `${item.name} — ` : ''}
                  {item.what}
                </div>
                <div className="kw-attention__why">{item.why}</div>
                <div className="kw-attention__todo">
                  <strong>What to do:</strong> {item.whatToDo}
                  {!item.blocksApproval ? ' This does not block the run.' : ''}
                </div>
              </div>
              <div>
                {item.link ? (
                  <Link to={item.link}>
                    <Button type={item.blocksApproval ? 'primary' : 'default'} size="small">
                      Fix
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
          ))
        )}
      </AdminSection>

      <AdminSection
        title="Take-home pay, person by person"
        description={
          variance.data?.rows?.length
            ? 'Compared with the previous period. A movement is the difference between the two, never a separately worked-out figure.'
            : undefined
        }
      >
        <DataTable
          rowKey="staffId"
          rows={data.pay.rows}
          emptyText="Nothing has been calculated yet."
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            {
              title: 'Take-home',
              dataIndex: 'netPay',
              width: 160,
              align: 'right' as const,
              render: (value: string) => <strong>{ringgit(value)}</strong>,
            },
            {
              title: 'vs last period',
              width: 160,
              align: 'right' as const,
              render: (_: unknown, row: PayrollJourney['pay']['rows'][number]) => {
                // THE MOVEMENT IS A SUBTRACTION the API already did. Recomputing
                // it here from two numbers on screen is how a comparison month
                // ends up carrying the current month's totals.
                const line = variance.data?.rows?.find((v) => v.staffId === row.staffId);
                if (!line || line.deltaCents === null) return <span className="kw-muted">—</span>;
                if (line.deltaCents === 0) return <span className="kw-muted">no change</span>;
                return (
                  <span style={{ color: line.deltaCents > 0 ? '#166534' : '#b42318' }}>
                    {line.deltaCents > 0 ? '+' : '−'}{ringgit((Math.abs(line.deltaCents) / 100).toFixed(2))}
                  </span>
                );
              },
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// STEP 6 — Approve & finalise
// ---------------------------------------------------------------------------

function ApproveStep({ data, runId }: { data: PayrollJourney; runId: string }) {
  const { message } = App.useApp();
  const approve = useApprovePayroll();
  /**
   * NO FINALISING FROM A PHONE.
   *
   * Not a layout decision. Finalising locks a month's pay for everybody, and the
   * evidence somebody needs to be sure — the person-by-person figures, the
   * comparison with last month, the full list of what is outstanding — does not
   * fit on a phone in a form anybody actually reads. A screen that lets an
   * irreversible decision be made on the evidence it can show is worse than one
   * that declines to.
   *
   * Everything else is available here: the totals, the checklist, what is
   * blocking, and who to chase.
   */
  const screens = Grid.useBreakpoint();
  const canFinaliseHere = screens.md ?? true;
  const gate = data.review.gate;
  const blockers = data.review.attention.filter((item) => item.blocksApproval);
  const warnings = data.review.attention.filter((item) => !item.blocksApproval && item.severity === 'WARNING');
  const provisional = data.run.statutoryStatus !== 'CONFIGURED';
  const alreadyApproved = data.run.status === 'APPROVED' || data.run.status === 'PAID';

  const checks = [
    {
      key: 'salary',
      title: 'Everyone has a salary on file',
      ok: !blockers.some((b) => b.code === 'NO_SALARY' || b.code === 'SALARY_CHANGED_MID_PERIOD'),
      // NAME THE PERSON. "No salary is in force for this period" without a name
      // is a blocker the owner cannot act on without going to look for who.
      detail:
        blockers
          .filter((b) => b.code === 'NO_SALARY' || b.code === 'SALARY_CHANGED_MID_PERIOD')
          .map((b) => [b.name, b.what].filter(Boolean).join(' — '))
          .join(' ') || `All ${data.run.employeeCount} employees.`,
    },
    {
      key: 'attendance',
      title: 'Attendance and leave are settled',
      ok: !warnings.some((w) => w.code === 'UNAPPROVED_OVERTIME' || w.code === 'MISSING_PUNCH'),
      warnOnly: true,
      detail:
        warnings
          .filter((w) => w.code === 'UNAPPROVED_OVERTIME' || w.code === 'MISSING_PUNCH')
          .map((w) => [w.name, w.what].filter(Boolean).join(' — '))
          .join(' ') || 'Nothing is waiting on a manager.',
    },
    {
      key: 'pcb',
      title: 'Monthly tax entered for everyone who pays it',
      ok: !blockers.some((b) => b.code === 'PCB_MISSING'),
      detail:
        blockers.filter((b) => b.code === 'PCB_MISSING').map((b) => b.name).filter(Boolean).join(', ') ||
        'Every employee who pays PCB has a figure.',
    },
  ];

  return (
    <div className="kw-approveGrid">
      <div>
        <AdminSection title="You are about to finalise">
          <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.018em' }}>
            {data.run.periodLabel} payroll
          </div>
          <div className="kw-muted" style={{ marginTop: 3 }}>
            {data.run.clinicName} · {data.run.employeeCount} employee
            {data.run.employeeCount === 1 ? '' : 's'}
            {data.run.paymentDate ? ` · pay day ${dayjs(data.run.paymentDate).format('dddd D MMMM')}` : ''}
          </div>

          <StatStrip
            stats={[
              { label: 'Take-home pay', value: ringgit(data.run.netTotal) },
              { label: 'Deductions', value: ringgit(data.run.deductionTotal) },
              { label: 'Cost to clinic', value: ringgit(data.run.employerCostTotal) },
            ]}
          />

          <div style={{ fontWeight: 650, fontSize: 12.5, marginTop: 12 }}>Before this can be finalised</div>
          {checks.map((check) => (
            <div key={check.key} className="kw-approveCheck">
              <span
                className={`kw-approveCheck__mark kw-approveCheck__mark--${
                  check.ok ? 'ok' : check.warnOnly ? 'warn' : 'bad'
                }`}
              >
                {check.ok ? '✓' : check.warnOnly ? '!' : '×'}
              </span>
              <div>
                <div
                  className="kw-approveCheck__title"
                  style={{ color: check.ok ? undefined : check.warnOnly ? '#b45309' : '#b42318' }}
                >
                  {check.title}
                </div>
                <div className="kw-approveCheck__detail">
                  {check.detail}
                  {!check.ok && check.warnOnly ? ' This does not block the run.' : ''}
                </div>
              </div>
            </div>
          ))}
        </AdminSection>

        <AdminSection title="What finalising does">
          <ul className="kw-plainList">
            <li>
              <strong>Locks the figures.</strong> A correction afterwards is a recorded adjustment, never a quiet edit.
            </li>
            <li>
              <strong>Prepares payslips.</strong> One per employee.
            </li>
            <li>
              <strong>Posts the cost to Finance.</strong> Employer cost and the statutory you owe.
            </li>
            <li className="kw-muted">
              <strong>Bank payment file and statutory files are not available yet.</strong> They are generated once the
              statutory rates have been checked. Kuwick will not produce a file it cannot stand behind.
            </li>
          </ul>
        </AdminSection>
      </div>

      <div>
        {provisional ? (
          <div className="kw-approveWarn">
            <div className="kw-approveWarn__title">This clinic is not live yet</div>
            <p>
              Kuwick's statutory rates have not yet been checked against KWSP, PERKESO and LHDN's own published tables.
              Until they are, a finalised run is a working figure — not something to pay staff with, and not something
              to file.
            </p>
            <Link to="/admin/hr/settings">What is still outstanding</Link>
          </div>
        ) : null}

        <AdminSection title="Finalise">
          {!canFinaliseHere && !alreadyApproved ? (
            <AdminNotice tone="info">
              <strong>Finalising is done on a computer.</strong> Locking a month's pay for everybody needs the whole
              run in front of you — the figures person by person, the comparison with last month, and everything
              outstanding. You can review all of it here and clear what is blocking; finalise from a desktop.
            </AdminNotice>
          ) : alreadyApproved ? (
            <p style={{ margin: 0 }}>
              This run was approved{data.run.status === 'PAID' ? ' and paid' : ''}.{' '}
              {provisional ? (
                <Tag color="warning">Provisional</Tag>
              ) : (
                <Tag color="success">Approved</Tag>
              )}
            </p>
          ) : (
            <>
              <p className="kw-muted" style={{ marginTop: 0 }}>
                {gate.canApprove
                  ? gate.reason
                  : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted first. Kuwick will not finalise a run it cannot compute.`}
              </p>
              <Button
                type="primary"
                block
                disabled={!gate.canApprove}
                loading={approve.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: `Finalise ${data.run.periodLabel} payroll?`,
                    content: provisional
                      ? 'The statutory rates behind these figures have not been verified. This run will be locked and marked PROVISIONAL — it must not be used to pay staff or file a return.'
                      : 'The figures will be locked. A correction afterwards is a recorded adjustment.',
                    okText: 'Finalise',
                    onOk: () =>
                      new Promise<void>((resolve, reject) => {
                        approve.mutate(
                          { id: runId, acknowledgeStatutoryGap: provisional },
                          {
                            onSuccess: () => {
                              message.success('Payroll finalised');
                              resolve();
                            },
                            onError: (error: Error) => {
                              message.error(error.message);
                              reject();
                            },
                          },
                        );
                      }),
                  })
                }
              >
                Finalise {data.run.periodLabel} payroll
              </Button>
              {!gate.canApprove ? (
                <div className="kw-muted" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                  Locked until the {gate.blocking} item{gate.blocking === 1 ? '' : 's'} {gate.blocking === 1 ? 'is' : 'are'} sorted
                </div>
              ) : null}
            </>
          )}
        </AdminSection>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StepFooter({
  data,
  step,
  onChange,
  runId,
}: {
  data: PayrollJourney;
  step: StepKey;
  onChange: (key: StepKey) => void;
  runId: string;
}) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const calculate = useCalculatePayroll();
  const index = STEPS.findIndex((s) => s.key === step);
  const next = STEPS[index + 1];
  const previous = STEPS[index - 1];
  const mustFix = data.review.mustFix;

  return (
    <div className="kw-stepFoot">
      {previous ? (
        <Button onClick={() => onChange(previous.key)}>Back</Button>
      ) : (
        <Button onClick={() => navigate('/admin/hr/payroll')}>Cancel</Button>
      )}
      {mustFix > 0 ? (
        <span className="kw-stepFoot__note">
          {mustFix} item{mustFix === 1 ? '' : 's'} must be sorted before this run can be finished
        </span>
      ) : null}
      <span className="kw-stepFoot__spacer" />
      {step === 'attendance' || step === 'earnings' || step === 'deductions' ? (
        <Button
          loading={calculate.isPending}
          onClick={() =>
            calculate.mutate(runId, {
              onSuccess: () => message.success('Recalculated'),
              onError: (error: Error) => message.error(error.message),
            })
          }
        >
          Recalculate
        </Button>
      ) : null}
      {next ? (
        <Button type="primary" onClick={() => onChange(next.key)}>
          Continue to {next.label.toLowerCase()}
        </Button>
      ) : null}
    </div>
  );
}
