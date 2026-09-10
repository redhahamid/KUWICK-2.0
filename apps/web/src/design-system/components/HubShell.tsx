import { ReactNode, useMemo } from 'react';
import { Grid, Select, Tabs, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';

const { Text, Title } = Typography;

export interface HubItem {
  path: string;
  label: string;
  /**
   * OTHER ROUTES THIS ENTRY OWNS.
   *
   * A nav entry that absorbed screens keeps their URLs working — links to them
   * exist in the user guide, in payroll exception remedies, and in people's
   * bookmarks — but a URL that lights no tab tells somebody they are nowhere.
   * Listing them here means "Schedule & Attendance" stays lit at
   * `/admin/hr/attendance` even though the entry's own path is
   * `/admin/hr/schedule`.
   */
  covers?: string[];
}

export interface HubCategory {
  key: string;
  label: string;
  // Where clicking the main tab lands. Defaults to the first item.
  landing?: string;
  items: HubItem[];
  /**
   * HOW THIS MODULE'S OWN NAVIGATION IS DRAWN.
   *
   * `tabs` (the default) is the horizontal row every module has always used.
   * `rail` is a navy sidebar, for a module whose sections are places you WORK
   * IN rather than pages you glance at — HR, where somebody spends a morning
   * moving between attendance, leave and payroll, and needs to know where they
   * are the whole time. A second horizontal menu says "more tabs"; a rail says
   * "this is a workspace".
   *
   * Per module rather than globally, so the four modules that are fine as tabs
   * are not disturbed to serve the one that is not.
   */
  layout?: 'tabs' | 'rail';
  /**
   * Configuration, kept OUT of the sections list.
   *
   * It is set up once and then rarely opened, so it sits apart on the rail
   * rather than taking one of the six seats somebody uses every day.
   */
  settings?: HubItem;
}

interface HubShellProps {
  title: string;
  categories: HubCategory[];
  // Extra element on the right of the context header (e.g. a link back).
  headerExtra?: ReactNode;
  /**
   * A class on the hub root, so a hub can normalise the screens rendered
   * inside it.
   *
   * Admin uses `kw-hub--admin`: a third of its screens were written for
   * /management years earlier and arrive with their own header idiom, their
   * own card weight and their own table density. Restyling them in place
   * would have changed how they look under /management too; scoping the
   * corrections to this shell means one component, two chromes, no fork.
   */
  scopeClass?: string;
}

// M1 layout shell (owner-approved revision of the focused Management
// audit): horizontal main-category tabs + a contextual secondary submenu
// instead of the permanent 220px left sidebar — Management is charts,
// reports, and wide tables, and the sidebar was eating width they need.
// Shared by Management and CMS Settings so both areas navigate the same
// way. Active category/item derive from the current route (exact match),
// so old bookmarks and redirects light up the right tabs automatically.
//
// Mobile (<md): main tabs scroll horizontally (antd keeps the active tab
// in view); the secondary submenu becomes a full-width dropdown — the
// owner's "Option 2", avoiding two crowded rows of tiny tabs.
export function HubShell({ title, categories, headerExtra, scopeClass }: HubShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();

  /**
   * WHICH NAV ENTRY THIS SCREEN BELONGS TO.
   *
   * This matched the pathname EXACTLY, so every detail route — a payroll run at
   * `/admin/hr/payroll/:id`, anything nested under a listed screen — matched
   * nothing and silently fell back to the FIRST category. The result was an HR
   * screen showing Operation as the active module and no HR submenu at all: the
   * navigation lied about where you were, on the screens people spend longest on.
   *
   * Exact still wins, because some entries differ only by `?view=` and a prefix
   * rule cannot tell those apart. Failing that, the LONGEST item path that is a
   * path-segment prefix of the current route wins — longest so that
   * `/admin/hr/payroll` beats `/admin/hr` for a run detail page.
   */
  const activePath = useMemo(() => {
    // Each entry is matched on its own path AND on every route it absorbed, but
    // resolves back to its own path — the tab that lights is the one you can
    // click, not the old URL you arrived on.
    // Settings is not one of the sections, but it IS a destination — leaving it
    // out of this list meant `/admin/hr/settings` fell back to the longest
    // matching prefix, `/admin/hr`, and lit Overview while you stood in
    // Settings. A rail that highlights the wrong entry is worse than one that
    // highlights nothing.
    const all = categories.flatMap((category) =>
      [...category.items, ...(category.settings ? [category.settings] : [])].flatMap((item) =>
        [item.path, ...(item.covers ?? [])].map((path) => ({ path, owner: item.path })),
      ),
    );
    const exact = all.find((entry) => entry.path === location.pathname);
    if (exact) return exact.owner;
    const prefixes = all.filter(
      (entry) => location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`),
    );
    return prefixes.sort((a, b) => b.path.length - a.path.length)[0]?.owner;
  }, [categories, location.pathname]);

  const activeCategory = useMemo(
    () =>
      categories.find(
        (category) =>
          category.items.some((item) => item.path === activePath) || category.settings?.path === activePath,
      ),
    [categories, activePath],
  );

  const scopeName = clinicId ? (clinics?.find((clinic) => clinic.id === clinicId)?.name ?? null) : null;

  const secondaryItems = activeCategory?.items ?? [];
  const showSecondary = secondaryItems.length > 1;
  // The rail needs real width to be a rail rather than a squeeze; below that
  // the same entries render as the horizontal row, which wraps honestly.
  const useRail = activeCategory?.layout === 'rail' && screens.md;

  return (
    <div
      className={scopeClass}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}
    >
      <div style={{ padding: '10px 24px 0', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {/*
            * WRAPS RATHER THAN BREAKING A WORD.
            *
            * This row was a bare flex with no wrap, so on a 390px phone the
            * hub title was squeezed until the browser hyphenated it mid-word
            * — "Administrati / on" above the branch picker. The classes below
            * let the responsive rules in index.css reach it; the title itself
            * never hyphenates.
            */}
          <div className="kw-hubShell__identity">
            <Title level={4} className="kw-hubShell__title" style={{ margin: 0 }}>
              {title}
            </Title>
            {showSelector ? (
              /*
               * A GROUP-LEVEL PERSON HAS TO BE ABLE TO PICK A BRANCH.
               *
               * Staff with no home clinic — the finance controller who covers
               * both branches, the owner's accountant — resolved to no
               * clinicId at all, and the header simply said "All Branches"
               * with nothing to click. Every branch-scoped endpoint then
               * answered "No branch selected for this request", which the
               * screens rendered as zeros: a day-end page reporting nothing
               * left to reconcile because it did not know which branch to ask
               * about. The picker is the missing half of that sentence.
               */
              <Select
                size="small"
                value={clinicId ?? ''}
                onChange={(value) => setClinicId(value || undefined)}
                style={{ minWidth: 190 }}
                aria-label="Branch"
                options={[
                  // "All branches" is a real scope for a group-level person,
                  // so it is an option they choose rather than the silent state
                  // they land in — a screen showing both branches under the
                  // same heading as one branch is how two totals disagree.
                  { value: '', label: 'All branches' },
                  ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name })),
                ]}
              />
            ) : (
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Viewing: {scopeName ?? 'All Branches'}
              </Text>
            )}
          </div>
          {headerExtra}
        </div>
        <Tabs
          activeKey={activeCategory?.key}
          onChange={(key) => {
            const category = categories.find((c) => c.key === key);
            if (category) navigate(category.landing ?? category.items[0].path);
          }}
          items={categories.map((category) => ({ key: category.key, label: category.label }))}
          size="small"
          tabBarStyle={{ marginBottom: 0 }}
        />
      </div>

      {/* A RAIL MODULE draws its sections down the side and its content beside
          them; everything else keeps the horizontal row it has always had. */}
      {useRail ? (
        <div className="kw-hubRail__frame">
          <nav className="kw-hubRail" aria-label={`${activeCategory?.label ?? ''} sections`}>
            <span className="kw-hubRail__heading">{activeCategory?.label}</span>
            {secondaryItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`kw-hubRail__item${item.path === activePath ? ' is-active' : ''}`}
                aria-current={item.path === activePath ? 'page' : undefined}
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </button>
            ))}
            {/* SET UP ONCE, THEN RARELY OPENED — so it sits apart from the
                sections somebody uses every day rather than competing with
                them for the same attention. */}
            {activeCategory?.settings ? (
              <button
                type="button"
                className={`kw-hubRail__item kw-hubRail__item--settings${
                  activeCategory.settings.path === activePath ? ' is-active' : ''
                }`}
                onClick={() => navigate(activeCategory.settings!.path)}
              >
                {activeCategory.settings.label}
              </button>
            ) : null}
          </nav>
          <div className="kw-hubRail__content">
            <Outlet />
          </div>
        </div>
      ) : (
        <>
          {showSecondary && (
            <div style={{ padding: screens.md ? '0 24px' : '8px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fafafa' }}>
              {screens.md ? (
                <Tabs
                  activeKey={activePath}
                  onChange={(path) => navigate(path)}
                  items={secondaryItems.map((item) => ({ key: item.path, label: item.label }))}
                  size="small"
                  tabBarStyle={{ marginBottom: 0 }}
                  tabBarGutter={24}
                />
              ) : (
                <Select
                  style={{ width: '100%' }}
                  value={secondaryItems.some((item) => item.path === activePath) ? activePath : undefined}
                  onChange={(path) => navigate(path)}
                  options={secondaryItems.map((item) => ({ value: item.path, label: item.label }))}
                />
              )}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: screens.md ? '16px 24px 24px' : '12px 16px 24px' }}>
            <Outlet />
          </div>
        </>
      )}
    </div>
  );
}
