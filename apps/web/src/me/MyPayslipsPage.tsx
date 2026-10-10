import { useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { ApiError, downloadFile } from '../core/api-client';
import { Drawer, Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { IconDoc } from '../admin/hr/ui/icons';
import { myPayslipPdfPath, useMyPayslip, useMyPayslips } from './hooks/useMe';
import { PortalEmpty, monthLabel, rm } from './portal';

const LABELS: Record<string, string> = {
  basicSalary: 'Basic salary',
  allowances: 'Allowances',
  overtimePay: 'Overtime',
  incentives: 'Incentives',
  bonus: 'Bonus',
  grossPay: 'Gross pay',
  epfEmployee: 'EPF',
  socsoEmployee: 'SOCSO',
  eisEmployee: 'EIS',
  lindungEmployee: 'LINDUNG 24 JAM',
  pcb: 'PCB / MTD',
  unpaidLeaveDeduction: 'Unpaid leave',
  otherDeductions: 'Other deductions',
  epfEmployer: 'EPF',
  socsoEmployer: 'SOCSO',
  eisEmployer: 'EIS',
  hrdLevy: 'HRD levy',
};

/**
 * PAYSLIPS — paid months only, newest first, each with the PDF HR issued and
 * a quick look at the lines without leaving the page.
 */
export function MyPayslipsPage() {
  const { message } = App.useApp();
  const { data, isLoading } = useMyPayslips();
  const [openRun, setOpenRun] = useState<string | undefined>();
  const { data: slip } = useMyPayslip(openRun);

  const download = (runId: string, period: string) =>
    downloadFile(myPayslipPdfPath(runId), `payslip-${dayjs(period).format('YYYY-MM')}.pdf`).catch((error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not download the payslip.'),
    );

  const lines = (source: Record<string, string | null> | undefined) =>
    Object.entries(source ?? {})
      .filter(([, value]) => value !== null && Number(value) !== 0)
      .map(([key, value]) => (
        <span key={key} style={{ display: 'contents' }}>
          <span className="hr-kv__k">{LABELS[key] ?? key}</span>
          <span className="hr-kv__v">{rm(value)}</span>
        </span>
      ));

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Payslips</h1>
          <div className="hr-sub">Paid months only. The PDF is the same document HR issues.</div>
        </div>
      </div>

      <Panel>
        <PanelHead title="Every paid month" />
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <PortalEmpty title="No payslips yet">
            A payslip appears here once a month's salary has been paid. A month still being worked on is not
            shown, because the figures in it can still change.
          </PortalEmpty>
        ) : (
          <table className="hr-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="hr-num">Gross</th>
                <th className="hr-num">Net</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.runId}>
                  <td>
                    <b>{monthLabel(dayjs(row.period).format('YYYY-MM'))}</b>
                    <div className="hr-tdSub">
                      {row.paymentDate ? `Paid ${dayjs(row.paymentDate).format('D MMM')}` : 'Paid'}
                    </div>
                  </td>
                  <td className="hr-num">{rm(row.grossPay)}</td>
                  <td className="hr-num hr-strong">{rm(row.netPay)}</td>
                  <td className="hr-num">
                    <span className="hr-dots">
                      <button type="button" className="hr-btn hr-btn--sm" onClick={() => setOpenRun(row.runId)}>
                        Lines
                      </button>
                      <button
                        type="button"
                        className="hr-btn hr-btn--sm"
                        onClick={() => void download(row.runId, String(row.period))}
                      >
                        <IconDoc />
                        PDF
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Drawer
        open={Boolean(openRun)}
        onClose={() => setOpenRun(undefined)}
        title={slip ? monthLabel(dayjs(slip.period).format('YYYY-MM')) : 'Payslip'}
        sub={slip ? `Take-home ${rm(slip.netPay)}` : undefined}
      >
        {slip ? (
          <>
            <PanelHead title="Earnings" />
            <div className="hr-kv">{lines(slip.earnings)}</div>
            <PanelHead title="Deductions" />
            <div className="hr-kv">{lines(slip.deductions)}</div>
            {slip.payments && slip.payments.length > 1 ? (
              <>
                {/* A month paid on several dates: what goes out when (UAT, 10 October 2026). */}
                <PanelHead title="When it is paid" />
                <div className="hr-kv" data-testid="my-pay-dates">
                  {slip.payments.map((payment) => (
                    <span key={payment.date} style={{ display: 'contents' }}>
                      <span className="hr-kv__k">
                        {dayjs(payment.paidOn ?? payment.date).format('D MMM YYYY')} · {payment.paidOn ? 'paid' : 'due'}
                      </span>
                      <span className="hr-kv__v">{rm(payment.amountCents / 100)}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            <PanelHead title="Paid by the clinic on top of your salary" />
            <div className="hr-kv">{lines(slip.employer)}</div>
            <div className="hr-portal__empty">
              These are the clinic's own contributions, credited to your EPF, SOCSO and EIS accounts. They are not
              taken from your pay.
              {slip.unpaidDays && Number(slip.unpaidDays) > 0 ? ` ${slip.unpaidDays} unpaid day(s) this month.` : ''}
            </div>
            <StatusChip tone={slip.runStatus === 'PAID' ? 'done' : 'info'}>
              {slip.runStatus === 'PAID' ? 'Paid' : 'Approved'}
            </StatusChip>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
