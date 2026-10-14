import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { HrPage, Panel, PanelHead } from './ui';
import { usePublicHolidays } from '../../hr/hooks/usePublicHolidays';
import { useShiftTemplates } from '../../appointment/hooks/useRoster';
import { useAttendancePolicy } from '../hooks/useAdmin';
import { WEEK_DAYS } from './ShiftSettingsPage';
import { AttendanceRulesPanel } from './AttendanceRulesPanel';
import { ClaimPolicyPanel } from './ClaimPolicyPanel';
import { LeavePolicyPanel } from './LeavePolicyPanel';

/**
 * ATTENDANCE & LEAVE — its own settings area, public holidays included.
 *
 * It was a panel two-thirds of the way down the old Settings wall, which is
 * an odd place for the answer to "why does this say I was late" — a question
 * somebody asks in week one and then cannot find where to change.
 *
 * Leave entitlement is still not settable here — the server has policies and
 * no screen that edits the days. What IS here now is the part of a leave policy
 * that is money and has a statute over it: whether untaken annual leave is paid
 * out when somebody leaves, which s.60E(3) requires whichever party ends the
 * contract. A clinic may decide otherwise, on the record; the panel is where.
 */
export function AttendanceSettingsPage() {
  const holidays = usePublicHolidays();
  const thisYear = dayjs().year();
  const holidaysThisYear = (holidays.data ?? []).filter((row) => dayjs(row.date).year() === thisYear).length;
  const templates = useShiftTemplates();
  const groupPolicy = useAttendancePolicy();
  const doctorShifts = (templates.data ?? []).filter((row) => row.group === 'DOCTOR').length;
  const staffShifts = (templates.data ?? []).filter((row) => row.group === 'STAFF').length;
  const opening = groupPolicy.data?.policy.openingHours;
  return (
    <HrPage
      title="Attendance & leave"
      sub="What counts as late, what counts as a full day, leave, public holidays and what a claim needs."
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Attendance &amp; leave
        </>
      }
    >
      {/* Shifts first: the roster is what attendance is measured against. */}
      <Panel>
        <PanelHead
          title="Shifts"
          sub={
            `${doctorShifts} doctor shift${doctorShifts === 1 ? '' : 's'}, ${staffShifts} staff shift${staffShifts === 1 ? '' : 's'}. ` +
            `The week starts on ${WEEK_DAYS[groupPolicy.data?.policy.weekStartDay ?? 1]}. ` +
            `Opening hours: ${!opening ? 'not set' : opening.open24Hours ? 'open 24 hours' : `${opening.openTime}–${opening.closeTime}`}.`
          }
          actions={
            <Link className="hr-btn" to="/admin/hr/settings/shifts">
              Open shifts
            </Link>
          }
        />
      </Panel>
      <div className="hr-mt">
        <AttendanceRulesPanel />
      </div>
      {/* Leave sits between attendance and claims because that is the order an
          employee meets them, and because the payout question below belongs to
          whoever is already reading what counts as a full day. */}
      <div className="hr-mt">
        <LeavePolicyPanel />
      </div>
      {/* Public holidays are part of this area (Settings has four cards, not
          six): attendance and leave both read from the one list, which keeps
          its own page for the list itself. */}
      <div className="hr-mt">
        <Panel>
          <PanelHead
            title="Public holidays"
            sub={`${holidaysThisYear} day${holidaysThisYear === 1 ? '' : 's'} for ${thisYear}. Days the clinic is closed; attendance and leave both read from this list.`}
            actions={
              <Link className="hr-btn" to="/admin/hr/settings/public-holidays">
                Open public holidays
              </Link>
            }
          />
        </Panel>
      </div>
      {/* Claims sit with attendance and leave: the three things an employee
          sends from the portal, and the three rules a manager judges them by. */}
      <div className="hr-mt">
        <ClaimPolicyPanel />
      </div>
    </HrPage>
  );
}
