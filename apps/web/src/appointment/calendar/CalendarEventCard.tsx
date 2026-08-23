import { Tooltip } from 'antd';
import { AppointmentStatus } from '@kuwick/shared';
import { PersonAvatar } from '../shared/PersonAvatar';
import { statusAccent } from '../shared/appointment-colors';
import { CardModel } from './calendar-events';

/**
 * THE APPOINTMENT CARD — a Kuwick component, not a calendar-library cell.
 *
 * The approved mockup (clinic panels 2 and 3) does not draw scheduler rows:
 * it draws a CARD. A person's face, the time in the doctor's own colour, the
 * patient's name as the loudest thing on it, the service under it, and — when
 * the card is wide enough to earn it — the doctor's name and the booking's
 * state. react-big-calendar still owns the geometry (where the card sits, how
 * tall it is, which column it belongs to); everything inside the box is this
 * file's, which is why the grid no longer looks like the library.
 *
 * DENSITY IS DECIDED BY REAL WIDTH, not by guessing. The card renders every
 * line it has, and the stylesheet's container queries retire them from the
 * bottom up as the card narrows — service, then doctor, then the name onto
 * its own line — so a squeezed card degrades to fewer TRUE lines instead of
 * one clipped one. Nothing here reads or affects availability, booking or
 * conflict rules: it is presentation over an event the engine already
 * decided existed.
 */

/** Short, human status words — the chip on a card with room for one. */
const STATUS_WORDS: Partial<Record<AppointmentStatus, string>> = {
  [AppointmentStatus.REQUESTED]: 'Requested',
  [AppointmentStatus.CONFIRMED]: 'Confirmed',
  [AppointmentStatus.REMINDED]: 'Reminded',
  [AppointmentStatus.ARRIVED]: 'Arrived',
  [AppointmentStatus.CHECKED_IN]: 'Checked in',
  [AppointmentStatus.IN_QUEUE]: 'In queue',
  [AppointmentStatus.COMPLETED]: 'Completed',
  [AppointmentStatus.NO_SHOW]: 'No-show',
  [AppointmentStatus.CANCELLED]: 'Cancelled',
};

export interface CalendarEventCardProps {
  card: CardModel;
  status: AppointmentStatus;
  staffId: string;
  providerName: string;
  /** Month chips stay a single line — the cell is a date, not an hour. */
  compact: boolean;
  compactLine: string;
  tooltip: string;
}

export function CalendarEventCard({
  card,
  status,
  staffId,
  providerName,
  compact,
  compactLine,
  tooltip,
}: CalendarEventCardProps) {
  if (compact) {
    const [time, ...rest] = compactLine.split(' ');
    return (
      <Tooltip title={tooltip}>
        <div className="kw-calendar-event kw-evchip">
          <span className="kw-evchip-time">{time}</span>
          <span className="kw-evchip-name">{rest.join(' ')}</span>
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`${tooltip} — double-click to move`}>
      <div
        // `kw-calendar-event` stays on the card as the STABLE HOOK for "an
        // appointment on the grid" — the golden-path walk and anything else
        // that has to find a booking address it by that name. The visual
        // class is kw-evcard; renaming the hook would have been a test edit
        // pretending to be a design decision.
        className="kw-calendar-event kw-evcard"
        // The card model already knows the booking's length: ≤15 minutes is
        // one line side by side, ≤30 is two, anything longer takes the lot.
        data-density={card.compact ? 'tight' : card.dense ? 'dense' : undefined}
      >
        <span className="kw-evcard-top">
          <PersonAvatar name={providerName || 'Provider'} colorSeed={staffId} size="xs" />
          <span className="kw-evcard-time">{card.time}</span>
          <span
            className="kw-evcard-status"
            style={{ color: statusAccent(status), borderColor: statusAccent(status) }}
          >
            {STATUS_WORDS[status] ?? ''}
          </span>
        </span>
        <span className="kw-evcard-name">{card.patient}</span>
        {card.service ? <span className="kw-evcard-service">{card.service}</span> : null}
        {providerName ? <span className="kw-evcard-doctor">{providerName}</span> : null}
      </div>
    </Tooltip>
  );
}
