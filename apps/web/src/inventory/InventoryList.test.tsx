// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { get, post, patch, del, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 400;
    body: unknown;
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, put: vi.fn(), delete: del },
}));

vi.mock('../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'clinic-1', setClinicId: vi.fn(), clinics: [], showSelector: false }),
  useDefaultClinicId: () => 'clinic-1',
}));

import { InventoryList } from './InventoryList';
import { renderWithClient } from '../clinical/test-utils/billingReviewHarness';

// ===========================================================================
// INVENTORY PIECE 1 — the list is the pricing worklist.
//
// The audit found 149 of 242 medicines with no divisor. The screen's job is to
// make that visible and workable without ever letting anybody clear it by
// typing 1 into the blanks — so the assertions here are about what the clinic
// is TOLD, not about which rows render.
// ===========================================================================

const STRIP = { id: 'su-1', name: 'TABLET PER STRIP', nameMs: 'TABLET PER PAPAN', active: true };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  code: 'MED-1',
  name: 'Paracetamol 500mg',
  category: 'Medication',
  active: true,
  sellPrice: '4.50',
  cost: '1.20',
  earliestExpiry: '2027-03-31',
  quantityOnHand: 99,
  belowThreshold: false,
  stockUnit: STRIP,
  packDescription: '10 BIJI / STRIP',
  divisor: 10,
  divisorSource: 'CLINIC',
  dispensedWhole: false,
  attention: null,
  ...over,
});

function world(rows: Array<Record<string, unknown>>, needsAttention: number) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/items/catalogue')) {
      return Promise.resolve({ rows, counts: { items: rows.length, needsAttention } });
    }
    if (url === '/item-categories') {
      return Promise.resolve([
        { id: 'c1', name: 'Medication', count: rows.length, registered: true },
        { id: null, name: 'Item', count: 4, registered: false },
      ]);
    }
    return Promise.resolve([]);
  });
}

const render = () => renderWithClient(<InventoryList onEdit={vi.fn()} onAdd={vi.fn()} />);

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockResolvedValue({});
  post.mockResolvedValue({});
});

describe('the balance is read the way the shelf is counted', () => {
  it('prints both languages', async () => {
    world([row()], 0);
    render();
    expect(await screen.findByText('99 Strip / Papan')).toBeTruthy();
  });

  it('prints the bare number when the item has no stock unit', async () => {
    world([row({ stockUnit: null, quantityOnHand: 12 })], 0);
    render();
    expect(await screen.findByText('12')).toBeTruthy();
  });
});

describe('the pricing worklist', () => {
  it('names the outstanding count at rest, before anybody goes looking', async () => {
    // A chip that only appeared once you turned the filter on would let the
    // 149-row gap ship silently.
    world([row()], 132);
    render();
    expect(await screen.findByRole('button', { name: /132 items need attention/i })).toBeTruthy();
  });

  it('says so plainly when there is nothing outstanding', async () => {
    world([row()], 0);
    render();
    expect(await screen.findByRole('button', { name: /nothing needs attention/i })).toBeTruthy();
  });

  it('marks a divisorless row and says what is missing', async () => {
    world([row({ attention: 'NO_DIVISOR', divisor: null, divisorSource: 'NONE' })], 1);
    render();
    expect(await screen.findByText(/no pack quantity/i)).toBeTruthy();
  });

  it('marks a bare 1 differently from a missing divisor — they are different facts', async () => {
    world([row({ attention: 'UNCONFIRMED_ONE', divisor: 1, divisorSource: 'IMPORT' })], 1);
    render();
    expect(await screen.findByText(/unconfirmed 1/i)).toBeTruthy();
  });

  it('does not mark a divisor of 1 somebody put their name to', async () => {
    world([row({ divisor: 1, dispensedWhole: true, attention: null })], 0);
    render();
    await screen.findByText('Paracetamol 500mg');
    // Scoped to the row's marker — the chip in the toolbar says "Nothing needs
    // attention", which is the opposite claim in the same words.
    expect(screen.queryByLabelText(/^Needs attention:/)).toBeNull();
  });

  it('asks the server for the filtered set rather than filtering in the browser', async () => {
    // The attention rule is `divisorFacts` and there is exactly one of those.
    world([row()], 3);
    render();
    await screen.findByText('Paracetamol 500mg');
    await userEvent.click(screen.getByRole('button', { name: /3 items need attention/i }));
    await waitFor(() => {
      expect(get.mock.calls.some(([url]: [string]) => url.includes('attentionOnly=true'))).toBe(true);
    });
  });

  it('keeps the worklist count while the filter narrows the rows', async () => {
    // The count is the CLINIC's total. It answers "how much is left", and a
    // number that moved with the filter would answer something else.
    world([row({ attention: 'NO_DIVISOR' })], 132);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /132 items need attention/i }));
    expect(await screen.findByRole('button', { name: /132 items need attention/i })).toBeTruthy();
  });
});

describe('D3 — the toggle is the control, and there is no delete', () => {
  it('offers no delete on any row', async () => {
    world([row()], 0);
    render();
    await screen.findByText('Paracetamol 500mg');
    expect(screen.queryByRole('button', { name: /delete paracetamol/i })).toBeNull();
  });

  it('deactivates through the item PATCH and says what deactivating does NOT do', async () => {
    world([row()], 0);
    render();
    await userEvent.click(await screen.findByRole('switch', { name: /deactivate paracetamol/i }));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('/items/i1', { active: false });
    });
  });

  it('keeps a deactivated row on the list — hiding it would make the toggle a delete', async () => {
    world([row({ active: false })], 0);
    render();
    expect(await screen.findByText('Paracetamol 500mg')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /reactivate paracetamol/i })).toBeTruthy();
  });
});

describe('the quick +/- is an adjustment, and it asks why', () => {
  it('will not submit without a reason', async () => {
    world([row()], 0);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /add stock to paracetamol/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /^Add$/ }).hasAttribute('disabled')).toBe(true);
  });

  it('posts a signed delta with the reason, to the adjust route rather than quick-add', async () => {
    world([row()], 0);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /take stock off paracetamol/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Breakage');
    await userEvent.click(within(dialog).getByRole('button', { name: /take off/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/stock/adjust', {
        clinicId: 'clinic-1',
        itemId: 'i1',
        quantityDelta: -1,
        reason: 'Breakage',
      });
    });
  });

  it('says out loud that this is not a delivery', async () => {
    world([row()], 0);
    render();
    await userEvent.click(await screen.findByRole('button', { name: /add stock to paracetamol/i }));
    expect(await screen.findByText(/not a delivery/i)).toBeTruthy();
  });
});

describe('category tabs', () => {
  it('shows the clinic’s categories with their counts, and an All tab', async () => {
    world([row()], 0);
    render();
    expect(await screen.findByRole('tab', { name: 'All (1)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Medication (1)' })).toBeTruthy();
  });

  it('shows an imported category nobody registered — hiding it would hide stock', async () => {
    world([row()], 0);
    render();
    expect(await screen.findByRole('tab', { name: 'Item (4)' })).toBeTruthy();
  });

  it('narrows through the server when a tab is picked', async () => {
    world([row()], 0);
    render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Medication (1)' }));
    await waitFor(() => {
      expect(get.mock.calls.some(([url]: [string]) => url.includes('category=Medication'))).toBe(true);
    });
  });
});
