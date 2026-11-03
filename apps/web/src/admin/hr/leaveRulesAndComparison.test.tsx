// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/* New-clinic UAT #2 re-check, 3 November 2026: items 80 and 81. Demo names only. */
const saveRules = vi.fn();
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useLeaveTypes: () => ({
    data: [
      { id: 't1', code: 'ANNUAL', name: 'Annual leave', paid: true, daysPerYear: 8, documentRequired: false, carryForwardCap: null, statutory: 'ANNUAL', actMinimum: 8, active: true },
      { id: 't2', code: 'COMPASSIONATE', name: 'Compassionate leave', paid: true, daysPerYear: 3, documentRequired: false, carryForwardCap: null, statutory: null, actMinimum: null, active: true },
      { id: 't3', code: 'MATERNITY', name: 'Maternity leave', paid: true, daysPerYear: 98, documentRequired: true, carryForwardCap: null, statutory: 'MATERNITY', actMinimum: 98, active: true },
    ],
  }),
  useSaveLeaveType: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useGlobalSetting', () => ({
  useGlobalSetting: () => ({ data: null }),
  useSetGlobalSetting: () => ({ mutate: saveRules, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { LeaveTypesPanel } = await import('./LeaveTypesPanel');
const { MonthComparison } = await import('./PayrollRunPage');

describe('part-year leave rules (item 80)', () => {
  it('gives compassionate leave in full by default, keeps the Act’s types fixed, and rounds to half days', () => {
    render(
      <App>
        <LeaveTypesPanel />
      </App>,
    );
    const table = within(screen.getByTestId('leave-types'));
    expect(table.getByLabelText('Annual leave when joining mid-year')).toBeTruthy();
    expect(screen.getByText('In full (the Act)')).toBeTruthy();
    expect(screen.getAllByTitle('In full').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Half days')).toBeTruthy();
  });

  it('saves whole-day rounding as the clinic’s setting', async () => {
    render(
      <App>
        <LeaveTypesPanel />
      </App>,
    );
    fireEvent.mouseDown(screen.getByLabelText('Round part-year leave to'));
    fireEvent.click(await screen.findByTitle('Whole days'));
    expect(saveRules).toHaveBeenCalledWith({ rounding: 'WHOLE', notProRated: ['COMPASSIONATE'] }, expect.anything());
  });
});

describe('this month beside the one before (item 81)', () => {
  it('shows October | November | Change and why each person moved', () => {
    render(
      <MemoryRouter>
        <MonthComparison
          comparison={{
            previousLabel: 'October',
            currentLabel: 'November',
            totals: [
              { label: 'Gross pay', previous: '1096.77', current: '2000.00', change: '+903.23' },
              { label: 'Net pay', previous: '963.00', current: '1757.25', change: '+794.25' },
            ],
            people: [{ staffId: 's1', name: 'Demo Nurse', previousNet: '963.00', currentNet: '1757.25', change: '+794.25', reason: 'Joined 15 Oct, part month in October' }],
          }}
        />
      </MemoryRouter>,
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['', 'October', 'November', 'Change']);
    expect(within(table).getByRole('row', { name: /Gross pay/ })).toHaveTextContent('+');
    expect(screen.getByText(/Joined 15 Oct, part month in October/)).toBeTruthy();
  });
});
