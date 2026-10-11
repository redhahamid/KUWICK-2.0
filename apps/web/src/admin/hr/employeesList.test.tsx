// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * EMPLOYEES ARE PEOPLE WITH AN EMPLOYMENT RECORD (UAT, 11 October 2026): a
 * login with no HR record appears only under "Accounts without HR record".
 * Demo names only.
 */
const person = (over: Record<string, unknown>) => ({
  staffId: 's',
  fullName: 'Demo',
  legacyRole: 'FRONT_DESK_CLINICAL_STAFF',
  roles: [],
  active: true,
  clinicId: 'clinic-1',
  clinicName: 'Demo Branch',
  hasProfile: true,
  employeeNo: 'EM-1',
  position: 'Nurse',
  employmentType: 'PERMANENT',
  employmentStatus: 'ACTIVE',
  startDate: '2026-01-01',
  ...over,
});
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useEmployees: () => ({
    data: [
      person({ staffId: 's-1', fullName: 'Demo Nurse' }),
      person({ staffId: 's-2', fullName: 'Demo Leaver', employmentStatus: 'RESIGNED', employeeNo: 'EM-2' }),
      person({ staffId: 's-3', fullName: 'Demo Doctor Login', hasProfile: false, employeeNo: null, position: null, employmentType: null, employmentStatus: null, startDate: null }),
    ],
    isLoading: false,
  }),
  usePayrollReadiness: () => ({ data: { employees: [] } }),
  usePayrollRuns: () => ({ data: [] }),
}));
vi.mock('../../core/hooks/useClinics', () => ({ useClinics: () => ({ data: [{ id: 'clinic-1', name: 'Demo Branch' }] }) }));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'clinic-1', setClinicId: () => {}, clinics: [], showSelector: false, mayViewAllBranches: true }),
  useDefaultClinicId: () => 'clinic-1',
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { EmployeesPage } = await import('./EmployeesPage');

/** In the list itself, not the figures above it. */
const listed = (name: string) => screen.queryAllByText(name).filter((element) => !element.closest('.hr-stat')).length > 0;

describe('the employees list', () => {
  it('shows people with an employment record, and logins without one only under their own filter', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <MemoryRouter>
          <App>
            <EmployeesPage />
          </App>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(listed('Demo Nurse')).toBe(true);
    expect(listed('Demo Doctor Login')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(listed('Demo Leaver')).toBe(true);
    expect(listed('Demo Doctor Login')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Accounts without HR record (1)' }));
    expect(listed('Demo Doctor Login')).toBe(true);
    expect(listed('Demo Nurse')).toBe(false);
  });
});
