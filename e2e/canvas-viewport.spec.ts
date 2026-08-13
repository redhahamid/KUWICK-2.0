import { Page, expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './support/app';

/**
 * A0 — THE CANVAS FITS THE CLINIC'S SCREENS.
 *
 * The 1600px figure in the approved spec is a DESIGN REFERENCE, not a
 * minimum viewport. Real clinic desktops are 1366×768 and 1536×864, and a
 * doctor who has to zoom the browser out to see the consultation is using a
 * layout that does not fit.
 *
 * Two assertions per width, both about what a person experiences:
 *
 *   1. NOTHING SCROLLS SIDEWAYS. Asserted on the document AND on every
 *      element inside it — a card that scrolls within itself hides content
 *      just as effectively as a page that does, and is harder to notice.
 *   2. ALL THREE COLUMNS ARE USABLE. A layout can avoid overflow by pushing
 *      a rail off-screen or collapsing it to a sliver, so each column's key
 *      control is required to be visible and to have real width.
 */

const VIEWPORTS = [
  { name: '1366×768 — the commonest clinic desktop', width: 1366, height: 768 },
  { name: '1536×864 — the second commonest', width: 1536, height: 864 },
];

/** Tolerance: sub-pixel layout rounding is not a defect. */
const SLACK = 2;

async function openCanvas(page: Page): Promise<void> {
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await page.getByRole('tab', { name: /^consultation/i }).click();
  await page.getByRole('link', { name: /Ujian/i }).first().click();
  await expect(page.getByText('Record View')).toBeVisible();

  await page.evaluate(() => {
    const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const staffId = session?.state?.staff?.id;
    window.localStorage.setItem(
      'kuwick-record-view-layout-v2',
      JSON.stringify({
        state: { byStaffId: staffId ? { [staffId]: 'canvas' } : {}, anonymous: 'canvas' },
        version: 0,
      }),
    );
  });
}

for (const viewport of VIEWPORTS) {
  test(`canvas fits ${viewport.name} with no sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openCanvas(page);
    await page.reload();
    await expect(page.getByTestId('canvas-visit-today')).toBeVisible();

    // 1. The document itself.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      doc.scrollWidth,
      `the page scrolls sideways at ${viewport.width}px (${doc.scrollWidth} > ${doc.clientWidth})`,
    ).toBeLessThanOrEqual(doc.clientWidth + SLACK);

    // 2. Every element inside it. Reported with enough identity to fix, not
    //    just a count — a bare "something overflows" is a second investigation.
    const overflowing = await page.evaluate((slack) => {
      const found: string[] = [];
      document.querySelectorAll<HTMLElement>('.kw-canvas2 *').forEach((el) => {
        if (el.clientWidth === 0) return;
        // Deliberately scrollable containers are legitimate: they opt in.
        const style = window.getComputedStyle(el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return;
        if (el.scrollWidth > el.clientWidth + slack) {
          found.push(
            `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} ` +
              `(${el.scrollWidth} > ${el.clientWidth})`,
          );
        }
      });
      return [...new Set(found)].slice(0, 10);
    }, SLACK);
    expect(overflowing, `elements overflow their own box at ${viewport.width}px`).toEqual([]);

    // 3. One key control from EACH column, visible and of real width — so a
    //    "fit" achieved by hiding a rail cannot pass.
    const columns: Array<[string, ReturnType<Page['locator']>]> = [
      ['visits rail', page.getByTestId('canvas-visit-today')],
      ['middle — the clinical note', page.locator('.ProseMirror, [contenteditable="true"]').first()],
      ['right rail — medications', page.getByRole('button', { name: /add medication/i }).first()],
    ];
    for (const [label, locator] of columns) {
      await expect(locator, `${label} is not visible at ${viewport.width}px`).toBeVisible();
      const box = await locator.boundingBox();
      expect(box?.width ?? 0, `${label} is collapsed to a sliver at ${viewport.width}px`).toBeGreaterThan(120);
      // Fully on screen, not clipped at the right edge.
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `${label} extends past the right edge at ${viewport.width}px`,
      ).toBeLessThanOrEqual(viewport.width + SLACK);
    }

    await page.screenshot({ path: `test-results/canvas-${viewport.width}.png`, fullPage: false });
  });
}

/**
 * THE CANVAS diagnosis box searches the clinic's real catalogue.
 *
 * The golden path proved this in FLOW and only in Flow, so it stayed green
 * while the owner's canvas box matched nothing at all: the rail hardcoded a
 * category filter, the seed wrote a different category, and an empty
 * AutoComplete renders silence. Two surfaces, one assertion each — the
 * cheapest thing that would have caught it.
 */
test('the CANVAS diagnosis box finds the clinic catalogue, and says so when it does not', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await openCanvas(page);
  await page.reload();

  const search = page.getByLabel('Search diagnosis').first();
  await expect(search).toBeVisible();

  // A term the spec does NOT seed, typed as a doctor types it.
  await search.click();
  await search.fill('urti');
  await expect(
    page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .filter({ hasText: /Acute upper respiratory infection/i })
      .first(),
  ).toBeVisible();

  // And a term that matches nothing must SAY nothing matched — silence is
  // what made the outage unreportable.
  await search.fill('zzzqqq');
  await expect(page.getByText(/No diagnosis matches/i)).toBeVisible();
});
