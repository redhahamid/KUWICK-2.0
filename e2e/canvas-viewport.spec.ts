import { Page, expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './support/app';
import { openDensityVisit } from './support/density';

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

/**
 * A count that has stopped changing.
 *
 * Playwright's auto-waiting settles on the SELECTOR, not on the fetch behind
 * it: a list component renders its empty shell first, so `count()` can return
 * a confident zero for a list that is still loading. Two equal readings in a
 * row is the cheapest honest "it has arrived".
 */
async function settledCount(locator: ReturnType<Page['locator']>): Promise<number> {
  let previous = -1;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await locator.count();
    if (current === previous) return current;
    previous = current;
    await locator.page().waitForTimeout(150);
  }
  return previous;
}

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
      // b1 — the rail's key control is the medicine SEARCH BOX now; the
      // "Add Medication" button it replaced was a door in front of it.
      ['right rail — medicine search', page.getByRole('combobox', { name: 'Add medicine' }).first()],
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
    //
    // SETTLED, not just counted. `toHaveCount(1)` on the region is satisfied
    // by an EMPTY region — the component renders before its fetch returns —
    // so on a database carrying a few dozen attachments this read a zero that
    // was really "not loaded yet", and the delta assertion then failed with a
    // count nobody had uploaded. It cost two false failures in one session.
    const before = await settledCount(chips);

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
  // No click first: b1 put the box in the rail, always visible, and typing is
  // the first act. A click here would have been the defect it removed.
  const canvasBox = page.getByRole('combobox', { name: 'Add medicine' }).first();
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

// ===========================================================================
// b4 PIECE 1 — THE RIGHT RAIL'S VERTICAL BUDGET, MEASURED.
//
// The compaction that made a medication one line was verified by eye. That is
// not a measurement, and it matters more than usual: Piece 2 puts a sticky
// bottom bar into the same space, so the budget has to be known before
// something starts consuming it.
//
// MEASURED AGAINST THE FULL VIEWPORT HEIGHT, BAR INCLUDED. Measuring the rail
// against viewport-minus-bar would pass by construction and prove nothing — the
// bar's height is exactly what the budget has to absorb. So the assertion is
// "every row is above 768", not "every row is above 768 minus whatever the bar
// turned out to be".
//
// Fixtures: `apps/api/prisma/seed-density-fixtures.ts`.
//   TYPICAL — 4 medications, 1 order, 1 document. Must FIT.
//   HEAVY   — 10 medications, 4 orders, 3 documents. Must DEGRADE as designed.
// ===========================================================================


/**
 * THE RIGHT RAIL, and only the right rail.
 *
 * `.kw-rail-panel` also matches the DIAGNOSIS card, which lives in the MIDDLE
 * column under the note editor — so an unscoped measurement mixed two columns
 * and reported the diagnosis card's position, which tracks the editor's
 * height, as a fact about rail density. It is what the first HEAVY reading
 * counted as one of its two "card headers pushed off screen".
 */
const RAIL = '[data-testid="canvas-right"]';

/** Every rail row and card header, with whether it is inside the viewport. */
async function railGeometry(page: Page) {
  return page.evaluate((railSelector) => {
    const rail = document.querySelector(railSelector);
    const all = <T extends HTMLElement>(selector: string) => [
      ...((rail?.querySelectorAll<T>(selector) ?? []) as unknown as T[]),
    ];
    const rows = all<HTMLElement>('.kw-rail-row');
    const heads = all<HTMLElement>('.kw-rail-head');
    const box = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, top: r.top };
    };
    return {
      rowCount: rows.length,
      headCount: heads.length,
      panelCount: all<HTMLElement>('.kw-rail-panel').length,
      railTop: rail ? Math.round(rail.getBoundingClientRect().top) : 0,
      railHeight: rail ? Math.round(rail.getBoundingClientRect().height) : 0,
      lowestRowBottom: rows.length ? Math.max(...rows.map((r) => box(r).bottom)) : 0,
      lowestHeadBottom: heads.length ? Math.max(...heads.map((h) => box(h).bottom)) : 0,
      // Any row whose own text is wider than its box — truncation, which the
      // compaction is not allowed to introduce.
      truncated: all<HTMLElement>('.kw-rail-row-main')
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .map((el) => el.textContent?.slice(0, 40) ?? '')
        .slice(0, 5),
    };
  }, RAIL);
}

/**
 * The measurement itself, printed on every run.
 *
 * The number this whole exercise exists to produce is "how much vertical space
 * does a visit's rail need, against how much the screen gives it" — and Piece
 * 2 needs it whether the assertion below passes or fails. A pass/fail alone
 * would report the answer only in the failure case.
 */
function reportBudget(label: string, geometry: { railTop: number; railHeight: number }, fold: number): void {
  const available = fold - geometry.railTop;
  console.log(
    `RAIL BUDGET — ${label}: rail needs ${geometry.railHeight}px, ` +
      `has ${available}px above the fold (${geometry.railHeight - available > 0 ? `OVER by ${geometry.railHeight - available}px` : `${available - geometry.railHeight}px to spare`})`,
  );
}

/**
 * b4 PIECE C — NOTHING IS FIXED TO THE VIEWPORT ANY MORE.
 *
 * Piece B's sticky bottom bar covered the last ~44px of the screen, so the
 * visibility assertions below measured against the BAR'S TOP EDGE rather than
 * the fold. The owner's layout decision removed that bar: the invoice is the
 * last card in the rail and Complete Consultation is back in the header band.
 *
 * So the fold is the fold again — 768 and 1080, the numbers the budget line
 * has always printed against. Every row that passed under the stricter reading
 * still passes under this one, and no assertion was relaxed to accommodate a
 * card: what was subtracted from the viewport is now added to the RAIL, where
 * `railHeight` measures it. The rule the handoff set is unchanged and now
 * points at the invoice card and the appointment card: if an assertion here
 * fails, THE CARD gets shorter, never the assertion.
 *
 * A guard rather than a comment: the bar must be gone from the DOM, so a
 * re-introduced fixed strip fails here instead of quietly hiding rail rows.
 */
async function noFixedStrip(page: Page) {
  return page.evaluate(() => document.querySelectorAll('.kw-invoice-bar').length);
}

/**
 * What the rail owes a doctor AT REST, as distinct from how tall it is.
 *
 * `railGeometry` answers "does everything fit". These four rects answer "is
 * the right thing on screen", which is the question the 1366 target is written
 * in now. Read in one pass so nothing can shift between measurements.
 */
async function railPromises(page: Page) {
  return page.evaluate((railSelector) => {
    const rail = document.querySelector(railSelector);
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    const meds = rail?.querySelector('.kw-rail-panel[data-panel="Medications"]') ?? null;
    // The row is found by its own DOM mark, and the CHIP is then required
    // inside it. Either alone would let this pass while the warning was gone:
    // the attribute could outlive the chip, and a chip class could be reused
    // on a row that carries no warning.
    const warned = rail?.querySelector('.kw-rail-row[data-unresolved-supply="true"]') ?? null;
    return {
      medsHead: box(meds?.querySelector('.kw-rail-head')),
      medsFirstRow: box(meds?.querySelector('.kw-rail-row')),
      warnedRow: box(warned),
      warnedRowHasChip: Boolean(warned?.querySelector('.kw-supply-label')),
      warnedRowCount: rail?.querySelectorAll('.kw-rail-row[data-unresolved-supply="true"]').length ?? 0,
      // Every card, so "no card lost" is measured rather than assumed from a
      // header count that a display:none card would still satisfy.
      cards: [...(rail?.querySelectorAll<HTMLElement>('.kw-rail-panel') ?? [])].map((panel) => ({
        name: panel.getAttribute('data-panel'),
        height: Math.round(panel.getBoundingClientRect().height),
      })),
      // b4 PIECE C — the invoice card, measured on its own so its cost to the
      // rail is a number on every run rather than something inferred from a
      // total that moved. The sticky bar's height used to print here the same
      // way; the appointment card's did too, until it left for the left
      // column.
      invoiceCard: box(rail?.querySelector('.kw-rail-panel[data-panel="Invoice"]')),
    };
  }, RAIL);
}

test.describe('the right rail fits the budget it was compacted for', () => {
  /**
   * THE 1366 TARGET, REDEFINED IN THE OPEN (2026-08-16, owner's decision).
   *
   * What this replaced: `TYPICAL fits 1366×768 with every card and row on
   * screen`, marked `.fixme` because it did not pass. It was over by 247px,
   * then by 237, and after Piece A's three height fixes it is over by ~101.
   * The owner's judgement is that the last of it is not worth buying: four
   * cards holding a real visit will not fit 768px while the band, the allergy
   * strip and a per-card add control all stay — and every remaining way to
   * close it takes something away from a doctor.
   *
   * So the target changed, DELIBERATELY AND UPWARD IN PRECISION. "Everything
   * fits" was one blunt assertion that happened to imply the things that
   * matter; these are the things that matter, each asserted on its own, in the
   * owner's own priority order. The budget line still prints on every run and
   * is still measured against the FULL 768 — the sticky bar of Piece B has to
   * fit inside that number, never be subtracted from it first.
   *
   *   a. NON-NEGOTIABLE — a row carrying the unresolved-supply warning chip is
   *      on screen at rest, or the rail auto-revealed it. That warning never
   *      requires a scroll to discover. It outranks (b): D-091 refused to put
   *      it behind a hover and `unresolvedSupplyFirst` refused to let the
   *      disclosure threshold collapse it, and a fold is the third way to hide
   *      the same thing.
   *   b. The Medications card header and its first row are above the fold at
   *      rest. Medications is what a doctor opens the rail for.
   *   c. No item text truncated, at this width or any other.
   *   d. No card lost — every card the rail mounts is present and of real
   *      height. Four when this target was written; five since Piece C added
   *      the appointment card BELOW them, where it cannot move (a) or (b).
   *
   * (e) is the 1920 case below: the whole rail, with no scrolling at all.
   */
  test('TYPICAL at 1366×768 keeps the warning, Medications and every card', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');

    const geometry = await railGeometry(page);
    reportBudget('TYPICAL at 1366×768', geometry, 768);
    // The guard stays first, on every case. `TYPICAL fits 1920` once passed
    // with zero rows, because the lowest row bottom of nothing is zero.
    expect(geometry.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

    const rail = await railPromises(page);

    // b4 PIECE C — the fold is the viewport again; nothing is fixed over it.
    expect(await noFixedStrip(page), 'a fixed bottom strip is back on the canvas').toBe(0);
    const fold = 768;
    // The two cards that consume this budget, each stated on every run, pass
    // or fail — the number the whole exercise exists to produce.
    console.log(`RAIL BUDGET — TYPICAL at 1366×768: invoice card ${rail.invoiceCard?.height ?? 0}px`);
    expect(rail.invoiceCard, 'the invoice card is not on the rail at all').not.toBeNull();

    // (a) THE WARNING. The fixture plants exactly one prescription with a NULL
    // supply mode, so a missing row here is a missing warning and not a
    // fixture that happened to resolve everything.
    expect(rail.warnedRowCount, 'the fixture carries no unresolved-supply row to find').toBe(1);
    expect(rail.warnedRowHasChip, 'the unresolved-supply row no longer carries its warning chip').toBe(true);
    // "On screen at rest" covers both halves of the rule: above the fold, or
    // auto-revealed. Nobody has scrolled at this point, so a row inside the
    // viewport is a row the doctor was given without asking — which is the
    // promise. Only a row they would have to go looking for fails. And
    // "behind the bottom bar" is a row they would have to go looking for.
    expect(
      rail.warnedRow,
      'the unresolved-supply row is not in the DOM at all',
    ).not.toBeNull();
    expect(
      rail.warnedRow!.top,
      `the unresolved-supply warning starts below the fold at rest (top ${rail.warnedRow!.top} ≥ ${fold})`,
    ).toBeLessThan(fold);
    expect(
      rail.warnedRow!.bottom,
      `the unresolved-supply warning is hidden by the fold or the bottom bar at rest ` +
        `(bottom ${rail.warnedRow!.bottom} > ${fold}). Per the handoff, shorten the BAR, not this assertion.`,
    ).toBeLessThanOrEqual(fold);

    // (b) MEDICATIONS — header and first row, both whole, and both clear of
    // the bar.
    expect(rail.medsHead, 'the Medications card is missing').not.toBeNull();
    expect(
      rail.medsHead!.bottom,
      `the Medications card header is below the fold (${rail.medsHead!.bottom} > ${fold})`,
    ).toBeLessThanOrEqual(fold);
    expect(rail.medsFirstRow, 'the Medications card rendered no rows').not.toBeNull();
    expect(
      rail.medsFirstRow!.bottom,
      `the first medication is below the fold (${rail.medsFirstRow!.bottom} > ${fold})`,
    ).toBeLessThanOrEqual(fold);

    // (c) NOTHING TRUNCATED. The compaction traded lines for hover titles; it
    // never traded a drug name for an ellipsis, and must not start here.
    expect(geometry.truncated, 'rail rows are truncating their own text').toEqual([]);

    // (d) NO CARD LOST. Present, named, IN ORDER, and of real height — a card
    // collapsed to a sliver is a card gone, and it would satisfy a mere count.
    //
    // b4 PIECE C added the fifth entry, and that is a change to the ROSTER,
    // not a weakening of a fold assertion. The handoff's rule — if a card
    // breaks (a)–(e), shorten the CARD and not the assertion — is about the
    // geometry above and below, all of which is untouched: the appointment
    // card is LAST, so nothing it does can push the unresolved-supply warning
    // or the first medication row toward the fold. What it does change is the
    // list of cards the rail is required to hold, and that list is the thing
    // this assertion exists to state. Its height is measured with the rest of
    // the rail in (e), where the whole column has to clear the bar.
    expect(rail.cards.map((card) => card.name)).toEqual([
      'Direct Services',
      'Orders / Procedures',
      'Medications',
      'Documents',
      'Invoice',
    ]);
    for (const card of rail.cards) {
      expect(card.height, `the ${card.name} card has collapsed to nothing`).toBeGreaterThan(20);
    }
    // And reachable: the rail scrolls with the page, so what is below the fold
    // is below it, not stranded outside a scroller.
    for (const card of rail.cards) {
      const head = page
        .locator(`${RAIL} .kw-rail-panel[data-panel="${card.name}"] .kw-rail-head`)
        .first();
      await head.scrollIntoViewIfNeeded();
      await expect(head, `the ${card.name} header cannot be brought on screen`).toBeVisible();
    }
  });

  test('TYPICAL visit fits 1920×1080 with room to spare', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openDensityVisit(page, 'typical');

    const geometry = await railGeometry(page);
    reportBudget('TYPICAL at 1920×1080', geometry, 1080);
    // The guard stays first on every case. `TYPICAL fits 1920` once PASSED
    // with zero rows, because the lowest row bottom of nothing is zero — the
    // same class of vacuous pass as measuring the rail against
    // viewport-minus-bar. Nothing below this line means anything without it.
    expect(geometry.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

    // (e) OF THE REDEFINED TARGET — the FULL rail, with no scrolling at all.
    // Stated on the rail's own bottom edge rather than on its lowest row: the
    // rail ends below its last row (card padding), and "fits with no
    // scrolling" is a claim about the whole thing, not about the last row
    // inside it.
    //
    // b4 PIECE C: the invoice DID land in the rail — it is the last card —
    // and the sticky bar is gone, so the rail's bottom edge now includes the
    // bill and is measured against the plain fold.
    expect(await noFixedStrip(page), 'a fixed bottom strip is back on the canvas').toBe(0);
    const fold = 1080;
    expect(
      geometry.railTop + geometry.railHeight,
      `the rail runs past the fold at 1920×1080 ` +
        `(${geometry.railTop + geometry.railHeight} > ${fold})`,
    ).toBeLessThanOrEqual(fold);
    // "Room to spare" stated as a number rather than implied: at the taller
    // viewport the rail should not be within a row's height of the fold.
    expect(geometry.lowestRowBottom).toBeLessThanOrEqual(fold - 40);
    expect(geometry.truncated, 'rail rows are truncating their own text').toEqual([]);
  });

  for (const width of [1366, 1920]) {
    const fold = width === 1366 ? 768 : 1080;

    test(`HEAVY visit degrades as designed at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: fold });
      const fixture = await openDensityVisit(page, 'heavy');

      const loaded = await railGeometry(page);
      reportBudget(`HEAVY at ${width}×${fold}`, loaded, fold);
      expect(loaded.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

      const rail = page.locator(RAIL);

      // 1. Disclosure collapsed the overflow rather than the list. Ten
      //    medications past a threshold of five means a "+N more".
      await expect(rail.getByRole('button', { name: /\+\d+ more/ }).first()).toBeVisible();

      // 2. NO CARD LOST. Every card the rail mounts is still a card: present,
      //    with real height, and reachable.
      //
      //    Deliberately NOT "every header is above the fold at rest" for both
      //    widths. HEAVY is not expected to FIT — that is what makes it the
      //    heavy case — and at 1366 its rail needs about 1020px of a 491px
      //    window, so demanding every header on screen there would be
      //    demanding the thing the fixture exists to say is impossible. What
      //    degradation-as-designed does promise is that nothing is dropped,
      //    clipped, or stranded outside the scroll: a doctor can still get to
      //    Documents when Medications is long.
      const heads = rail.locator('.kw-rail-head');
      // Services, Orders, Medications, Documents, Invoice — the appointment
      // left the rail for the left column in Piece C (3).
      await expect(heads).toHaveCount(5);
      for (const head of await heads.all()) {
        await head.scrollIntoViewIfNeeded();
        await expect(head, 'a card header cannot be brought on screen at all').toBeVisible();
        const box = await head.boundingBox();
        expect(box?.height ?? 0, 'a card header has collapsed to nothing').toBeGreaterThan(8);
      }
      await page.evaluate(() => window.scrollTo(0, 0));

      // 2b. And where the rail IS expected to fit, the stricter reading still
      //     holds: at 1920 every card header is on screen without scrolling.
      if (width === 1920) {
        const geometry = await railGeometry(page);
        const onScreen = await page.evaluate(
          ([railSelector, h]) =>
            [...document.querySelectorAll<HTMLElement>(`${railSelector} .kw-rail-head`)].filter(
              (el) => el.getBoundingClientRect().top < Number(h),
            ).length,
          [RAIL, String(fold)] as const,
        );
        expect(
          onScreen,
          `${geometry.headCount - onScreen} card header(s) pushed off screen at ${width}px`,
        ).toBe(geometry.headCount);
      }

      // 3. No item text truncated.
      const geometry = await railGeometry(page);
      expect(geometry.truncated, 'rail rows are truncating their own text').toEqual([]);
      // The disclosure is a REMAINDER, not the list: five of the ten are on
      // the rail, and the header still says how many there are.
      expect(geometry.rowCount).toBe(5 + fixture.orders + fixture.documents);

      // 4. The unresolved-supply warning is still ON ITS ROW, not behind a
      //    hover. VISIBLE, not merely present: Piece 1 moved other detail to
      //    title attributes, so asserting presence alone would pass even if
      //    this had been hidden with the rest.
      //
      //    It also must not be behind the DISCLOSURE, which is where this
      //    measurement first found it — tenth in the server's order, inside
      //    "+5 more", a warning one click away for exactly the reason D-091
      //    refused to put it one hover away. Unresolved rows are ordered
      //    first now (`unresolvedSupplyFirst`), so the count of them on the
      //    rail is asserted, not just that one exists somewhere.
      await expect(rail.locator('.kw-supply-label').first()).toBeVisible();
      await expect(rail.locator('[data-unresolved-supply]')).toHaveCount(1);
    });
  }

  // =========================================================================
  // b4 PIECE C — THE INVOICE CARD ITSELF.
  //
  // It replaces "the invoice bar is slim at rest". The bar's height was the
  // number every assertion above depended on; the card's height is that number
  // now, and it is measured rather than trusted to the stylesheet.
  //
  // The other half is what the card must NOT do. The bar's breakdown was an
  // overlay so it cost the rail nothing; a card's disclosure DOES grow the
  // rail, and that is correct — it is what every other rail card does. What
  // must not happen is that it grows the rail AT REST, or that it moves the
  // cards above it when it opens. A doctor who opens the detail must find the
  // medications exactly where they left them.
  // =========================================================================
  test('the invoice card is compact at rest, and opening its detail moves nothing above it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');

    const before = await railGeometry(page);
    expect(before.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

    /**
     * Where the Medications CARD sits inside the rail.
     *
     * The card, not its header: `.kw-rail-head` is `position: sticky` inside
     * its panel, so its rect moves with the scroll and would report a scroll
     * as a reflow. The panel's own box does not move.
     */
    const medsOffset = () =>
      page.evaluate(() => {
        const rail = document.querySelector('[data-testid="canvas-right"]');
        const meds = rail?.querySelector('.kw-rail-panel[data-panel="Medications"]');
        if (!rail || !meds) return null;
        return Math.round(meds.getBoundingClientRect().top - rail.getBoundingClientRect().top);
      });

    const card = page.locator('[data-testid="canvas-right"] .kw-rail-panel[data-panel="Invoice"]');
    await expect(card, 'the invoice card is not in the rail').toBeVisible();
    const cardBox = (await card.boundingBox())!;

    // 1. THE INVOICE IS THE LAST CARD. Read off the DOM order rather than
    //    assumed from the source: the bill prices the cards above it.
    const panels = page.locator('[data-testid="canvas-right"] .kw-rail-panel');
    await expect(panels.last()).toHaveAttribute('data-panel', 'Invoice');

    // 2. COMPACT. Group totals plus the total, not an itemised bill — 160px is
    //    the tolerance, not a new allowance. If this fails, the CARD gets
    //    shorter (the handoff's rule, inherited from the bar).
    console.log(`INVOICE CARD — height ${Math.round(cardBox.height)}px at 1366×768`);
    expect(
      cardBox.height,
      `the invoice card is ${Math.round(cardBox.height)}px at rest, not compact`,
    ).toBeLessThanOrEqual(160);

    // 3. It carries the running total at rest, and the itemised detail is NOT
    //    in the DOM until it is asked for.
    await expect(page.getByTestId('invoice-total')).toBeVisible();
    await expect(page.getByTestId('invoice-total')).toContainText(/RM \d+\.\d\d|—/);
    await expect(page.getByTestId('invoice-breakdown')).toHaveCount(0);

    // 4. THE POINT: opening the detail grows the CARD and moves nothing above
    //    it. The rail's top and every card before the invoice stay put.
    // MEASURED RELATIVE TO THE RAIL, NOT TO THE VIEWPORT. The toggle is below
    // the fold at 1366 — the rail is hundreds of pixels over its window — so
    // reaching it scrolls the page, and every rect here is viewport-relative.
    // Comparing a scrolled reading with an unscrolled one reports the SCROLL
    // as a reflow, which is what the first version of this assertion did. The
    // offset of the Medications card from the top of the rail is the fact
    // under test and it does not care where the page is scrolled to.
    const medsOffsetBefore = await medsOffset();

    await page.getByTestId('invoice-details-toggle').scrollIntoViewIfNeeded();
    await page.getByTestId('invoice-details-toggle').click();
    await expect(page.getByTestId('invoice-breakdown')).toBeVisible();

    const duringOpen = await railGeometry(page);
    expect(
      await medsOffset(),
      'the Medications card moved when the invoice detail opened — the disclosure must grow ' +
        'DOWNWARD, never push the cards above it',
    ).toBe(medsOffsetBefore);
    expect(duringOpen.railHeight, 'the detail did not grow the card at all').toBeGreaterThan(
      before.railHeight,
    );

    // 5. And closing it returns the rail to exactly its resting height.
    await page.getByTestId('invoice-details-toggle').scrollIntoViewIfNeeded();
    await page.getByTestId('invoice-details-toggle').click();
    await expect(page.getByTestId('invoice-breakdown')).toHaveCount(0);
    const after = await railGeometry(page);
    expect(after.railHeight, 'closing the detail did not return the rail to its resting height').toBe(
      before.railHeight,
    );

    await page.screenshot({ path: 'test-results/invoice-card-1366.png', fullPage: false });
  });

  // =========================================================================
  // b4 PIECE C (3) — THE APPOINTMENT MONTH, DOCKED BOTTOM-LEFT.
  //
  // The owner's brief for it was a layout contract, not a feature list:
  // "Fixed position: it must not push the Visits panel or scroll the page."
  // Both halves are measured here, because both are the kind of thing that
  // looks fine on the screen it was built on and breaks on a shorter one.
  // =========================================================================
  test('the appointment month sits under the visits panel without moving it or the page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');

    const calendar = page.getByTestId('canvas-appointment-calendar');
    await expect(calendar, 'the appointment month is not on the canvas').toBeVisible();

    // 1. IN THE LEFT COLUMN, BELOW THE VISITS PANEL. Read off the geometry
    //    rather than the source: "bottom left" is a position, and a component
    //    imported into the right file can still render in the wrong place.
    const placement = await page.evaluate(() => {
      const column = document.querySelector('[data-testid="canvas-visits"]');
      const dock = document.querySelector('.kw2-appt-dock');
      const visits = document.querySelector('.kw2-visits-card, [data-testid="canvas-visit-today"]');
      if (!column || !dock || !visits) return null;
      return {
        insideLeftColumn: column.contains(dock),
        belowVisits: Math.round(dock.getBoundingClientRect().top) >=
          Math.round(visits.getBoundingClientRect().top),
        docHeight: document.documentElement.scrollHeight,
        visitsTop: Math.round(visits.getBoundingClientRect().top),
        dockHeight: Math.round(dock.getBoundingClientRect().height),
      };
    });
    expect(placement, 'the left column, the dock or the visits panel is missing').not.toBeNull();
    expect(placement!.insideLeftColumn, 'the appointment month is not in the left column').toBe(true);
    expect(placement!.belowVisits, 'the appointment month is not below the visits panel').toBe(true);
    console.log(`APPOINTMENT MONTH — ${placement!.dockHeight}px, docked in the left column`);

    // 2. IT DOES NOT MAKE THE PAGE SCROLL. Measured by removing it and
    //    re-measuring: if the document is no shorter without it, it is not
    //    what decides the page's height. The middle and right columns are far
    //    taller, which is exactly why the empty space below the visits panel
    //    was free to use.
    const withoutDock = await page.evaluate(() => {
      const dock = document.querySelector('.kw2-appt-dock') as HTMLElement | null;
      if (!dock) return null;
      const previous = dock.style.display;
      dock.style.display = 'none';
      const height = document.documentElement.scrollHeight;
      dock.style.display = previous;
      return height;
    });
    expect(
      placement!.docHeight,
      'the appointment month is making the page taller — it must live in space the ' +
        'other columns already occupy',
    ).toBe(withoutDock);

    // 3. IT DOES NOT PUSH THE VISITS PANEL. Same method: the panel is where it
    //    was with the dock gone.
    const visitsTopWithout = await page.evaluate(() => {
      const dock = document.querySelector('.kw2-appt-dock') as HTMLElement | null;
      const visits = document.querySelector('.kw2-visits-card, [data-testid="canvas-visit-today"]');
      if (!dock || !visits) return null;
      const previous = dock.style.display;
      dock.style.display = 'none';
      const top = Math.round(visits.getBoundingClientRect().top);
      dock.style.display = previous;
      return top;
    });
    expect(placement!.visitsTop, 'the appointment month moved the visits panel').toBe(visitsTopWithout);

    // 4. AND IT DOES NOT DRAW OVER THE VISITS PANEL. This is the assertion the
    //    first implementation needed and did not have: `position: sticky`
    //    passed (2) and (3) — the panel kept its height and its position —
    //    while the calendar sat ON TOP of its lower half and a doctor lost two
    //    visits behind it. A panel that has not moved can still have been
    //    made unreadable.
    const overlap = await page.evaluate(() => {
      const dock = document.querySelector('.kw2-appt-dock');
      const visits = document.querySelector('.kw2-visits');
      if (!dock || !visits) return null;
      const d = dock.getBoundingClientRect();
      const v = visits.getBoundingClientRect();
      return { dockTop: Math.round(d.top), visitsBottom: Math.round(v.bottom) };
    });
    expect(
      overlap!.dockTop,
      `the appointment month is drawn over the visits panel (starts at ${overlap!.dockTop}, ` +
        `the panel ends at ${overlap!.visitsBottom})`,
    ).toBeGreaterThanOrEqual(overlap!.visitsBottom - SLACK);

    await calendar.screenshot({ path: 'test-results/canvas-appointment-month.png' });
  });

  /**
   * 5. THE EMPTY SPACE THE OWNER POINTED AT IS REAL, AND THIS MEASURES WHERE.
   *
   * At 1920×1080 the month is on screen at rest, under the visits panel,
   * with nothing scrolled — which is the layout the brief describes.
   *
   * It is asserted THERE and not at 1366 or 1536, and the number says why: a
   * 449px visits panel starting at y=253 plus a 267px month ends at ~1006, so
   * it clears an 1080 fold and does not clear a 768 or an 864 one. Making it
   * clear those would mean shrinking the visits panel, which is exactly what
   * the brief forbids — so at the shorter screens it is reached by the same
   * scroll the rail already needs, and this test prints where it lands at each
   * width rather than pretending otherwise.
   */
  for (const viewport of [
    { width: 1920, height: 1080, mustFit: true },
    { width: 1536, height: 864, mustFit: false },
  ]) {
    test(`the appointment month at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openDensityVisit(page, 'typical');

      const calendar = page.getByTestId('canvas-appointment-calendar');
      await expect(calendar).toBeVisible();
      const box = (await calendar.boundingBox())!;
      const bottom = Math.round(box.y + box.height);
      console.log(
        `APPOINTMENT MONTH — at ${viewport.width}×${viewport.height} it ends at ${bottom} of ${viewport.height}`,
      );
      if (viewport.mustFit) {
        expect(
          bottom,
          `the appointment month runs past the fold at ${viewport.width}×${viewport.height}`,
        ).toBeLessThanOrEqual(viewport.height + SLACK);
      }
      // At every width it is reachable, which is the promise that holds
      // everywhere: the page scrolls, and nothing is stranded outside it.
      await calendar.scrollIntoViewIfNeeded();
      await expect(calendar).toBeVisible();
    });
  }

  // =========================================================================
  // b4 PIECE B/C — THE FOUR SOURCES, AND THE OTC RULE, ON THE REAL SCREEN.
  //
  // The unit suites assert the draft's shape and the card's rendering against
  // fixtures. This asserts that a REAL seeded visit's medications and orders
  // reach the card at all — the composition failure that no component test can
  // see, and the one that has cost this project the most time.
  // =========================================================================
  test('the invoice card pulls the seeded visit’s own medications and orders', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const fixture = await openDensityVisit(page, 'typical');

    await page.getByTestId('invoice-details-toggle').click();
    const sheet = page.getByTestId('invoice-breakdown');
    await expect(sheet).toBeVisible();

    // Every medication on the visit is a line on the draft — including the
    // one with an undecided supply mode, which must be LISTED with its
    // reason rather than dropped. D-091's rule, on the bill this time.
    const medicationLines = sheet.locator('[data-source-type="PRESCRIPTION"]');
    await expect(
      medicationLines,
      'the draft invoice did not pull the visit’s medications',
    ).toHaveCount(fixture.medications);

    // The unresolved one is present, uncounted, and carries the server's own
    // wording — never priced at RM 0.00, which would read as free.
    const unresolved = sheet.locator('[data-state="UNRESOLVED_SUPPLY"]');
    await expect(unresolved).toHaveCount(1);
    await expect(unresolved.first()).toHaveAttribute('data-counted', 'false');
    await expect(unresolved.first()).toContainText(/supply mode has not been confirmed/i);

    // The orders on the visit reach it too.
    await expect(
      sheet.locator('[data-source-type="ORDER_SERVICE"]'),
      'the draft invoice did not pull the visit’s orders',
    ).toHaveCount(fixture.orders);

    // b4 PIECE C (2a) — THE CONSULTATION IS ON THE BILL, on a visit that is
    // not OTC. Staging showed orders + medications and no consultation charge:
    // the branch had no tariff rule, D-094 turned auto-billing off, and the
    // worklist added no row at all — RM35 lost on every visit, silently. The
    // staging seed now configures the rule, and this asserts the line arrives.
    const consultation = sheet.locator('[data-source-type="CONSULTATION"]');
    await expect(consultation, 'the draft carries no consultation line at all').toHaveCount(1);
    await expect(consultation).toHaveAttribute('data-counted', 'true');
    await expect(consultation).toContainText(/RM \d+\.\d\d/);

    // b4 PIECE C (2b) — TWO NAMED FACTS, BOTH ON SCREEN AT ONCE. The fixture
    // carries three medications awaiting dispensing and one whose supply mode
    // is undecided, which are different problems with different actions:
    // "not priced" means the total is incomplete, "to dispense" means the
    // patient has not received something they are being charged for. A single
    // "N items outstanding" could say neither.
    await expect(page.getByTestId('invoice-unpriced')).toContainText(/\d+ items? not priced/);
    await expect(page.getByTestId('invoice-to-dispense')).toContainText(/\d+ medicines? to dispense/);

    // And the total is stated, not blank.
    await expect(page.getByTestId('invoice-total')).toContainText(/RM \d+\.\d\d/);

    await sheet.screenshot({ path: 'test-results/invoice-detail-1920.png' });
  });
});
