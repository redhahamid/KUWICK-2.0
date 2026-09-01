import type { PayrollExceptionRow } from '../types';

/**
 * SEVERITY, SAID THE SAME WAY EVERYWHERE.
 *
 * Blocking, warning and info appear in three places on the payroll screen —
 * the banner, the exception centre and the run table — and a person deciding
 * whether they can pay their staff should not have to work out that "red tag
 * here" and "bold red number there" are the same idea.
 *
 * NOT COLOUR ALONE. Blocking carries a solid rule down its left edge and the
 * heaviest weight; warning carries a lighter rule; info carries none. The
 * three are still told apart on a monochrome print of the payslip register, or
 * by a reader who cannot separate red from amber.
 */
const LABEL: Record<PayrollExceptionRow['severity'], string> = {
  BLOCKING: 'Blocking',
  WARNING: 'Warning',
  INFO: 'Note',
};

export function SeverityTag({
  severity,
  overridden = false,
}: {
  severity: PayrollExceptionRow['severity'];
  overridden?: boolean;
}) {
  return (
    <span
      className={`kw-sev kw-sev--${severity.toLowerCase()}${overridden ? ' kw-sev--passed' : ''}`}
      // A blocking exception that has been deliberately passed is no longer
      // blocking anything, and the chip has to stop insisting that it is.
      title={
        overridden
          ? 'Passed deliberately, with a reason on the record'
          : severity === 'BLOCKING'
            ? 'Approval is refused until this is resolved'
            : severity === 'WARNING'
              ? 'On the record; it does not stop approval'
              : 'Informational'
      }
    >
      {LABEL[severity]}
      {overridden ? ' · passed' : ''}
    </span>
  );
}
