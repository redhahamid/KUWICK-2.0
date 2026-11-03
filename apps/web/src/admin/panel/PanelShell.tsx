import { useMemo, type ReactElement } from 'react';
import { ConfigProvider, Select } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_CATEGORIES } from '../adminNav';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCanCheck } from '../../core/hooks/useCan';
import { usePanelConfigs, usePanelWorkQueue } from '../hooks/useAdmin';
import {
  IconCompany,
  IconDoc,
  IconList,
  IconOpeningBalances,
  IconSliders,
} from '../hr/ui/icons';
import { SectionTileContext, type SectionTile } from '../hr/ui/sectionTile';
import { fontFamily } from '../../design-system/tokens';
import '../hr/ui/slate.css';

/**
 * THE PANEL MODULE'S OWN SHELL.
 *
 * Slate, for the same reason HR is: panel claims are where somebody spends a
 * morning. You move between the work queue, a rejection, a remittance and a
 * panel's terms on one train of thought, and a workspace reads as one place
 * only when its chrome stays put. The three modules that are pages you glance
 * at — Operation, Stock, Finance — keep `HubShell`.
 *
 * WHY THE KIT IS IMPORTED FROM `../hr/ui` RATHER THAN COPIED. It is one kit
 * with an `hr-` prefix for historical reasons (see the header of `slate.css`),
 * and HR is simply where it was written. A second copy under `panel/` would
 * drift from the first within a release, and the module that got the stale
 * copy would be the one nobody was looking at. The guard in
 * `slateIsolation.test.tsx` names the kit's territory, and Panel was added to
 * it by owner decision rather than by an import nobody noticed.
 *
 * `kw-hub--admin` is carried as well, so the Panel screens that have NOT moved
 * to the kit yet keep the look they have today. Without it they would lose the
 * hub's header, card and density normalisation the moment this shell took over
 * — a restyle nobody asked for, applied by omission.
 */
const ICONS: Record<string, () => ReactElement> = {
  '/admin/panel': IconList,
  '/admin/panel/import': IconOpeningBalances,
  '/admin/panel/configuration': IconSliders,
  '/admin/panel/batches': IconDoc,
  '/admin/panel/companies': IconCompany,
};

/** The gradient tile each section's cards wear — see `sectionTile.tsx`. */
const TILES: Record<string, SectionTile> = {
  '/admin/panel': { tone: 'indigo', icon: <IconList /> },
  '/admin/panel/import': { tone: 'sky', icon: <IconOpeningBalances /> },
  '/admin/panel/configuration': { tone: 'slate', icon: <IconSliders /> },
  '/admin/panel/batches': { tone: 'violet', icon: <IconDoc /> },
  '/admin/panel/companies': { tone: 'teal', icon: <IconCompany /> },
};
const FALLBACK_TILE: SectionTile = { tone: 'indigo', icon: <IconList /> };

export function PanelShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();

  const panel = ADMIN_CATEGORIES.find((category) => category.key === 'panel');
  const may = useCanCheck();
  const allItems = panel?.items ?? [];
  // An entry nobody can open is not drawn.
  const items = allItems.filter((item) => may(item.needs));

  /*
   * WHICH ENTRY IS LIT. Exact match first, then the LONGEST entry path that is
   * a segment prefix — so a claim at `/admin/panel/claims/:id` lights the work
   * queue rather than falling back to the first seat and reading as "you are
   * nowhere". Resolved over the FULL list rather than the drawn one, so a URL
   * reached by hand still lights the entry that owns it.
   */
  const activePath = useMemo(() => {
    // `covers` as well as `path`, the same as HR's rail: an absorbed URL
    // lights the entry that owns it. The setup wizard is reached from the
    // workspace's empty state and returns there, so it lights the workspace.
    const all = allItems.flatMap((item) =>
      [item.path, ...(item.covers ?? [])].map((path) => ({ path, owner: item.path })),
    );
    const exact = all.find((entry) => entry.path === location.pathname);
    if (exact) return exact.owner;
    return all
      .filter(
        (entry) =>
          location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]?.owner;
  }, [allItems, location.pathname]);

  /*
   * A NUMBER IN THE RAIL MEANS SOMEBODY IS WAITING — the same rule as HR's.
   *
   * Two seats only, and both are money somebody has to act on: claims sitting
   * in the work queue, and panels whose fee or term nobody has established. A
   * count on Import or Batches would be decoration; nothing there waits on a
   * decision.
   */
  const workQueue = usePanelWorkQueue({});
  const configs = usePanelConfigs();
  const needsAnAnswer = (configs.data ?? []).filter(
    (row) =>
      row.active &&
      (row.feeTreatmentUnresolved ||
        (row.paymentTermDays === null && !row.paymentTermVariesByPayer)),
  ).length;
  const counts: Record<string, number> = {
    '/admin/panel': workQueue.data?.length ?? 0,
    '/admin/panel/configuration': needsAnAnswer,
  };

  const sectionTile = (activePath && TILES[activePath]) || FALLBACK_TILE;

  const railItem = (path: string, label: string) => {
    const Icon = ICONS[path];
    const count = counts[path] ?? 0;
    return (
      <button
        key={path}
        type="button"
        className={`kw-hubRail__item${path === activePath ? ' is-active' : ''}`}
        aria-current={path === activePath ? 'page' : undefined}
        onClick={() => navigate(path)}
      >
        {Icon ? <Icon /> : null}
        {/* The label is its own element so a test can read the NAME of the
            section without the waiting-count beside it. */}
        <span className="hr-side__label">{label}</span>
        {count > 0 ? <span className="hr-side__count">{count}</span> : null}
      </button>
    );
  };

  return (
    <ConfigProvider
      theme={{
        // Same tokens as HR, for the same reason: the kit's controls are drawn
        // against these proportions, and a different radius or text size here
        // would make one module's buttons quietly unlike the other's.
        token: { colorPrimary: '#4b4fc4', colorLink: '#4b4fc4', borderRadius: 12, fontSize: 15, fontFamily },
      }}
    >
      <SectionTileContext.Provider value={sectionTile}>
        <div className="kw-hrSlate kw-hub--admin">
          <div className="hr-shell">
            <aside className="hr-side">
              <span className="kw-hubRail__heading">Panel &amp; claims</span>
              {showSelector ? (
                /* A group-level person has no home clinic, and every
                   branch-scoped screen answers with zeros until they pick one. */
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
              <nav aria-label="Panel sections">
                {items.map((item) => railItem(item.path, item.label))}
              </nav>
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
