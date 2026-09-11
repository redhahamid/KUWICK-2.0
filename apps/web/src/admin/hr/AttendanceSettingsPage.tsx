import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { AdminShell } from '../components/AdminShell';
import { AttendanceRulesPanel } from './AttendanceRulesPanel';

/**
 * ATTENDANCE & LEAVE POLICIES — its own settings area.
 *
 * It was a panel two-thirds of the way down the old Settings wall, which is
 * an odd place for the answer to "why does this say I was late" — a question
 * somebody asks in week one and then cannot find where to change.
 */
export function AttendanceSettingsPage() {
  return (
    <AdminShell
      title="Attendance & leave policies"
      subtitle="What counts as late, and what counts as a full day."
      actions={
        <Link to="/admin/hr/settings">
          <Button size="small">← Settings</Button>
        </Link>
      }
    >
      <AttendanceRulesPanel />
    </AdminShell>
  );
}
