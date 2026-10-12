// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';

/*
 * ORGANISATION SETTINGS → USERS (owner, 12 October 2026): the owner renames
 * anybody. Demo names only.
 */
const { patch, canManage } = vi.hoisted(() => ({ patch: vi.fn(async () => ({})), canManage: { value: true } }));
vi.mock('../core/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/api-client')>()),
  apiClient: { patch },
}));
vi.mock('./hooks/useStaff', () => ({
  useStaff: () => ({
    isLoading: false,
    data: [{ id: 's-1', fullName: 'Dr Demo Asal', role: 'OWNER_ADMIN', clinicId: null, active: true }],
  }),
}));
vi.mock('../core/hooks/useClinics', () => ({ useClinics: () => ({ data: [] }) }));
vi.mock('../core/hooks/useCan', () => ({ useCan: () => canManage.value }));

const { UsersSettingsPage } = await import('./UsersSettingsPage');

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App>
        <UsersSettingsPage />
      </App>
    </QueryClientProvider>,
  );

describe('users', () => {
  it('lets the owner rename somebody', async () => {
    canManage.value = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Dr Demo Asal' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Dr Demo Baharu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/s-1/name', { fullName: 'Dr Demo Baharu' }));
  });

  it('offers no rename to somebody who does not manage users', () => {
    canManage.value = false;
    mount();
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
  });
});
