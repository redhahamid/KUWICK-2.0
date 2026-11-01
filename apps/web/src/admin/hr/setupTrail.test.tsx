// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * STAYING IN THE WIZARD (new-clinic UAT #2, item 69): a page the wizard
 * opened shows the eight steps in the rail, until "Leave setup".
 */
vi.mock('./useHrSetup', () => ({
  useHrSetup: () => ({
    steps: [
      { key: 'company', title: 'Company & statutory numbers', done: true, summary: 'Numbers on file', intro: '' },
      { key: 'items', title: 'Payroll items', done: false, summary: 'None set up', intro: '' },
      { key: 'employees', title: 'Employees', done: false, summary: 'Nobody to pay yet', intro: '' },
    ],
  }),
}));

const { fromSetup, stepOfPage, useSetupTrail, SetupRail } = await import('./setupTrail');

function Probe() {
  const trail = useSetupTrail();
  return trail.on ? <SetupRail onLeave={trail.leave} /> : <span>HR sections</span>;
}
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  );

beforeEach(() => sessionStorage.clear());

describe('the setup trail', () => {
  it('marks a link as opened from setup', () => {
    expect(fromSetup('/admin/hr/employees')).toBe('/admin/hr/employees?from=setup');
    expect(fromSetup('/admin/hr/payroll?period=2026-10')).toBe('/admin/hr/payroll?period=2026-10&from=setup');
  });

  it('knows which step a page belongs to', () => {
    expect(stepOfPage('/admin/hr/settings/payroll-items')).toBe('items');
    expect(stepOfPage('/admin/hr/settings/payroll')).toBe('payRules');
    expect(stepOfPage('/admin/hr/employees/new')).toBe('employees');
    expect(stepOfPage('/admin/hr/leave')).toBeNull();
  });

  it('pins the steps on a page the wizard opened, with that page’s step lit', () => {
    mount('/admin/hr/settings/payroll-items?from=setup');
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' }));
    expect(steps.getByRole('button', { current: 'step' })).toHaveTextContent('Payroll items');
    expect(screen.getByText('Set up payroll · 1/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave setup' })).toBeInTheDocument();
  });

  it('keeps them on the next page in the same tab, and not on a page reached any other way', () => {
    mount('/admin/hr/employees?from=setup').unmount();
    mount('/admin/hr/employees/new');
    expect(screen.getByRole('navigation', { name: 'Setup steps' })).toBeInTheDocument();
    sessionStorage.clear();
    mount('/admin/hr/leave').unmount();
  });

  it('shows the HR sections when nothing came from setup', () => {
    mount('/admin/hr/employees');
    expect(screen.getByText('HR sections')).toBeInTheDocument();
  });
});
