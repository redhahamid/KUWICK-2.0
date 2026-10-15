// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollPolicyRow } from '../types';

/*
 * HOW A PART MONTH IS PAID, chosen per rule set (UAT, 10 October 2026):
 * calendar days by the Act unless the clinic picks working days, and the
 * choice reaches the server.
 */
const upsertMutate = vi.fn();

const ruleSet = {
  id: 'rs-1',
  name: 'Everybody',
  legalEmployerId: null,
  overtime: { days: 26, hoursPerDay: 8 },
  pcbProjectionBasis: 'CURRENT_MONTH',
  termination: { basis: 'CALENDAR_DAYS', days: 31 },
  partMonthBasis: 'CALENDAR_DAYS',
  overtimeMode: 'STATUTORY',
  clinicRates: null,
  multipliers: null,
  belowAct: null,
  floor: null,
  protectedCount: 0,
  workforceCategory: null,
  isDefault: true,
  appliesTo: 'Everybody not in a group',
  employeeCount: 1,
  employeeNames: ['Demo Nurse'],
  removable: false,
  updatedAt: '2026-10-01T00:00:00.000Z',
} as unknown as PayrollPolicyRow;

vi.mock('./newStaffDefaults', () => ({
  useNewStaffDefaults: () => ({ workDaysPerWeek: 6, probationMonths: 3, departments: ['Clinical'] }),
  useSetNewStaffDefaults: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));
vi.mock('../hooks/useAdmin', () => ({
  usePayrollApprovalPolicy: () => ({ data: undefined, error: null }),
  useSetPayrollApprovalPolicy: () => ({ mutate: vi.fn(), isPending: false }),
  usePayrollPolicies: () => ({ data: { policies: [ruleSet] }, error: null }),
  useStatutoryRates: () => ({ data: undefined }),
  useUpsertPayrollPolicy: () => ({ mutate: upsertMutate, isPending: false }),
  useDeletePayrollPolicy: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { PayrollSettingsPage } = await import('./PayrollSettingsPage');

describe('part-month proration on a rule set', () => {
  it('starts on calendar days, and sends working days when the clinic picks them', () => {
    render(
      <MemoryRouter>
        <AntApp>
          <PayrollSettingsPage />
        </AntApp>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));

    expect(screen.getByText(/RM1,800 × 11\/31 = RM638\.71/)).toBeTruthy();

    fireEvent.mouseDown(screen.getByLabelText('Part-month proration'));
    fireEvent.click(screen.getByTitle('Working days'));
    expect(screen.getByText(/working days employed ÷ working days in the month/)).toBeTruthy();
    expect(screen.queryByText(/RM1,800 × 11\/31/)).toBeNull();
    expect(screen.getByText(/Unpaid leave keeps its own divisor/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({ id: 'rs-1', partMonthBasis: 'WORKING_DAYS' });
  });
});
