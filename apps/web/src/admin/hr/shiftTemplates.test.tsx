// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftTemplate } from '../../appointment/hooks/useRoster';

/*
 * SHIFTS (UAT, 14 October 2026): the clinic's own shifts per group, picked
 * when rostering. The times here are invented for the test; Kuwick ships none.
 */
const template = (over: Partial<ShiftTemplate>): ShiftTemplate => ({
  id: 't1',
  clinicId: null,
  group: 'STAFF',
  name: 'Morning',
  kind: 'WORKING',
  startTime: '07:00',
  endTime: '14:00',
  breakMinutes: 30,
  night: false,
  colour: '#2e90fa',
  sortOrder: 0,
  active: true,
  crossesMidnight: false,
  workedMinutes: 390,
  ...over,
});
const { saveTemplate, createShift, lists } = vi.hoisted(() => ({
  saveTemplate: vi.fn(),
  createShift: vi.fn(),
  lists: { STAFF: [] as ShiftTemplate[], DOCTOR: [] as ShiftTemplate[] },
}));

vi.mock('../../appointment/hooks/useRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../appointment/hooks/useRoster')>()),
  useShiftTemplates: (params: { group?: 'STAFF' | 'DOCTOR' } = {}) => ({
    data: params.group ? lists[params.group] : [...lists.DOCTOR, ...lists.STAFF],
    isLoading: false,
  }),
  useSaveShiftTemplate: () => ({ mutateAsync: saveTemplate, isPending: false }),
  useRemoveShiftTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateShift: () => ({ mutateAsync: createShift, isPending: false }),
  useUpdateShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useAttendancePolicy: () => ({ data: { source: 'KUWICK_DEFAULT', policy: { weekStartDay: 1, openingHours: null } } }),
  useSaveAttendancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({ useClinicFilter: () => ({ clinics: [{ id: 'c1', name: 'Demo Branch' }] }) }));
vi.mock('../../core/hooks/useCan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/hooks/useCan')>()),
  useCan: () => true,
}));

const { ShiftSettingsPage } = await import('./ShiftSettingsPage');
const { ShiftEditorModal } = await import('../../appointment/roster/ShiftEditorModal');

const wrap = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <App>{node}</App>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('shift templates', () => {
  beforeEach(() => {
    saveTemplate.mockReset();
    createShift.mockReset();
    lists.STAFF = [];
    lists.DOCTOR = [];
  });

  it('starts empty, with no shift built in, and adds one the clinic defines', async () => {
    wrap(<ShiftSettingsPage />);
    expect(screen.getByText('No doctor shifts yet.')).toBeTruthy();
    expect(screen.getByText('No staff shifts yet.')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add shift' })[1]);
    const drawer = screen.getByRole('dialog', { name: 'Add a staff shift' });
    fireEvent.change(within(drawer).getByLabelText('Name'), { target: { value: 'Late' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Colour #7a5af8' }));
    saveTemplate.mockResolvedValueOnce({});
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ group: 'STAFF', name: 'Late', kind: 'WORKING', colour: '#7a5af8', clinicId: null })),
    );
  });

  it('lists a night shift that crosses midnight with its break and worked hours', () => {
    lists.STAFF = [template({ id: 'n', name: 'Overnight', startTime: '21:00', endTime: '07:00', breakMinutes: 60, night: true, crossesMidnight: true, workedMinutes: 540 })];
    wrap(<ShiftSettingsPage />);
    const row = screen.getByText('Overnight').closest('tr') as HTMLElement;
    expect(within(row).getByText('(next day)')).toBeTruthy();
    expect(within(row).getByText('60 min')).toBeTruthy();
    expect(within(row).getByText('9 h')).toBeTruthy();
  });

  it('rosters from a template: its times are shown and its id is sent', async () => {
    lists.STAFF = [template({})];
    wrap(<ShiftEditorModal open clinicId="c1" staffId="s1" staffName="Demo Staff" dates={['2026-11-02']} group="STAFF" onClose={() => undefined} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Shift' }));
    fireEvent.click(await screen.findByText('Morning · 07:00–14:00'));
    expect(await screen.findByText(/07:00–14:00, 30 min rest\./)).toBeTruthy();
    createShift.mockResolvedValueOnce({ created: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    await waitFor(() =>
      expect(createShift).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', startTime: '07:00', endTime: '14:00', dates: ['2026-11-02'] })),
    );
  });
});
