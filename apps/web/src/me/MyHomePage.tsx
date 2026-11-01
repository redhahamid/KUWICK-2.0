import { App } from 'antd';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { clinicDayjs, formatClinicTime } from '../clinical/clinicTime';
import { ApiError, downloadFile } from '../core/api-client';
import { Panel, PanelHead, StatCard } from '../admin/hr/ui';
import { IconCalendar, IconClaims, IconClock, IconDoc, IconEdit, IconPlus } from '../admin/hr/ui/icons';
import { ClockButton } from './clock';
import { ScanClock } from './ScanClock';
import { myPayslipPdfPath, useMyHome, type MyPaidPayslip } from './hooks/useMe';
import { IconCard, PortalEmpty, greetingName, monthLabel, monthShort, rm } from './portal';

/**
 * HOME, after `portal-home.html`: the greeting with today's shift, the clock
 * button, three figures (the last payslip, the leave left, the claims waiting
 * to be paid), the last three payslips with their PDFs, the four things an
 * employee comes here to do, and what happened lately.
 *
 * Every figure is the server's. The page adds nothing up.
 */
export function MyHomePage() {
  const { message } = App.useApp();
  const { data, isLoading } = useMyHome();

  const onDuty = data?.clock.onDuty ?? false;
  const time = (value: string | null | undefined) => (value ? formatClinicTime(value) : '—');

  const download = (slip: MyPaidPayslip) =>
    downloadFile(myPayslipPdfPath(slip.runId), `payslip-${slip.period}.pdf`).catch((error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not download the payslip.'),
    );

  const shift = data?.todayShifts[0];
  const subLine = data
    ? [
        clinicDayjs(`${data.date}T00:00:00`).format('dddd D MMMM YYYY'),
        data.clinicName,
        shift
          ? `shift ${time(shift.startsAt)}–${time(shift.endsAt)}`
          : data.nextShift
            ? `next shift ${clinicDayjs(`${data.nextShift.date}T00:00:00`).format('ddd D MMM')}, ${time(data.nextShift.startsAt)}–${time(data.nextShift.endsAt)}`
            : 'no shift today',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const latest = data?.latestPayslip ?? null;
  const annual = data?.leave.annual ?? null;
  const claims = data?.claims;
  const recentCutoff = dayjs().subtract(14, 'day');

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Hi, {greetingName(data?.fullName)}</h1>
          <div className="hr-sub">{subLine}</div>
        </div>
        <div className="hr-pageHead__actions">
          {onDuty ? <span className="hr-clockState">On duty since {time(data?.clock.since)}</span> : null}
          <ScanClock onDuty={onDuty} />
          <ClockButton onDuty={onDuty} disabled={isLoading} />
        </div>
      </div>

      <div className="hr-stats hr-stats--3">
        <StatCard
          icon={<IconCard />}
          label="Latest payslip"
          value={latest ? rm(latest.netPay) : '—'}
          sub={
            latest ? (
              <>
                {monthLabel(latest.period)}
                {latest.paymentDate ? ` · paid ${dayjs(latest.paymentDate).format('D MMM')}` : ''} ·{' '}
                <a
                  className="hr-link"
                  href={myPayslipPdfPath(latest.runId)}
                  onClick={(event) => {
                    event.preventDefault();
                    void download(latest);
                  }}
                >
                  Download PDF
                </a>
              </>
            ) : (
              'No paid month yet'
            )
          }
        />
        <StatCard
          icon={<IconCalendar />}
          label="Annual leave left"
          value={annual ? `${annual.remaining} ${annual.remaining === 1 ? 'day' : 'days'}` : '—'}
          sub={
            annual
              ? `of ${annual.available} · ${data?.leave.medicalUsed ?? 0} medical used`
              : data?.leave.hasHrRecord === false
                ? 'No HR record for this account'
                : data?.leave.policyName
                  ? 'No annual leave on your policy'
                  : 'No leave policy assigned yet'
          }
        />
        <StatCard
          icon={<IconClaims />}
          label="Claims"
          value={claims ? rm(claims.awaitingTotal) : '—'}
          sub={
            claims && claims.awaitingCount > 0
              ? `${claims.awaitingCount} approved, pays with ${claims.payrollPeriod ? monthShort(claims.payrollPeriod) : 'the next'} payroll`
              : 'Nothing waiting to be paid'
          }
        />
      </div>

      <div className="hr-grid2">
        <Panel>
          <PanelHead
            title="Payslips"
            icon={<IconDoc />}
            tone="violet"
            actions={
              <Link className="hr-link" to="/my/payslips">
                All
              </Link>
            }
          />
          {data && data.payslips.length === 0 ? (
            <PortalEmpty title="No payslip yet">A payslip appears here once a month has been paid.</PortalEmpty>
          ) : (
            <table className="hr-table">
              <tbody>
                {(data?.payslips ?? []).map((slip) => (
                  <tr key={slip.runId}>
                    <td>
                      <b>{monthLabel(slip.period)}</b>
                      <div className="hr-tdSub">{slip.paymentDate ? `Paid ${dayjs(slip.paymentDate).format('D MMM')}` : 'Paid'}</div>
                    </td>
                    <td className="hr-num hr-strong">{rm(slip.netPay)}</td>
                    <td className="hr-num">
                      <button type="button" className="hr-btn hr-btn--sm" onClick={() => void download(slip)}>
                        <IconDoc />
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Quick actions" icon={<IconPlus />} tone="indigo" />
          <div className="hr-quick">
            <Link className="hr-btn" to="/my/leave">
              <IconCalendar />
              Apply for leave
            </Link>
            <Link className="hr-btn" to="/my/claims">
              <IconPlus />
              Submit a claim
            </Link>
            <Link className="hr-btn" to="/my/attendance">
              <IconClock />
              Request attendance correction
            </Link>
            <Link className="hr-btn" to="/my/profile">
              <IconEdit />
              Update bank account
            </Link>
          </div>
          <div className="hr-panelHead--top">
            <PanelHead title="Recent" icon={<IconClock />} tone="slate" />
          </div>
          {data && data.recent.length === 0 ? (
            <PortalEmpty title="Nothing yet">Decisions on your leave and claims, and paid months, show here.</PortalEmpty>
          ) : (
            <div className="hr-tl" style={{ padding: '12px 22px 6px' }}>
              {(data?.recent ?? []).map((event) => (
                <div
                  key={`${event.kind}-${event.title}-${event.at}`}
                  className={dayjs(event.at).isAfter(recentCutoff) ? 'hr-tl__row is-on' : 'hr-tl__row'}
                >
                  <Link to={event.href}>
                    <b>{event.title}</b>
                  </Link>{' '}
                  {event.state} · {dayjs(event.at).format('D MMM')}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
