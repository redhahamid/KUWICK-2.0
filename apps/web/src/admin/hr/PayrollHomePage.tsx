import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { App, Button, DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, ringgit } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCreatePayrollRun, usePayrollHome } from '../hooks/useAdmin';
import { ProvisionalBanner } from './ProvisionalBanner';
import { PayrollStartGate } from './PayrollStartGate';
import type { PayrollHome } from '../types';

/**
 * PAYROLL HOME — is this month done?
 *
 * The owner rejected a payroll screen that opened on rate tables, verification
 * states and exception codes. This opens on one question and one button.
 *
 * WHAT IS DELIBERATELY NOT HERE: statutory rate configuration, verification
 * state, snapshot mechanics, the exception catalogue, component liability. All
 * of it still exists; none of it is a step in paying somebody this month, so
 * none of it is on the screen somebody opens to pay somebody this month.
 */
export function PayrollHomePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'));
  const home = usePayrollHome({ period, clinicId });
  const createRun = useCreatePayrollRun();

  const data = home.data;

  return (
    <AdminShell
      error={firstError(home)}
      title="Payroll"
      subtitle="One run a month, for the people on your payroll."
      actions={
        <DatePicker
          picker="month"
          size="small"
          allowClear={false}
          value={dayjs(period)}
          onChange={(value) => value && setPeriod(value.format('YYYY-MM'))}
        />
      }
    >
      <ProvisionalBanner statutoryStatus={data?.run?.statutoryStatus ?? data?.periodStatutoryStatus} />

      {data ? (
        <>
          {/* The gate decides whether the month may start, and says who is
              missing what when it may not. It wraps the hero rather than
              sitting beside it so the verdict and the button cannot disagree. */}
          <PayrollStartGate period={period} clinicId={clinicId}>
            {({ canStart, reason }) => (
              <PeriodHero
                data={data}
                busy={createRun.isPending}
                canStart={canStart}
                blockedReason={reason}
                onStart={() =>
                  createRun.mutate(
                    { period: `${period}-01`, clinicId },
                    {
                      onSuccess: (created) => navigate(`/admin/hr/payroll/${(created as { id: string }).id}`),
                      onError: (error: Error) => message.error(error.message),
                    },
                  )
                }
                onContinue={() => data.run && navigate(`/admin/hr/payroll/${data.run.id}`)}
              />
            )}
          </PayrollStartGate>

          <div className="kw-homeGrid">
            <AttentionCard data={data} />
            <SetupCard data={data} />
            <FeedingCard data={data} />
          </div>
        </>
      ) : null}

      <AdminSection title="Recent payrolls">
        <DataTable
          rowKey="id"
          loading={home.isLoading}
          rows={data?.recent ?? []}
          emptyText="No earlier payroll has been run."
          columns={[
            {
              title: 'Period',
              dataIndex: 'period',
              width: 150,
              render: (value: string) => dayjs(`${value}-01`).format('MMMM YYYY'),
            },
            {
              title: 'Status',
              width: 160,
              render: (_: unknown, row: PayrollHome['recent'][number]) =>
                row.statutoryStatus !== 'CONFIGURED' ? (
                  <Tag color="warning">{row.status === 'APPROVED' || row.status === 'PAID' ? 'Provisional' : row.status}</Tag>
                ) : (
                  <Tag color={row.status === 'PAID' ? 'success' : 'processing'}>{row.status}</Tag>
                ),
            },
            { title: 'Employees', dataIndex: 'employeeCount', width: 110, align: 'right' as const },
            {
              title: 'Net pay',
              dataIndex: 'netTotal',
              width: 140,
              align: 'right' as const,
              render: (value: string) => <strong>{ringgit(value)}</strong>,
            },
            {
              title: 'Cost to clinic',
              dataIndex: 'employerCostTotal',
              width: 150,
              align: 'right' as const,
              render: (value: string) => ringgit(value),
            },
            {
              title: '',
              width: 90,
              noExport: true,
              render: (_: unknown, row: PayrollHome['recent'][number]) => (
                <Link to={`/admin/hr/payroll/${row.id}`}>
                  <Button size="small">View</Button>
                </Link>
              ),
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}

/**
 * The period, its state, and the one thing to do about it. A hero rather than a
 * row in a table, because "run September's payroll" is not one of six equally
 * likely actions — it is the reason the page was opened.
 */
function PeriodHero({
  data,
  busy,
  canStart,
  blockedReason,
  onStart,
  onContinue,
}: {
  data: PayrollHome;
  busy: boolean;
  /** False when not one employee could be paid — see PayrollStartGate. */
  canStart: boolean;
  blockedReason: string | null;
  onStart: () => void;
  onContinue: () => void;
}) {
  const [year, month] = data.period.split('-');
  const stateLabel: Record<PayrollHome['state'], string> = {
    NOT_STARTED: 'Not started',
    STARTED: 'In progress',
    READY_TO_REVIEW: 'Ready to review',
    APPROVED: 'Approved',
    PAID: 'Paid',
  };

  return (
    <div className="kw-periodHero">
      <div className="kw-periodHero__date">
        <span className="kw-periodHero__month">{dayjs(`${data.period}-01`).format('MMM').toUpperCase()}</span>
        <span className="kw-periodHero__year">{year.slice(2)}</span>
      </div>

      <div className="kw-periodHero__body">
        <div className="kw-periodHero__titleRow">
          <span className="kw-periodHero__title">{data.periodLabel}</span>
          <Tag color={data.state === 'PAID' || data.state === 'APPROVED' ? 'success' : data.state === 'NOT_STARTED' ? undefined : 'processing'}>
            {stateLabel[data.state]}
          </Tag>
        </div>
        <div className="kw-periodHero__sub">
          {data.employeesExpected} employee{data.employeesExpected === 1 ? '' : 's'} expected
          {data.run?.paymentDate ? ` · pay day ${dayjs(data.run.paymentDate).format('dddd D MMMM')}` : ''}
          {data.contractorsExcluded > 0
            ? ` · ${data.contractorsExcluded} contractor${data.contractorsExcluded === 1 ? '' : 's'} paid separately`
            : ''}
        </div>
      </div>

      {data.run ? (
        <div className="kw-periodHero__figure">
          <span className="kw-periodHero__figureLabel">TAKE-HOME PAY</span>
          <span className="kw-periodHero__figureValue">{ringgit(data.run.netTotal)}</span>
        </div>
      ) : data.recent[0] ? (
        <div className="kw-periodHero__figure">
          {/* An unapproved month's figure is a working number, and the label
              says so — "LAST MONTH'S NET" over a draft read as a paid fact. */}
          <span className="kw-periodHero__figureLabel">
            {data.recent[0].status === 'APPROVED' || data.recent[0].status === 'PAID'
              ? "LAST MONTH'S NET"
              : "LAST MONTH'S NET (not approved yet)"}
          </span>
          <span className="kw-periodHero__figureValue">{ringgit(data.recent[0].netTotal)}</span>
        </div>
      ) : null}

      <div className="kw-periodHero__cta">
        {data.state === 'NOT_STARTED' ? (
          <Button
            type="primary"
            size="large"
            loading={busy}
            // A month that can pay nobody does not start. The reason is on the
            // button rather than discovered six screens later.
            disabled={!canStart}
            title={blockedReason ?? ''}
            onClick={onStart}
          >
            Run {dayjs(`${data.period}-01`).format('MMMM')} payroll
          </Button>
        ) : (
          <Button type="primary" size="large" onClick={onContinue}>
            {data.state === 'APPROVED' || data.state === 'PAID' ? 'Open' : 'Continue'}{' '}
            {dayjs(`${data.period}-01`).format('MMMM')} payroll
          </Button>
        )}
      </div>
    </div>
  );
}

function AttentionCard({ data }: { data: PayrollHome }) {
  // FAIL CLOSED, exactly as PayrollPage documents for the same fact: a null
  // gate on an existing run means "not yet known", and "not yet known" must
  // not read as "nothing is blocking".
  const gateKnown = data.gate !== null && data.gate !== undefined;
  const blocking = data.gate?.blocking ?? 0;
  const warnings = data.gate?.warnings ?? 0;

  return (
    <div className="kw-homeCard">
      <div className="kw-homeCard__head">
        <span className="kw-homeCard__title">Needs attention</span>
        {data.gate ? (
          <span className={`kw-homeCard__count kw-homeCard__count--${blocking > 0 ? 'bad' : warnings > 0 ? 'warn' : 'good'}`}>
            {blocking + warnings}
          </span>
        ) : null}
      </div>
      {!data.run ? (
        <p className="kw-homeCard__body">
          Nothing has been worked out for {dayjs(`${data.period}-01`).format('MMMM')} yet. Start the run and Kuwick will
          tell you what is standing in the way.
        </p>
      ) : !gateKnown ? (
        <p className="kw-homeCard__body">Whether anything is blocking this month has not been worked out yet — open the run to see.</p>
      ) : blocking === 0 && warnings === 0 ? (
        <p className="kw-homeCard__body">Nothing is standing in the way of finishing this month.</p>
      ) : (
        <p className="kw-homeCard__body">
          {blocking > 0 ? (
            <>
              <strong>
                {blocking} thing{blocking === 1 ? '' : 's'} must be sorted
              </strong>{' '}
              before this run can be finished
              {warnings > 0 ? `, and ${warnings} more ${warnings === 1 ? 'is' : 'are'} worth a look` : ''}.
            </>
          ) : (
            <>
              {warnings} thing{warnings === 1 ? '' : 's'} worth a look. None of them stops the run.
            </>
          )}
        </p>
      )}
      {data.run ? (
        <Link to={`/admin/hr/payroll/${data.run.id}?step=review`} className="kw-homeCard__link">
          Open the review
        </Link>
      ) : null}
    </div>
  );
}

function SetupCard({ data }: { data: PayrollHome }) {
  const { setup } = data;
  return (
    <div className="kw-homeCard">
      <div className="kw-homeCard__head">
        <span className="kw-homeCard__title">Employee setup</span>
        <span className="kw-homeCard__count kw-homeCard__count--plain">
          {setup.ready} <span className="kw-homeCard__countOf">/ {setup.total} ready</span>
        </span>
      </div>
      <p className="kw-homeCard__body">
        An employee is ready when their salary, bank account and date of birth are on file. Set once, and true until
        somebody changes them.
      </p>
      <ul className="kw-checkList">
        <CheckRow label="Salary on record" done={setup.salaryOnRecord === setup.total} value={`${setup.salaryOnRecord} / ${setup.total}`} />
        <CheckRow label="Bank account" done={setup.bankAccount === setup.total} value={`${setup.bankAccount} / ${setup.total}`} />
        <CheckRow label="Date of birth" done={setup.dateOfBirth === setup.total} value={`${setup.dateOfBirth} / ${setup.total}`} />
      </ul>
      {/*
        * MONTHLY TAX IS SAID SEPARATELY, and only for the people it is truly
        * outstanding for. Counting it as setup once made a fully set-up clinic
        * read "0 of 8 ready" every month; and after the MTD engine landed,
        * counting everyone without a hand-keyed figure alarmed clinics whose
        * tax profiles let the run CALCULATE it. The server now counts only
        * employees whose figure can neither be calculated nor found entered.
        */}
      {setup.pcbMissing > 0 ? (
        <p className="kw-homeCard__aside">
          <strong>{setup.pcbMissing}</strong> {setup.pcbMissing === 1 ? 'employee has' : 'employees have'} no monthly
          tax figure and no tax profile to calculate one from. Record their tax residence and MTD category, or enter
          the month's PCB by hand — the run will not finish without one or the other.
        </p>
      ) : null}
      <Link to="/admin/hr/payroll/readiness" className="kw-homeCard__link">
        Get ready for payroll
      </Link>
    </div>
  );
}

/**
 * WHAT IS FEEDING THIS MONTH.
 *
 * The point of the card is the sentence, not the numbers: payroll is reading
 * the clinic's own records rather than waiting for somebody to type them in
 * again. An owner who does not believe that will re-key everything.
 */
function FeedingCard({ data }: { data: PayrollHome }) {
  const { feeding } = data;
  return (
    <div className="kw-homeCard">
      <div className="kw-homeCard__head">
        <span className="kw-homeCard__title">Feeding this month</span>
      </div>
      <p className="kw-homeCard__body">
        Nothing here is typed into payroll twice — it comes from where the work was recorded.
      </p>
      <ul className="kw-checkList">
        <FeedRow label="Attendance" value={`${feeding.attendanceDays} days`} hint="from the roster" />
        <FeedRow
          label="Overtime"
          value={`${feeding.overtimeHours} hrs`}
          hint={feeding.unapprovedOvertimeHours > 0 ? `${feeding.unapprovedOvertimeHours} unapproved` : 'all approved'}
          warn={feeding.unapprovedOvertimeHours > 0}
        />
        <FeedRow
          label="Unpaid leave"
          value={`${feeding.unpaidLeaveRequests} request${feeding.unpaidLeaveRequests === 1 ? '' : 's'}`}
          hint="from leave"
        />
        <FeedRow label="Claims" value={ringgit(feeding.claimTotal)} hint={`${feeding.claims} approved`} />
        <FeedRow label="Incentives" value={ringgit(feeding.incentiveTotal)} hint={`${feeding.incentives} approved`} />
      </ul>
    </div>
  );
}

function CheckRow({ label, done, value }: { label: string; done: boolean; value: string }) {
  return (
    <li className="kw-checkList__row">
      <span className={`kw-checkList__mark kw-checkList__mark--${done ? 'done' : 'todo'}`}>{done ? '✓' : '!'}</span>
      <span className="kw-checkList__label">{label}</span>
      <span className={`kw-checkList__value${done ? '' : ' kw-checkList__value--warn'}`}>{value}</span>
    </li>
  );
}

function FeedRow({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <li className="kw-checkList__row kw-checkList__row--feed">
      <span className="kw-checkList__label">{label}</span>
      <span className="kw-checkList__value">{value}</span>
      <span className={`kw-checkList__hint${warn ? ' kw-checkList__hint--warn' : ''}`}>{hint}</span>
    </li>
  );
}
