// @vitest-environment jsdom
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeRow } from '../types';

/**
 * A CLAIM HR RECORDS FROM A PAPER RECEIPT. The portal was the only way a
 * claim could start, which left the receptionist's parking ticket and the
 * cleaner without a login nowhere to go. HR now records one for them: the
 * same fields, the same mileage arithmetic, sent for the person it belongs to.
 */
const createMutate = vi.fn();
const upload = vi.fn();
vi.mock('../../core/hooks/useClinicFilter', () => ({ useClinicFilter: () => ({ clinicId: 'c-a', setClinicId: () => {}, clinics: [], showSelector: false, mayViewAllBranches: false }) }));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true, permissionHint: () => '' }));
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useStaffClaims: () => ({ data: [], isLoading: false, isError: false }),
  useEmployees: () => ({
    data: [
      { staffId: 's-1', fullName: 'Amirah Demo', position: 'Clinic assistant', hasProfile: true, active: true },
      { staffId: 's-2', fullName: 'Left Person', position: 'Clinic assistant', hasProfile: true, active: false },
    ] as unknown as EmployeeRow[],
    isLoading: false,
  }),
  useStaffBenefits: () => ({ data: { accounts: [] }, isLoading: false }),
  useDecideStaffClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSettleStaffClaim: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStaffClaimHistory: () => ({ data: [] }),
  useClaimPolicy: () => ({ data: { mileageRatePerKm: '0.60', receiptRequired: false, updatedAt: '2026-09-01T00:00:00.000Z' } }),
  useCreateStaffClaim: () => ({ mutateAsync: createMutate, isPending: false }),
  uploadStaffFileFor: (...args: unknown[]) => upload(...args),
}));

const { ClaimsPage } = await import('./ClaimsPage');

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AntApp>
        <MemoryRouter>
          <ClaimsPage />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMutate.mockReset().mockResolvedValue({ id: 'claim-1', amountClaimed: '30.00' });
  upload.mockReset();
});

describe('recording a claim for somebody', () => {
  it('sends the same claim the portal would, for the person chosen, and offers only people still employed', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: '+ Record claim' }));
    const who = screen.getByLabelText('Employee') as HTMLSelectElement;
    expect([...who.options].map((option) => option.textContent)).toEqual(['Choose…', 'Amirah Demo']);
    fireEvent.change(who, { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'MEAL' } });
    fireEvent.change(screen.getByLabelText('Amount (RM)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Lunch for the audit team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate.mock.calls[0][0]).toMatchObject({
      staffId: 's-1',
      category: 'MEAL',
      amountClaimed: '30.00',
      description: 'Lunch for the audit team',
    });
    expect(createMutate.mock.calls[0][0].receiptFileId).toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('prices mileage from the kilometres at the clinic’s rate, like the portal', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: '+ Record claim' }));
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'MILEAGE' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Bangi' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'Kajang' } });
    fireEvent.change(screen.getByLabelText('Distance'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Stock run' } });
    expect(screen.getByText(/RM 6\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(createMutate.mock.calls[0][0]).toMatchObject({ category: 'MILEAGE', amountClaimed: '6.00', distanceKm: 10, description: 'Mileage 10 km, Bangi to Kajang: Stock run' });
  });
});
