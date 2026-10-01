// @vitest-environment jsdom
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADD SEVERAL EMPLOYEES — the grid talks to the one intake endpoint.
 *
 * A check sends the rows without writing; a problem comes back naming its
 * row and cell and lands under that cell; a clean batch is added with one
 * call. The IC fills the date of birth here as it does on the form.
 */
const mutateAsync = vi.fn();
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useLegalEmployers: () => ({ data: [{ id: 'emp-1', name: 'Klinik Contoh Sdn Bhd', active: true }] }),
  useEmployeeIntake: () => ({ mutateAsync: (...args: unknown[]) => mutateAsync(...args), isPending: false }),
}));
vi.mock('../../core/hooks/useClinics', () => ({
  useClinics: () => ({ data: [{ id: 'clinic-1', name: 'Contoh Central' }] }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'clinic-1', setClinicId: () => {}, clinics: [], showSelector: false, mayViewAllBranches: true }),
  useDefaultClinicId: () => 'clinic-1',
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { BulkEmployeesPage } = await import('./BulkEmployeesPage');

function open() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AntApp>
        <MemoryRouter>
          <BulkEmployeesPage />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

const clean = (index: number, staffId?: string) => ({ index, problems: [], readiness: { blocking: [], advisory: [] }, ...(staffId ? { staffId } : {}) });

beforeEach(() => {
  mutateAsync.mockReset();
});

describe('the intake grid', () => {
  it('fills the date of birth from the IC, checks without writing, and adds with one call', async () => {
    mutateAsync.mockResolvedValueOnce({ dryRun: true, rowCount: 1, clean: true, created: 0, results: [clean(0)] });
    open();
    fireEvent.change(screen.getByLabelText('Full name, row 1'), { target: { value: 'Demo Pekerja binti Contoh' } });
    fireEvent.change(screen.getByLabelText('IC or passport no., row 1'), { target: { value: '900101-14-5566' } });
    await waitFor(() => expect((screen.getByLabelText('Date of birth, row 1') as HTMLInputElement).value).toBe('1 Jan 1990'));
    fireEvent.change(screen.getByLabelText('Monthly salary (RM), row 1'), { target: { value: '2500' } });

    fireEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const checked = mutateAsync.mock.calls[0][0] as { rows: Record<string, unknown>[]; commit: boolean };
    expect(checked.commit).toBe(false);
    expect(checked.rows).toHaveLength(1);
    // The branch chosen on the page and the one company on file are already on the row.
    expect(checked.rows[0]).toMatchObject({
      fullName: 'Demo Pekerja binti Contoh',
      clinicId: 'clinic-1',
      legalEmployerId: 'emp-1',
      identifierType: 'NRIC',
      identifierValue: '900101-14-5566',
      dateOfBirth: '1990-01-01',
      gender: 'FEMALE',
      salary: { amount: '2500', basis: 'MONTHLY' },
    });
    expect(await screen.findByText('Ready for payroll')).toBeInTheDocument();

    mutateAsync.mockResolvedValueOnce({ dryRun: false, rowCount: 1, clean: true, created: 1, results: [clean(0, 'staff-1')] });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 employee' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect((mutateAsync.mock.calls[1][0] as { commit: boolean }).commit).toBe(true);
  });

  it('puts a refusal under the cell it names, and nothing is added', async () => {
    mutateAsync.mockResolvedValueOnce({
      dryRun: true,
      rowCount: 1,
      clean: false,
      created: 0,
      results: [{ index: 0, problems: [{ field: 'salary.amount', message: 'Recording a salary needs payroll access, not employee-record access alone.' }], readiness: { blocking: [], advisory: [] } }],
    });
    open();
    fireEvent.change(screen.getByLabelText('Full name, row 1'), { target: { value: 'Demo Dua' } });
    fireEvent.change(screen.getByLabelText('Monthly salary (RM), row 1'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 employee' }));
    expect(await screen.findByText(/Recording a salary needs payroll access/)).toBeInTheDocument();
    expect(screen.getByText(/1 row needs fixing before anything is added/)).toBeInTheDocument();
    // Typing in that cell clears the stale reason.
    fireEvent.change(screen.getByLabelText('Monthly salary (RM), row 1'), { target: { value: '' } });
    await act(async () => {});
    expect(screen.queryByText(/Recording a salary needs payroll access/)).toBeNull();
  });

  it('reads a sheet into rows, naming a branch it does not know', async () => {
    open();
    const file = new File(
      [
        'Full name,Account role,Branch,Employer,Start date (YYYY-MM-DD),Document (IC or Passport),IC or passport number,Date of birth (YYYY-MM-DD; blank = from IC),Gender (blank = from IC),Monthly salary (RM),EPF membership,Tax residence,Monthly tax category,Rest day,LINDUNG 24 JAM (blank = enrolled)\n' +
          'Demo Tiga binti Contoh,Nurse,Contoh Selatan,Klinik Contoh Sdn Bhd,2026-03-01,IC,850505-10-5571,,,2800,Malaysian citizen,Resident,Category 1,Sunday,\n',
      ],
      'people.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText('Upload a CSV'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText('Full name, row 1') as HTMLInputElement).value).toBe('Demo Tiga binti Contoh'));
    expect(screen.getByText('No branch called "Contoh Selatan". Pick one.')).toBeInTheDocument();
    expect(screen.getByText(/1 row read/)).toBeInTheDocument();
  });
});
