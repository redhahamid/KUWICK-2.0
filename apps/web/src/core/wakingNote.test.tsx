// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WAKING_TEXT, WakingNote } from './WakingNote';

/* A FRIENDLY WAIT (new-clinic UAT #2, item 56). */
describe('the waking-up note', () => {
  afterEach(() => vi.useRealTimers());

  it('says the server is waking up once the wait has gone on', () => {
    vi.useFakeTimers();
    render(<WakingNote />);
    expect(screen.getByRole('status')).toHaveTextContent('Getting your page ready…');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByRole('status')).toHaveTextContent(WAKING_TEXT);
  });
});
