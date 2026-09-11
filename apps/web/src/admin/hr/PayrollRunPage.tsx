import { useMemo, useState, type ReactNode } from 'react';
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
import { PayrollStepper, STEPS, normaliseStep, stepsWithProblems, type StepKey } from './PayrollStepper';
import { PayrollMonthHeader } from './PayrollMonthHeader';
import { PayrollGrid } from './PayrollGrid';
import { PayrollEmployeeDrawer } from './PayrollEmployeeDrawer';
import { PayrollExceptionCentre } from './PayrollExceptionCentre';
import { PayrollInputsDrawer } from './PayrollInputsDrawer';
import { PayslipsPanel } from './PayslipsPanel';
import { PaymentPanel } from './PaymentPanel';
import { StatutoryOutputsPanel } from './StatutoryOutputsPanel';
import { useCan } from '../../core/hooks/useCan';
import { PersonCell } from '../components/Person';
import { StatusChip, humanise } from '../components/Chip';
import { Panel } from '../components/Panel';
import type { PayrollJourney } from '../types';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => !/^(dr|mr|mrs|ms|puan|encik)$/i.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * THE MONTH'S PAYROLL WORKSPACE.
 *
 * What this replaced was one dense page carrying every concept the payroll
 * engine has — exception codes, snapshot versions, verification states,
 * component liability — on the screen a clinic owner opens once a month to pay
 * five people.
 *
 * MOUNTED BY TWO ROUTES, deliberately. `/admin/hr/payroll` resolves the
 * current month and mounts this directly, so opening payroll opens the month's
 * work rather than a page about payroll; `/admin/hr/payroll/:id` mounts the
 * same thing by run id, so every existing link, exception remedy and bookmark
 * still lands where it always did. One workspace, not two implementations that
 * drift.
 *
 * `monthNav` is the month selector and History control, passed in by whichever
 * route can meaningfully offer them — the month page can move between months,
 * a direct run link cannot.
 */
export function PayrollWorkspace({ runId, monthNav }: { runId: string; monthNav?: ReactNode }) {
  const id = runId;
  const [search, setSearch] = useSearchParams();
  const journey = usePayrollJourney(id);
  // Old six-step links still resolve — see normaliseStep.
  const step = normaliseStep(search.get('step'));
  const data = journey.data;
  const mayApprove = useCan('hr.payroll.approve');
  const mayRun = useCan('hr.payroll.run');

  // The inputs drawer, hosted here so the exception centre's "Enter it now"
  // opens on this screen, for this employee, instead of routing away.
  const [inputsOpen, setInputsOpen] = useState(false);
  const [inputsStaff, setInputsStaff] = useState<{ id: string; name: string | null } | null>(null);
  const locked = data?.run.status === 'APPROVED' || data?.run.status === 'PAID';

  const goTo = (key: StepKey) => {
    search.set('step', key);
    setSearch(search, { replace: true });
  };
  const onFixInputs = (staffId: string, staffName: string | null) => {
    setInputsStaff({ id: staffId, name: staffName });
    setInputsOpen(true);
  };

  return (
    <AdminShell error={firstError(journey)} title="Payroll">
      {/*
        * THE MONTH FIRST, then how far through it you are.
        *
        * The page title used to be the STAGE ("What needs looking at —
        * September 2026") with a sentence under it explaining the stage. Both
        * are gone: the stage bar below already says which stage you are on,
        * and an owner opening payroll wants the month's figures, not a
        * paragraph about the screen they are on.
        */}
      {data ? (
        <PayrollMonthHeader
          periodLabel={data.run.periodLabel}
          status={data.run.status}
          provisional={data.run.statutoryStatus !== 'CONFIGURED'}
          employees={data.run.employeeCount}
          gross={data.pay.totals.gross}
          deductions={data.pay.totals.deductions}
          employerContributions={data.pay.totals.employerContributions}
          net={data.pay.totals.net}
          notCalculated={data.pay.totals.statutoryNotCalculated}
          right={monthNav}
        />
      ) : null}
      <ProvisionalBanner statutoryStatus={data?.run.statutoryStatus} />
      {/*
        * A TICK MEANS SETTLED. The stepper reads the SAME exception rows the
        * Review screen lists, so a step holding a blocker cannot show a green
        * tick on one screen and a blocker on the next.
        */}
      <PayrollStepper
        current={step}
        onChange={goTo}
        problemSteps={data ? stepsWithProblems(data.review.attention) : undefined}
        status={data?.run.status}
        canApprove={data?.review.gate.canApprove}
      />

      {data ? (
        <>
          {/*
            * PAYROLL DETAILS — the register, and under it who is being paid
            * and what they worked.
            *
            * The register leads because it is the answer to the owner's actual
            * question. What used to be four separate reading steps — Employees,
            * Attendance, Earnings, Deductions — is one stage plus one drawer:
            * the two context tables stay here because they carry facts the
            * register cannot (who was left out and why, whose overtime is
            * unapproved), and every money breakdown moved into the drawer,
            * beside the figure it explains.
            */}
          {step === 'prepare' ? (
            <>
              <RunGridSection data={data} onFixInputs={onFixInputs} canEdit={mayRun && !locked} />
              <EmployeesStep data={data} />
              <AttendanceStep data={data} />
            </>
          ) : null}

          {/* REVIEW — blockers, then warnings, then what the month adds up to. */}
          {step === 'review' ? (
            <ReviewStep data={data} runId={id!} mayApprove={mayApprove} onFixInputs={onFixInputs} onGoTo={goTo} />
          ) : null}

          {step === 'approve' ? <ApproveStep data={data} runId={id!} /> : null}
          {step === 'complete' ? <FinaliseStep data={data} runId={id!} /> : null}
          <StepFooter data={data} step={step} onChange={goTo} runId={id!} />
          <PayrollInputsDrawer
            open={inputsOpen}
            onClose={() => setInputsOpen(false)}
            period={`${data.run.period}-01`}
            staffId={inputsStaff?.id}
            staffName={inputsStaff?.name ?? undefined}
            canEdit={mayRun && !locked}
          />
        </>
      ) : null}
    </AdminShell>
  );
}

/**
 * `/admin/hr/payroll/:id` — one run, by id.
 *
 * Kept because links to a specific run are everywhere: exception remedies, the
 * history table, the guide, and whatever anybody has bookmarked. It offers no
 * month selector, because a link to a run is a link to THAT run — moving month
 * from here would silently take somebody somewhere they did not ask to go.
 */
export function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  return <PayrollWorkspace runId={id!} />;
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
// STAGE 2 — Review. The primary owner control screen.
// ---------------------------------------------------------------------------

type PayRow = PayrollJourney['pay']['rows'][number];

/**
 * REVIEW — blockers, then warnings, then what the month adds up to.
 *
 * The reference sheet's hierarchy, and it is the correction this screen most
 * needed. Every exception used to be rendered at the same weight in one list:
 * a missing monthly-tax figure that stops the run and an unapproved hour of
 * overtime that does not, drawn identically, sorted only by severity. A
 * warning is not a blocker, and a screen that draws them the same way teaches
 * people to skim both.
 *
 * BLOCKERS is a section with a count and a red edge; WARNINGS is amber and
 * collapsible-by-eye; PAYROLL SUMMARY is where the money is. The last thing on
 * the page is the one button that moves the month forward, and it says why it
 * is disabled when it is.
 */
function ReviewStep({
  data,
  runId,
  mayApprove,
  onFixInputs,
  onGoTo,
}: {
  data: PayrollJourney;
  runId: string;
  mayApprove: boolean;
  onFixInputs: (staffId: string, staffName: string | null) => void;
  onGoTo: (key: StepKey) => void;
}) {
  const totals = data.pay.totals;
  const gate = data.review.gate;

  /*
   * COUNTS OF PEOPLE, AND THEY HAVE TO ADD UP.
   *
   * This read "10 employees · 7 ready · 4 blockers · 2 warnings", which
   * invites the arithmetic 7 + 4 = 11 and does not resolve. Three different
   * populations were in one strip: rows in the run, exception ROWS (one of
   * them about somebody with no row at all), and people — and two of the
   * warned employees were also blocked, so nothing partitioned anything.
   *
   * Ready and Blocked now partition the run exactly, and the person the run
   * left out gets a count of their own instead of hiding inside a blocker
   * tally. Warnings are named in their own section below, where the overlap
   * with a blocker does not have to be resolved in a single number.
   */
  const blocked = data.pay.rows.filter((row) => row.blockers > 0).length;
  const ready = data.pay.rows.length - blocked;
  const leftOut = data.employees.needsSetup;

  return (
    <>
      <StatStrip
        stats={[
          { label: 'In this run', value: data.pay.rows.length },
          { label: 'Ready', value: ready, tone: ready === data.pay.rows.length ? 'good' : 'neutral' },
          {
            label: 'Blocked',
            value: blocked,
            tone: blocked > 0 ? 'bad' : 'good',
          },
          {
            label: 'Not in this run',
            value: leftOut,
            tone: leftOut > 0 ? 'warn' : 'good',
            hint: leftOut > 0 ? 'No salary on record' : undefined,
          },
        ]}
      />

      <PayrollExceptionCentre runId={runId} canOverride={mayApprove} onFixInputs={onFixInputs} />

      {/*
        * WHAT THE MONTH ADDS UP TO — and nothing else.
        *
        * This section used to carry a second person-by-person table: every
        * employee's gross, deductions and take-home, with a movement column,
        * directly under the register that had just shown the same figures with
        * more detail. Review is where you decide whether to approve, not where
        * you read the payroll a second time; the month-on-month comparison
        * lives in Reports, which is where somebody goes to ask that question.
        */}
      <AdminSection title="What this month comes to">
        <div className="kw-summaryRows">
          <SummaryRow label="Gross pay" value={ringgit(totals.gross)} />
          <SummaryRow
            label="Employee deductions"
            value={
              totals.statutoryNotCalculated > 0
                ? `−${ringgit(totals.deductions)} · ${totals.statutoryNotCalculated} not worked out`
                : `−${ringgit(totals.deductions)}`
            }
            tone={totals.statutoryNotCalculated > 0 ? 'bad' : 'deduct'}
          />
          <SummaryRow label="Net pay" value={ringgit(totals.net)} strong />
          <SummaryRow label="Employer contributions" value={ringgit(totals.employerContributions)} muted />
          <SummaryRow label="Cost to the clinic" value={ringgit(totals.employerCost)} strong />
        </div>

        {!totals.addsUp && totals.discrepancy ? <AdminNotice tone="warn">{totals.discrepancy}</AdminNotice> : null}
      </AdminSection>

      {/* THE ONE BUTTON THAT MOVES THE MONTH ON, and the reason when it will
          not. A disabled control with no explanation is a dead end. */}
      <div className="kw-proceed">
        <div className="kw-proceed__text">
          {gate.canApprove
            ? 'Nothing is blocking this month.'
            : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted before this run can be approved.`}
        </div>
        <Button onClick={() => onGoTo('prepare')}>← Back to the register</Button>
        <Button type="primary" disabled={!gate.canApprove} onClick={() => onGoTo('approve')}>
          Proceed to approval →
        </Button>
      </div>
    </>
  );
}

/** One figure on the Approve summary, drawn like the month header's. */
function ApproveFigure({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div className={`kw-payFig${lead ? ' kw-payFig--lead' : ''}`}>
      <span className="kw-payFig__label">{label}</span>
      <span className="kw-payFig__value">{ringgit(value)}</span>
    </div>
  );
}

/** A money figure in the summary strip, grouped and with its cents smaller. */
function ReviewFigure({ label, amount, hint }: { label: string; amount: string; hint: string }) {
  const [whole, cents] = amount.split('.');
  return (
    <div className="kw-reviewFigure">
      <div className="kw-reviewFigure__label">{label}</div>
      <div className="kw-reviewFigure__value">
        RM{group(whole)}
        <span className="kw-reviewFigure__cents">.{cents}</span>
      </div>
      <div className="kw-reviewFigure__hint">{hint}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  strong,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'deduct' | 'bad';
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`kw-summaryRow${strong ? ' kw-summaryRow--strong' : ''}${muted ? ' kw-summaryRow--muted' : ''}`}>
      <span>{label}</span>
      <span className={tone === 'bad' ? 'kw-bad' : tone === 'deduct' ? 'kw-summaryRow__deduct' : undefined}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 3 — Approve
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
  const approval = data.approval;

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
        <AdminSection title={`Approve ${data.run.periodLabel} payroll`}>
          {/*
            * THE SENTENCE SOMEBODY IS AGREEING TO, in the words they would use
            * saying it out loud. This screen called the action "finalise"
            * throughout while the stage above it said Approve — two names for
            * one irreversible thing, on the screen where being sure matters
            * most. Approve is the word; Finalise is the stage that comes after.
            */}
          <p className="kw-approveStatement">
            You are approving the {data.run.periodLabel} payroll for {data.run.employeeCount} employee
            {data.run.employeeCount === 1 ? '' : 's'} at {data.run.clinicName}
            {data.run.paymentDate ? `, to be paid on ${dayjs(data.run.paymentDate).format('dddd D MMMM')}` : ''}.
          </p>

          {/*
            * THE SAME FIVE FIGURES AS THE MONTH HEADER, in the same order and
            * the same shape. A grid of five cards inside this column wrapped
            * four-and-one and left an empty cell beside the last figure, which
            * reads as something failing to load; a flex row wraps evenly and
            * makes Approve visually the same statement as the header above it.
            */}
          <div className="kw-payMonth__figures kw-approveFigures">
            <ApproveFigure label="Gross pay" value={data.pay.totals.gross} />
            <ApproveFigure label="Employee deductions" value={data.pay.totals.deductions} />
            <ApproveFigure label="Employer contributions" value={data.pay.totals.employerContributions} />
            <ApproveFigure label="Net pay" value={data.pay.totals.net} lead />
            <ApproveFigure label="Cost to clinic" value={data.pay.totals.employerCost} />
          </div>

          <div style={{ fontWeight: 650, fontSize: 12.5, marginTop: 12 }}>Before this can be approved</div>
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

        <AdminSection title="What approving does">
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
              <strong>No bank payment file and no authority submission files.</strong> No bank’s format and no
              authority’s upload format is on record, and Kuwick will not produce a file it cannot stand behind —
              what downloads is a listing for keying or cross-checking at the bank’s and each authority’s own
              portal, and the filing you make there is recorded here with its reference.
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

        {/*
          * WHO IS APPROVING THIS, and whether that is finished.
          *
          * Under a two-approval rule, one approval is not an approval — and a
          * screen that says "approved" after the first one is how a run gets
          * paid on half the sign-off the clinic asked for.
          */}
        {approval.required > 1 || approval.given.length > 0 ? (
          <AdminSection title="Sign-off">
            <p className="kw-muted" style={{ marginTop: 0 }}>{approval.rule}</p>
            <div className="kw-signoffList">
              {Array.from({ length: Math.max(approval.required, approval.given.length) }).map((_, index) => {
                const person = approval.given[index];
                return (
                  <div key={index} className="kw-signoffList__row">
                    <span
                      className={`kw-signoffList__mark kw-signoffList__mark--${person ? 'done' : 'todo'}`}
                    >
                      {person ? '✓' : index + 1}
                    </span>
                    <div>
                      <div className="kw-signoffList__title">
                        {person ? person.name : 'Waiting for a second person'}
                      </div>
                      <div className="kw-signoffList__detail">
                        {person
                          ? `${dayjs(person.at).format('D MMM YYYY, HH:mm')}${person.wasOwnSelfApproval ? ' · approved their own run' : ''}`
                          : 'The run stays open until they approve it.'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </AdminSection>
        ) : null}

        <AdminSection title="Approve">
          {!canFinaliseHere && !alreadyApproved ? (
            <AdminNotice tone="info">
              <strong>Approving is done on a computer.</strong> Locking a month&apos;s pay needs the whole run in front of you. Review and clear blockers here; approve from a desktop.
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
              {/*
                * TWO REASONS THE BUTTON MIGHT NOT WORK, kept apart. "This run
                * has problems" and "you are not the one who may approve it"
                * need different actions, and merging them sends somebody off
                * to fix five exceptions they were never going to approve.
                */}
              <p className="kw-muted" style={{ marginTop: 0 }}>
                {!approval.youMayApprove && approval.whyNot
                  ? approval.whyNot
                  : gate.canApprove
                    ? approval.completesTheRun
                      ? gate.reason
                      : 'Your approval will be recorded. The run stays open until a second person approves it.'
                    : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted first. Kuwick will not approve a run it cannot compute.`}
              </p>
              <Button
                type="primary"
                block
                disabled={!gate.canApprove || !approval.youMayApprove}
                loading={approve.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: approval.completesTheRun
                      ? `Approve ${data.run.periodLabel} payroll?`
                      : `Record your approval of ${data.run.periodLabel} payroll?`,
                    content: !approval.completesTheRun
                      ? `This clinic requires ${approval.required} approvals. Nothing locks until a second person approves it.`
                      : provisional
                        ? 'The statutory rates behind these figures have not been verified. This run will be locked and marked PROVISIONAL — it must not be used to pay staff or file a return.'
                        : 'The figures will be locked. A correction afterwards is a recorded adjustment.',
                    okText: 'Approve',
                    onOk: () =>
                      new Promise<void>((resolve, reject) => {
                        approve.mutate(
                          { id: runId, acknowledgeStatutoryGap: provisional },
                          {
                            onSuccess: () => {
                              message.success(
                                approval.completesTheRun
                                  ? 'Payroll approved'
                                  : 'Your approval is recorded. One more is needed.',
                              );
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
                {approval.completesTheRun
                  ? `Approve ${data.run.periodLabel} payroll`
                  : `Approve ${data.run.periodLabel} payroll (1 of ${approval.required})`}
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

      {alreadyApproved ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <AdminNotice tone="info">
            This run is approved. Payslips, the payment listing and the statutory figures are on the{' '}
            <strong>Finalise</strong> stage.
          </AdminNotice>
        </div>
      ) : null}
    </div>
  );
}

/**
 * FINALISE — what comes OUT of an approved month.
 *
 * These three panels used to hang off the bottom of the Approve screen, which
 * meant the stage called "Complete" rendered the approve screen a second time
 * and the outputs were something you scrolled to rather than a place you went.
 * They are the fourth stage now because they are the fourth thing that
 * happens: the month is approved, and then payslips are issued, staff are
 * paid, and returns are filed.
 *
 * BEFORE APPROVAL THERE IS NOTHING HERE, and the screen says so rather than
 * rendering three empty panels — an empty payslip list reads as "no payslips
 * were produced", which is a different and alarming claim.
 */
function FinaliseStep({ data, runId }: { data: PayrollJourney; runId: string }) {
  const approved = data.run.status === 'APPROVED' || data.run.status === 'PAID';

  if (!approved) {
    /*
     * COMPACT AND ACTIONABLE, not a screen of white to say nothing is here.
     *
     * This was a full section wrapping a centred empty state with three lines
     * of prose about frozen snapshots — roughly a third of a laptop screen
     * spent saying "not yet". One line, and the button that gets you there.
     */
    return (
      <Panel
        title={`${data.run.periodLabel} has not been approved`}
        hint="Payslips and the payment listing are produced from the approved month."
        action={
          <Link to={`?step=${data.review.gate.canApprove ? 'approve' : 'review'}`}>
            {data.review.gate.canApprove ? 'Approve this month' : 'See what is blocking it'}
          </Link>
        }
        padded={false}
      >
        <span />
      </Panel>
    );
  }

  return (
    <>
      <PayslipsPanel runId={runId} />
      <PaymentPanel runId={runId} />
      <StatutoryOutputsPanel runId={runId} />

      {/*
        * THE TWO REMAINING OUTPUTS, WHERE SOMEBODY LOOKS FOR THEM.
        *
        * The register export and the cost report have always existed, in
        * Reports — which meant finishing a month and then going somewhere else
        * to get the two documents the month produces. These link straight to
        * the report, already set to THIS run, rather than to a library where
        * the reader picks both again.
        */}
      <AdminSection title="The rest of this month">
        <div className="kw-outputLinks">
          <Link to={`/admin/hr/reports?report=PAYROLL_REGISTER&run=${runId}`} className="kw-outputLink">
            <strong>Payroll register</strong>
            <span>Every employee, every component. Exports to CSV.</span>
          </Link>
          <Link to={`/admin/hr/reports?report=EMPLOYER_COST&run=${runId}`} className="kw-outputLink">
            <strong>Cost to the clinic</strong>
            <span>Wages plus the employer’s own contributions, by branch and legal employer.</span>
          </Link>
        </div>
      </AdminSection>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * THE REGISTER, and the drawer it opens.
 *
 * ONE READ. This used to fetch the run detail SEPARATELY from the journey and
 * render the register off it, while the drawer beside it rendered off the
 * journey — two server answers about the same person's pay, formatted by two
 * different bits of browser code. They agreed, until one of them was changed.
 * The journey now carries every figure the register shows, so the register and
 * the drawer are two renderings of ONE answer.
 */
function RunGridSection({
  data,
  onFixInputs,
  canEdit,
}: {
  data: PayrollJourney;
  onFixInputs: (staffId: string, staffName: string | null) => void;
  canEdit: boolean;
}) {
  const [openStaffId, setOpenStaffId] = useState<string | null>(null);
  const rows = data.pay.rows;
  const open = rows.find((row) => row.staffId === openStaffId) ?? null;

  if (rows.length === 0) {
    return (
      <AdminSection
        title="Nothing has been worked out yet"
        description="Calculate the month and every employee's figures appear here."
      >
        <span />
      </AdminSection>
    );
  }

  return (
    <>
      {/*
        * NO SECTION HEADING. The stage above already says "Payroll Details",
        * and a panel titled "Payroll register" under it said the same thing a
        * second time — for about 50px of the vertical space the totals row
        * needs to stay above the fold on a laptop.
        */}
      <PayrollGrid
        rows={rows}
        totals={data.pay.totals}
        selectedStaffId={open?.staffId}
        onOpenEmployee={(row) => setOpenStaffId(row.staffId)}
        onFix={canEdit ? (row) => onFixInputs(row.staffId, row.name) : undefined}
      />
      <PayrollEmployeeDrawer
        open={open !== null}
        onClose={() => setOpenStaffId(null)}
        row={open}
        attendance={data.attendance.rows.find((r) => r.staffId === open?.staffId)}
        period={data.run.period}
        onAddItem={(staffId, staffName) => onFixInputs(staffId, staffName)}
        canEdit={canEdit}
      />
    </>
  );
}

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
      {step === 'prepare' || step === 'review' ? (
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
