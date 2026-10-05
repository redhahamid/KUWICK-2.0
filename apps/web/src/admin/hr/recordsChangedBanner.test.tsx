// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordsChangedBanner } from './RecordsChangedBanner';

const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ staffId: `s${i}`, name: `Demo Person ${i + 1}`, what: ['statutory standing'] }));

describe('records changed since the draft was worked out', () => {
  it('says so in the words UAT asked for, names who and what, and works the month out again', () => {
    const onWorkOut = vi.fn();
    render(
      <RecordsChangedBanner
        changed={{ since: '2026-10-05T01:00:00.000Z', employees: [{ staffId: 's1', name: 'Puteri Balqis', what: ['statutory standing', 'salary'] }] }}
        mayRun
        working={false}
        onWorkOut={onWorkOut}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Records changed since this draft was worked out — work it out again.');
    expect(screen.getByText('Puteri Balqis: statutory standing, salary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Work it out again' }));
    expect(onWorkOut).toHaveBeenCalledTimes(1);
  });

  it('names the first eight and counts the rest', () => {
    render(<RecordsChangedBanner changed={{ since: null, employees: people(11) }} mayRun working={false} onWorkOut={() => undefined} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getByText('and 3 more')).toBeInTheDocument();
  });

  it('offers no button to somebody who may not run payroll, and says nothing when nothing moved', () => {
    const { rerender } = render(<RecordsChangedBanner changed={{ since: null, employees: people(1) }} mayRun={false} working={false} onWorkOut={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<RecordsChangedBanner changed={null} mayRun working={false} onWorkOut={() => undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
