import { Segmented } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * NAVIGATION WITHIN A WORK AREA.
 *
 * The HR rail carries six groups now instead of twelve destinations, and two
 * of those groups are one subject that had been split in half: "was somebody
 * meant to work, and did they?" is Schedule and Attendance, and "what has
 * somebody asked me to decide?" is Leave and Claims.
 *
 * A THIRD RAIL WOULD UNDO THE POINT. The row above already answers "which part
 * of HR am I in"; asking it twice is how twelve tabs happened in the first
 * place. This is a segmented control inside the page — visibly a view switch
 * on one subject rather than another level of the map.
 *
 * Each view keeps its own URL, so a link to Attendance still opens Attendance.
 */
export const TIME_VIEWS = [
  { path: '/admin/hr/time', label: 'Attendance' },
  { path: '/admin/hr/time/roster', label: 'Roster' },
  { path: '/admin/hr/time/leave', label: 'Leave' },
  { path: '/admin/hr/time/claims', label: 'Claims' },
];

/**
 * PAYROLL'S OWN THREE VIEWS.
 *
 * Doctor incentives and locum sessions were top-level HR tabs, then routes
 * with no way in: they light Payroll in the rail, and nothing on the payroll
 * screen mentioned them. They are pay INPUTS — things that feed a payslip and
 * a payable — so they belong to Payroll the way Roster and Claims belong to
 * Time & Leave, and they get the same switcher.
 *
 * The RUN itself is deliberately not here: inside a run the stage strip is the
 * navigation, and two switchers on one screen is how twelve tabs happened.
 */
export const PAYROLL_VIEWS = [
  { path: '/admin/hr/payroll', label: 'Payroll' },
  { path: '/admin/hr/incentives', label: 'Doctor incentives' },
  { path: '/admin/hr/locum', label: 'Locum sessions' },
];

export function WorkAreaTabs({ views }: { views: { path: string; label: string }[] }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Longest matching path wins, so a detail route nested under one view does
  // not fall back to the first.
  const active =
    views
      .filter((view) => location.pathname === view.path || location.pathname.startsWith(`${view.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? views[0].path;

  return (
    <Segmented
      className="kw-workAreaTabs"
      value={active}
      onChange={(value) => navigate(String(value))}
      options={views.map((view) => ({ value: view.path, label: view.label }))}
    />
  );
}
