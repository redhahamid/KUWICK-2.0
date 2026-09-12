import { Link } from 'react-router-dom';
import { HrPage } from './ui';
import { AttendanceRulesPanel } from './AttendanceRulesPanel';
import { ClaimPolicyPanel } from './ClaimPolicyPanel';

/**
 * ATTENDANCE & LEAVE POLICIES — its own settings area.
 *
 * It was a panel two-thirds of the way down the old Settings wall, which is
 * an odd place for the answer to "why does this say I was late" — a question
 * somebody asks in week one and then cannot find where to change.
 *
 * Leave entitlement is not on this page yet: the product has leave policies
 * on the server and no screen that sets them. The card that opens this page
 * promises only what it delivers.
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
      {/* Claims sit with attendance and leave: the three things an employee
          sends from the portal, and the three rules a manager judges them by. */}
      <div className="hr-mt">
        <ClaimPolicyPanel />
      </div>
    </HrPage>
  );
}
