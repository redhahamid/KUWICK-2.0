import { useMemo, type ReactElement } from 'react';
import { AppstoreOutlined } from '@ant-design/icons';
import { ConfigProvider, Select } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ADMIN_CATEGORIES } from '../adminNav';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCanCheck } from '../../core/hooks/useCan';
import { usePayrollReadiness, useWorkforceToday } from '../hooks/useAdmin';
import {
  IconCalendar,
  IconClaims,
  IconClock,
  IconEmployees,
  IconPayroll,
  IconReports,
  IconSettings,
} from './ui/icons';
import { SectionTileContext, type SectionTile } from './ui/sectionTile';
import { fontFamily } from '../../design-system/tokens';
import './ui/slate.css';

/**
 * THE HR MODULE'S OWN SHELL.
 *
 * Slate, because HR is where somebody spends a morning: a workspace reads as
 * one place when its chrome stays put, and the four modules that are pages you
 * glance at keep the shell they have (`HubShell`). Nothing here can reach them.
 *
 * The five module tabs are NOT here. They are in the app header, where the
 * mockups put them, so this shell draws exactly one thing: which part of HR
 * you are in.
 */
const ICONS: Record<string, () => ReactElement> = {
  '/admin/hr/employees': IconEmployees,
  '/admin/hr/payroll': IconPayroll,
  '/admin/hr/attendance': IconClock,
  '/admin/hr/attendance/roster': IconCalendar,
  '/admin/hr/leave': IconCalendar,
  '/admin/hr/claims': IconClaims,
  '/admin/hr/reports': IconReports,
  '/admin/hr/settings': IconSettings,
};

/**
 * THE TILE EACH SECTION'S PANELS WEAR, by the section the rail has lit —
 * the canvas design puts a gradient icon beside every card title, and a
 * panel inherits its section's unless it names its own. The overview, which
 * has no rail entry, wears the module's indigo.
 */
const TILES: Record<string, SectionTile> = {
  '/admin/hr/employees': { tone: 'indigo', icon: <IconEmployees /> },
  '/admin/hr/payroll': { tone: 'violet', icon: <IconPayroll /> },
  '/admin/hr/attendance': { tone: 'amber', icon: <IconClock /> },
  '/admin/hr/attendance/roster': { tone: 'amber', icon: <IconCalendar /> },
  '/admin/hr/leave': { tone: 'teal', icon: <IconCalendar /> },
  '/admin/hr/claims': { tone: 'green', icon: <IconClaims /> },
  '/admin/hr/reports': { tone: 'sky', icon: <IconReports /> },
  '/admin/hr/settings': { tone: 'slate', icon: <IconSettings /> },
};
const OVERVIEW_TILE: SectionTile = { tone: 'indigo', icon: <AppstoreOutlined aria-hidden="true" /> };

export function HrShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();

  const hr = ADMIN_CATEGORIES.find((category) => category.key === 'hr');
  const may = useCanCheck();
  const allItems = hr?.items ?? [];
  // An entry nobody can open is not drawn.
  const items = allItems.filter((item) => may(item.needs));
  const settings = hr?.settings;

  /*
   * WHICH ENTRY IS LIT.
   *
   * Exact first, because two entries can differ only by a query string. Then
   * the LONGEST entry path that is a segment prefix of the route, so a payroll
   * run at `/admin/hr/payroll/:id` lights Payroll rather than falling back to
   * the first seat. Absorbed URLs light the entry that absorbed them.
   */
  // Resolved over the FULL list, not the drawn one: a payroll URL reached by
  // hand — or still open when a role changed — lights the entry that owns it
  // rather than lighting nothing and reading as "you are nowhere".
  const activePath = useMemo(() => {
    const all = [...allItems, ...(settings ? [settings] : [])].flatMap((item) =>
      [item.path, ...(item.covers ?? [])].map((path) => ({ path, owner: item.path })),
    );
    const exact = all.find((entry) => entry.path === location.pathname);
    if (exact) return exact.owner;
    return all
      .filter((entry) => location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]?.owner;
  }, [allItems, settings, location.pathname]);

  /*
   * A NUMBER IN THE RAIL MEANS SOMEBODY IS WAITING.
   *
   * Gold, and only for the three seats where a person has to decide something:
   * a payroll row that would hold up approval, a leave request, a claim. No
   * count on Employees or Reports — nothing there waits on a decision.
   */
  const period = dayjs().format('YYYY-MM');
  const today = useWorkforceToday(clinicId);
  const readiness = usePayrollReadiness({ period, clinicId });
  const counts: Record<string, number> = {
    '/admin/hr/payroll': readiness.data?.summary.withBlockers ?? 0,
    '/admin/hr/leave': today.data?.pendingLeaveApprovals ?? 0,
    '/admin/hr/claims': today.data?.pendingClaims ?? 0,
  };

  const sectionTile = (activePath && TILES[activePath]) || OVERVIEW_TILE;

  const railItem = (path: string, label: string, apart = false) => {
    const Icon = ICONS[path];
    const count = counts[path] ?? 0;
    return (
      <button
        key={path}
        type="button"
        className={`kw-hubRail__item${apart ? ' kw-hubRail__item--settings' : ''}${path === activePath ? ' is-active' : ''}`}
        aria-current={path === activePath ? 'page' : undefined}
        onClick={() => navigate(path)}
      >
        {Icon ? <Icon /> : null}
        {/* The label is its own element so a test can read the NAME of the
            section without the waiting-count that sits beside it. */}
        <span className="hr-side__label">{label}</span>
        {count > 0 ? <span className="hr-side__count">{count}</span> : null}
      </button>
    );
  };

  return (
    <ConfigProvider
      theme={{
        // antd inside HR follows the HR look (UAT, 10 October 2026,
        // docs/hr-mockup): the deeper indigo is the action colour, 15px text,
        // and the radius of the hand-drawn controls beside it.
        token: { colorPrimary: '#4b4fc4', colorLink: '#4b4fc4', borderRadius: 12, fontSize: 15, fontFamily },
      }}
    >
      <SectionTileContext.Provider value={sectionTile}>
      <div className="kw-hrSlate">
        <div className="hr-shell">
          <aside className="hr-side">
            <span className="kw-hubRail__heading">HR &amp; payroll</span>
            {showSelector ? (
              /* A group-level person has no home clinic, and every branch-scoped
                 screen answers with zeros until they pick one. The mockups have
                 no picker because they are drawn for a single branch. */
              <div style={{ padding: '0 12px 12px' }}>
                <Select
                  size="small"
                  value={clinicId ?? ''}
                  onChange={(value) => setClinicId(value || undefined)}
                  style={{ width: '100%' }}
                  aria-label="Branch"
                  options={[
                    { value: '', label: 'All branches' },
                    ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name })),
                  ]}
                />
              </div>
            ) : null}
            <nav aria-label="HR sections">{items.map((item) => railItem(item.path, item.label))}</nav>
            {settings ? (
              <div className="hr-side__bottom">
                <nav aria-label="HR settings">{railItem(settings.path, settings.label, true)}</nav>
              </div>
            ) : null}
          </aside>
          <main className="hr-main">
            <Outlet />
          </main>
        </div>
      </div>
      </SectionTileContext.Provider>
    </ConfigProvider>
  );
}
