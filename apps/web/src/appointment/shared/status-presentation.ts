import { AppointmentStatus } from '@kuwick/shared';
import { statusAccent } from './appointment-colors';

/**
 * HOW LOUDLY A STATUS SPEAKS ON A CALENDAR CARD (approved decision 4).
 *
 * `statusAccent` answers "what colour is this state?" and is unchanged — it
 * still governs every DOT, including the deliberate grey a released slot
 * wears. This module answers a different question: how much of the card does
 * this state get to occupy? Twenty-four identical bordered CHECKED IN
 * capsules down one column is not information, it is wallpaper; but a
 * front desk that cannot see at a glance who is already in the building has
 * lost the one fact the day view exists to carry.
 *
 * So the ladder is by OPERATIONAL WEIGHT, not by tidiness:
 *   action      — somebody must do something (a request awaiting approval)
 *   operational — the patient is physically here; the desk acts on this
 *   warning     — a no-show; recognisable, never mistaken for background
 *   quiet       — confirmed and coming: a dot, nothing more
 *   receded     — done; present, deliberately unemphatic
 *   muted       — cancelled/released; grey and struck through
 *
 * Colour never carries this alone: the word ships with the badge, and the
 * List and the drawer always spell the state out in full.
 */
export type StatusProminence =
  | 'action'
  | 'operational'
  | 'warning'
  | 'quiet'
  | 'receded'
  | 'muted';

export interface StatusPresentation {
  /** The short human word — "Checked in", never CHECKED_IN. */
  word: string;
  /** The tone this state paints with on a card. */
  tone: string;
  prominence: StatusProminence;
}

/** No-show is the one card treatment that departs from the dot palette: a
 *  released SLOT is background, but a patient who did not arrive is a fact
 *  somebody has to follow up, so the badge borrows the KPI strip's danger. */
const NO_SHOW_WARNING = '#b42318';

const PRESENTATION: Record<AppointmentStatus, StatusPresentation> = {
  [AppointmentStatus.REQUESTED]: {
    word: 'Requested',
    tone: statusAccent(AppointmentStatus.REQUESTED),
    prominence: 'action',
  },
  [AppointmentStatus.CONFIRMED]: {
    word: 'Confirmed',
    tone: statusAccent(AppointmentStatus.CONFIRMED),
    prominence: 'quiet',
  },
  [AppointmentStatus.REMINDED]: {
    word: 'Reminded',
    tone: statusAccent(AppointmentStatus.REMINDED),
    prominence: 'quiet',
  },
  [AppointmentStatus.ARRIVED]: {
    word: 'Arrived',
    tone: statusAccent(AppointmentStatus.ARRIVED),
    prominence: 'operational',
  },
  [AppointmentStatus.CHECKED_IN]: {
    word: 'Checked in',
    tone: statusAccent(AppointmentStatus.CHECKED_IN),
    prominence: 'operational',
  },
  [AppointmentStatus.IN_QUEUE]: {
    word: 'In queue',
    tone: statusAccent(AppointmentStatus.IN_QUEUE),
    prominence: 'operational',
  },
  [AppointmentStatus.COMPLETED]: {
    word: 'Completed',
    tone: statusAccent(AppointmentStatus.COMPLETED),
    prominence: 'receded',
  },
  [AppointmentStatus.NO_SHOW]: {
    word: 'No-show',
    tone: NO_SHOW_WARNING,
    prominence: 'warning',
  },
  [AppointmentStatus.CANCELLED]: {
    word: 'Cancelled',
    tone: statusAccent(AppointmentStatus.CANCELLED),
    prominence: 'muted',
  },
  [AppointmentStatus.RESCHEDULED]: {
    word: 'Rescheduled',
    tone: statusAccent(AppointmentStatus.RESCHEDULED),
    prominence: 'muted',
  },
  [AppointmentStatus.WAITLIST]: {
    word: 'Waitlist',
    tone: statusAccent(AppointmentStatus.WAITLIST),
    prominence: 'muted',
  },
};

export function statusPresentation(status: AppointmentStatus): StatusPresentation {
  return (
    PRESENTATION[status] ?? {
      word: 'Booked',
      tone: statusAccent(status),
      prominence: 'quiet',
    }
  );
}

/**
 * Does this state earn its WORD on a grid card, or only its dot?
 *
 * The three that do are the three a receptionist would otherwise have to open
 * a drawer to discover: something needs approving, somebody is here, somebody
 * did not come. Everything else is either the expected case or already said
 * by the card's own greying — and is still one hover away.
 */
export function showsStatusWord(status: AppointmentStatus): boolean {
  const { prominence } = statusPresentation(status);
  return prominence === 'action' || prominence === 'operational' || prominence === 'warning';
}
