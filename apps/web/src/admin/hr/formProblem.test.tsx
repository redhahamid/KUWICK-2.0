// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FieldProblem, ProblemNotice, useProblemFocus, type FormProblem } from './ui';

/*
 * A REFUSAL THE PERSON WHO CAUSED IT CAN SEE.
 *
 * Staging UAT: an overtime divisor of 30 was correctly refused and the refusal
 * was INVISIBLE. The drawer body scrolls and Save sits in a pinned footer
 * outside it, so the reason rendered at the top of a body already scrolled
 * past. Nothing appeared to happen; the owner closed the drawer and guessed.
 *
 * jsdom has no layout, so these cannot assert that a pixel moved. What they CAN
 * pin is the part that was actually wrong: the reason now belongs to a named
 * field and renders there, the view is asked to move to it, and the box that
 * has to change gets the caret.
 */
const Form = ({ problem }: { problem: FormProblem }) => {
  useProblemFocus(problem);
  return (
    <div>
      <ProblemNotice problem={problem} />
      <input id="ruleset-name" defaultValue="" />
      <FieldProblem problem={problem} field="ruleset-name" />
      <input id="orp-ot-days" defaultValue="30" />
      <FieldProblem problem={problem} field="orp-ot-days" />
    </div>
  );
};

describe('a refused save says why, where the mistake is', () => {
  it('puts the reason under the field it is about and nowhere else', () => {
    render(<Form problem={{ field: 'orp-ot-days', message: 'An overtime divisor of 30 underpays every hour.' }} />);

    const reason = screen.getByRole('alert');
    expect(reason.textContent).toContain('underpays every hour');
    // It sits next to the divisor box, not at the top of the drawer.
    expect(reason.previousElementSibling?.id).toBe('orp-ot-days');
    // And exactly one thing speaks — the banner stays quiet for a field problem.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('puts the caret back in the box that has to change', () => {
    render(<Form problem={{ field: 'orp-ot-days', message: 'Use 26 or fewer.' }} />);
    expect(document.activeElement?.id).toBe('orp-ot-days');
  });

  it('keeps the banner for a problem that belongs to no single field', () => {
    render(<Form problem={{ message: 'A clinic-rate rule set needs at least one amount.' }} />);
    const reason = screen.getByRole('alert');
    expect(reason.id).toBe('hr-form-problem');
    // No field is named, so no field speaks.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('speaks again when the same mistake is submitted twice', () => {
    // The second press is exactly when somebody is least sure anything works,
    // so a message that only moves the view on a CHANGED string would go quiet
    // at the worst moment. Each refusal is its own object.
    const Twice = () => {
      const [problem, setProblem] = useState<FormProblem>(null);
      useProblemFocus(problem);
      return (
        <div>
          <button type="button" onClick={() => setProblem({ field: 'orp-ot-days', message: 'Use 26 or fewer.' })}>
            Save changes
          </button>
          <input id="orp-ot-days" defaultValue="30" />
          <FieldProblem problem={problem} field="orp-ot-days" />
        </div>
      );
    };
    render(<Twice />);
    const save = screen.getByRole('button', { name: 'Save changes' });

    fireEvent.click(save);
    expect(screen.getByRole('alert').textContent).toContain('Use 26 or fewer.');

    const scrolled = vi.spyOn(document.getElementById('orp-ot-days') as HTMLElement, 'scrollIntoView');
    fireEvent.click(save);
    expect(scrolled).toHaveBeenCalled();
  });

  it('says nothing at all when there is nothing wrong', () => {
    render(<Form problem={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
