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
/**
 * ATTENDANCE'S TWO VIEWS.
 *
 * Roster and the timesheet are two halves of one question — was somebody
 * meant to work, and did they? — so they are tabs inside Attendance rather
 * than two entries in the rail.
 *
 * Leave and Claims used to be tabs here too. They are not views of
 * attendance; they are two different decisions a manager makes ("may somebody
 * be away", "do we owe somebody money back"), and hiding them behind a third
 * label meant two of the three were invisible until you clicked the third.
 * They have their own rail entries now.
 *
 * PEOPLE_VIEWS and PAYROLL_VIEWS are gone. They carried Medical benefits,
 * Doctor incentives and Locum sessions — supporting workflows that do not
 * belong in navigation, and whose tabs were the last back door into the rail.
 * Their URLs still resolve; incentives and locum are reached from the payroll
 * figure they produce, which is where the question about them is actually
 * asked.
 */
export const ATTENDANCE_VIEWS = [
  { path: '/admin/hr/attendance', label: 'Timesheet' },
  { path: '/admin/hr/attendance/roster', label: 'Roster' },
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
