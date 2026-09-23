// @vitest-environment jsdom
import { App } from 'antd';
import { fireEvent, render as renderBare, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DELETE — for a record that should never have existed.
 *
 * The directory said "there is no delete". For anybody who was paid that is
 * right and the server still says so; for a duplicate, a wrong entry or a
 * hire who never turned up there was no exit at all. These cases pin that
 * the form asks for a reason, sends the delete, and shows the server's
 * refusal in its own words — with the exit it names.
 */
const deleteMutate = vi.fn();
vi.mock('../hooks/useAdmin', () => ({
  useDeleteEmployee: () => ({ mutate: deleteMutate, isPending: false }),
}));

const { DeleteEmployeeModal } = await import('./DeleteEmployeeModal');

/** What the modal hands the mutation beside the variables. */
type Handlers = { onSuccess?: () => void; onError?: (error: Error) => void };
const settle = (outcome: (handlers: Handlers) => void) =>
  deleteMutate.mockImplementation((_vars: unknown, handlers: Handlers) => {
    outcome(handlers);
  });

const render = (node: React.ReactElement) => renderBare(<App>{node}</App>);

/*
 * A BLOCK BODY, deliberately. `mockClear()` returns the mock, and a hook that
 * returns a function has returned a CLEANUP: the runner then called the mock
 * itself with no arguments after every test, which ran the installed
 * implementation against `undefined` and read as a defect in a component
 * that had none.
 */
beforeEach(() => {
  deleteMutate.mockClear();
});

describe('deleting an employee record', () => {
  it('will not send a delete without a reason', async () => {
    render(<DeleteEmployeeModal staffId="staff-9" fullName="Duplicate Entry" open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await screen.findByText(/Say why/);
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it('sends the delete with the reason, and reports back', async () => {
    const onDeleted = vi.fn();
    settle((handlers) => handlers.onSuccess?.());
    render(<DeleteEmployeeModal staffId="staff-9" fullName="Duplicate Entry" open onClose={() => {}} onDeleted={onDeleted} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));

    await waitFor(() => expect(deleteMutate).toHaveBeenCalled());
    expect(deleteMutate.mock.calls[0][0]).toEqual({ staffId: 'staff-9', reason: 'Entered twice' });
    expect(onDeleted).toHaveBeenCalled();
  });

  it('shows the server’s refusal for somebody who was paid, with the exit it names', async () => {
    settle((handlers) => handlers.onError?.(new Error('Was Paid appears on 1 approved payroll line(s) (2026-02). Mark them as resigned instead.')));
    render(<DeleteEmployeeModal staffId="staff-9" fullName="Was Paid" open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong person' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));

    await screen.findByText(/approved payroll line/);
    expect(screen.getByText(/Mark them as resigned/)).toBeTruthy();
  });
});
