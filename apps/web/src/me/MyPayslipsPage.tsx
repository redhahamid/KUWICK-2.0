import { useState } from 'react';
import { Button, Drawer, Tag } from 'antd';
import dayjs from 'dayjs';
import { MyEmpty } from './MyKuwickLayout';
import { useMyPayslip, useMyPayslips } from './hooks/useMe';

const money = (value: string | null | undefined) =>
  value === null || value === undefined ? '—' : `RM${Number(value).toFixed(2)}`;

const LABELS: Record<string, string> = {
  basicSalary: 'Basic salary',
  allowances: 'Allowances',
  overtimePay: 'Overtime',
  incentives: 'Incentives',
  bonus: 'Bonus',
  grossPay: 'Gross pay',
  epfEmployee: 'EPF (you)',
  socsoEmployee: 'SOCSO (you)',
  eisEmployee: 'EIS (you)',
  lindungEmployee: 'LINDUNG 24 Jam (you)',
  pcb: 'Income tax (PCB)',
  unpaidLeaveDeduction: 'Unpaid leave',
  otherDeductions: 'Other deductions',
  epfEmployer: 'EPF (clinic)',
  socsoEmployer: 'SOCSO (clinic)',
  eisEmployer: 'EIS (clinic)',
  hrdLevy: 'HRD levy (clinic)',
};

/**
 * MY PAYSLIPS — only mine, and only months that have been approved.
 *
 * A calculated run is a working draft whose figures can still change. Showing
 * it to the person being paid turns every rounding correction into a
 * conversation about why their pay went down, so this screen simply does not
 * have it.
 *
 * The employer's own contributions are shown because Malaysian staff are
 * entitled to see their EPF and SOCSO credited — clearly separated from the
 * deductions, so nobody reads the clinic's EPF share as money taken off them.
 */
export function MyPayslipsPage() {
  const { data, isLoading } = useMyPayslips();
  const [openRun, setOpenRun] = useState<string | undefined>();
  const { data: slip } = useMyPayslip(openRun);

  const lines = (source: Record<string, string | null> | undefined) =>
    Object.entries(source ?? {})
      .filter(([, value]) => value !== null && Number(value) !== 0)
      .map(([key, value]) => (
        <div className="kw-my-shift" key={key}>
          <span className="kw-my-shift__meta">{LABELS[key] ?? key}</span>
          <span className="kw-my-money">{money(value)}</span>
        </div>
      ));

  return (
    <>
      <div>
        <h1 className="kw-my__title">My payslips</h1>
        <p className="kw-my__subtitle">Only yours, and only months that have been approved.</p>
      </div>

      <div className="kw-my-card kw-my-card--flush">
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <MyEmpty title="No payslips yet">
            A payslip appears here once a month's payroll has been approved. A month still being worked on is
            not shown, because the figures in it can still change.
          </MyEmpty>
        ) : (
          data?.map((row) => (
            <div className="kw-my-row" key={row.runId}>
              <div className="kw-my-row__main">
                <span className="kw-my-row__title">{dayjs(row.period).format('MMMM YYYY')}</span>
                <span className="kw-my-row__detail">
                  Gross {money(row.grossPay)}
                  {row.paymentDate ? ` · paid ${dayjs(row.paymentDate).format('D MMM')}` : ''}
                </span>
              </div>
              <div className="kw-my-row__side">
                <span className="kw-my-money">{money(row.netPay)}</span>
                <Tag color={row.runStatus === 'PAID' ? 'green' : 'blue'}>
                  {row.runStatus === 'PAID' ? 'Paid' : 'Approved'}
                </Tag>
                <Button size="small" onClick={() => setOpenRun(row.runId)}>
                  Open
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Drawer
        open={Boolean(openRun)}
        onClose={() => setOpenRun(undefined)}
        title={slip ? dayjs(slip.period).format('MMMM YYYY') : 'Payslip'}
        placement="bottom"
        height="86%"
        destroyOnHidden
      >
        {slip ? (
          <div className="kw-my-form">
            <div className="kw-my-card">
              <div className="kw-my-card__label">Take-home pay</div>
              <div className="kw-my-clock__now">{money(slip.netPay)}</div>
              <div className="kw-my-shift__meta">
                {slip.fullName}
                {slip.unpaidDays && Number(slip.unpaidDays) > 0 ? ` · ${slip.unpaidDays} unpaid day(s)` : ''}
              </div>
            </div>

            <div className="kw-my-card">
              <div className="kw-my-card__label">Earnings</div>
              {lines(slip.earnings)}
            </div>

            <div className="kw-my-card">
              <div className="kw-my-card__label">Taken off</div>
              {lines(slip.deductions)}
            </div>

            <div className="kw-my-card">
              <div className="kw-my-card__label">Paid by the clinic on top of your salary</div>
              {lines(slip.employer)}
              <p className="kw-my__subtitle" style={{ marginTop: 8 }}>
                These are the clinic's own contributions. They are not taken from your pay — they are credited
                to your EPF, SOCSO and EIS accounts on top of it.
              </p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
