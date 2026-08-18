// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { get, post, patch, del, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 409;
    body: unknown;
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, put: vi.fn(), delete: del },
}));

import { ManageCategoriesModal } from './ManageCategoriesModal';
import { renderWithClient } from '../clinical/test-utils/billingReviewHarness';

// ===========================================================================
// MANAGE CATEGORIES — the refusal is the point of the screen.
//
// A category with items under it cannot be deleted without either orphaning
// them or blanking their category, and both are a clinic losing the
// arrangement of their own shelf to one click.
// ===========================================================================

const CATEGORIES = [
  { id: 'c1', name: 'Medication', count: 218, registered: true },
  { id: 'c2', name: 'Vaccine', count: 0, registered: true },
  { id: null, name: 'BATUK', count: 41, registered: false },
];

const rowFor = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(CATEGORIES);
  post.mockResolvedValue({});
  patch.mockResolvedValue({});
  del.mockResolvedValue({});
});

const render = () => renderWithClient(<ManageCategoriesModal open onClose={vi.fn()} />);

describe('delete is guarded, and the reason is on the row', () => {
  it('refuses a category with items under it, and says how many without a hover', async () => {
    // A tooltip does not exist on a phone — the same argument Settings ›
    // Prescription Vocabulary already settled for its locked SYSTEM rows.
    render();
    await screen.findByText('Medication');
    const row = rowFor('Medication');
    expect(within(row).getByLabelText('Delete Medication').hasAttribute('disabled')).toBe(true);
    expect(within(row).getByText(/218 items — move them before this can be deleted/)).toBeTruthy();
  });

  it('allows deleting a category nothing is filed under', async () => {
    render();
    await screen.findByText('Vaccine');
    const row = rowFor('Vaccine');
    expect(within(row).getByLabelText('Delete Vaccine').hasAttribute('disabled')).toBe(false);

    await userEvent.click(within(row).getByLabelText('Delete Vaccine'));
    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/item-categories/c2'));
  });

  it('renders the server’s own refusal rather than "Conflict"', async () => {
    const error = new MockApiError('23 items are filed under "ANTIBIOTIK". Move them to another category first');
    del.mockRejectedValue(error);
    render();
    await screen.findByText('Vaccine');
    const row = rowFor('Vaccine');
    await userEvent.click(within(row).getByLabelText('Delete Vaccine'));
    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    expect(await screen.findByText(/23 items are filed under "ANTIBIOTIK"/)).toBeTruthy();
  });
});

describe('rename', () => {
  it('sends the new name for a registered category', async () => {
    render();
    await screen.findByText('Medication');
    const row = rowFor('Medication');
    await userEvent.click(within(row).getByLabelText('Rename Medication'));

    const field = await screen.findByLabelText('New name for Medication');
    await userEvent.clear(field);
    await userEvent.type(field, 'Ubat');
    await userEvent.click(screen.getByLabelText('Save Medication'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/item-categories/c1', { name: 'Ubat' }));
  });

  it('offers Add to list, not Rename, for a name that only exists on imported items', async () => {
    // There is no registry row to rename yet. Adopting it is what creates one,
    // and no item moves.
    render();
    await screen.findByText('BATUK');
    const row = rowFor('BATUK');
    expect(within(row).queryByLabelText('Rename BATUK')).toBeNull();

    await userEvent.click(within(row).getByLabelText('Add BATUK to the list'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/item-categories/adopt', { name: 'BATUK' }));
  });
});

describe('add', () => {
  it('creates a category before anything is filed in it', async () => {
    render();
    await screen.findByText('Medication');
    await userEvent.type(screen.getByLabelText('New category name'), 'Antibiotik');
    await userEvent.click(screen.getByLabelText('Add category'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/item-categories', { name: 'Antibiotik' }));
  });

  it('will not send a blank name', async () => {
    render();
    await screen.findByText('Medication');
    expect(screen.getByLabelText('Add category').hasAttribute('disabled')).toBe(true);
  });
});
