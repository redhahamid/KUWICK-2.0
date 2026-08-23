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
 * THE READING ORDER IS THE RECEPTIONIST'S, NOT THE DESIGNER'S. A person at a
 * counter answers six questions off this card in about two seconds: who, when,
 * what for, which doctor, what state, and does anybody need to do something.
 * So TIME and PATIENT share the headline — the two anchors — with the patient
 * carrying the weight; the service and the provider follow as supporting
 * lines; and the state speaks up only when it is asking for something.
 *
 * THREE COLOUR SYSTEMS MEET HERE AND NEVER MIX (approved decisions 1, 2, 4):
 *   PATIENT  — the subject. A NEUTRAL monogram, never a provider hue, never
 *              a gendered silhouette. `photoUrl` is the seam a real patient
 *              photograph drops into later without redrawing the card.
 *   PROVIDER — identity. The left edge, the card's pastel in week, the dot
 *              before their name. Never a strong fill: a full-width pastel
 *              behind every booking is how a busy single-doctor day turned
 *              into a wall of one colour.
 *   STATUS   — workflow state. A dot for the expected case; a compact badge
 *              only where somebody must act. The word travels with the colour.
 *
 * Colour arrives as CSS custom properties rather than inline paint so the
 * stylesheet can decide how much each VIEW spends — a decision that belongs
 * to the view, not to the card.
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
   * the COLUMN is the doctor and repeating them on every card costs the
   * patient's name the space it needs.
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
    // THE MONTH CHIP. One line, one job: which patient, at what time. Month
    // is the only view where the provider's pastel touches the whole chip —
    // a 20px chip has no body for it to flood.
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
  const namesProvider = Boolean(providerName) && showProvider && (card.provider || wide);

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
        {/* The PATIENT's face, in the position the approved mockup gives it.
            Neutral by design; a real photograph would slot in here. */}
        <span className="kw-evcard-gutter">
          <PersonAvatar name={card.patient} size="xs" />
        </span>

        <span className="kw-evcard-body">
          {/* THE HEADLINE — the two anchors, together. Time first so the
              column scans vertically; the patient carries the weight. */}
          <span className="kw-evcard-headline">
            <span className="kw-evcard-time">{card.time}</span>
            <span className="kw-evcard-name">{card.patient}</span>
          </span>
          {card.service ? <span className="kw-evcard-service">{card.service}</span> : null}
          {namesProvider ? (
            <span className="kw-evcard-doctor" style={{ color: color.text }}>
              <span
                className="kw-evcard-pdot"
                style={{ background: color.accent }}
                aria-hidden="true"
              />
              {providerName}
            </span>
          ) : null}
        </span>

        {/* The state. A dot is the whole treatment for the expected case; the
            word joins it where somebody has to act, and on a card long enough
            to spell it out anyway. */}
        <span className="kw-evcard-state" style={{ ['--st-tone' as string]: state.tone }}>
          <span className="kw-evcard-dot" aria-hidden="true" />
          {wordOnCard ? <span className="kw-evcard-word">{state.word}</span> : null}
        </span>
      </div>
    </Tooltip>
  );
}
