// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// Vite's ?raw import gives the file's SOURCE. Whether a link lands somewhere is
// a fact about the wiring between two files, which no rendered component can
// show on its own.
import appSource from '../../App.tsx?raw';
import settingsSource from './HrSettingsPage.tsx?raw';

/**
 * EVERY HR LINK LANDS ON A SCREEN, AND LANDS ON IT DIRECTLY.
 *
 * This exists because of a link that did not. `/admin/hr/payroll/locum` was
 * written on the contractor panel of the employee record; there is no such
 * route, so it fell through to `/admin/hr/payroll/:id` and asked the server
 * for a payroll run whose id was the word "locum". Nothing in the type system,
 * the unit suites or the browser walk noticed, because a `<Link>` target is
 * just a string until somebody clicks it.
 *
 * The second guarantee is the one the navigation pass is actually about. The
 * old addresses still resolve — they are in bookmarks, in the user guide and
 * in payroll exception remedies — but a link INSIDE the product that points at
 * a redirect is a link that was never updated. Redirects are for the past, not
 * for the screens shipping today.
 */

const SOURCES = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Comments name dead URLs deliberately; a guard must not read them as links. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** `/admin/hr/employees/${row.staffId}?tab=pay` is the route `/admin/hr/employees/:id`. */
const shape = (target: string) =>
  target
    .split(/[?#]/)[0]
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/\/+$/, '') || '/';

// Every `<Route>` under /admin/hr, and whether it draws a screen or forwards.
const routes = (() => {
  const declarations = [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => ({
    path: match[1],
    at: match.index ?? 0,
  }));
  return declarations
    .map((declaration, index) => {
      const end = declarations[index + 1]?.at ?? appSource.length;
      const forwards = /element=\{<Navigate to="([^"]+)"/.exec(appSource.slice(declaration.at, end));
      return { path: declaration.path, redirectsTo: forwards?.[1] ?? null };
    })
    .filter((route) => route.path.startsWith('/admin/hr'));
})();

/** React Router matches `:id` against one segment. */
const matches = (route: string, target: string) => {
  const a = route.split('/');
  const b = target.split('/');
  return a.length === b.length && a.every((segment, i) => segment.startsWith(':') || segment === b[i]);
};

// Vite normalises a relative glob's keys, so the raw key is the readable name.
const links = Object.entries(SOURCES)
  .filter(([file]) => !file.includes('.test.') && !file.endsWith('/App.tsx'))
  .flatMap(([file, source]) =>
    [...code(source).matchAll(/(?:to=\{?|to: |navigate\(|href=)["'`](\/admin\/hr[^"'`]*)["'`]/g)].map(
      (match) => ({ file, target: match[1] }),
    ),
  );

describe('the HR addresses', () => {
  it('are mounted — nothing links at a route that does not exist', () => {
    expect(links.length).toBeGreaterThan(20);
    const unmounted = links
      .filter(({ target }) => {
        const path = shape(target);
        // A link written as a CONSTANT has to land on a constant route. This
        // is the whole guard: `/admin/hr/payroll/locum` "matches"
        // `/admin/hr/payroll/:id`, which is exactly how it got shipped — the
        // router happily took the word "locum" as a payroll run id and asked
        // the server for it. Only an interpolated link may fill a `:param`.
        const literal = !target.includes('${');
        return literal
          ? !routes.some((route) => route.path === path)
          : !routes.some((route) => matches(route.path, path));
      })
      .map(({ file, target }) => `${file} → ${target}`);
    expect(unmounted).toEqual([]);
  });

  it('are canonical — no screen links at an address that only redirects', () => {
    const forwarded = routes.filter((route) => route.redirectsTo);
    // The redirects themselves are the point of the navigation pass; if this
    // list is empty the guard below is asserting nothing.
    expect(forwarded.length).toBeGreaterThan(10);

    const stale = links
      .filter(({ target }) => forwarded.some((route) => matches(route.path, shape(target))))
      .map(({ file, target }) => `${file} → ${target}`);
    expect(stale).toEqual([]);
  });

  it('open HR in ONE place, whether the tab is clicked or the URL is typed', async () => {
    // These disagreed. `/admin/hr` redirected to Payroll while the module tab
    // navigated to the first rail entry, Employees, so "open HR" meant two
    // different screens depending on how you did it.
    const { ADMIN_CATEGORIES } = await import('../AdminLayout');
    const hr = ADMIN_CATEGORIES.find((category) => category.key === 'hr');
    const bareUrl = routes.find((route) => route.path === '/admin/hr');
    expect({ tab: hr?.landing ?? null, url: bareUrl?.redirectsTo ?? null }).toEqual({
      tab: '/admin/hr/payroll',
      url: '/admin/hr/payroll',
    });
  });

  it('send the rail at screens, never at a redirect', async () => {
    const { ADMIN_CATEGORIES } = await import('../AdminLayout');
    const hr = ADMIN_CATEGORIES.find((category) => category.key === 'hr');
    expect(hr).toBeDefined();
    const rail = [...hr!.items.map((item) => item.path), hr!.settings?.path ?? ''];
    expect(rail).toHaveLength(7);
    for (const path of rail) {
      const route = routes.find((candidate) => matches(candidate.path, path));
      expect({ path, mounted: Boolean(route), redirectsTo: route?.redirectsTo ?? null }).toEqual({
        path,
        mounted: true,
        redirectsTo: null,
      });
    }
  });
});

/**
 * THE WORDS THAT NAME NOTHING.
 *
 * People, Time, Workforce, Hub, Overview, Command Centre, Journey — each was
 * once a tab in this module, and each names a screen rather than a piece of
 * work. "Overview" is the clearest case: nobody arrives at a clinic in the
 * morning meaning to do an overview. They mean to pay somebody, approve a
 * day off, or find out who is in.
 *
 * The rule is about NAMES, not about English: "What you pay people" is a
 * sentence and stays. A label that IS one of these words is the failure.
 */
const BANNED = ['people', 'time', 'workforce', 'hub', 'overview', 'command centre', 'journey'];

describe('the HR labels', () => {
  it('never name a screen after itself', () => {
    const offenders = Object.entries(SOURCES)
      // Vite resolves a relative glob's keys against THIS file, so the HR
      // directory — the one this rule is scoped to — is exactly `./*`.
      .filter(([file]) => /^\.\/[^/]+\.tsx?$/.test(file) && !file.includes('.test.'))
      .flatMap(([file, source]) =>
        [...code(source).matchAll(/(?:label|title|heading)(?:=\{?|: )["'`]([^"'`]+)["'`]/g)]
          .filter((match) => BANNED.includes(match[1].trim().toLowerCase()))
          .map((match) => `${file} → ${match[1]}`),
      );
    expect(offenders).toEqual([]);
  });

  it('name the HR rail after the work, not after the screen', async () => {
    const { ADMIN_CATEGORIES } = await import('../AdminLayout');
    const hr = ADMIN_CATEGORIES.find((category) => category.key === 'hr');
    const labels = [...(hr?.items ?? []).map((item) => item.label), hr?.settings?.label ?? ''];
    expect(labels).toEqual(['Employees', 'Payroll', 'Attendance', 'Leave', 'Claims', 'Reports', 'Settings']);
  });
});

/**
 * A CARD IS A PROMISE ABOUT WHERE IT GOES.
 *
 * The Settings cards were renamed for the restructure and the pages they
 * open were not: "Payroll policies" opened a page headed *Payroll rules*,
 * "Company & statutory" opened *Legal employers*, "Attendance & leave
 * policies" opened *Attendance rules*. Nobody is lost for long, but the card
 * you clicked and the page you land on should agree on what the thing is
 * called, and only a test keeps them agreeing after the next rename.
 */
describe('the Settings cards', () => {
  const cards = [...code(settingsSource).matchAll(/title: '([^']+)',\s*\n\s*description: '[^']*',\s*\n\s*to: '([^']+)'/g)].map(
    (match) => ({ title: match[1], to: match[2] }),
  );

  /** `/admin/hr/settings/payroll` → `PayrollSettingsPage` → its AdminShell title. */
  const titleOf = (path: string) => {
    const mounted = new RegExp(`path="${path}"\\s*element=\\{<([A-Za-z]+)\\s*/>\\}`).exec(
      appSource.replace(/\s+/g, ' '),
    );
    if (!mounted) return { page: null, title: null };
    const page = mounted[1];
    const entry = Object.entries(SOURCES).find(([, source]) =>
      new RegExp(`export function ${page}\\(`).test(source),
    );
    if (!entry) return { page, title: null };
    // A page draws its title with `HrPage` on the Slate kit, or `AdminShell`
    // until it has moved. Either way the first `title=` after the shell is it.
    const at = Math.max(entry[1].indexOf('<HrPage'), entry[1].indexOf('<AdminShell'));
    const body = at >= 0 ? entry[1].slice(at) : '';
    return { page, title: /title="([^"]+)"/.exec(body)?.[1] ?? null };
  };

  // Four since UAT on 10 October 2026 (docs/hr-mockup/SettingsHome.html):
  // pay rules merged, public holidays inside Attendance & leave, and the
  // rarely-touched pages under Advanced.
  it('are the four the settings home asks for', () => {
    expect(cards.map((card) => card.title)).toEqual(['Company & statutory', 'Pay rules', 'Payroll items', 'Attendance & leave']);
  });

  it('open a page that calls itself the same thing', () => {
    const mismatched = cards
      .map((card) => ({ card: card.title, ...titleOf(card.to) }))
      .filter((row) => row.title !== row.card);
    expect(mismatched).toEqual([]);
  });
});
