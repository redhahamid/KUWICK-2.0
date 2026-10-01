// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PublicHoliday } from '../../hr/types';

/*
 * PUBLIC HOLIDAYS — a holiday can be marked festive, so the payroll rule set
 * can price Hari Raya apart from an ordinary public holiday. The marker is on
 * the row, after the fact, and on the add form; everything else on the page
 * is as it was.
 */
const holidays: PublicHoliday[] = [
  { id: 'h-merdeka', date: '2026-08-31', name: 'Hari Kebangsaan', kind: 'ORDINARY' },
  { id: 'h-raya', date: '2026-03-20', name: 'Hari Raya Aidilfitri (demo)', kind: 'FESTIVE' },
];
const createMutate = vi.fn().mockResolvedValue(undefined);
const updateMutate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../hr/hooks/usePublicHolidays', () => ({
  usePublicHolidays: () => ({ data: holidays, isLoading: false }),
  useCreatePublicHoliday: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdatePublicHoliday: () => ({ mutateAsync: updateMutate, isPending: false }),
  useDeletePublicHoliday: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { PublicHolidaysPage } = await import('./PublicHolidaysPage');

const mount = () =>
  render(
    <AntApp>
      <MemoryRouter>
        <PublicHolidaysPage />
      </MemoryRouter>
    </AntApp>,
  );

describe('the holiday calendar', () => {
  it('shows which holidays are festive, and lets the owner mark one either way', () => {
    mount();
    expect(screen.getByText('Festive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Hari Kebangsaan festive' }));
    expect(updateMutate).toHaveBeenCalledWith({ id: 'h-merdeka', kind: 'FESTIVE' });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Hari Raya Aidilfitri (demo) ordinary' }));
    expect(updateMutate).toHaveBeenCalledWith({ id: 'h-raya', kind: 'ORDINARY' });
  });

  it('adds a holiday as ordinary unless festive is chosen', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '+ Add holiday' }));
    expect(screen.getByRole('dialog', { name: 'Add public holiday' })).toBeInTheDocument();
    // The type is asked on the form, defaulting to ordinary.
    expect(screen.getByLabelText('Ordinary public holiday')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Festive'));
    expect(screen.getByLabelText('Festive')).toBeChecked();
  });
});
