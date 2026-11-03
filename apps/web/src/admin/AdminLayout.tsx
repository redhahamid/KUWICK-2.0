import { useLocation } from 'react-router-dom';
import { HubShell } from '../design-system/components/HubShell';
import { HrShell } from './hr/HrShell';
import { PanelShell } from './panel/PanelShell';
import { ADMIN_CATEGORIES } from './adminNav';

/** The nav config moved to `adminNav.ts` so the app header can read it without
    depending on this component. Re-exported because the guards import it here. */
export { ADMIN_CATEGORIES } from './adminNav';

/**
 * ONE ADMIN, TWO CHROMES — for as long as it takes.
 *
 * HR and Panel are built on the Slate kit. Operation, Stock and Finance are
 * not, and repainting them is still out of scope, so the choice is made here
 * rather than inside `HubShell`: the two workspaces get their own shell, the
 * other three keep the one they have, and neither can change the other by
 * accident.
 *
 * WHY THOSE TWO. Both are places somebody spends a morning rather than pages
 * they glance at — you move between attendance, leave and payroll on one train
 * of thought, and between the claim queue, a rejection and a remittance on
 * another. The chrome has to stay put for that to read as one place. Panel
 * joined on the owner's instruction of 3 November 2026, with the same kit
 * rather than a second copy of it.
 *
 * The five module tabs are NOT drawn here for either — they sit in the slate
 * app header (see `AppLayout`), which is where the Slate mockups put them.
 * Exactly one set of module tabs renders on any page, whichever shell is in
 * use.
 */
export function AdminLayout() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin/hr')) return <HrShell />;
  if (location.pathname.startsWith('/admin/panel')) return <PanelShell />;

  // `kw-hub--admin` is what makes a mounted Management screen look native:
  // see the "ONE ADMIN" block in index.css. It normalises the older header,
  // card and table idioms to this hub's, and only inside this hub.
  return <HubShell scopeClass="kw-hub--admin" title="Administration" categories={ADMIN_CATEGORIES} />;
}
