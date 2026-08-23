import { AppointmentStatus } from '@kuwick/shared';

/**
 * ONE SOURCE for appointment status colour. Before the premium pass this
 * concept lived in four places (calendar-events' dot + card tint, the metric
 * bar's own hexes, and the design-system statusPalette) and they had already
 * drifted. Everything on the appointment surfaces that colours BY STATUS now
 * reads from here; the D-105 tone language itself (which status means what)
 * stays in @kuwick/shared, untouched.
 *
 * Two deliberate departures from a naive tone→hex mapping, both inherited
 * from the diary's semantics:
 * - released states (cancelled, no-show, rescheduled, waitlist) are GREY on
 *   a card dot — a released slot is background, not an alarm;
 * - the metric bar's No-show cell is danger red — as a COUNT it is a fact to
 *   follow up, which is exactly the difference between a card and a KPI.
 */
export function statusAccent(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.REQUESTED:
      return '#7f56d9'; // planned
    case AppointmentStatus.ARRIVED:
      return '#d97706'; // attention — physically at the desk
    case AppointmentStatus.CHECKED_IN:
    case AppointmentStatus.IN_QUEUE:
      return '#0f6b78'; // clinical — in the building
    case AppointmentStatus.COMPLETED:
      return '#16a34a'; // success
    case AppointmentStatus.CANCELLED:
    case AppointmentStatus.NO_SHOW:
    case AppointmentStatus.RESCHEDULED:
    case AppointmentStatus.WAITLIST:
      return '#98a2b3'; // released
    default:
      return '#1d4ed8'; // active — confirmed and coming
  }
}

/** The soft card tint a status earns; white when it has nothing to say. */
export function statusSoft(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.ARRIVED:
      return '#fff8eb';
    case AppointmentStatus.CHECKED_IN:
    case AppointmentStatus.IN_QUEUE:
      return '#eff8f8';
    case AppointmentStatus.REQUESTED:
      return '#faf7ff';
    case AppointmentStatus.COMPLETED:
      return '#f8fafc';
    default:
      return '#ffffff';
  }
}

/**
 * The KPI strip's five cells (Booked / Arrived / Waiting / Completed /
 * No-show). Keys are the strip's own vocabulary, not statuses — "Waiting"
 * aggregates the in-the-building states.
 */
export const METRIC_COLORS = {
  booked: '#1d4ed8',
  arrived: '#d97706',
  waiting: '#0f6b78',
  completed: '#16a34a',
  noShow: '#b42318',
} as const;

/**
 * The public availability calendar's three-word legend. Same values as the
 * --apt-avail/--apt-limited/--apt-full CSS tokens; exported for inline SVG
 * and canvas contexts that cannot read CSS custom properties.
 */
export const AVAILABILITY_COLORS = {
  available: '#16a34a',
  limited: '#d97706',
  full: '#98a2b3',
} as const;
