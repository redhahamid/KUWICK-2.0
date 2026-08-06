import { ReactNode } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

/**
 * G4.5d5b-1 — a number somebody is going to act on.
 *
 * Used for a calculator result and for the dispensing stock figure. Both are
 * values a clinician reads at a glance and then does something irreversible
 * about, so both get the same treatment: the number large and unambiguous,
 * its unit attached rather than implied, and its interpretation underneath in
 * words.
 *
 * `caption` is where the value CAME FROM — "from vitals recorded 09:14" — and
 * it matters as much as the number. A calculator silently using a stale
 * weight is the failure mode this component is shaped to prevent.
 */
export interface KuwickResultCardProps {
  label: string;
  /** The number, already rounded by the caller. Null renders the empty state. */
  value: string | null;
  unit?: string;
  /** Plain-language reading of the value. */
  interpretation?: ReactNode;
  /** Provenance and timestamp. */
  caption?: ReactNode;
  /** Shown in place of the value when it cannot be computed. */
  emptyText?: string;
  tone?: 'neutral' | 'attention';
}

export function KuwickResultCard({
  label,
  value,
  unit,
  interpretation,
  caption,
  emptyText = 'Enter the values above',
  tone = 'neutral',
}: KuwickResultCardProps) {
  return (
    <div className="kw-result-card" data-tone={tone} aria-live="polite">
      <Text type="secondary" className="kw-result-label">
        {label}
      </Text>
      {value === null ? (
        <div className="kw-result-empty">
          <Text type="secondary">{emptyText}</Text>
        </div>
      ) : (
        <div className="kw-result-value">
          <span className="kw-result-number">{value}</span>
          {unit && <span className="kw-result-unit">{unit}</span>}
        </div>
      )}
      {value !== null && interpretation && (
        <div className="kw-result-interpretation">{interpretation}</div>
      )}
      {caption && (
        <Text type="secondary" className="kw-result-caption">
          {caption}
        </Text>
      )}
    </div>
  );
}
