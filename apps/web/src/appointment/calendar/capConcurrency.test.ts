import { describe, expect, it } from 'vitest';
import { capConcurrency } from './calendar-events';

const at = (hh: number, mm: number) => new Date(2026, 7, 26, hh, mm, 0, 0);
const ev = (id: string, from: [number, number], to: [number, number], resourceId?: string) => ({
  id,
  start: at(from[0], from[1]),
  end: at(to[0], to[1]),
  resourceId,
});

// ===========================================================================
// THE CAP IS COUNTED AGAINST THE COLUMN A RECEPTIONIST ACTUALLY SEES.
//
// Every event carries a resourceId, but react-big-calendar is only handed
// `resources` in the Providers view — Day and Week draw every provider into
// ONE shared column per date. Bucketing by provider there applied the cap
// per doctor, so six doctors could put eighteen cards into a single band; the
// busy Wednesday measured five boxes of 264px where the cap said three.
//
// These cases are the guard on that distinction. Nothing here changes an
// appointment: the hidden ones ride the overflow bundle with their true times
// and open from it.
// ===========================================================================
describe('capConcurrency', () => {
  it('DAY/WEEK: counts every provider against the one shared column', () => {
    // Six concurrent bookings, one per doctor, in a view with no per-provider
    // columns. Three is the cap, so two survive and four go to the bundle.
    const events = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      ev(id, [8, 30], [9, 0], `doc-${i}`),
    );
    const { visible, overflow } = capConcurrency(events, 3, false);
    expect(visible).toHaveLength(2);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].hidden).toHaveLength(4);
  });

  it('PROVIDERS: each doctor has their own column, so nothing is capped away', () => {
    const events = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      ev(id, [8, 30], [9, 0], `doc-${i}`),
    );
    const { visible, overflow } = capConcurrency(events, 3, true);
    expect(visible).toHaveLength(6);
    expect(overflow).toHaveLength(0);
  });

  it('PROVIDERS: still caps a single doctor who is genuinely double-booked', () => {
    const events = ['a', 'b', 'c', 'd'].map((id) => ev(id, [8, 30], [9, 0], 'doc-1'));
    const { visible, overflow } = capConcurrency(events, 3, true);
    expect(visible).toHaveLength(2);
    expect(overflow[0].hidden).toHaveLength(2);
  });

  it('hides nothing when the band is within the cap', () => {
    const events = [ev('a', [8, 0], [8, 30]), ev('b', [8, 30], [9, 0])];
    const { visible, overflow } = capConcurrency(events, 3, false);
    expect(visible).toHaveLength(2);
    expect(overflow).toHaveLength(0);
  });

  it('never loses a booking — everything is either drawn or carried on the bundle', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ev(id, [9, 0], [9, 30], `doc-${i}`));
    const { visible, overflow } = capConcurrency(events, 3, false);
    const seen = new Set([...visible.map((e) => e.id), ...overflow.flatMap((o) => o.hidden.map((e) => e.id))]);
    expect(seen.size).toBe(5);
  });

  it('keeps a separate bundle per calendar date', () => {
    const monday = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id: `mon-${id}`,
      start: new Date(2026, 7, 24, 9, 0),
      end: new Date(2026, 7, 24, 9, 30),
      resourceId: `doc-${i}`,
    }));
    const tuesday = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id: `tue-${id}`,
      start: new Date(2026, 7, 25, 9, 0),
      end: new Date(2026, 7, 25, 9, 30),
      resourceId: `doc-${i}`,
    }));
    const { overflow } = capConcurrency([...monday, ...tuesday], 3, false);
    expect(overflow).toHaveLength(2);
  });

  it('keeps a live booking visible when cancelled cards fill the same band (public booking walk, 15 October 2026)', () => {
    const cancelled = ['x1', 'x2', 'x3', 'x4'].map((id) => ({ ...ev(id, [8, 0], [8, 30], 'doc-1'), released: true }));
    const live = { ...ev('live', [8, 0], [8, 30], 'doc-1'), released: false };
    const { visible, overflow } = capConcurrency([...cancelled, live], 3, false);
    expect(visible.map((row) => row.id)).toContain('live');
    expect(overflow[0].hidden.every((row) => row.released)).toBe(true);
  });
});
