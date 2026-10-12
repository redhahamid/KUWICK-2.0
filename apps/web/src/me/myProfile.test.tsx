// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * MY KUWICK → PROFILE (owner, 12 October 2026): the person changes their own
 * display name; the signed-in session takes the new name. Demo names only.
 */
const { rename } = vi.hoisted(() => ({ rename: vi.fn(async (body: { fullName: string }) => ({ id: 's-1', fullName: body.fullName.trim() })) }));
vi.mock('./hooks/useMe', () => ({
  useMyProfile: () => ({ data: { fullName: 'Dr Demo Asal', branch: { name: 'Demo Branch' }, category: 'CLINICAL', hasEmploymentProfile: false, employment: null } }),
  useRenameSelf: () => ({ mutateAsync: rename, isPending: false }),
}));

const { MyProfilePage } = await import('./MyProfilePage');
const { useAuthStore } = await import('../core/auth-store');

describe('my profile', () => {
  it('changes my own display name and updates the session', async () => {
    useAuthStore.setState({ staff: { id: 's-1', fullName: 'Dr Demo Asal' } as never });
    render(
      <MemoryRouter>
        <App>
          <MyProfilePage />
        </App>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const input = screen.getByLabelText('Display name');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at least two letters/)).toBeTruthy();
    expect(rename).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Dr Demo Baharu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith({ fullName: 'Dr Demo Baharu' }));
    await waitFor(() => expect(useAuthStore.getState().staff?.fullName).toBe('Dr Demo Baharu'));
  });
});
