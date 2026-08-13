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

/**
 * b0 — ONE ATTACHMENTS REGION, AFTER AN UPLOAD.
 *
 * The reported defect: attach a file on the Canvas and "Attachments (N)"
 * appeared TWICE — once on a summary strip and once inside the panel that the
 * strip's own Upload button revealed — with the thumbnail duplicated and the
 * Hide/Upload pair sitting over the note area.
 *
 * It was a COMPOSITION defect: two components each rendering the visit's
 * attachment list, mounted one above the other by the page. Neither
 * component's own tests could see it, because each was correct alone. So this
 * asserts on the assembled page, after a real file has actually landed —
 * before the upload the duplicate was not visible either, which is why it
 * survived review.
 *
 * Both layouts, because "assert every surface" is the rule that this project
 * keeps paying for: Flow mounts the same component and must also have one.
 */
for (const layout of ['canvas', 'flow'] as const) {
  test(`${layout}: attachments render as exactly ONE region after a file is uploaded`, async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 864 });
    await openCanvas(page);
    if (layout === 'flow') {
      await page.evaluate(() => {
        const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
        const staffId = session?.state?.staff?.id;
        window.localStorage.setItem(
          'kuwick-record-view-layout-v2',
          JSON.stringify({
            state: { byStaffId: staffId ? { [staffId]: 'flow' } : {}, anonymous: 'flow' },
            version: 0,
          }),
        );
      });
    }
    await page.reload();

    const regions = page.locator('[data-attachments-region="visit"]');
    const chips = page.locator('.kw-attachment-chip');
    await expect(regions).toHaveCount(1);
    // Counted, not assumed to be zero: the specs share one worker and one
    // seeded visit, so this may already carry files the run before it
    // attached. The DELTA is what this test is about.
    const before = await chips.count();

    // A real PNG: the server checks the leading bytes, so a fake one is
    // refused exactly as a hostile upload would be and would prove nothing.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    // Unique per RUN, not just per layout. The seeded visit is not reset
    // between runs on a re-used database, so a fixed name accumulates and
    // "exactly one chip with this name" starts failing on the third run —
    // for a reason that has nothing to do with the defect under test.
    const fileName = `attachment-${layout}-${Date.now()}.png`;
    await page
      .getByLabel('Choose files to attach to this visit')
      .setInputFiles({ name: fileName, mimeType: 'image/png', buffer: png });

    // The file is on the record — asserted by its own name on a chip, not by
    // a progress message, which is a claim about a request rather than about
    // the visit. A per-layout name, so one run's file cannot satisfy the
    // other run's assertion.
    await expect(chips.filter({ hasText: fileName })).toHaveCount(1);

    // THE assertion. Still ONE region and ONE count label after the upload,
    // and exactly one new chip — not two of each, which is what was reported.
    await expect(regions).toHaveCount(1);
    await expect(page.getByText(/^Attachments \(\d+\)$/)).toHaveCount(1);
    await expect(chips).toHaveCount(before + 1);
    // The heading's number agrees with the chips it is counting.
    await expect(page.getByText(new RegExp(`^Attachments \\(${before + 1}\\)$`))).toBeVisible();

    // And the upload control has not landed on top of the note: the editor's
    // box and the attachments region must not intersect.
    if (layout === 'canvas') {
      const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
      const editorBox = await editor.boundingBox();
      const regionBox = await regions.boundingBox();
      expect(editorBox && regionBox, 'the editor or the attachments region has no box').toBeTruthy();
      const overlaps =
        editorBox!.y < regionBox!.y + regionBox!.height && regionBox!.y < editorBox!.y + editorBox!.height;
      expect(overlaps, 'the attachments region overlaps the note editor vertically').toBe(false);
    }

    // Evidence for the unit's report: the region itself, and the notes card
    // it lives in — a viewport shot would frame the editor and cut off the
    // thing under test, which is exactly what happened the first time.
    await regions.scrollIntoViewIfNeeded();
    await regions.screenshot({ path: `test-results/attachments-${layout}-region.png` });
    await page.locator('.kw-notes-card, .ant-card').first().screenshot({
      path: `test-results/attachments-${layout}-card.png`,
    });
  });
}

/**
 * b1 — THE MEDICINE BOX FINDS THE CLINIC'S OWN SHELF, ON BOTH SURFACES.
 *
 * The same defect family as the diagnosis outage above, one catalogue across.
 * 181 of this clinic's 236 medicines carry a Malay group tag — BATUK, DEMAM,
 * ANTIBIOTIK, 42 of them — and neither surface looked at that column: the
 * server matched name and code, and Flow's Select filtered client-side on the
 * option's printed label. So a doctor typing the word the clinic files a cough
 * medicine under matched NOTHING, while nine cough medicines sat in stock.
 *
 * "batuk" is deliberately a term no spec seeds. It comes from the clinic's own
 * import, which is the only kind of term that can catch this class.
 */
test('the medicine box finds a medicine by the clinic Malay group — Canvas AND Flow', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await openCanvas(page);
  await page.reload();

  // ---- CANVAS: the search-first box in the medications rail ---------------
  await page.getByRole('button', { name: /add medication/i }).first().click();
  const canvasBox = page.getByLabel('Search medicine').first();
  await expect(canvasBox).toBeVisible();
  await canvasBox.click();
  await canvasBox.fill('batuk');

  const canvasOption = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .first();
  await expect(canvasOption).toBeVisible();
  // The row says what the clinic needs in order to choose: its own group, the
  // price, and what is on the shelf. Before this it said the strength alone.
  await expect(canvasOption).toContainText(/BATUK/i);
  await expect(canvasOption).toContainText(/RM \d+\.\d\d/);
  await expect(canvasOption).toContainText(/in stock|out of stock|stock unknown/);

  // Evidence for the unit's report: the dropdown as the doctor sees it.
  await page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
    .first()
    .screenshot({ path: 'test-results/medicine-search-batuk.png' });

  // And a term that matches nothing must SAY so — silence is what made the
  // diagnosis outage unreportable. This is the search component's own
  // sentence, asserted verbatim rather than as a loose pattern that a blank
  // dropdown could also satisfy.
  await canvasBox.fill('zzzqqq');
  await expect(page.getByText('No match. Check the spelling, or search by code.')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^cancel$/i }).first().click();

  // ---- FLOW: the other surface, which filters in the browser -------------
  await page.evaluate(() => {
    const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const staffId = session?.state?.staff?.id;
    window.localStorage.setItem(
      'kuwick-record-view-layout-v2',
      JSON.stringify({
        state: { byStaffId: staffId ? { [staffId]: 'flow' } : {}, anonymous: 'flow' },
        version: 0,
      }),
    );
  });
  await page.reload();
  // Flow's Record View sections are plain labels, not tabs — the same handle
  // the golden path uses.
  await page.getByText('Medications', { exact: true }).first().click();

  // antd renders a Select's placeholder as a span, not an input attribute, so
  // the box is reached the way the golden path reaches it.
  const flowBox = page.locator('.ant-select').filter({ hasText: 'Search medicine' }).first();
  await expect(flowBox).toBeVisible();
  await flowBox.click();
  // TYPED, not opened-and-scanned: a 236-item antd Select virtualises, so the
  // row is not in the DOM until the list is narrowed. This is also the only
  // way the client-side filter under test is exercised at all.
  await flowBox.locator('input').fill('batuk');
  await expect(
    page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first(),
  ).toBeVisible();
});
