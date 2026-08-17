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
 * b4 PIECE B — THE STICKY BOTTOM BAR, AND WHY IT CHANGES WHAT "ON SCREEN"
 * MEANS.
 *
 * The bar is `position: fixed` at the bottom of the viewport, so it COVERS
 * the last ~44px of whatever is behind it. A rail row at y=760 is inside the
 * viewport and behind the bar — which is not "on screen at rest" in any sense
 * a doctor would recognise.
 *
 * So the visibility assertions measure against the BAR'S TOP EDGE, and that
 * is a STRENGTHENING, not a weakening: every row that passed before must
 * still pass, and rows the bar now hides fail. Per the handoff, if a Piece A
 * assertion breaks with the bar present, THE BAR'S HEIGHT is what gets fixed
 * — never the assertion.
 *
 * The BUDGET LINE is unaffected and still prints against the full viewport
 * height. Measuring the rail against viewport-minus-bar is the vacuous pass
 * this file has already been burned by once.
 */
async function barGeometry(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.kw-invoice-bar');
    if (!bar) return null;
    const rect = bar.getBoundingClientRect();
    return { top: Math.round(rect.top), height: Math.round(rect.height) };
  });
}

/** The fold a row must be above to count as on screen at rest. */
function visibleFold(fold: number, bar: { top: number } | null): number {
  return bar ? Math.min(fold, bar.top) : fold;
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
      // b4 PIECE C — the appointment card, measured on its own so its cost to
      // the rail is a number on every run rather than something inferred from
      // a total that moved. The bar's height is printed the same way.
      appointmentCard: box(rail?.querySelector('.kw-rail-panel[data-panel="Next Appointment"]')),
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

    // b4 PIECE B — the bar is part of the measured region. Everything below
    // is asserted against ITS top edge, because a row behind a fixed bar is
    // not on screen. The bar's own height is checked in its case below.
    const bar = await barGeometry(page);
    expect(bar, 'the sticky bottom bar is not on the canvas at all').not.toBeNull();
    const fold = visibleFold(768, bar);
    console.log(`RAIL BUDGET — TYPICAL at 1366×768: bar is ${bar!.height}px, visible fold is ${fold}px`);
    // b4 PIECE C — the card's own cost, printed beside the bar's for the same
    // reason: two things now consume this budget and both are stated on every
    // run, pass or fail.
    console.log(
      `RAIL BUDGET — TYPICAL at 1366×768: appointment card is ${rail.appointmentCard?.height ?? 0}px`,
    );
    expect(rail.appointmentCard, 'the appointment card is not on the rail at all').not.toBeNull();

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
      'Next Appointment',
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
    // b4 PIECE B: the invoice did NOT land in the rail — it is the sticky
    // bottom bar — so the rail's bottom edge is unchanged, and it must now
    // also clear that bar.
    const bar = await barGeometry(page);
    expect(bar, 'the sticky bottom bar is not on the canvas at all').not.toBeNull();
    const fold = visibleFold(1080, bar);
    expect(
      geometry.railTop + geometry.railHeight,
      `the rail runs past the fold or under the bottom bar at 1920×1080 ` +
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
      // Services, Orders, Medications, Documents, Next Appointment (Piece C).
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
  // b4 PIECE B — THE STICKY BOTTOM BAR ITSELF.
  //
  // The bar's height is the number every assertion above now depends on, so
  // it is measured rather than trusted to the stylesheet. The other half is
  // that the EXPANSION costs nothing permanent: the breakdown is an overlay,
  // so a doctor opening it and closing it must leave the rail exactly where
  // it was. A breakdown that pushed the page would be the fifth rail card
  // this piece exists not to build, arriving by a different route.
  // =========================================================================
  test('the invoice bar is slim at rest, and its breakdown costs the rail nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');

    const before = await railGeometry(page);
    expect(before.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

    const bar = page.locator('.kw-invoice-bar');
    await expect(bar, 'the sticky bottom bar is not on the canvas').toBeVisible();
    const barBox = (await bar.boundingBox())!;

    // 1. SLIM, and pinned to the bottom. The ~44px is the budget the rail was
    //    compacted for; 48 is the tolerance, not a new allowance.
    console.log(`INVOICE BAR — height ${Math.round(barBox.height)}px, top ${Math.round(barBox.y)}px at 1366×768`);
    expect(barBox.height, `the bottom bar is ${barBox.height}px, not slim`).toBeLessThanOrEqual(48);
    expect(
      Math.round(barBox.y + barBox.height),
      'the bottom bar is not sitting on the bottom edge of the viewport',
    ).toBeGreaterThanOrEqual(768 - SLACK);

    // 2. It carries BOTH of its jobs at rest: the running total and the
    //    completion action, without anything being expanded.
    await expect(page.getByTestId('invoice-bar-total')).toBeVisible();
    await expect(page.getByTestId('invoice-bar-total')).toContainText(/RM \d+\.\d\d|—/);
    await expect(page.getByTestId('invoice-breakdown')).toHaveCount(0);

    // 3. The breakdown opens OVER the canvas — above the bar, and the bar
    //    keeps its height and its place.
    await page.getByTestId('invoice-bar-total').click();
    const sheet = page.getByTestId('invoice-breakdown');
    await expect(sheet).toBeVisible();
    const sheetBox = (await sheet.boundingBox())!;
    const barAfterOpen = (await bar.boundingBox())!;
    expect(Math.round(barAfterOpen.height), 'the bar grew when the breakdown opened').toBe(
      Math.round(barBox.height),
    );
    expect(
      Math.round(sheetBox.y + sheetBox.height),
      'the breakdown does not sit above the bar',
    ).toBeLessThanOrEqual(Math.round(barAfterOpen.y) + SLACK);

    // 4. THE POINT: it is an OVERLAY. With the breakdown open, every rail row
    //    is exactly where it was — no reflow, no push, nothing scrolled.
    const duringOpen = await railGeometry(page);
    expect(duringOpen.railTop, 'the rail moved when the breakdown opened').toBe(before.railTop);
    expect(duringOpen.railHeight, 'the rail resized when the breakdown opened').toBe(before.railHeight);

    // 5. And collapsing returns to the slim bar.
    await page.getByTestId('invoice-bar-total').click();
    await expect(sheet).toHaveCount(0);
    const after = await railGeometry(page);
    expect(after.railTop).toBe(before.railTop);
    expect(after.railHeight).toBe(before.railHeight);
    expect(Math.round((await bar.boundingBox())!.height)).toBe(Math.round(barBox.height));

    await page.screenshot({ path: 'test-results/invoice-bar-1366.png', fullPage: false });
  });

  // =========================================================================
  // b4 PIECE B — THE FOUR SOURCES, AND THE OTC RULE, ON THE REAL SCREEN.
  //
  // The unit suites assert the draft's shape and the bar's rendering against
  // fixtures. This asserts that a REAL seeded visit's medications and orders
  // reach the bar at all — the composition failure that no component test can
  // see, and the one that has cost this project the most time.
  // =========================================================================
  test('the invoice bar pulls the seeded visit’s own medications and orders', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const fixture = await openDensityVisit(page, 'typical');

    await page.getByTestId('invoice-bar-total').click();
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

    // And the total is stated, not blank.
    await expect(page.getByTestId('invoice-bar-total')).toContainText(/RM \d+\.\d\d/);

    await sheet.screenshot({ path: 'test-results/invoice-breakdown-1920.png' });
  });
});
