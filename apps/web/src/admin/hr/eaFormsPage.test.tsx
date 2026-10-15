// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EaForm } from '../types';

const downloadFile = vi.fn().mockResolvedValue(undefined);
vi.mock('../../core/api-client', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }));
vi.mock('../../core/hooks/useClinicFilter', () => ({ useClinicFilter: () => ({ clinicId: undefined }) }));

const form = (over: Partial<EaForm>): EaForm => ({
  staffId: 's1',
  legalEmployerId: 'e1',
  year: 2026,
  employer: { name: 'Klinik Demo Sdn Bhd', lhdnEmployerNo: 'E 0000000000', address: null },
  employee: { name: 'Demo Staf Satu', employeeNo: 'D-1', position: 'Nurse', idType: 'IC', idNumber: 'demo', taxNumber: 'IG 0000', epfNumber: null, socsoNumber: null, startDate: null, endDate: null },
  boxes: { B1a: 3600000 },
  pcbCents: 120000,
  cp38Cents: 0,
  zakatCents: 0,
  tp1ReliefCents: 0,
  qualifyingChildren: 0,
  epfCents: 0,
  socsoCents: 0,
  status: 'READY',
  problems: [],
  ...over,
});

vi.mock('../hooks/useAdmin', () => ({
  useEaForms: () => ({
    data: {
      year: 2026,
      notApproved: ['Dec'],
      forms: [
        form({}),
        form({
          staffId: 's2',
          employee: { ...form({}).employee, name: 'Demo Staf Dua', taxNumber: null },
          status: 'INCOMPLETE',
          problems: [{ level: 'BLOCK', text: 'No income tax number on the employee record.' }],
        }),
      ],
    },
    isLoading: false,
    error: null,
  }),
  useBorangE: () => ({
    data: {
      year: 2026,
      dueDate: '2027-03-31',
      notApproved: [],
      employers: [{ legalEmployerId: 'e1', name: 'Klinik Demo Sdn Bhd', lhdnEmployerNo: 'E 0000000000', employees: 2, withTax: 2, incomplete: 1, remuneration: '72000.00', pcb: '2400.00', cp38: '0.00', zakat: '0.00', epf: '0.00', socso: '0.00' }],
    },
  }),
  useLegalEmployers: () => ({ data: [] }),
  useEaFormVersion: () => ({ data: { versionLabel: '(C.P.8A - Pin. 2017)' } }),
  useSetEaFormVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { EaFormsPage } = await import('./EaFormsPage');

describe('year-end forms (overnight brief, 15 October 2026)', () => {
  it('lists what is missing, says which months are not approved, and downloads every form at once', () => {
    render(
      <AntApp>
        <MemoryRouter>
          <EaFormsPage />
        </MemoryRouter>
      </AntApp>,
    );
    expect(screen.getByText(/Dec \d{4} is not approved yet/)).toBeTruthy();
    expect(screen.getByTestId('ea-check-list').textContent).toContain('Demo Staf Dua: No income tax number on the employee record.');
    expect(screen.getByText('Missing details')).toBeTruthy();
    expect(screen.getByText(/due by 31 March 2027/)).toBeTruthy();
    expect((screen.getByLabelText('Form version printed on each page') as HTMLInputElement).value).toBe('(C.P.8A - Pin. 2017)');
    fireEvent.click(screen.getByRole('button', { name: /Download all \(2\)/ }));
    expect(downloadFile.mock.calls[0][0]).toMatch(/^\/workforce\/ea-forms\/all\.pdf\?year=\d{4}/);
  });
});
