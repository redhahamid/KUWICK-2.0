import type { PayrollJourney } from '../types';

/**
 * RECORDS CHANGED SINCE THIS DRAFT WAS WORKED OUT (UAT, 5 October 2026).
 *
 * The figures on the workspace were worked out from records that have since
 * moved. The banner says whose and which kinds, and working the month out
 * again is one press away for whoever may run payroll. Nothing to say, no
 * banner: the server sends null when nothing moved, when the month is not a
 * worked-out draft, or when it has no fingerprint to compare with.
 */
export function RecordsChangedBanner({
  changed,
  mayRun,
  working,
  onWorkOut,
}: {
  changed: PayrollJourney['recordsChanged'];
  mayRun: boolean;
  working: boolean;
  onWorkOut: () => void;
}) {
  if (!changed || changed.employees.length === 0) return null;
  const shown = changed.employees.slice(0, 8);
  const more = changed.employees.length - shown.length;
  return (
    <div className="hr-notice hr-notice--attn" role="alert" data-testid="records-changed">
      <strong>Records changed since this draft was worked out — work it out again.</strong>
      <ul>
        {shown.map((person) => (
          <li key={person.staffId}>
            {person.name}: {person.what.join(', ')}
          </li>
        ))}
        {more > 0 ? <li>and {more} more</li> : null}
      </ul>
      {mayRun ? (
        <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" style={{ marginTop: 8 }} disabled={working} onClick={onWorkOut}>
          {working ? 'Working it out…' : 'Work it out again'}
        </button>
      ) : null}
    </div>
  );
}
