import { Tooltip } from 'antd';
import { AppointmentStatus, ProviderColor } from '@kuwick/shared';
import { PersonAvatar } from '../shared/PersonAvatar';
import { showsStatusWord, statusPresentation } from '../shared/status-presentation';
import { CardModel } from './calendar-events';

/**
 * THE APPOINTMENT CARD — a Kuwick component, not a calendar-library cell.
 *
 * react-big-calendar still owns the GEOMETRY (where the card sits, how tall
 * it is, which column it belongs to); everything inside the box is this
 * file's, which is why the grid no longer looks like the library.
 *
 * THREE SEPARATE SYSTEMS MEET HERE AND NEVER MIX (approved decisions 1, 2, 4):
 *   PATIENT  — the subject. The name is the strongest text on the card at
 *              every density, in ink, never abbreviated, never dropped.
 *   PROVIDER — identity. It reaches the card as the left edge, the gutter
 *              band and the avatar ring, and NEVER as a body fill: a
 *              full-width pastel behind every booking is how a busy single-
 *              doctor day turned into a wall of one colour.
 *   STATUS   — workflow state. A dot for the expected case; a compact badge
 *              only for the three states somebody must act on. The word
 *              always travels with the colour.
 *
 * The colour arrives as CSS custom properties rather than inline paint so the
 * stylesheet can decide how much of it each VIEW is allowed to use — a
 * decision that belongs to the view, not to the card.
 */

export interface CalendarEventCardProps {
  card: CardModel;
  status: AppointmentStatus;
  /** The provider's resolved identity colour — stored first, fallback second. */
  color: ProviderColor;
  providerName: string;
  /** Month chips stay a single line — the cell is a date, not an hour. */
  compact: boolean;
  compactLine: string;
  tooltip: string;
  /** True when the day/provider column is wide: the card composes across. */
  wide?: boolean;
  /**
   * Whether the card names the doctor. False in the Providers view, where
   * the COLUMN is the doctor and repeating them on every card would be
   * twenty-four restatements of the column header.
   */
  showProvider?: boolean;
}

export function CalendarEventCard({
  card,
  status,
  color,
  providerName,
  compact,
  compactLine,
  tooltip,
  wide,
  showProvider = true,
}: CalendarEventCardProps) {
  const state = statusPresentation(status);

  if (compact) {
    // THE MONTH CHIP. One line, one job: which patient, at what time. The
    // provider is the 2px edge and the faint ground — month is the only view
    // where the pastel touches the whole chip, because a chip is 20px tall
    // and there is no body for it to flood.
    const [time, ...rest] = compactLine.split(' ');
    return (
      <Tooltip title={tooltip}>
        <div className="kw-calendar-event kw-evchip" data-prominence={state.prominence}>
          <span className="kw-evchip-time">{time}</span>
          <span className="kw-evchip-name">{rest.join(' ')}</span>
        </div>
      </Tooltip>
    );
  }

  const wordOnCard = showsStatusWord(status) || card.tier === 'full';

  return (
    <Tooltip title={`${tooltip} — double-click to move`}>
      <div
        // `kw-calendar-event` stays on the card as the STABLE HOOK for "an
        // appointment on the grid" — the golden-path walk and anything else
        // that has to find a booking addresses it by that name. The visual
        // class is kw-evcard; renaming the hook would have been a test edit
        // pretending to be a design decision.
        className="kw-calendar-event kw-evcard"
        data-tier={card.tier}
        data-prominence={state.prominence}
        data-wide={wide ? 'true' : undefined}
      >
        {/* The provider's band: colour and face, kept to the card's left so
            the body can stay white however wide the column gets. */}
        <span className="kw-evcard-gutter">
          <PersonAvatar name={providerName || 'Provider'} color={color} size="xs" />
        </span>

        <span className="kw-evcard-body">
          <span className="kw-evcard-name">{card.patient}</span>
          {/* Time and service travel together when the card stacks, and
              become independent columns when it composes across a wide day
              row — `display: contents` in the stylesheet, so one DOM serves
              both without a second rendering path. */}
          <span className="kw-evcard-line">
            <span className="kw-evcard-time">{card.time}</span>
            {card.service ? <span className="kw-evcard-service">{card.service}</span> : null}
          </span>
          {/* A wide day row has horizontal room the stacked ladder does not,
              so it names the doctor at every tier — "which doctor" is one of
              the five things the front desk must read in seconds. */}
          {providerName && showProvider && (card.provider || wide) ? (
            <span className="kw-evcard-doctor" style={{ color: color.text }}>
              {providerName}
            </span>
          ) : null}
        </span>

        {/* The state. A dot is the whole treatment for the expected case; the
            word joins it when somebody has to act, and on a card long enough
            to spell it out anyway. */}
        <span className="kw-evcard-state" style={{ ['--st-tone' as string]: state.tone }}>
          <span className="kw-evcard-dot" aria-hidden="true" />
          {wordOnCard ? <span className="kw-evcard-word">{state.word}</span> : null}
        </span>
      </div>
    </Tooltip>
  );
}
