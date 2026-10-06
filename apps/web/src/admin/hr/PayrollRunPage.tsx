import { useState, type ReactNode } from 'react';
import { RecordsChangedBanner } from './RecordsChangedBanner';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App, Grid, Modal } from 'antd';
import dayjs from 'dayjs';
import { ringgit } from '../components/DataTable';
import { humanise } from '../components/Chip';
import {
  useApprovePayroll,
  useCalculatePayroll,
  useDeletePayrollInput,
  useDiscardPayrollRun,
  usePayrollJourney,
  useUpsertPayrollInput,
} from '../hooks/useAdmin';
import { ProvisionalBanner } from './ProvisionalBanner';
import { PayrollStepper, STEPS, normaliseStep, stepsWithProblems, type StepKey } from './PayrollStepper';
import { cellValue, gridColumnsFor, PayrollGrid, type GridEdit, type LeftOutRow, type SaveOutcome } from './PayrollGrid';
import { PayrollExceptionCentre } from './PayrollExceptionCentre';
import { PayrollInputsDrawer } from './PayrollInputsDrawer';
import { PayslipsPanel } from './PayslipsPanel';
import { PaymentPanel } from './PaymentPanel';
import { StatutoryOutputsPanel } from './StatutoryOutputsPanel';
import { useCan } from '../../core/hooks/useCan';
import { HrPage, Panel, PanelHead, SegControl, StatCard, StatRow, StatusChip, Toolbar, ToolbarSearch } from './ui';
import { IconDownload, IconHistory, IconPayroll } from './ui/icons';
import { downloadCsv } from './ui/csv';
import type { PayrollJourney } from '../types';

/** The query's own error, as a sentence, or nothing. */
const errorText = (query: { error: unknown }) => (query.error instanceof Error ? query.error.message : null);

type PayRow = PayrollJourney['pay']['rows'][number];

/**
 * THE MONTH'S PAYROLL — payroll.html.
 *
 * One run per month, and the month is the screen: four figures, four stages,
 * and the grid. Grey cells come from records or are worked out; a white cell
 * opens that person's items for the month; the footer says what is blocked
 * and will not let the month move on to Review while anything is.
 *
 * MOUNTED BY TWO ROUTES, deliberately. `/admin/hr/payroll` resolves the
 * current month and mounts this directly, so opening payroll opens the month's
 * work rather than a page about payroll; `/admin/hr/payroll/:id` mounts the
 * same thing by run id, so every existing link, exception remedy and bookmark
 * still lands where it always did. One workspace, not two implementations that
 * drift.
 *
 * EVERY FIGURE IS THE SERVER'S. `journey.pay.totals` is summed from the
 * payslip lines by `payroll-journey.service.ts`; the stat cards, the grid and
 * the review summary display them and compute nothing. A total that
 * disagrees with the grid would be a second payroll implementation.
 *
 * `monthNav` is the month control, passed in by whichever route can
 * meaningfully offer it — the month page can move between months, a direct
 * run link cannot.
 */
export function PayrollWorkspace({ runId, monthNav }: { runId: string; monthNav?: ReactNode }) {
  const [search, setSearch] = useSearchParams();
  const journey = usePayrollJourney(runId);
  // Old six-step links still resolve — see normaliseStep.
  const step = normaliseStep(search.get('step'));
  const data = journey.data;
  const mayApprove = useCan('hr.payroll.approve');
  const mayRun = useCan('hr.payroll.run');
  const { message } = App.useApp();
  const workOut = useCalculatePayroll();

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

  const rows = data?.pay.rows ?? [];
  // The register's own figures for the person whose items are open, so the
  // drawer can say when the cell is behind the lines.
  const inputsRow = inputsStaff ? (rows.find((row) => row.staffId === inputsStaff.id) ?? null) : null;
  const blockedRows = rows.filter((row) => row.blockers > 0);
  const checkRows = rows.filter((row) => row.blockers === 0 && row.warnings > 0);
  // Somebody the run left out has no line, so no row in `pay.rows` — and a
  // grid that simply omits them is a month that is quietly one person short.
  const leftOut: LeftOutRow[] = (data?.employees.rows ?? [])
    .filter((row) => !row.includedInRun && row.state !== 'READY')
    .map((row) => ({ staffId: row.staffId, name: row.name, position: row.position, reason: row.reason }));
  const blockedCount = blockedRows.length + leftOut.length;
  const provisional = data ? data.run.statutoryStatus !== 'CONFIGURED' : false;

  const exportCsv = () => {
    if (!data) return;
    // Every column, the clinic's own ones included — a folded column is a
    // screen decision, not a change to what the month contains.
    const exportColumns = gridColumnsFor(data.pay.columns);
    downloadCsv(
      `payroll-${data.run.period}`,
      // The export carries the column's fuller name where the grid leans on
      // the group header above it to say whose money the column is.
      ['Employee', 'Position', 'Status', ...exportColumns.map((column) => column.exportTitle ?? column.title)],
      rows.map((row) => [
        row.name,
        row.position,
        row.blockers > 0 ? 'Blocked' : row.warnings > 0 ? 'Needs attention' : 'Ready',
        ...exportColumns.map((column) => cellValue(column, row)),
      ]),
    );
  };

  return (
    <HrPage
      title="Payroll"
      sub={STEPS[0].blurb}
      error={errorText(journey)}
      actions={
        <>
          {data ? (
            <StatusChip tone={provisional ? 'attn' : locked ? 'done' : 'info'}>
              {provisional ? `${humanise(data.run.status)} · provisional` : humanise(data.run.status)}
            </StatusChip>
          ) : null}
          {monthNav}
          <Link className="hr-btn" to="/admin/hr/payroll/history">
            <IconHistory />
            History
          </Link>
          <button type="button" className="hr-btn" onClick={exportCsv} disabled={rows.length === 0}>
            <IconDownload />
            Export
          </button>
          {data && mayRun && !locked ? <DiscardRunButton runId={runId} period={data.run.period} /> : null}
        </>
      }
    >
      {data ? (
        <StatRow>
          <StatCard
            icon={<IconPayroll />}
            label="Gross pay"
            value={ringgit(data.pay.totals.gross)}
            sub={`${data.run.employeeCount} ${data.run.employeeCount === 1 ? 'employee' : 'employees'}`}
          />
          <StatCard
            icon={<IconPayroll />}
            label="Employee deductions"
            value={ringgit(data.pay.totals.deductions)}
            sub={
              data.pay.totals.statutoryNotCalculated > 0
                ? `${data.pay.totals.statutoryNotCalculated} not worked out`
                : 'EPF, SOCSO, EIS, PCB'
            }
            tone={data.pay.totals.statutoryNotCalculated > 0 ? 'gold' : 'plain'}
          />
          <StatCard icon={<IconPayroll />} label="Employer contributions" value={ringgit(data.pay.totals.employerContributions)} sub="Paid on top of gross" />
          <StatCard
            icon={<IconPayroll />}
            label="Net pay"
            value={ringgit(data.pay.totals.net)}
            tone="teal"
            sub={`${blockedCount} blocked · ${checkRows.length} to check`}
          />
        </StatRow>
      ) : null}
      {/* Only once the run is read: an unread status is not "not production-ready". */}
      {data ? <ProvisionalBanner statutoryStatus={data.run.statutoryStatus} /> : null}
      {data && !locked ? (
        <RecordsChangedBanner
          changed={data.recordsChanged}
          mayRun={mayRun}
          working={workOut.isPending}
          onWorkOut={() =>
            workOut.mutate(runId, {
              onSuccess: () => message.success('Worked out again from the records as they are now.'),
              onError: (error: Error) => message.error(error.message),
            })
          }
        />
      ) : null}

      <Panel>
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
          subs={{
            prepare: data
              ? blockedCount + checkRows.length > 0
                ? `${blockedCount} blocked, ${checkRows.length} to check`
                : rows.length > 0
                  ? 'Every row ready'
                  : 'Not worked out yet'
              : undefined,
            // Named only when that month exists for this branch; a first month has nothing to compare with.
            review: data ? (data.review.previousRun ? `Compare with ${dayjs(data.review.previousRun.period).format('MMMM')}` : 'First month on record') : undefined,
            approve: 'Locks the month',
            complete: 'Bank listing + payslips',
          }}
        />

        {data ? (
          <>
            {step === 'prepare' ? (
              <PrepareStep
                data={data}
                runId={runId}
                leftOut={leftOut}
                canEdit={mayRun && !locked}
                onGoTo={goTo}
                onOpenItems={(row) => onFixInputs(row.staffId, row.name)}
              />
            ) : null}
            {step === 'review' ? (
              <ReviewStep data={data} runId={runId} mayApprove={mayApprove} onFixInputs={onFixInputs} onGoTo={goTo} />
            ) : null}
            {step === 'approve' ? <ApproveStep data={data} runId={runId} /> : null}
            {step === 'complete' ? <PayStep data={data} runId={runId} /> : null}
          </>
        ) : null}
      </Panel>

      {data ? (
        <PayrollInputsDrawer
          open={inputsOpen}
          onClose={() => setInputsOpen(false)}
          period={`${data.run.period}-01`}
          staffId={inputsStaff?.id}
          staffName={inputsStaff?.name ?? undefined}
          canEdit={mayRun && !locked}
          runId={runId}
          cell={inputsRow ? { otherIncome: inputsRow.otherIncome, otherDeductions: inputsRow.otherDeductions } : null}
        />
      ) : null}
    </HrPage>
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
// STAGE 1 — Prepare: the grid, one row edited at a time.
// ---------------------------------------------------------------------------

type Filter = 'all' | 'blocked' | 'check';

function PrepareStep({
  data,
  runId,
  leftOut,
  canEdit,
  onGoTo,
  onOpenItems,
}: {
  data: PayrollJourney;
  runId: string;
  leftOut: LeftOutRow[];
  canEdit: boolean;
  onGoTo: (key: StepKey) => void;
  /** A white cell was pressed: open that person's items for the month. */
  onOpenItems: (row: PayrollJourney['pay']['rows'][number]) => void;
}) {
  const { message } = App.useApp();
  const calculate = useCalculatePayroll();
  const upsertInput = useUpsertPayrollInput();
  const removeInput = useDeletePayrollInput();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = data.pay.rows;
  const blocked = rows.filter((row) => row.blockers > 0);
  const check = rows.filter((row) => row.blockers === 0 && row.warnings > 0);
  const needle = query.trim().toLowerCase();
  const byName = (name: string) => needle === '' || name.toLowerCase().includes(needle);
  const shown = rows.filter(
    (row) =>
      byName(row.name) && (filter === 'all' || (filter === 'blocked' ? row.blockers > 0 : row.blockers === 0 && row.warnings > 0)),
  );
  const shownLeftOut = filter === 'check' ? [] : leftOut.filter((row) => byName(row.name));

  const recalculate = (afterwards?: string) =>
    calculate.mutate(runId, {
      onSuccess: () => message.success(afterwards ?? 'Worked out again'),
      onError: (error: Error) => message.error(error.message),
    });

  /*
   * ONE SAVE FOR A BATCH OF CELLS. Each changed cell goes through the same
   * inputs endpoint the drawer uses — a line per person and item, the same
   * server rules, the same audit row — and the month is worked out ONCE at
   * the end rather than after every cell. A cell the server refuses keeps
   * its draft and its reason; the rest are saved.
   */
  const saveCells = async (edits: GridEdit[]): Promise<SaveOutcome> => {
    const failed: { key: string; message: string }[] = [];
    for (const edit of edits) {
      try {
        if (edit.amount === null) {
          if (edit.inputId) await removeInput.mutateAsync(edit.inputId);
        } else {
          await upsertInput.mutateAsync({
            staffId: edit.staffId,
            period: `${data.run.period}-01`,
            componentCode: edit.code,
            amount: edit.amount,
          });
        }
      } catch (error) {
        failed.push({ key: edit.key, message: `${edit.title} for ${edit.name}: ${(error as Error).message}` });
      }
    }
    const saved = edits.length - failed.length;
    if (saved > 0) {
      try {
        await calculate.mutateAsync(runId);
        message.success(`${saved} ${saved === 1 ? 'change' : 'changes'} saved and the month worked out again.`);
      } catch (error) {
        message.error(`Saved, but the month could not be worked out again: ${(error as Error).message}`);
      }
    }
    return { failed };
  };


  return (
    <>
      <Toolbar
        right={
          <div className="hr-legend">
            <span>
              <i className="is-record" />
              From records / auto
            </span>
            <span>
              <i className="is-editable" />
              Opens the month’s items
            </span>
            {data.pay.columns.length > 0 ? (
              <span>
                <i className="is-input" />
                Type an amount, then Save changes
              </span>
            ) : null}
          </div>
        }
      >
        <ToolbarSearch value={query} onChange={setQuery} placeholder="Search employee" label="Search employee" />
        <SegControl<Filter>
          label="Rows"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${rows.length + leftOut.length}` },
            { value: 'blocked', label: `Blocked ${blocked.length + leftOut.length}` },
            { value: 'check', label: `Needs attention ${check.length}` },
          ]}
        />
      </Toolbar>

      {rows.length === 0 && leftOut.length === 0 ? (
        <div className="hr-empty">
          <div className="hr-strong">Nothing has been worked out yet.</div>
          <div className="hr-muted">Work the month out again builds it from attendance, leave, claims and the employee records.</div>
        </div>
      ) : (
        <PayrollGrid
          rows={shown}
          leftOut={shownLeftOut}
          totals={data.pay.totals}
          counted={rows.length}
          runId={runId}
          onOpenItems={onOpenItems}
          columns={data.pay.columns}
          canEdit={canEdit}
          previousMonth={dayjs(data.run.period).subtract(1, 'month').format('MMMM YYYY')}
          onSaveCells={saveCells}
        />
      )}

      {/* "3 not worked out" on the HRD levy is not an explanation; this is the employer-level one. */}
      {data.pay.hrdAdvice ? (
        <div className="hr-pad hr-pad--top0">
          <div className="hr-notice hr-notice--info" data-testid="hrd-advice">
            <strong>
              HRD levy not worked out for {data.pay.totals.hrdLevyNotDetermined} {data.pay.totals.hrdLevyNotDetermined === 1 ? 'person' : 'people'}.
            </strong>{' '}
            {data.pay.hrdAdvice}
          </div>
        </div>
      ) : null}

      <div className="hr-panelNote">
        Overtime hours and unpaid days come from the records: overtime is paid once it is approved in Attendance, and unpaid
        leave once it is approved in Leave. Correct them there and save the draft again.{' '}
        <Link className="hr-link" to="/admin/hr/attendance">
          Open timesheet
        </Link>
        {data.employees.contractors.length > 0 ? (
          <>
            {' '}
            · {data.employees.contractors.map((c) => c.name).join(', ')}{' '}
            {data.employees.contractors.length === 1 ? 'is' : 'are'} engaged as {data.employees.contractors.length === 1 ? 'a contractor' : 'contractors'}, paid as
            professional fees and never payrolled.{' '}
            <Link className="hr-link" to="/admin/hr/locum">
              Open locum sessions
            </Link>
          </>
        ) : null}
      </div>

      <div className="hr-panel__foot">
        {blocked.length + leftOut.length > 0 ? (
          <StatusChip tone="block">{blocked.length + leftOut.length} blocked</StatusChip>
        ) : (
          <StatusChip tone="done">Nothing blocked</StatusChip>
        )}
        <span className="hr-small hr-muted">
          {[...blocked, ...leftOut]
            .map((row) => `${row.name} — ${row.reason ?? 'needs attention'}`)
            .join(' · ')}
        </span>
        <span className="hr-spacer" />
        {canEdit ? (
          <button type="button" className="hr-btn" disabled={calculate.isPending} onClick={() => recalculate('Worked out again')}>
            <IconDownload />
            {/* THE BUTTON SAYS WHAT IT DOES: nothing is saved here any more, the month is worked out again. */}
            Work the month out again
          </button>
        ) : null}
        <button
          type="button"
          className="hr-btn hr-btn--primary"
          disabled={blocked.length + leftOut.length > 0 || rows.length === 0}
          onClick={() => onGoTo('review')}
        >
          Continue to review
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// STAGE 2 — Review. The primary owner control screen.
// ---------------------------------------------------------------------------

/**
 * REVIEW — blockers, then warnings, then what the month adds up to.
 *
 * Every exception used to be rendered at the same weight in one list: a
 * missing monthly-tax figure that stops the run and an unapproved hour of
 * overtime that does not, drawn identically. A warning is not a blocker, and
 * a screen that draws them the same way teaches people to skim both.
 *
 * The last thing on the stage is the one button that moves the month forward,
 * and it says why it is disabled when it is.
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
   * COUNTS OF PEOPLE, AND THEY HAVE TO ADD UP. Ready and Blocked partition
   * the run exactly, and the person the run left out gets a count of their
   * own instead of hiding inside a blocker tally.
   */
  const blocked = data.pay.rows.filter((row) => row.blockers > 0).length;
  const ready = data.pay.rows.length - blocked;
  const leftOut = data.employees.needsSetup;
  /*
   * LINES STILL CARRYING LAST MONTH'S AMOUNT, counted here because the
   * reviewer is the person who has to know. They are paid as they stand —
   * right when the figure repeats, wrong when it does not — and nothing
   * asks for a click per line; editing or clearing one takes it off this list.
   */
  const previousMonth = dayjs(data.run.period).subtract(1, 'month').format('MMMM YYYY');
  const carried = data.pay.rows.flatMap((row) =>
    row.items.filter((item) => item.carried).map((item) => ({ name: row.name, label: item.label, amount: item.amount })),
  );

  return (
    <>
      <div className="hr-pad">
        <StatRow>
          <StatCard label="In this run" value={data.pay.rows.length} />
          <StatCard label="Ready" value={ready} tone={ready === data.pay.rows.length ? 'teal' : 'plain'} />
          <StatCard label="Blocked" value={blocked} tone={blocked > 0 ? 'red' : 'plain'} />
          <StatCard label="Not in this run" value={leftOut} tone={leftOut > 0 ? 'gold' : 'plain'} sub={leftOut > 0 ? 'No salary on record' : undefined} />
        </StatRow>
      </div>

      {carried.length > 0 ? (
        <div className="hr-pad hr-pad--top0">
          <div className="hr-notice hr-notice--info" data-testid="carried-unchecked">
            <strong>
              {carried.length} {carried.length === 1 ? 'line' : 'lines'} carried from {previousMonth} {carried.length === 1 ? 'has' : 'have'} not
              been edited or cleared.
            </strong>{' '}
            {carried.length === 1 ? 'It' : 'They'} will be paid at last month’s amount:{' '}
            {carried.map((line) => `${line.name}, ${line.label} ${ringgit(line.amount)}`).join('; ')}. Change or clear any that should
            not repeat on the grid, or leave them as they are.
          </div>
        </div>
      ) : null}

      <div className="hr-pad hr-pad--top0">
        <PayrollExceptionCentre runId={runId} canOverride={mayApprove} onFixInputs={onFixInputs} />
      </div>

      {/*
        * WHAT THE MONTH ADDS UP TO — and nothing else. The month-on-month
        * comparison lives in Reports, which is where somebody goes to ask
        * that question.
        */}
      <PanelHead
        rule
        title="What this month comes to"
        sub={
          data.review.previousRun
            ? `Compared with ${dayjs(data.review.previousRun.period).format('MMMM')} in Reports.`
            : 'The first month on record for this branch, so there is no earlier month to compare with yet.'
        }
      />
      <div className="hr-pad">
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
        {!totals.addsUp && totals.discrepancy ? <div className="hr-notice hr-notice--attn" style={{ margin: '12px 0 0' }}>{totals.discrepancy}</div> : null}
      </div>

      {/* THE ONE BUTTON THAT MOVES THE MONTH ON, and the reason when it will
          not. A disabled control with no explanation is a dead end. */}
      <div className="hr-panel__foot">
        <span className="hr-small hr-muted">
          {gate.canApprove
            ? 'Nothing is blocking this month.'
            : gate.recordsChanged
              ? gate.reason
              : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted before this run can be approved.`}
        </span>
        <span className="hr-spacer" />
        <button type="button" className="hr-btn" onClick={() => onGoTo('prepare')}>
          Back to the grid
        </button>
        <button type="button" className="hr-btn hr-btn--primary" disabled={!gate.canApprove} onClick={() => onGoTo('approve')}>
          Proceed to approval
        </button>
      </div>
    </>
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
      <span className={tone === 'bad' ? 'kw-bad' : tone === 'deduct' ? 'kw-summaryRow__deduct' : undefined}>{value}</span>
    </div>
  );
}

/** One figure on the Approve summary. */
function ApproveFigure({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div className={`kw-payFig${lead ? ' kw-payFig--lead' : ''}`}>
      <span className="kw-payFig__label">{label}</span>
      <span className="kw-payFig__value">{ringgit(value)}</span>
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
   * NO APPROVING FROM A PHONE.
   *
   * Not a layout decision. Approving locks a month's pay for everybody, and the
   * evidence somebody needs to be sure — the person-by-person figures, the
   * comparison with last month, the full list of what is outstanding — does not
   * fit on a phone in a form anybody actually reads. A screen that lets an
   * irreversible decision be made on the evidence it can show is worse than one
   * that declines to.
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
    <div className="hr-pad">
      <div className="kw-approveGrid">
        <div>
          <h3 className="hr-h3">Approve {data.run.periodLabel} payroll</h3>
          {/*
            * THE SENTENCE SOMEBODY IS AGREEING TO, in the words they would use
            * saying it out loud.
            */}
          <p className="kw-approveStatement">
            You are approving the {data.run.periodLabel} payroll for {data.run.employeeCount} employee
            {data.run.employeeCount === 1 ? '' : 's'} at {data.run.clinicName}
            {data.run.paymentDate ? `, to be paid on ${dayjs(data.run.paymentDate).format('dddd D MMMM')}` : ''}.
          </p>

          {/* THE SAME FIVE FIGURES AS THE STAT CARDS, in the same order. */}
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
              <span className={`kw-approveCheck__mark kw-approveCheck__mark--${check.ok ? 'ok' : check.warnOnly ? 'warn' : 'bad'}`}>
                {check.ok ? '✓' : check.warnOnly ? '!' : '×'}
              </span>
              <div>
                <div className="kw-approveCheck__title" style={{ color: check.ok ? undefined : check.warnOnly ? 'var(--hr-gold)' : 'var(--hr-red)' }}>
                  {check.title}
                </div>
                <div className="kw-approveCheck__detail">
                  {check.detail}
                  {!check.ok && check.warnOnly ? ' This does not block the run.' : ''}
                </div>
              </div>
            </div>
          ))}

          <h3 className="hr-h3" style={{ marginTop: 18 }}>
            What approving does
          </h3>
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
            <li className="hr-muted">
              <strong>No bank payment file and no authority submission files.</strong> No bank’s format and no
              authority’s upload format is on record, and Kuwick will not produce a file it cannot stand behind —
              what downloads is a listing for keying or cross-checking at the bank’s and each authority’s own
              portal, and the filing you make there is recorded here with its reference.
            </li>
          </ul>
        </div>

        <div>
          {provisional ? (
            <div className="hr-notice hr-notice--attn" style={{ margin: '0 0 14px' }}>
              <strong>This clinic is not live yet.</strong> Kuwick's statutory rates have not yet been checked against
              KWSP, PERKESO and LHDN's own published tables. Until they are, an approved run is a working figure — not
              something to pay staff with, and not something to file.{' '}
              <Link className="hr-link" to="/admin/hr/settings">
                What is still outstanding
              </Link>
            </div>
          ) : null}

          {/*
            * WHO IS APPROVING THIS, and whether that is finished. Under a
            * two-approval rule, one approval is not an approval.
            */}
          {approval.required > 1 || approval.given.length > 0 ? (
            <>
              <h3 className="hr-h3">Sign-off</h3>
              <p className="hr-muted" style={{ marginTop: 0 }}>{approval.rule}</p>
              <div className="kw-signoffList">
                {Array.from({ length: Math.max(approval.required, approval.given.length) }).map((_, index) => {
                  const person = approval.given[index];
                  return (
                    <div key={index} className="kw-signoffList__row">
                      <span className={`kw-signoffList__mark kw-signoffList__mark--${person ? 'done' : 'todo'}`}>
                        {person ? '✓' : index + 1}
                      </span>
                      <div>
                        <div className="kw-signoffList__title">{person ? person.name : 'Waiting for a second person'}</div>
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
            </>
          ) : null}

          <h3 className="hr-h3">Approve</h3>
          {!canFinaliseHere && !alreadyApproved ? (
            <div className="hr-notice hr-notice--info" style={{ margin: 0 }}>
              <strong>Approving is done on a computer.</strong> Locking a month&apos;s pay needs the whole run in front of you. Review
              and clear blockers here; approve from a desktop.
            </div>
          ) : alreadyApproved ? (
            <p style={{ margin: 0 }}>
              This run was approved{data.run.status === 'PAID' ? ' and paid' : ''}.{' '}
              {provisional ? <StatusChip tone="attn">Provisional</StatusChip> : <StatusChip tone="done">Approved</StatusChip>}
            </p>
          ) : (
            <>
              {/*
                * TWO REASONS THE BUTTON MIGHT NOT WORK, kept apart. "This run
                * has problems" and "you are not the one who may approve it"
                * need different actions.
                */}
              <p className="hr-muted" style={{ marginTop: 0 }}>
                {!approval.youMayApprove && approval.whyNot
                  ? approval.whyNot
                  : gate.canApprove
                    ? approval.completesTheRun
                      ? gate.reason
                      : 'Your approval will be recorded. The run stays open until a second person approves it.'
                    : gate.recordsChanged
                      ? gate.reason
                      : `${gate.blocking} thing${gate.blocking === 1 ? '' : 's'} must be sorted first. Kuwick will not approve a run it cannot compute.`}
              </p>
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={!gate.canApprove || !approval.youMayApprove || approve.isPending}
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
                              message.success(approval.completesTheRun ? 'Payroll approved' : 'Your approval is recorded. One more is needed.');
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
              </button>
              {!gate.canApprove ? (
                <div className="hr-muted hr-small" style={{ marginTop: 8, textAlign: 'center' }}>
                  {gate.recordsChanged
                    ? 'Locked until the month is worked out again'
                    : `Locked until the ${gate.blocking} item${gate.blocking === 1 ? '' : 's'} ${gate.blocking === 1 ? 'is' : 'are'} sorted`}
                </div>
              ) : null}
            </>
          )}
        </div>

        {alreadyApproved ? (
          <div className="hr-notice hr-notice--info" style={{ gridColumn: '1 / -1', margin: 0 }}>
            This run is approved. Payslips, the payment listing and the statutory figures are on the <strong>Pay</strong> stage.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 4 — Pay: what comes OUT of an approved month.
// ---------------------------------------------------------------------------

/**
 * BEFORE APPROVAL THERE IS NOTHING HERE, and the stage says so rather than
 * rendering three empty panels — an empty payslip list reads as "no payslips
 * were produced", which is a different and alarming claim.
 */
function PayStep({ data, runId }: { data: PayrollJourney; runId: string }) {
  const navigate = useNavigate();
  const approved = data.run.status === 'APPROVED' || data.run.status === 'PAID';

  if (!approved) {
    return (
      <div className="hr-empty">
        <div className="hr-strong">{data.run.periodLabel} has not been approved.</div>
        <div className="hr-muted">Payslips and the bank listing are produced from the approved month.</div>
        <button
          type="button"
          className="hr-btn hr-btn--sm"
          style={{ marginTop: 10 }}
          onClick={() => navigate(`?step=${data.review.gate.canApprove ? 'approve' : 'review'}`)}
        >
          {data.review.gate.canApprove ? 'Approve this month' : 'See what is blocking it'}
        </button>
      </div>
    );
  }

  return (
    <div className="hr-pad">
      <PayslipsPanel runId={runId} />
      <PaymentPanel runId={runId} />
      <StatutoryOutputsPanel runId={runId} />
      <PanelHead rule title="The rest of this month" sub="The filing helper and the two documents the month produces, already set to this run." />
      <div className="kw-outputLinks" style={{ padding: '12px 0 0' }}>
        <Link to={`/admin/hr/payroll/${runId}/filing`} className="kw-outputLink">
          <strong>Statutory filing helper</strong>
          <span>KWSP, PERKESO, LHDN and HRD Corp: who to add or remove, the list in portal order, the total to pay, and “mark as submitted”.</span>
        </Link>
        <Link to={`/admin/hr/reports?report=PAYROLL_REGISTER&run=${runId}`} className="kw-outputLink">
          <strong>Payroll register</strong>
          <span>Every employee, every component. Exports to CSV.</span>
        </Link>
        <Link to={`/admin/hr/reports?report=EMPLOYER_COST&run=${runId}`} className="kw-outputLink">
          <strong>Cost to the clinic</strong>
          <span>Wages plus the employer’s own contributions, by branch and legal employer.</span>
        </Link>
      </div>
    </div>
  );
}


/**
 * DISCARD AN UNAPPROVED RUN.
 *
 * A month started too early — before the salaries, the standing or the rest
 * days were in — was a draft nobody could get rid of. It is rendered only on
 * an unapproved run for somebody who may run payroll; the server refuses an
 * approved or paid one regardless, and the confirm says so in the clinic's
 * words before the button does anything.
 */
function DiscardRunButton({ runId, period }: { runId: string; period: string }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const discard = useDiscardPayrollRun();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const month = dayjs(period).format('MMMM YYYY');
  return (
    <>
      <button type="button" className="hr-btn hr-btn--danger" onClick={() => { setProblem(null); setOpen(true); }}>
        Discard draft
      </button>
      <Modal
        open={open}
        title={`Discard the ${month} run?`}
        okText="Discard"
        okButtonProps={{ danger: true }}
        confirmLoading={discard.isPending}
        onCancel={() => setOpen(false)}
        onOk={() =>
          discard.mutate(
            { id: runId, reason: `Discarded the ${month} draft` },
            {
              onSuccess: () => {
                setOpen(false);
                message.success(`${month} discarded. Start it again when the records are ready.`);
                navigate(`/admin/hr/payroll?period=${dayjs(period).format('YYYY-MM')}`);
              },
              onError: (error: Error) => setProblem(error.message),
            },
          )
        }
      >
        {problem ? <div className="hr-notice hr-notice--attn" role="alert">{problem}</div> : null}
        <p>
          Nothing has been paid or filed from this run, so it goes: its figures, its exceptions and any
          edits made in the grid. Hand-keyed inputs for the month are kept. You can start {month} again
          afterwards.
        </p>
        <p className="hr-muted">An approved month is never discarded — reopen it instead.</p>
      </Modal>
    </>
  );
}
