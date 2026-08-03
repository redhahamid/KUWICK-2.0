// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MedicationsTab } from './MedicationsTab';

// ===========================================================================
// G4.5d3c-3a1 (D-091) — the Add Medication form's supply intent.
//
// Tests 1 and 2: the control VISIBLY defaults to "Dispense from clinic", and
// the submitted DTO carries ONSITE_DISPENSE explicitly — the stored value is
// what the doctor saw selected, never a hidden database default.
// ===========================================================================

const { post, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { post: vi.fn(), MockApiError };
});
vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: {
    post,
    get: vi.fn(async (url: string) => {
      if (url.startsWith('/items')) {
        return [{ id: 'item-1', name: 'Ibuprofen 400mg', sellPrice: '1.00' }];
      }
      return [];
    }),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('Add Medication supply intent', () => {
  it('1. the control has a visible label and visibly defaults to Dispense from clinic', async () => {
    render(
      <Harness>
        <MedicationsTab visitId="visit-1" />
      </Harness>,
    );
    expect(await screen.findByText('Supply Mode')).toBeInTheDocument();
    // antd renders the selected option's label in the selection item.
    expect(screen.getByText('Dispense from clinic')).toBeInTheDocument();
  });

  it('2. the submitted DTO carries ONSITE_DISPENSE explicitly', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ id: 'rx-1' });
    render(
      <Harness>
        <MedicationsTab visitId="visit-1" />
      </Harness>,
    );

    // Select the medicine through the real antd combobox.
    await user.click(await screen.findByRole('combobox', { name: '' }));
    await user.click(await screen.findByTitle('Ibuprofen 400mg'));

    await user.type(screen.getByText('Dose Amount').parentElement!.querySelector('input')!, '1');
    await user.type(screen.getByText('Frequency').parentElement!.querySelector('input')!, 'TDS');

    await user.click(screen.getByRole('button', { name: /add to prescription/i }));

    expect(post).toHaveBeenCalledTimes(1);
    const [url, dto] = post.mock.calls[0];
    expect(url).toBe('/prescriptions');
    expect(dto).toMatchObject({ visitId: 'visit-1', itemId: 'item-1', supplyMode: 'ONSITE_DISPENSE' });
  });
});
