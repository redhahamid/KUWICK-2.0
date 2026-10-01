// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';

/*
 * THE CLINIC'S OWN JOB TITLES. Picked from a list on the employee form, added
 * to on the spot, and kept beside the employees: rename follows through to
 * every record, retire keeps the title on those who hold it.
 */
const titles = [
  { id: 'jt-1', name: 'Clinic assistant', active: true, employeeCount: 2 },
  { id: 'jt-2', name: 'Dispenser', active: false, employeeCount: 1 },
];
const createMutate = vi.fn().mockResolvedValue({ id: 'jt-new', name: 'Pharmacist', active: true, employeeCount: 0 });
const updateMutate = vi.fn().mockResolvedValue({});

vi.mock('../hooks/useAdmin', () => ({
  useJobTitles: () => ({ data: titles, isLoading: false }),
  useCreateJobTitle: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateJobTitle: () => ({ mutateAsync: updateMutate, isPending: false }),
}));

const { JobTitlePicker } = await import('./JobTitlePicker');
const { JobTitlesDrawer } = await import('./JobTitlesDrawer');

describe('the job title picker', () => {
  it('offers the active titles, and adds a new one on the spot', async () => {
    const onChange = vi.fn();
    render(
      <AntApp>
        <label htmlFor="jt">Job title</label>
        <JobTitlePicker id="jt" onChange={onChange} />
      </AntApp>,
    );
    fireEvent.mouseDown(screen.getByLabelText('Job title'));
    expect(await screen.findByTitle('Clinic assistant')).toBeInTheDocument();
    // A retired title is offered to nobody new.
    expect(screen.queryByTitle('Dispenser')).toBeNull();
    fireEvent.click(screen.getByTitle('Clinic assistant'));
    expect(onChange).toHaveBeenCalledWith('jt-1', 'Clinic assistant');

    fireEvent.click(screen.getByRole('button', { name: 'Add a job title' }));
    fireEvent.change(screen.getByLabelText('New job title'), { target: { value: 'Pharmacist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledWith({ name: 'Pharmacist' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('jt-new', 'Pharmacist'));
  });
});

describe('the job titles drawer', () => {
  it('renames and retires from the list', async () => {
    render(
      <AntApp>
        <JobTitlesDrawer open onClose={() => {}} />
      </AntApp>,
    );
    expect(screen.getByText('Clinic assistant')).toBeInTheDocument();
    expect(screen.getByText(/retired/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retire Clinic assistant' }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'jt-1', active: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename Clinic assistant' }));
    fireEvent.change(screen.getByLabelText('Rename Clinic assistant'), { target: { value: 'Clinic assistant (senior)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'jt-1', name: 'Clinic assistant (senior)' }));
    await act(async () => {});
  });
});
