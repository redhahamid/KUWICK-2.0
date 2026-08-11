import { ReactNode } from 'react';
import { StatusTone, statusPalette } from '../tokens';

/**
 * G4.5d5b-1 — a status chip that always carries its word.
 *
 * There is no API here for "just the colour". Colour alone is unreadable to a
 * colour-blind clinician and invisible in a printed screenshot, and every
 * status in this product has a short English name — so the label is required
 * and the tone is the decoration, not the other way round.
 *
 * Raw enum values never reach this component: callers map them to approved
 * wording first. `KuwickStatusTag` takes a string it can render as-is.
 */
export interface KuwickStatusTagProps {
  tone: StatusTone;
  label: string;
  /** A number or short qualifier after the label — "12 available". */
  detail?: ReactNode;
  icon?: ReactNode;
  /** Marks the chip as an alert for assistive technology. */
  alert?: boolean;
}

export function KuwickStatusTag({ tone, label, detail, icon, alert }: KuwickStatusTagProps) {
  const palette = statusPalette[tone];
  return (
    <span
      className="kw-status-tag"
      data-tone={tone}
      role={alert ? 'status' : undefined}
      style={{ color: palette.fg, background: palette.bg }}
    >
      {icon}
      <span className="kw-status-tag-label">{label}</span>
      {detail !== undefined && detail !== null && <span className="kw-status-tag-detail">{detail}</span>}
    </span>
  );
}
