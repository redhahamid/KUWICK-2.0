import { useLocation } from 'react-router-dom';
import { HubShell } from '../design-system/components/HubShell';
import { HrShell } from './hr/HrShell';
import { ADMIN_CATEGORIES } from './adminNav';

/** The nav config moved to `adminNav.ts` so the app header can read it without
    depending on this component. Re-exported because the guards import it here. */
export { ADMIN_CATEGORIES } from './adminNav';

/**
 * ONE ADMIN, TWO CHROMES — for as long as it takes.
 *
 * HR is being rebuilt on the Slate kit. Operation, Stock, Panel and Finance
 * are not, and repainting them is explicitly out of scope, so the choice is
 * made here rather than inside `HubShell`: HR gets its own shell, the other
 * four keep the one they have, and neither can change the other by accident.
 *
 * The five module tabs are NOT drawn here for HR — they sit in the slate app
 * header (see `AppLayout`), which is where the Slate mockups put them. Exactly
 * one set of module tabs renders on any page, whichever shell is in use.
 */
export function AdminLayout() {
  const location = useLocation();
  if (location.pathname.startsWith('/admin/hr')) return <HrShell />;

  // `kw-hub--admin` is what makes a mounted Management screen look native:
  // see the "ONE ADMIN" block in index.css. It normalises the older header,
  // card and table idioms to this hub's, and only inside this hub.
  return <HubShell scopeClass="kw-hub--admin" title="Administration" categories={ADMIN_CATEGORIES} />;
}
