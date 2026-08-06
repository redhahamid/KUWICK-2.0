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

// ===========================================================================
// G4.5d3c-3c — the default says that it IS one
//
// The owner's report was that medication entry required the supply mode too
// often. The control was already visible and already pre-selected (D-091);
// what was missing was that a pre-selected value reads as a deliberate choice
// somebody made, so doctors stopped reading the field. It now labels itself.
// ===========================================================================
describe('the supply-mode default is visible AS a default', () => {
  it('3. it says it is the default and when to change it', async () => {
    render(
      <Harness>
        <MedicationsTab visitId="visit-1" />
      </Harness>,
    );
    expect(await screen.findByText(/Default — change this if/i)).toBeInTheDocument();
  });

  it('4. it is a real control, not hidden behind a disclosure', async () => {
    render(
      <Harness>
        <MedicationsTab visitId="visit-1" />
      </Harness>,
    );
    // Present on first paint: no "Advanced", no "More options" in front of it.
    expect(await screen.findByText('Supply Mode')).toBeVisible();
    expect(screen.queryByRole('button', { name: /advanced|more options/i })).not.toBeInTheDocument();
  });

  it('5. no raw enum value is rendered for the default', async () => {
    const { container } = render(
      <Harness>
        <MedicationsTab visitId="visit-1" />
      </Harness>,
    );
    await screen.findByText('Supply Mode');
    expect(container.textContent).not.toMatch(/ONSITE_DISPENSE|EXTERNAL_PRESCRIPTION|NO_SUPPLY_REQUIRED/);
  });
});
