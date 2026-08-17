import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Page, expect } from '@playwright/test';
import { ACCOUNTS, login } from './app';

/**
 * The density fixtures, and how to open one.
 *
 * Shared by the vertical-budget measurement (`canvas-viewport.spec.ts`) and
 * the canvas booking spec (`canvas-appointment.spec.ts`) because both open the
 * same seeded visit and both need the same wait. Two copies of this helper
 * would be two waits that drift, and the wait is the part that was hard to get
 * right — see `openDensityVisit` below.
 */

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
export interface DensityFixture {
  url: string;
  medications: number;
  orders: number;
  documents: number;
}

/** b4 PIECE C — the scheduling backbone the canvas books a follow-up through. */
export interface BookingFixture {
  patientName: string;
  /** Mapped to the fixture doctor, with a slot length and a daily capacity. */
  followUpService: string;
  /** Exists in the catalogue and is deliberately NOT mapped to that doctor. */
  unmappedService: string;
  slotLengthMinutes: number;
  dailyCapacity: number;
}

export interface DensityFixtures {
  typical: DensityFixture;
  heavy: DensityFixture;
  booking: BookingFixture;
}

export function densityFixtures(): DensityFixtures {
  return JSON.parse(readFileSync(join(__dirname, '..', '.density-fixtures.json'), 'utf8'));
}

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
export async function openDensityVisit(page: Page, which: 'typical' | 'heavy'): Promise<DensityFixture> {
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

  const rail = page.locator('[data-testid="canvas-right"]');
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
