import { App, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCalculatePayroll, useCreatePayrollRun, usePayrollHome } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { PayrollStartGate } from './PayrollStartGate';
import { PayrollWorkspace } from './PayrollRunPage';
import { ProvisionalBanner } from './ProvisionalBanner';
import { HrPage, Panel, PanelHead, SegControl, StatCard, StatRow } from './ui';
import { IconHistory, IconPayroll } from './ui/icons';

/** The query's own error, as a sentence, or nothing. */
const errorText = (query: { error: unknown }) => (query.error instanceof Error ? query.error.message : null);

/**
 * `/admin/hr/payroll` — THE CURRENT MONTH, NOT A PAGE ABOUT PAYROLL.
 *
 * This resolves the period's run and mounts the workspace directly. There is
 * no intermediate screen: a spreadsheet opens on the month, and so does this.
 *
 * THE PERIOD IS IN THE URL. `?period=2026-09` makes a month linkable and
 * survives a refresh. The month control is the mockup's three-way segment —
 * last month, this month, next month — so moving a month is one click and
 * the neighbours are always named.
 *
 * WHEN THE MONTH HAS NOT BEEN STARTED the same four figures still lead, with
 * dashes where they will be. Dashes, not zeros: "RM0.00 net pay" is a claim
 * about a month nobody has worked out yet.
 */
export function PayrollMonthPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const [search, setSearch] = useSearchParams();
  const mayRun = useCan('hr.payroll.run');

  const period = search.get('period') ?? dayjs().format('YYYY-MM');
  const setPeriod = (next: string) => {
    if (next === period) return;
    const params = new URLSearchParams(search);
    params.set('period', next);
    // A new month starts at the first stage: carrying `?step=approve` across a
    // month change would open a different month on a stage it may not be at.
    params.delete('step');
    setSearch(params, { replace: true });
  };

  const home = usePayrollHome({ period, clinicId });
  const createRun = useCreatePayrollRun();
  const calculate = useCalculatePayroll();
  const data = home.data;

  // ONE STEP EITHER WAY, OR ANY MONTH AT ALL. The three segments walk the
  // calendar; the picker beside them jumps straight to a month, which is the
  // only way to reach January from September without eight taps.
  const monthNav = (
    <>
      <SegControl<string>
        label="Payroll month"
        value={period}
        onChange={setPeriod}
        options={[
          { value: dayjs(period).subtract(1, 'month').format('YYYY-MM'), label: dayjs(period).subtract(1, 'month').format('MMM') },
          { value: period, label: dayjs(period).format('MMM YYYY') },
          { value: dayjs(period).add(1, 'month').format('YYYY-MM'), label: dayjs(period).add(1, 'month').format('MMM') },
        ]}
      />
      <DatePicker
        picker="month"
        value={dayjs(period)}
        onChange={(value) => value && setPeriod(value.format('YYYY-MM'))}
        allowClear={false}
        format="MMM YYYY"
        aria-label="Choose a month"
        style={{ width: 124 }}
      />
    </>
  );

  // The month has a run: this IS the workspace. Nothing wraps it.
  if (data?.run) {
    return <PayrollWorkspace runId={data.run.id} monthNav={monthNav} />;
  }

  const label = data?.periodLabel ?? dayjs(period).format('MMMM YYYY');
  return (
    <HrPage
      title="Payroll"
      sub="One run per month. Grey cells come from records or are worked out for you; a white cell opens that person’s items for the month, and an item with a column of its own is typed straight in."
      error={errorText(home)}
      actions={
        <>
          {monthNav}
          <Link className="hr-btn" to="/admin/hr/payroll/history">
            <IconHistory />
            History
          </Link>
        </>
      }
    >
      <StatRow>
        <StatCard icon={<IconPayroll />} label="Gross pay" value="—" sub={data ? `${data.employeesExpected} with a salary on record` : undefined} />
        <StatCard icon={<IconPayroll />} label="Employee deductions" value="—" sub="EPF, SOCSO, EIS, PCB" />
        <StatCard icon={<IconPayroll />} label="Employer contributions" value="—" sub="Paid on top of gross" />
        <StatCard icon={<IconPayroll />} label="Net pay" value="—" sub="Not started" />
      </StatRow>
      <ProvisionalBanner statutoryStatus={data?.periodStatutoryStatus} />

      {data ? (
        <PayrollStartGate period={period} clinicId={clinicId} salaryOnRecord={data.setup.salaryOnRecord}>
          {({ canStart, reason }) => (
            <Panel>
              <PanelHead
                title={`${label} has not been started`}
                sub={
                  canStart
                    ? `Kuwick will work out ${data.employeesExpected} ${data.employeesExpected === 1 ? 'payslip' : 'payslips'} from attendance, leave, claims, recurring items and incentives already approved.`
                    : (reason ?? undefined)
                }
                actions={
                  mayRun ? (
                    <button
                      type="button"
                      className="hr-btn hr-btn--primary"
                      disabled={!canStart || createRun.isPending || calculate.isPending}
                      onClick={async () => {
                        /*
                         * STARTING A MONTH WORKS IT OUT.
                         *
                         * Creating the run only opened an empty one: the grid
                         * then drew a dash in every cell, RM0.00 in every
                         * total and every employee LEFT OUT, with "Continue to
                         * review" refusing — because a run with no lines has
                         * nobody in it. The only way forward was a button
                         * called "Save draft", which does not sound like the
                         * thing that makes a month appear, and the panel above
                         * this button has already promised that Kuwick will
                         * work the payslips out.
                         *
                         * A failure here still opens the run. The month exists
                         * either way, and the grid says more about why it is
                         * empty than a toast on a screen you never left.
                         */
                        try {
                          const created = (await createRun.mutateAsync({ period: `${period}-01`, clinicId })) as {
                            id: string;
                            carried: { from: string; carried: number; skipped: number; people: number; repeated: boolean } | null;
                          };
                          // WHAT THE MONTH STARTED WITH. Lines copied from
                          // last month for the items the clinic marked to
                          // carry are said out loud, with the one-off late
                          // payments that were left behind.
                          if (created.carried && created.carried.carried > 0) {
                            const { carried, from, people, skipped } = created.carried;
                            message.info(
                              `${carried} ${carried === 1 ? 'line' : 'lines'} carried from ${from} for ${people} ${people === 1 ? 'person' : 'people'}: edit or clear any that should not repeat.` +
                                (skipped > 0 ? ` ${skipped} one-off late ${skipped === 1 ? 'payment was' : 'payments were'} not carried.` : ''),
                              8,
                            );
                          }
                          try {
                            await calculate.mutateAsync(created.id);
                          } catch (error) {
                            message.error((error as Error).message);
                          }
                          // Straight into the grid, on the stage the work
                          // starts at — not back to a summary of what happened.
                          navigate(`/admin/hr/payroll/${created.id}?step=prepare`);
                        } catch (error) {
                          message.error((error as Error).message);
                        }
                      }}
                    >
                      Start {label} payroll
                    </button>
                  ) : undefined
                }
              />
            </Panel>
          )}
        </PayrollStartGate>
      ) : null}
    </HrPage>
  );
}
