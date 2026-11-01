// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/* MY KUWICK IS NOT A DEAD END (new-clinic UAT #2, item 52). Demo names only. */
let mayHr = true;
vi.mock('../core/hooks/useCan', () => ({ useCan: (permission: string) => (permission === 'hr.view' ? mayHr : false) }));
vi.mock('./hooks/useMe', () => ({
  useMyProfile: () => ({ data: { fullName: 'Demo Owner' } }),
  useMyHome: () => ({ data: { fullName: 'Demo Owner', waiting: { leaveRequests: 0, claims: 0, attendanceCorrections: 0 } } }),
}));

const { MyKuwickLayout } = await import('./MyKuwickLayout');
const mount = () =>
  render(
    <App>
      <MemoryRouter initialEntries={['/my']}>
        <MyKuwickLayout />
      </MemoryRouter>
    </App>,
  );

describe('the way back from My Kuwick', () => {
  it('takes an owner or HR person back to Kuwick admin, and the avatar opens a menu', async () => {
    mayHr = true;
    mount();
    expect(screen.getByRole('link', { name: /Back to Kuwick admin/ })).toHaveAttribute('href', '/admin/hr');
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('My profile')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('takes other staff back to the clinic workspace', () => {
    mayHr = false;
    mount();
    expect(screen.getByRole('link', { name: /Back to Kuwick$/ })).toHaveAttribute('href', '/appointments');
  });
});
