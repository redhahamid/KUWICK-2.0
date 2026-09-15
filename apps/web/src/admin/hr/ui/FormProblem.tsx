import { useEffect } from 'react';

/**
 * A REFUSAL THE PERSON WHO CAUSED IT CAN SEE.
 *
 * Found in staging UAT on the rule set drawer: typing an overtime divisor of 30
 * was correctly refused and the refusal was INVISIBLE. The drawer body scrolls
 * (`.hr-drawer__body { overflow: auto }`) and the Save button sits in a pinned
 * footer outside it, so pressing Save rendered the reason at the top of a body
 * that had been scrolled past. Nothing appeared to happen. The owner closed the
 * drawer by hand and guessed.
 *
 * Two rules come out of that, and they are what this file is:
 *
 * 1. THE REASON BELONGS BESIDE THE FIELD THAT CAUSED IT. "An overtime divisor
 *    of 30 underpays every hour" means nothing forty lines above the box where
 *    30 was typed.
 *
 * 2. WHEREVER IT LANDS, THE VIEW MOVES TO IT. A message rendered off-screen is
 *    the same as no message, and neither the writer of the form nor the person
 *    using it can tell which they are getting.
 */
export type FormProblem = { field?: string; message: string } | null;

/** Drawers that predate the field-level shape still pass a bare string. */
type Problem = FormProblem | string | null | undefined;

const messageOf = (problem: Problem): string | null =>
  typeof problem === 'string' ? problem : (problem?.message ?? null);

const fieldOf = (problem: Problem): string | undefined =>
  typeof problem === 'string' ? undefined : problem?.field;

/** The id the banner carries, so the hook below can find it without a ref. */
export const PROBLEM_NOTICE_ID = 'hr-form-problem';

/**
 * The reason, under the field it is about. Renders nothing anywhere else, so a
 * form can drop one of these under every input and only the guilty one speaks.
 */
export function FieldProblem({ problem, field }: { problem: Problem; field: string }) {
  if (fieldOf(problem) !== field) return null;
  const message = messageOf(problem);
  if (!message) return null;
  return (
    <div className="hr-form__error" role="alert">
      {message}
    </div>
  );
}

/**
 * The banner, for a problem that belongs to no single field — "a clinic-rate
 * rule set needs at least one amount" is about the form, not about a box.
 */
export function ProblemNotice({ problem }: { problem: Problem }) {
  const message = messageOf(problem);
  if (!message || fieldOf(problem)) return null;
  return (
    <div id={PROBLEM_NOTICE_ID} className="hr-notice hr-notice--attn" role="alert">
      {message}
    </div>
  );
}

/**
 * Puts the view where the reason is.
 *
 * A new problem object every time it is set, so pressing Save twice on the same
 * mistake moves the view twice rather than going quiet on the second press —
 * which is exactly when somebody is least sure anything is working.
 */
export function useProblemFocus(problem: Problem) {
  useEffect(() => {
    if (!messageOf(problem)) return;
    const field = fieldOf(problem);
    const target = field ? document.getElementById(field) : document.getElementById(PROBLEM_NOTICE_ID);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Focusing the input is what tells a screen reader, and what puts the
    // caret back in the box that has to change.
    if (field && typeof (target as HTMLInputElement).focus === 'function') {
      (target as HTMLInputElement).focus({ preventScroll: true });
    }
  }, [problem]);
}
