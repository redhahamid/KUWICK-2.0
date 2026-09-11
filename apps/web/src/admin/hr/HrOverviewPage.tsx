import { useMemo } from 'react';
import dayjs from 'dayjs';
import { Button } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { clinicDayjs, formatClinicTime } from '../../clinical/clinicTime';
import { AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { Panel, PanelLink, PanelList, PanelRow, EmptyState } from '../components/Panel';
import { PersonAvatar } from '../components/Person';
import { StatusChip } from '../components/Chip';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useWorkforceToday, usePayrollReadiness, usePayrollHome, useEmployees } from '../hooks/useAdmin';
import { useLeaveRequests } from '../../hr/hooks/useLeaveRequests';
import { HrSetupJourney } from './HrSetupJourney';
import type { PayrollHomeState } from '../types';

/**
 * HR OVERVIEW — "what requires my attention today?"
 *
 * That question, and not "how is the clinic doing", is what the reference
 * sheet's Overview is built around, and it decides the whole layout. Four
 * numbers along the top answer where the workforce stands; four panels below
 * are the work itself, each one a list of things somebody is waiting on rather
 * than a counter.
 *
 * THE COUNTERS ARE GONE. This screen used to open with five attendance tiles
 * and seven exception tiles — twelve numbers, none of which said what to do
 * next. A tile reading "3" teaches a manager they have a problem and nothing
 * about whose it is; the same three, named, are three decisions.
 *
 * WHAT SURVIVES FROM THE OLD SCREEN, because the brief is explicit that
 * nothing important disappears: every exception count is still here, now as
 * named rows inside Needs Attention, and each one still opens the work.
 */

const PAYROLL_STATE: Record<PayrollHomeState, { label: string; tone: 'ok' | 'attention' | 'info' | 'neutral' }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  STARTED: { label: 'In progress', tone: 'info' },
  READY_TO_REVIEW: { label: 'Ready to review', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  PAID: { label: 'Paid', tone: 'ok' },
};

export function HrOverviewPage() {
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const period = dayjs().format('YYYY-MM');

  const today = useWorkforceToday(clinicId);
  const readiness = usePayrollReadiness({ period, clinicId });
  const payroll = usePayrollHome({ period, clinicId });
  const employees = useEmployees({ clinicId });
  const leave = useLeaveRequests();

  const data = today.data;
  const notSetUpYet = (readiness.data?.summary.total ?? 0) === 0;
  const employersMissing = (readiness.data?.employers ?? []).filter((row) => !row.ready).length;
  const payrollState = payroll.data ? PAYROLL_STATE[payroll.data.state] : null;

  /*
   * TODAY'S WORKFORCE — one list, not three.
   *
   * On duty, rostered-but-not-in, and on leave were three separate tables on
   * this screen. They are three states of the same fact, and reading them
   * apart meant scrolling to find out whether the person missing from the
   * first list was late or on holiday.
   */
  const workforce = useMemo(() => {
    const rows: { staffId: string; name: string; state: 'in' | 'due' | 'late' | 'leave'; detail: string }[] = [];
    for (const person of data?.onDuty ?? []) {
      rows.push({
        staffId: person.staffId,
        name: person.name,
        state: 'in',
        detail: `In since ${formatClinicTime(person.since)}`,
      });
    }
    for (const person of data?.notClockedIn ?? []) {
      rows.push({
        staffId: person.staffId,
        name: person.name,
        state: person.overdue ? 'late' : 'due',
        detail: person.overdue
          ? `Shift started ${formatClinicTime(person.dueAt)}`
          : `Due ${formatClinicTime(person.dueAt)}`,
      });
    }
    for (const person of data?.onLeave ?? []) {
      rows.push({ staffId: person.staffId, name: person.name, state: 'leave', detail: person.leaveType });
    }
    // Whoever is not where they should be, first.
    const order = { late: 0, due: 1, in: 2, leave: 3 } as const;
    return rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  }, [data]);

  /*
   * NEEDS ATTENTION — every count that used to be a tile, as a row that names
   * the work and goes to it. Clean rows are dropped rather than shown as a
   * quiet zero: on a panel of eight, eight zeroes is what somebody scrolls
   * past, and the empty state says the same thing in one line.
   */
  const attention = [
    {
      key: 'leave',
      label: 'Leave requests waiting',
      count: data?.pendingLeaveApprovals ?? 0,
      tone: 'attention' as const,
      to: '/admin/hr/leave',
    },
    {
      key: 'punch',
      label: 'Missing clock-in or clock-out',
      count: data?.missingPunches ?? 0,
      tone: 'blocked' as const,
      to: '/admin/hr/attendance',
    },
    {
      key: 'ot',
      label: 'Overtime claimed, not approved',
      count: data?.unapprovedOvertimeClaims ?? 0,
      tone: 'attention' as const,
      to: '/admin/hr/attendance',
    },
    {
      key: 'corrections',
      label: 'Attendance fixes requested',
      count: data?.pendingAttendanceCorrections ?? 0,
      tone: 'attention' as const,
      to: '/admin/hr/attendance',
    },
    {
      key: 'claims',
      label: 'Claims waiting for a decision',
      count: data?.pendingClaims ?? 0,
      tone: 'attention' as const,
      to: '/admin/hr/claims',
    },
    {
      key: 'employer',
      label: 'Company statutory details missing',
      count: employersMissing,
      tone: 'blocked' as const,
      to: '/admin/hr/settings/company',
    },
  ].filter((row) => row.count > 0);

  /*
   * PAYROLL READINESS — a checklist, not a score.
   *
   * The brief's rule, in its own words: never show a user a cryptic 5/8
   * without explaining what is missing. So this panel names each standing
   * fact payroll needs and says how many people still lack it, which is the
   * shape somebody can act on — "3 without a bank account" is an afternoon's
   * work; "18/24 ready" is a mystery.
   *
   * The figures come from `payroll.setup`, the same read the payroll gate
   * uses, so this panel cannot say ready while the gate refuses to start.
   */
  const setup = payroll.data?.setup;
  const checklist = setup
    ? [
        { key: 'salary', label: 'Salary in force', outstanding: setup.total - setup.salaryOnRecord, blocking: true },
        { key: 'bank', label: 'Bank account on file', outstanding: setup.total - setup.bankAccount, blocking: true },
        { key: 'dob', label: 'Date of birth recorded', outstanding: setup.total - setup.dateOfBirth, blocking: true },
        {
          key: 'pcb',
          // THIS MONTH'S WORK, not a gap in anybody's record — which is why it
          // is advisory here and why the payroll gate counts it separately.
          label: 'Monthly tax answered',
          outstanding: setup.pcbMissing,
          blocking: false,
        },
        { key: 'employer', label: 'Company statutory details', outstanding: employersMissing, blocking: true },
      ]
    : [];

  /* LEAVE THIS WEEK — approved leave that lands in the next seven days. */
  const weekLeave = useMemo(() => {
    const from = dayjs().startOf('day');
    const to = from.add(7, 'day');
    return (leave.data ?? [])
      .filter((row) => row.status === 'APPROVED' || row.status === 'PENDING')
      .filter((row) => dayjs(row.endDate) >= from && dayjs(row.startDate) < to)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 6);
  }, [leave.data]);

  return (
    <AdminShell
      error={firstError(today, readiness, payroll)}
      title="Today"
      subtitle={clinicDayjs(`${data?.date ?? ''}T00:00:00`).format('dddd D MMMM YYYY')}
      actions={
        <Button type="primary" onClick={() => navigate('/admin/hr/employees/new')}>
          + Add employee
        </Button>
      }
    >
      {notSetUpYet ? <HrSetupJourney period={period} clinicId={clinicId} /> : null}

      <StatStrip
        stats={[
          { label: 'Total staff', value: employees.data?.length ?? 0 },
          {
            label: 'On duty now',
            // A ZERO IS NOT GOOD NEWS. Painting "0 on duty" green is the same
            // class of error as rendering an uncomputed statutory figure as
            // 0.00 — it dresses an absence as a healthy result.
            value: data?.onDuty?.length ?? 0,
            tone: (data?.onDuty?.length ?? 0) > 0 ? 'good' : 'neutral',
            hint: `${data?.scheduled?.length ?? 0} rostered today`,
          },
          {
            label: 'On leave today',
            value: data?.onLeave?.length ?? 0,
            tone: (data?.onLeave?.length ?? 0) > 0 ? 'warn' : 'neutral',
          },
          {
            // THE MONTH GOES IN THE HINT. "Payroll · September 2026" is 26
            // characters and truncated to "PAYROLL · SEPTEMBE…" on a phone,
            // which is the one word in it that had to survive.
            label: 'Payroll status',
            value: payrollState ? <span className="kw-stat__word">{payrollState.label}</span> : '—',
            tone: payroll.data?.state === 'APPROVED' || payroll.data?.state === 'PAID' ? 'good' : 'neutral',
            hint: `${payroll.data?.periodLabel ?? dayjs(period).format('MMMM YYYY')} · ${
              (readiness.data?.summary.withBlockers ?? 0) > 0
                ? `${readiness.data?.summary.withBlockers} would hold up approval`
                : `${readiness.data?.summary.ready ?? 0} ready to pay`
            }`,
          },
        ]}
      />

      <div className="kw-hrGrid">
        <Panel
          title="Today's workforce"
          hint="Read from the provider roster — changing a shift happens there, not here."
          action={<PanelLink to="/admin/hr/attendance">Attendance</PanelLink>}
        >
          {workforce.length === 0 ? (
            <EmptyState
              title="Nobody is rostered today"
              hint="The roster is the one schedule; attendance reads it and never writes to it."
              action={<Link to="/admin/hr/attendance/roster">Open the roster →</Link>}
            />
          ) : (
            <PanelList>
              {workforce.slice(0, 8).map((row) => (
                <PanelRow
                  key={`${row.staffId}-${row.state}`}
                  to={`/admin/hr/employees/${row.staffId}`}
                  lead={<PersonAvatar name={row.name} size={28} />}
                  title={row.name}
                  meta={row.detail}
                  right={
                    row.state === 'in' ? (
                      <StatusChip tone="ok" dot>
                        On duty
                      </StatusChip>
                    ) : row.state === 'late' ? (
                      <StatusChip tone="blocked" dot>
                        Not clocked in
                      </StatusChip>
                    ) : row.state === 'due' ? (
                      <StatusChip tone="neutral" dot>
                        Due later
                      </StatusChip>
                    ) : (
                      <StatusChip tone="info" dot>
                        On leave
                      </StatusChip>
                    )
                  }
                />
              ))}
            </PanelList>
          )}
        </Panel>

        <Panel
          title="Needs attention"
          tone={attention.some((row) => row.tone === 'blocked') ? 'blocked' : attention.length ? 'attention' : undefined}
        >
          {attention.length === 0 ? (
            <EmptyState title="Nothing is waiting on you" hint="No pending approvals, punches or company gaps." />
          ) : (
            <PanelList>
              {attention.map((row) => (
                <PanelRow
                  key={row.key}
                  to={row.to}
                  title={row.label}
                  right={<StatusChip tone={row.tone}>{row.count}</StatusChip>}
                />
              ))}
            </PanelList>
          )}
        </Panel>

        <Panel
          title={`Payroll readiness · ${payroll.data?.periodLabel ?? dayjs(period).format('MMMM YYYY')}`}
          hint={
            (readiness.data?.summary.withBlockers ?? 0) > 0
              ? `${readiness.data?.summary.ready ?? 0} of ${readiness.data?.summary.total ?? 0} can be paid today.`
              : undefined
          }
          footer={
            <Link to="/admin/hr/payroll">
              <Button type="primary" size="small">
                Continue payroll →
              </Button>
            </Link>
          }
        >
          {checklist.length === 0 ? (
            <EmptyState title="No payroll period is open" hint="Start the month from Payroll." />
          ) : (
            <ul className="kw-readiness">
              {checklist.map((row) => {
                const done = row.outstanding <= 0;
                return (
                  <li
                    key={row.key}
                    className={`kw-readinessItem kw-readinessItem--${done ? 'done' : row.blocking ? 'blocked' : 'advisory'}`}
                  >
                    <span className="kw-readinessItem__mark" aria-hidden>
                      {done ? '✓' : row.blocking ? '✕' : '!'}
                    </span>
                    <span className="kw-readinessItem__text">
                      <span className="kw-readinessItem__label">{row.label}</span>
                      {!done ? (
                        <span className="kw-readinessItem__detail">
                          {row.outstanding} {row.key === 'employer' ? 'company' : 'employee'}
                          {row.outstanding === 1 ? '' : row.key === 'employer' ? 'ies' : 's'} outstanding
                        </span>
                      ) : null}
                    </span>
                    {!done ? (
                      <Link
                        className="kw-readinessItem__fix"
                        to={row.key === 'employer' ? '/admin/hr/settings/company' : '/admin/hr/payroll'}
                      >
                        Fix
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Leave this week" action={<PanelLink to="/admin/hr/leave">Leave</PanelLink>}>
          {weekLeave.length === 0 ? (
            <EmptyState title="No leave in the next seven days" />
          ) : (
            <PanelList>
              {weekLeave.map((row) => (
                <PanelRow
                  key={row.id}
                  to="/admin/hr/leave"
                  lead={<PersonAvatar name={row.staff?.fullName ?? '?'} size={28} />}
                  title={row.staff?.fullName ?? '—'}
                  meta={`${dayjs(row.startDate).format('ddd D MMM')} – ${dayjs(row.endDate).format('ddd D MMM')} · ${row.leaveType.toLowerCase()}`}
                  right={
                    row.status === 'PENDING' ? (
                      <StatusChip tone="attention">Waiting</StatusChip>
                    ) : (
                      <StatusChip tone="ok" dot>
                        Approved
                      </StatusChip>
                    )
                  }
                />
              ))}
            </PanelList>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
