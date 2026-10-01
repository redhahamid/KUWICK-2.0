// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * COMPANY & STATUTORY with one branch picked: the companies with nobody
 * active there fold away under one line, so the one that matters is not lost
 * among the ones that do not. Under All branches every company is listed.
 */
const employer = (over: Record<string, unknown>) => ({
  id: 'e-1',
  name: 'Hijraa Sdn Bhd',
  updatedAt: '2026-09-01T00:00:00.000Z',
  registrationNo: '202401000001',
  epfEmployerNo: 'EPF-1',
  socsoEmployerNo: null,
  lhdnEmployerNo: null,
  hrdRegistrationNo: null,
  legacyHrdCategory: null,
  legacyHrdLevyRate: null,
  hrdRegistration: null,
  hrdLevyRatePercent: null,
  hrdEffectiveFrom: null,
  addressLine1: null,
  city: null,
  state: null,
  bankName: null,
  bankAccountOnFile: false,
  bankAccountLastFour: null,
  bankAccountName: null,
  active: true,
  employeeCount: 3,
  payrollRunCount: 0,
  statutoryReadiness: { complete: false, missing: ['SOCSO employer code'], note: '' },
  ...over,
});
let clinicId: string | undefined = 'clinic-a';
const rows = [employer({}), employer({ id: 'e-2', name: 'Cawangan Sdn Bhd', employeeCount: 0 }), employer({ id: 'e-3', name: 'Dormant Sdn Bhd', employeeCount: 0 })];

vi.mock('../hooks/useAdmin', () => ({
  useLegalEmployers: () => ({ data: rows, isLoading: false }),
  useUpsertLegalEmployer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordEmployerHrd: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));
vi.mock('../../core/hooks/useClinics', () => ({ useClinics: () => ({ data: [{ id: 'clinic-a', name: 'Bangi' }, { id: 'clinic-b', name: 'Kajang' }] }) }));
vi.mock('../../core/hooks/useClinicFilter', () => ({ useClinicFilter: () => ({ clinicId, setClinicId: () => {}, clinics: [], showSelector: true, mayViewAllBranches: true }) }));

const { LegalEmployersPage } = await import('./LegalEmployersPage');
const mount = () =>
  render(
    <AntApp>
      <MemoryRouter>
        <LegalEmployersPage />
      </MemoryRouter>
    </AntApp>,
  );

describe('the companies, with one branch picked', () => {
  it('folds the companies with nobody active here under one line, and unfolds them on request', () => {
    clinicId = 'clinic-a';
    mount();
    expect(screen.getByText('Hijraa Sdn Bhd')).toBeInTheDocument();
    expect(screen.queryByText('Cawangan Sdn Bhd')).toBeNull();
    const toggle = screen.getByRole('button', { name: /Show other employers \(no staff here\) · 2/ });
    fireEvent.click(toggle);
    expect(screen.getByText('Cawangan Sdn Bhd')).toBeInTheDocument();
    expect(screen.getByText('Dormant Sdn Bhd')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide other employers/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists every company under All branches, with nothing folded', () => {
    clinicId = undefined;
    mount();
    expect(screen.getByText('Cawangan Sdn Bhd')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /other employers/ })).toBeNull();
  });
});
