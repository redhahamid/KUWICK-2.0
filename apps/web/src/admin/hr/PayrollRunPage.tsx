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
  usePayrollRun,
  usePayrollVariance,
} from '../hooks/useAdmin';
import { ProvisionalBanner } from './ProvisionalBanner';
import { PayrollStepper, STEPS, normaliseStep, stepsWithProblems, type StepKey } from './PayrollStepper';
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
import { EmptyState } from '../components/Panel';
import type { PayrollJourney, PayrollRunDetail } from '../types';

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
  // Old six-step links still resolve — see normaliseStep.
  const step = normaliseStep(search.get('step'));
  const stepMeta = STEPS.find((s) => s.key === step) ?? STEPS[0];
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
    <AdminShell
      error={firstError(journey)}
      title={data ? `${stepMeta.heading} — ${data.run.periodLabel}` : 'Payroll run'}
      subtitle={stepMeta.blurb}
      actions={
        <>
          {/* THE RUN'S OWN STATUS, beside its month. A stage strip says where
              you are in the work; it does not say whether the month is a draft,
              approved or paid, and those are different things to be looking at. */}
          {data ? (
            data.run.statutoryStatus !== 'CONFIGURED' ? (
              <StatusChip tone="attention" dot>
                {humanise(data.run.status)} · provisional
              </StatusChip>
            ) : (
              <StatusChip tone={data.run.status === 'PAID' ? 'ok' : data.run.status === 'APPROVED' ? 'ok' : 'info'} dot>
                {humanise(data.run.status)}
              </StatusChip>
            )
          ) : null}
          <Link to="/admin/hr/payroll">
            <Button size="small">Payroll home</Button>
          </Link>
        </>
      }
    >
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
              <RunGridSection runId={id!} data={data} onFixInputs={onFixInputs} canEdit={mayRun && !locked} />
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
  const variance = usePayrollVariance(runId);
  const totals = data.pay.totals;
  const gate = data.review.gate;

  return (
    <>
      <PayrollExceptionCentre runId={runId} canOverride={mayApprove} onFixInputs={onFixInputs} />

      <AdminSection title="Payroll summary" description={`${data.run.periodLabel} · ${data.run.clinicName}`}>
        <div className="kw-reviewFigures">
          <ReviewFigure
            label="TAKE-HOME PAY"
            amount={data.run.netTotal}
            hint={`What leaves the clinic to your staff${
              data.run.paymentDate ? ` on ${dayjs(data.run.paymentDate).format('D MMMM')}` : ''
            }.`}
          />
          <div className="kw-reviewFigure">
            <div className="kw-reviewFigure__label">EMPLOYEES</div>
            <div className="kw-reviewFigure__value">{data.run.employeeCount}</div>
            <div className="kw-reviewFigure__hint">
              {data.employees.needsSetup > 0
                ? `${data.employees.needsSetup} more not ready to be paid.`
                : 'Everyone employed here this month.'}
            </div>
          </div>
          <ReviewFigure
            label="TOTAL COST TO THE CLINIC"
            amount={data.run.employerCostTotal}
            hint="Pay plus the clinic's own EPF, SOCSO, EIS and HRD levy."
          />
        </div>

        {/*
          * THE MONTH'S ARITHMETIC, from the server. Gross less deductions is
          * net, and a scheme that was not calculated is a COUNT here rather
          * than a zero folded into a total — which is how a clinic ends up
          * reading "RM0.00 statutory" and believing it owes nothing.
          */}
        <div className="kw-summaryRows">
          <SummaryRow label="Gross earnings" value={ringgit(totals.gross)} />
          <SummaryRow label="Salary earned (after unpaid leave)" value={ringgit(totals.salaryEarned)} muted />
          <SummaryRow label="Allowances, overtime, incentives and claims" value={ringgit(totals.additions)} muted />
          <SummaryRow
            label="Employee statutory (EPF, SOCSO, EIS, LINDUNG)"
            value={
              totals.statutoryNotCalculated > 0
                ? `${totals.statutoryNotCalculated} not calculated`
                : `−${ringgit(totals.statutoryEmployee)}`
            }
            tone={totals.statutoryNotCalculated > 0 ? 'bad' : 'deduct'}
          />
          <SummaryRow
            label="Monthly tax (PCB)"
            value={totals.pcbMissing > 0 ? `${totals.pcbMissing} missing` : `−${ringgit(totals.pcb)}`}
            tone={totals.pcbMissing > 0 ? 'bad' : 'deduct'}
          />
          <SummaryRow label="Other deductions" value={`−${ringgit(totals.otherDeductions)}`} tone="deduct" />
          <SummaryRow label="Total deductions" value={`−${ringgit(totals.deductions)}`} tone="deduct" muted />
          <SummaryRow label="Take-home pay" value={ringgit(totals.net)} strong />
        </div>

        {!totals.addsUp && totals.discrepancy ? <AdminNotice tone="warn">{totals.discrepancy}</AdminNotice> : null}
      </AdminSection>

      {Number(totals.unpaidLeave) > 0 ? (
        <AdminNotice tone="info">
          <strong>Unpaid leave is not a deduction.</strong> An incomplete month's wages are smaller under s.18A, so the{' '}
          {ringgit(totals.unpaidLeave)} has already come off the salary column and is not taken again below.
        </AdminNotice>
      ) : null}

      <AdminSection
        title="Take-home pay, person by person"
        description={
          variance.data?.rows?.length
            ? 'Compared with the previous period. A movement is the difference between the two, never a separately worked-out figure.'
            : undefined
        }
        padded={false}
      >
        <DataTable<PayRow>
          rowKey="staffId"
          rows={data.pay.rows}
          emptyText="Nothing has been calculated yet."
          columns={[
            {
              title: 'Employee',
              dataIndex: 'name',
              width: 230,
              render: (value: string) => <PersonCell name={value} />,
            },
            {
              title: 'Gross',
              dataIndex: 'grossPay',
              width: 140,
              align: 'right' as const,
              render: (value: string) => ringgit(value),
            },
            {
              title: 'Deductions',
              dataIndex: 'deductionTotal',
              width: 140,
              align: 'right' as const,
              render: (value: string) =>
                Number(value) ? <span className="kw-bad">−{ringgit(value)}</span> : <span className="kw-muted">—</span>,
            },
            {
              title: 'Take-home',
              dataIndex: 'netPay',
              width: 150,
              align: 'right' as const,
              render: (value: string) => <strong>{ringgit(value)}</strong>,
            },
            {
              title: 'vs last period',
              key: 'vs-last-period',
              width: 150,
              align: 'right' as const,
              render: (_: unknown, row: PayRow) => {
                // THE MOVEMENT IS A SUBTRACTION the API already did. Recomputing
                // it here from two numbers on screen is how a comparison month
                // ends up carrying the current month's totals.
                const line = variance.data?.rows?.find((entry) => entry.staffId === row.staffId);
                if (!line || line.deltaCents === null) return <span className="kw-muted">—</span>;
                if (line.deltaCents === 0) return <span className="kw-muted">no change</span>;
                return (
                  <span className={line.deltaCents > 0 ? 'kw-good' : 'kw-bad'}>
                    {line.deltaCents > 0 ? '+' : '−'}
                    {ringgit((Math.abs(line.deltaCents) / 100).toFixed(2))}
                  </span>
                );
              },
            },
          ]}
        />
      </AdminSection>

      {/* THE ONE BUTTON THAT MOVES THE MONTH ON, and the reason when it will
          not. A disabled control with no explanation is a dead end. */}
      <div className="kw-proceed">
        <div className="kw-proceed__text">
          {gate.canApprove
            ? 'Nothing is blocking this month.'
            : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted before this run can be approved.`}
        </div>
        <Button type="primary" disabled={!gate.canApprove} onClick={() => onGoTo('approve')}>
          Proceed to approval →
        </Button>
      </div>
    </>
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

        <AdminSection title="Finalise">
          {!canFinaliseHere && !alreadyApproved ? (
            <AdminNotice tone="info">
              <strong>Finalising is done on a computer.</strong> Locking a month's pay needs the whole run in front of you. Review and clear blockers here; finalise from a desktop.
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
                    : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted first. Kuwick will not finalise a run it cannot compute.`}
              </p>
              <Button
                type="primary"
                block
                disabled={!gate.canApprove || !approval.youMayApprove}
                loading={approve.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: approval.completesTheRun
                      ? `Finalise ${data.run.periodLabel} payroll?`
                      : `Record your approval of ${data.run.periodLabel} payroll?`,
                    content: !approval.completesTheRun
                      ? `This clinic requires ${approval.required} approvals. Nothing locks until a second person approves it.`
                      : provisional
                        ? 'The statutory rates behind these figures have not been verified. This run will be locked and marked PROVISIONAL — it must not be used to pay staff or file a return.'
                        : 'The figures will be locked. A correction afterwards is a recorded adjustment.',
                    okText: approval.completesTheRun ? 'Finalise' : 'Approve',
                    onOk: () =>
                      new Promise<void>((resolve, reject) => {
                        approve.mutate(
                          { id: runId, acknowledgeStatutoryGap: provisional },
                          {
                            onSuccess: () => {
                              message.success(
                                approval.completesTheRun
                                  ? 'Payroll finalised'
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
                  ? `Finalise ${data.run.periodLabel} payroll`
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
    return (
      <AdminSection title="Nothing to issue yet">
        <EmptyState
          title={`${data.run.periodLabel} has not been approved`}
          hint="Payslips, the payment listing and the statutory figures are produced from an approved run's frozen snapshot, so they appear once the month is approved."
        />
      </AdminSection>
    );
  }

  return (
    <>
      <PaymentPanel runId={runId} />
      <PayslipsPanel runId={runId} />
      <StatutoryOutputsPanel runId={runId} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * THE REGISTER, and the drawer it opens.
 *
 * Loaded separately from the journey read because it is the only thing on this
 * page that needs every line of every employee — the journey summarises, and
 * summarising is what made the owner reassemble the month in their head.
 *
 * The drawer's itemised detail comes from the journey's own `pay.rows`, so the
 * register's columns and the drawer's lines are two renderings of one server
 * answer rather than two calculations.
 */
function RunGridSection({
  runId,
  data,
  onFixInputs,
  canEdit,
}: {
  runId: string;
  data: PayrollJourney;
  onFixInputs: (staffId: string, staffName: string | null) => void;
  canEdit: boolean;
}) {
  const run = usePayrollRun(runId);
  const [openLine, setOpenLine] = useState<PayrollRunDetail['lines'][number] | null>(null);

  if (run.isLoading) {
    return (
      <AdminSection title="The month, employee by employee">
        <p className="kw-muted">Working out the register…</p>
      </AdminSection>
    );
  }
  if (!run.data) return null;
  if (run.data.lines.length === 0) {
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
      <AdminSection
        title="Payroll register"
        description="Open a row for one person's earnings, deductions and statutory detail."
        padded={false}
      >
        <PayrollGrid
          run={run.data}
          selectedStaffId={openLine?.staffId}
          onOpenEmployee={(line) => setOpenLine(line)}
          otherEarnings={new Map(data.pay.rows.map((row) => [row.staffId, row.otherEarnings]))}
        />
      </AdminSection>
      <PayrollEmployeeDrawer
        open={openLine !== null}
        onClose={() => setOpenLine(null)}
        line={openLine}
        payRow={data.pay.rows.find((row) => row.staffId === openLine?.staffId)}
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
