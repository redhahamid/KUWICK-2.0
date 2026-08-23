import { describe, expect, it } from 'vitest';
import { presentationRoom } from './calendar-events';

const at = (hh: number, mm: number) => new Date(2026, 7, 26, hh, mm, 0, 0);
const ev = (id: string, from: [number, number], to: [number, number], resourceId?: string) => ({
  id,
  start: at(from[0], from[1]),
  end: at(to[0], to[1]),
  resourceId,
});

// ===========================================================================
// THE ONE PROPERTY THAT MATTERS HERE.
//
// A short booking is allowed to DRAW itself taller so its patient's name is
// readable — but only into grid that was already empty. It must never reach
// the next booking's start, because the moment it does, the calendar is
// showing a booking occupying time it does not own. This suite is the guard
// on that: the maths of the schedule is not this function's to touch.
// ===========================================================================
describe('presentationRoom', () => {
  it('never lets a card reach the next booking in the same column', () => {
    const room = presentationRoom([ev('a', [8, 0], [8, 15]), ev('b', [8, 15], [8, 30])], 25);
    // 'a' may draw 15 minutes — exactly up to 'b', never past it.
    expect(room.get('a')).toBe(15);
  });

  it('lets an isolated short booking borrow up to the readable cap', () => {
    const room = presentationRoom([ev('a', [8, 0], [8, 15])], 25);
    expect(room.get('a')).toBe(25);
  });

  it('borrows only the empty gap when the gap is smaller than the cap', () => {
    const room = presentationRoom([ev('a', [8, 0], [8, 15]), ev('b', [8, 20], [8, 35])], 25);
    expect(room.get('a')).toBe(20);
  });

  it('never shrinks a booking below its own duration', () => {
    const room = presentationRoom([ev('a', [8, 0], [9, 0])], 25);
    expect(room.get('a')).toBe(60);
  });

  it('treats provider columns separately — a neighbour cannot cost you room', () => {
    const room = presentationRoom(
      [ev('a', [8, 0], [8, 15], 'doc-1'), ev('b', [8, 15], [8, 30], 'doc-2')],
      25,
    );
    // Different columns: 'a' has nothing beneath it and takes the full cap.
    expect(room.get('a')).toBe(25);
  });

  it('ignores a true overlap starting at the same minute — rbc splits those sideways', () => {
    const room = presentationRoom([ev('a', [8, 0], [8, 15]), ev('b', [8, 0], [8, 15])], 25);
    expect(room.get('a')).toBe(25);
    expect(room.get('b')).toBe(25);
  });

  it('is per calendar DATE, so tomorrow’s first booking does not shorten today’s last', () => {
    const late = {
      id: 'today-last',
      start: new Date(2026, 7, 26, 20, 0),
      end: new Date(2026, 7, 26, 20, 15),
    };
    const tomorrow = {
      id: 'tomorrow-first',
      start: new Date(2026, 7, 27, 8, 0),
      end: new Date(2026, 7, 27, 8, 15),
    };
    const room = presentationRoom([late, tomorrow], 25);
    expect(room.get('today-last')).toBe(25);
  });
});
