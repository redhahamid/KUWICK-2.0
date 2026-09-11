import { App, Button, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AdminShell, firstError } from '../components/AdminShell';
import { Panel } from '../components/Panel';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCreatePayrollRun, usePayrollHome } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { PayrollMonthHeader } from './PayrollMonthHeader';
import { PayrollStartGate } from './PayrollStartGate';
import { PayrollWorkspace } from './PayrollRunPage';
import { ProvisionalBanner } from './ProvisionalBanner';

/**
 * `/admin/hr/payroll` — THE CURRENT MONTH, NOT A PAGE ABOUT PAYROLL.
 *
 * This route used to be a landing dashboard: a hero, three explanatory cards
 * ("Feeding this month", "Employee setup"), and a table of previous runs. The
 * month's own work was one click further in, and the owner's verdict was that
 * their spreadsheet was easier to use. It was: a spreadsheet opens on the
 * month.
 *
 * So this resolves the period's run and mounts the workspace directly. There
 * is no intermediate screen. The three cards did not become a smaller
 * dashboard — they were answers to "who is not ready?", and that question is
 * now answered BESIDE THE PERSON IT IS ABOUT, on their row in the register.
 *
 * THE PERIOD IS IN THE URL. `?period=2026-09` makes a month linkable and
 * survives a refresh, which the local `useState` this replaced did not.
 *
 * WHEN THE MONTH HAS NOT BEEN STARTED the same header still leads — the month,
 * the headcount expected, and dashes where the figures will be. Dashes, not
 * zeros: "RM0.00 net pay" is a claim about a month nobody has worked out yet.
 */
export function PayrollMonthPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const [search, setSearch] = useSearchParams();
  const mayRun = useCan('hr.payroll.run');

  const period = search.get('period') ?? dayjs().format('YYYY-MM');
  const setPeriod = (next: string) => {
    const params = new URLSearchParams(search);
    params.set('period', next);
    // A new month starts at the first stage: carrying `?step=approve` across a
    // month change would open a different month on a stage it may not be at.
    params.delete('step');
    setSearch(params, { replace: true });
  };

  const home = usePayrollHome({ period, clinicId });
  const createRun = useCreatePayrollRun();
  const data = home.data;

  const monthNav = (
    <>
      <DatePicker
        picker="month"
        size="small"
        allowClear={false}
        aria-label="Payroll month"
        value={dayjs(period)}
        onChange={(value) => value && setPeriod(value.format('YYYY-MM'))}
      />
      <Link to="/admin/hr/payroll/history">
        <Button size="small">History</Button>
      </Link>
    </>
  );

  // The month has a run: this IS the workspace. Nothing wraps it.
  if (data?.run) {
    return <PayrollWorkspace runId={data.run.id} monthNav={monthNav} />;
  }

  return (
    <AdminShell error={firstError(home)} title="Payroll">
      <PayrollMonthHeader
        periodLabel={data?.periodLabel ?? dayjs(period).format('MMMM YYYY')}
        status="NOT_STARTED"
        provisional={data ? data.periodStatutoryStatus !== 'CONFIGURED' : false}
        employees={data?.employeesExpected ?? 0}
        gross={null}
        deductions={null}
        employerContributions={null}
        net={null}
        right={monthNav}
      />
      <ProvisionalBanner statutoryStatus={data?.periodStatutoryStatus} />

      {data ? (
        <PayrollStartGate period={period} clinicId={clinicId} salaryOnRecord={data.setup.salaryOnRecord}>
          {({ canStart, reason }) => (
            <Panel
              title="This month has not been started"
              hint={
                canStart
                  ? `Kuwick will work out ${data.employeesExpected} ${
                      data.employeesExpected === 1 ? 'payslip' : 'payslips'
                    } from attendance, leave, claims and incentives already approved.`
                  : (reason ?? undefined)
              }
              action={
                mayRun ? (
                  <Button
                    type="primary"
                    disabled={!canStart}
                    loading={createRun.isPending}
                    onClick={() =>
                      createRun.mutate(
                        { period: `${period}-01`, clinicId },
                        {
                          // Straight into the register, on the stage the work
                          // starts at — not back to a summary of what happened.
                          onSuccess: (created) =>
                            navigate(`/admin/hr/payroll/${(created as { id: string }).id}?step=prepare`),
                          onError: (error: Error) => message.error(error.message),
                        },
                      )
                    }
                  >
                    Start {data.periodLabel} payroll
                  </Button>
                ) : undefined
              }
            >
              <span />
            </Panel>
          )}
        </PayrollStartGate>
      ) : null}
    </AdminShell>
  );
}
