import { Link } from 'react-router-dom';
import { HrPage } from './ui';
import { AttendanceRulesPanel } from './AttendanceRulesPanel';
import { ClaimPolicyPanel } from './ClaimPolicyPanel';
import { LeavePolicyPanel } from './LeavePolicyPanel';

/**
 * ATTENDANCE & LEAVE POLICIES — its own settings area.
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
  return (
    <HrPage
      title="Attendance & leave policies"
      sub="What counts as late, what counts as a full day, and what a claim needs."
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Attendance &amp; leave policies
        </>
      }
    >
      <AttendanceRulesPanel />
      {/* Leave sits between attendance and claims because that is the order an
          employee meets them, and because the payout question below belongs to
          whoever is already reading what counts as a full day. */}
      <div className="hr-mt">
        <LeavePolicyPanel />
      </div>
      {/* Claims sit with attendance and leave: the three things an employee
          sends from the portal, and the three rules a manager judges them by. */}
      <div className="hr-mt">
        <ClaimPolicyPanel />
      </div>
    </HrPage>
  );
}
