import { Locator, Page, expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './support/app';

/**
 * THE CATALOGUE FINDABILITY GUARDRAIL (owner rule, 2026-08-13).
 *
 * "A catalogue is only searchable if EVERY surface queries the same source
 *  with the same fields — verify each surface independently; fixing one proves
 *  nothing about the other."
 *
 * This exists because the same defect has now shipped three times, and the
 * third instance is the one that settles the argument:
 *
 *   DIAGNOSES  — 162 rows reached staging and a doctor typing "urti" matched
 *                nothing. The seed wrote one category, the surface queried
 *                another, and an empty antd dropdown renders silence, so the
 *                outage had no symptom to report.
 *   MEDICINES  — 181 of 236 medicines carry a Malay group tag (BATUK, DEMAM,
 *                ANTIBIOTIK, 42 groups) and NOTHING looked at that column.
 *                Two surfaces, broken two different ways: the server matched
 *                name and code, and Flow never asked the server at all — it
 *                filters the catalogue client-side on the option's printed
 *                label.
 *   SERVICES   — the server matched `name` alone, so a procedure could not be
 *                found by the code on its own order form, while the two rails
 *                that filter client-side found it perfectly well, because
 *                their label happens to read "CODE — Name". One catalogue,
 *                two surfaces, broken in OPPOSITE directions. A test of either
 *                one would have certified the other.
 *
 * So the assertion is deliberately shaped as a TABLE, not as prose: every
 * catalogue, every surface that exposes its search, and a term that matches a
 * field which is NOT the name. A term matching the name proves nothing — name
 * matching has never been the thing that broke.
 *
 * A surface added later without a row here is the gap this file is for. When
 * you add a search box onto a catalogue, add it here.
 */

const VIEWPORT = { width: 1536, height: 864 };

/** Open a patient's record and force a layout. */
async function openRecord(page: Page, layout: 'canvas' | 'flow'): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await page.getByRole('tab', { name: /^consultation/i }).click();
  await page.getByRole('link', { name: /Ujian/i }).first().click();
  await expect(page.getByText('Record View')).toBeVisible();
  await page.evaluate((chosen: string) => {
    const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const staffId = session?.state?.staff?.id;
    window.localStorage.setItem(
      'kuwick-record-view-layout-v2',
      JSON.stringify({
        state: { byStaffId: staffId ? { [staffId]: chosen } : {}, anonymous: chosen },
        version: 0,
      }),
    );
  }, layout);
  await page.reload();
}

/**
 * Type a term into a search box and require that the dropdown offers
 * something.
 *
 * TYPED, never opened-and-scanned: antd virtualises, so on a real 236-item
 * catalogue the wanted row is not in the DOM until the list narrows — which is
 * also the only way a client-side filter is exercised at all. Opening and
 * looking worked only while the database held a handful of demo rows, which is
 * the same illusion that hid the empty staging catalogue.
 */
async function findsSomething(page: Page, box: Locator, term: string): Promise<void> {
  await expect(box).toBeVisible();
  await box.click();
  const input = (await box.evaluate((node: Element) => node.tagName)) === 'INPUT' ? box : box.locator('input').first();
  await input.fill(term);
  await expect(
    page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first(),
    `"${term}" matched nothing on this surface`,
  ).toBeVisible();
}

interface Surface {
  /** Named so a failure says WHICH surface, not just "a search box". */
  name: string;
  layout: 'canvas' | 'flow';
  /** Navigate to the surface and return its search box. */
  reach: (page: Page) => Promise<Locator>;
  /**
   * A term for THIS surface, where the catalogue's default does not apply.
   *
   * Some surfaces legitimately expose a slice of a catalogue rather than all
   * of it — the services rail offers STANDARD_SERVICE only, so a TASK_ORDER's
   * code is correctly absent from it. That is a scope fact, not a findability
   * defect, and papering over it with a term that matches everywhere would
   * hide the very thing this file tests. Each such surface gets its own
   * non-name term instead.
   */
  term?: string;
  field?: string;
}

interface CatalogueCase {
  catalogue: string;
  /** A term matching a field that is NOT the name. */
  term: string;
  /** Which non-name field the term matches — reported on failure. */
  field: string;
  surfaces: Surface[];
}

/** Flow's Record View sections are plain labels, not tabs. */
async function flowSection(page: Page, label: string): Promise<void> {
  await page.getByText(label, { exact: true }).first().click();
}

/** An antd Select whose placeholder text identifies it (placeholders are spans, not attributes). */
function selectByPlaceholder(page: Page, text: string): Locator {
  return page.locator('.ant-select').filter({ hasText: text }).first();
}

const CATALOGUES: CatalogueCase[] = [
  {
    catalogue: 'diagnoses',
    // Not seeded by any spec — it comes from the clinic's own import, which is
    // the only kind of term that can catch this class.
    term: 'urti',
    field: 'the shortform (nobody types "Acute upper respiratory infection")',
    surfaces: [
      {
        name: 'Canvas — diagnosis rail',
        layout: 'canvas',
        reach: async (page) => page.getByLabel('Search diagnosis').first(),
      },
      {
        name: 'Flow — Diagnosis section',
        layout: 'flow',
        reach: async (page) => {
          await flowSection(page, 'Diagnosis');
          return page.getByLabel('Search diagnosis').first();
        },
      },
    ],
  },
  {
    catalogue: 'medicines',
    term: 'batuk',
    field: 'the clinic\'s Malay group tag',
    surfaces: [
      {
        name: 'Canvas — the rail\'s medicine search box',
        layout: 'canvas',
        // Always visible: b1 removed the button that used to stand in front
        // of it, so there is nothing to click first.
        reach: async (page) => page.getByRole('combobox', { name: 'Add medicine' }).first(),
      },
      {
        name: 'Flow — Medications section (filters in the BROWSER)',
        layout: 'flow',
        reach: async (page) => {
          await flowSection(page, 'Medications');
          return selectByPlaceholder(page, 'Search medicine');
        },
      },
    ],
  },
  {
    catalogue: 'services & procedures',
    // The code on the order form. Deliberately the hyphenated form, which does
    // NOT appear in the service's name ("Consultation (E2E)") — a term that
    // also matches the name would prove nothing.
    term: 'E2E-CONSULT',
    field: 'the service code',
    surfaces: [
      {
        name: 'Canvas — Add order (asks the SERVER)',
        layout: 'canvas',
        reach: async (page) => {
          await page.getByRole('button', { name: /add order/i }).first().click();
          return page.getByLabel('Search procedures and investigations').first();
        },
      },
      {
        name: 'Canvas — services rail (filters in the BROWSER)',
        layout: 'canvas',
        // This rail offers STANDARD_SERVICE only, so it has its own coded row
        // (planted by seed-e2e). A TASK_ORDER code is correctly not here.
        term: 'E2E-WOUNDCARE',
        field: 'the service code, on a standard service',
        reach: async (page) => selectByPlaceholder(page, 'Search services'),
      },
      {
        name: 'Flow — Orders & Services section (filters in the BROWSER)',
        layout: 'flow',
        reach: async (page) => {
          await flowSection(page, 'Orders & Services');
          return selectByPlaceholder(page, 'Search orders or services');
        },
      },
    ],
  },
];

for (const entry of CATALOGUES) {
  for (const surface of entry.surfaces) {
    const term = surface.term ?? entry.term;
    const field = surface.field ?? entry.field;
    test(`${entry.catalogue}: "${term}" is findable on ${surface.name}`, async ({ page }) => {
      await openRecord(page, surface.layout);
      const box = await surface.reach(page);
      await test.step(`typing a term matching ${field}`, async () => {
        await findsSomething(page, box, term);
      });
    });
  }
}

/**
 * And the other half of the rule: a term that matches NOTHING must say so.
 *
 * An empty dropdown is silence, and silence is what made the diagnosis outage
 * unreportable — there was no symptom for the clinic to describe. Asserted on
 * the two catalogues whose surfaces own their own empty state.
 */
test('a term that matches nothing says so, rather than rendering silence', async ({ page }) => {
  await openRecord(page, 'canvas');

  await page.getByLabel('Search diagnosis').first().fill('zzzqqq');
  await expect(page.getByText(/No diagnosis matches/i)).toBeVisible();

  const medicine = page.getByRole('combobox', { name: 'Add medicine' }).first();
  await medicine.click();
  await medicine.fill('zzzqqq');
  await expect(page.getByText('No match. Check the spelling, or search by code.')).toBeVisible();
});
