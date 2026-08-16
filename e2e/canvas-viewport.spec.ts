import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * What the fixture seed planted, and where.
 *
 * Read from the seed's own file rather than navigated to by clicking: a
 * density measurement must fail when the RAIL is too tall, not when a click
 * path through the visits rail changed. The COUNTS come from the same file for
 * the same reason — copying them here as literals would make two places that
 * have to be kept agreeing by hand about how many medications a "typical"
 * visit has.
 */
interface DensityFixture {
  url: string;
  medications: number;
  orders: number;
  documents: number;
}

function densityFixtures(): Record<'typical' | 'heavy', DensityFixture> {
  return JSON.parse(readFileSync(join(__dirname, '.density-fixtures.json'), 'utf8'));
}

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

/**
 * Open a seeded density visit in the canvas layout, AND WAIT FOR ITS CONTENT.
 *
 * The wait is the point of this helper, and it was the whole blocker. Waiting
 * for `.kw-rail-panel` to be visible looked like waiting for the rail; it is
 * not. Piece 1 made an EMPTY card collapse to one line rather than render
 * nothing, so a rail with no rows in it yet and a rail whose fetches have not
 * returned are the same DOM to a selector — the panels are there either way.
 * Every measurement taken on that signal read zero rows, which looked like a
 * canvas refusing a directly-seeded visit. It refuses nothing: the visit
 * loads, the rows arrive, the measurement was simply taken first. Nothing in
 * the fixture needed a queue ticket or a visit state.
 *
 * So the wait is on the panel headers PRINTING THE COUNTS THE SEED PLANTED.
 * A count cannot be satisfied early — the header reads (0) until that panel's
 * rows are in hand — and it cannot be satisfied by the wrong visit, because
 * opening a patient renders their most recent visit for a moment before the
 * `visitId` in the URL takes effect, and the two fixtures have different
 * counts on purpose.
 */
async function openDensityVisit(page: Page, which: 'typical' | 'heavy'): Promise<DensityFixture> {
  const fixture = densityFixtures()[which];
  await login(page, ACCOUNTS.doctor);
  await page.goto(fixture.url);
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
  await page.reload();

  const rail = page.locator(RAIL);
  await expect(rail).toBeVisible();
  for (const [title, count] of [
    ['Orders / Procedures', fixture.orders],
    ['Medications', fixture.medications],
    ['Documents', fixture.documents],
  ] as const) {
    await expect(
      rail.locator('.kw-rail-head').filter({ hasText: `${title} (${count})` }).first(),
      `the ${which} fixture's ${title} never reached the rail`,
    ).toBeVisible();
  }
  return fixture;
}

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

test.describe('the right rail fits the budget it was compacted for', () => {
  /**
   * NOT YET PASSING, AND MARKED AS SUCH RATHER THAN QUIETLY WEAKENED.
   *
   * This is no longer the fixture problem the other three were. The fixture
   * loads, the rows render, and the measurement is now trustworthy — and what
   * it measures is that a TYPICAL visit DOES NOT FIT 1366×768 today:
   *
   *     rail starts at y=277 (patient header band, then the documents strip)
   *     rail needs      738px   —  Direct Services 78 (empty), Orders 120,
   *                                Medications 368, Documents 131, gaps 41
   *     rail has        491px   —  768 minus where it starts
   *     OVER BY         247px   —  Documents is entirely below the fold, and
   *                                two of the four medications with it
   *
   * Piece 1 compacted the ROWS and did not reach the per-card overhead: four
   * cards spend roughly 320px on headers and always-visible add controls for
   * six rows of content. Two of Piece 1's own rules also come apart at exactly
   * 1366 and nowhere else — an empty card takes 78px instead of the one line
   * it takes at 1920, and a medication row with a longer name wraps to two —
   * because the rail is ~457px wide there and the controls wrap.
   *
   * Closing 247px is a layout decision about what else gives way (the header
   * band, the allergy strip, the per-card add controls — which Piece 1
   * deliberately keeps in one DOM position and on screen), and that decision
   * is the owner's, not a test fix. So this case stays `.fixme`: it reports
   * itself as outstanding on every run and is never counted as green.
   *
   * It is also the number Piece 2 was waiting for. The sticky bar has no
   * space to consume at 1366 — there is a 247px deficit before it arrives.
   */
  test.fixme('TYPICAL visit fits 1366×768 with every card and row on screen', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');

    const geometry = await railGeometry(page);
    reportBudget('TYPICAL at 1366×768', geometry, 768);
    expect(geometry.rowCount, 'the fixture did not load — nothing to measure').toBeGreaterThan(0);

    // The FULL viewport height. Piece 2's sticky bar has to fit inside this
    // number, not be subtracted from it first.
    expect(
      geometry.lowestRowBottom,
      `the last rail row sits below the fold at 1366×768 (${Math.round(geometry.lowestRowBottom)} > 768)`,
    ).toBeLessThanOrEqual(768);
    expect(geometry.truncated, 'rail rows are truncating their own text').toEqual([]);
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
    // "Room to spare" stated as a number rather than implied: at the taller
    // viewport the rail should not be within a row's height of the fold.
    expect(geometry.lowestRowBottom).toBeLessThanOrEqual(1080 - 40);
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
      await expect(heads).toHaveCount(4); // Services, Orders, Medications, Documents
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
});
