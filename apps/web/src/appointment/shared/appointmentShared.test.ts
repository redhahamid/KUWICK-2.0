import { describe, expect, it } from 'vitest';
import { AppointmentStatus } from '@kuwick/shared';
import {
  AVAILABILITY_COLORS,
  METRIC_COLORS,
  statusAccent,
  statusSoft,
} from './appointment-colors';
import { statusCardBackground, statusDotColor } from '../calendar/calendar-events';
import { initialsOf } from './PersonAvatar';

// ===========================================================================
// FINAL UAT REDESIGN — the shared foundation.
//
// Status colour used to live in four places and had drifted. These pins make
// shared/appointment-colors.ts the single source and hold the calendar's own
// exported names to it, so a future edit in one spot cannot quietly disagree
// with the others again.
// ===========================================================================

describe('one source for status colour', () => {
  it('1. every status has an accent and a soft tint — no status falls through to undefined', () => {
    for (const status of Object.values(AppointmentStatus)) {
      expect(statusAccent(status)).toMatch(/^#[0-9a-f]{6}$/);
      expect(statusSoft(status)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('2. the calendar exports DELEGATE — same value for every status', () => {
    for (const status of Object.values(AppointmentStatus)) {
      expect(statusDotColor(status)).toBe(statusAccent(status));
      expect(statusCardBackground(status)).toBe(statusSoft(status));
    }
  });

  it('3. released states are grey on a card dot — a released slot is background, not an alarm', () => {
    for (const status of [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.RESCHEDULED,
      AppointmentStatus.WAITLIST,
    ]) {
      expect(statusAccent(status)).toBe('#98a2b3');
    }
  });

  it('4. the KPI strip keeps danger red for the No-show COUNT — a KPI is a follow-up fact', () => {
    expect(METRIC_COLORS.noShow).toBe('#b42318');
    expect(METRIC_COLORS.booked).toBe(statusAccent(AppointmentStatus.CONFIRMED));
    expect(METRIC_COLORS.arrived).toBe(statusAccent(AppointmentStatus.ARRIVED));
    expect(METRIC_COLORS.waiting).toBe(statusAccent(AppointmentStatus.CHECKED_IN));
    expect(METRIC_COLORS.completed).toBe(statusAccent(AppointmentStatus.COMPLETED));
  });

  it('5. the availability trio is the CSS token trio', () => {
    // Mirrors --apt-avail / --apt-limited / --apt-full in appointment-v3.css.
    expect(AVAILABILITY_COLORS).toEqual({
      available: '#16a34a',
      limited: '#d97706',
      full: '#98a2b3',
    });
  });
});

describe('the one initials helper', () => {
  it('6. two words → two initials; one word → one; empty → a placeholder', () => {
    expect(initialsOf('Siti Aminah binti Yusof')).toBe('SA');
    expect(initialsOf('Nurul')).toBe('N');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('dr. chong wei ling')).toBe('DC');
  });
});
