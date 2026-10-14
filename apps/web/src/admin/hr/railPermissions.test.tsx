// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * A SEAT IN THE RAIL IS A PROMISE THAT THERE IS SOMETHING BEHIND IT.
 *
 * The clinic manager approves leave, claims and overtime and never sees a
 * salary. She was still given the Payroll seat and then refused at it — "Your
 * account is not permitted to view payroll" — which reads as a fault in the
 * product rather than the boundary the clinic set on purpose.
 *
 * The server stays the enforcer; this only decides what is drawn. Which is why
 * the last test here matters most: a session minted before permissions were
 * published carries no array at all, and absent has to keep meaning "draw it",
 * never "no" — otherwise every stale session loses its whole rail at once.
 */
const permissions = vi.hoisted(() => ({ value: undefined as string[] | undefined }));

vi.mock('../../core/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ staff: { permissions: permissions.value } }),
}));

vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: undefined, setClinicId: vi.fn(), clinics: [], showSelector: false }),
}));

vi.mock('../hooks/useAdmin', () => ({
  usePayrollReadiness: () => ({ data: undefined }),
  useWorkforceToday: () => ({ data: undefined }),
}));

const { HrShell } = await import('./HrShell');

const railLabels = () =>
  [...screen.getByRole('navigation', { name: 'HR sections' }).querySelectorAll('.hr-side__label')].map((node) =>
    (node.textContent ?? '').trim(),
  );

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/admin/hr/leave']}>
      <HrShell />
    </MemoryRouter>,
  );

describe('the HR rail draws only what the account can open', () => {
  it('gives the owner every seat, Payroll included', () => {
    permissions.value = ['hr.view', 'hr.payroll.view', 'hr.leave.approve'];
    mount();
    expect(railLabels()).toContain('Payroll');
  });

  it('withholds the Payroll seat from a clinic manager rather than refusing her at it', () => {
    permissions.value = ['hr.view', 'hr.leave.approve', 'hr.claim.approve', 'hr.attendance.manage'];
    mount();
    const labels = railLabels();
    expect(labels).not.toContain('Payroll');
    // The rest of her job is untouched — this withholds one seat, not a module.
    expect(labels).toEqual(['Employees', 'Attendance', 'Roster', 'Leave', 'Claims', 'Reports']);
  });

  it('draws everything for a session that carries no permission array at all', () => {
    // Absent is "fall back", never "no": the server remains the enforcer and a
    // stale session keeps yesterday's behaviour until its next refresh.
    permissions.value = undefined;
    mount();
    expect(railLabels()).toContain('Payroll');
  });
});
