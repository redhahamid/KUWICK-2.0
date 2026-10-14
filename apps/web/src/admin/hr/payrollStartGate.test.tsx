// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollReadiness } from '../types';

/*
 * EARLIER MONTHS WITH NO PAYROLL (UAT, 10 October 2026): "Jun–Sep have no
 * payroll run — PCB may be understated", said before the month is worked out,
 * and never a block.
 */
let served: PayrollReadiness | undefined;
vi.mock('../hooks/useAdmin', () => ({
  usePayrollReadiness: () => ({ data: served, isLoading: false }),
}));

const { PayrollStartGate } = await import('./PayrollStartGate');

const readiness = (over: Partial<PayrollReadiness['summary']>, people: PayrollReadiness['employees']): PayrollReadiness => ({
  period: '2026-10',
  periodLabel: 'October 2026',
  summary: { total: people.length, ready: people.length, withBlockers: 0, withAdvisories: people.length, withoutEmployer: 0, ...over },
  employers: [],
  employees: people,
});
const person = (staffId: string, name: string, monthsWithoutPay: string | null): PayrollReadiness['employees'][number] => ({
  staffId,
  name,
  position: 'Nurse',
  legalEmployerId: 'le-1',
  employerName: 'Demo Sdn Bhd',
  startDate: '2024-01-01',
  monthsWithoutPay,
  readiness: { items: [], done: 0, total: 0, blockersOutstanding: 0, ready: true },
});

const mount = () =>
  render(
    <MemoryRouter>
      <PayrollStartGate period="2026-10" salaryOnRecord={2}>
        {({ canStart }) => <button disabled={!canStart}>Work out the month</button>}
      </PayrollStartGate>
    </MemoryRouter>,
  );

describe('earlier months of the year with no payroll', () => {
  it('names the months and the people, and leaves the month free to work out', () => {
    served = readiness(
      { monthsWithoutPay: { people: 2, months: [6, 7, 8, 9], text: 'Jun–Sep', taxYear: 2026 } },
      [person('s1', 'Demo Nurse', 'Jun–Sep'), person('s2', 'Demo Clerk', 'Aug–Sep'), person('s3', 'Demo Doctor', null)],
    );
    mount();
    const notice = screen.getByTestId('months-without-pay');
    expect(notice).toHaveTextContent('Jun–Sep have no payroll — PCB may be understated');
    expect(notice).toHaveTextContent('For 2 people employed then. The month can still be worked out.');
    expect(within(notice).getByRole('link', { name: 'Demo Nurse' })).toHaveAttribute('href', '/admin/hr/employees/s1?tab=statutory&focus=tax');
    expect(notice).toHaveTextContent('Demo Clerk: Aug–Sep 2026');
    expect(notice).not.toHaveTextContent('Demo Doctor');
    expect(screen.getByRole('button', { name: 'Work out the month' })).toBeEnabled();
  });

  it('says nothing when every earlier month is on record', () => {
    served = readiness({ monthsWithoutPay: { people: 0, months: [], text: null, taxYear: 2026 } }, [person('s1', 'Demo Nurse', null)]);
    mount();
    expect(screen.queryByTestId('months-without-pay')).toBeNull();
  });
});
