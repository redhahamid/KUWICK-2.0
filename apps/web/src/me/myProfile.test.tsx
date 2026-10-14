// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * MY KUWICK → PROFILE (owner, 12 October 2026): the person changes their own
 * display name; the signed-in session takes the new name. Demo names only.
 */
const { rename, saveContact, profile } = vi.hoisted(() => ({
  rename: vi.fn(async (body: { fullName: string }) => ({ id: 's-1', fullName: body.fullName.trim() })),
  saveContact: vi.fn(),
  profile: { current: { fullName: 'Dr Demo Asal', branch: { name: 'Demo Branch' }, category: 'CLINICAL', hasEmploymentProfile: false, employment: null } as Record<string, unknown> },
}));
vi.mock('./hooks/useMe', () => ({
  useMyProfile: () => ({ data: profile.current }),
  useRenameSelf: () => ({ mutateAsync: rename, isPending: false }),
  useUpdateMyContact: () => ({ mutate: saveContact, isPending: false }),
  useMyBankChange: () => ({ data: { current: { bankName: 'Demo Bank', lastFour: '7890' }, request: null } }),
  useRequestBankChange: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelBankChange: () => ({ mutate: vi.fn(), isPending: false }),
  uploadMyFile: vi.fn(),
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

  it('keeps my own phone up to date and shows where pay goes (testing, 15 October 2026)', () => {
    profile.current = { ...profile.current, hasEmploymentProfile: true, employment: { phone: '011-000 0000', email: null } };
    render(
      <MemoryRouter>
        <App>
          <MyProfilePage />
        </App>
      </MemoryRouter>,
    );
    expect(screen.getByText('Demo Bank •••• 7890')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '012-111 2222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveContact.mock.calls[0][0]).toMatchObject({ phone: '012-111 2222' });
  });
});
