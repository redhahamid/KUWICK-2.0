// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { get, post, downloadFile, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 400;
  }
  return { get: vi.fn(), post: vi.fn(), downloadFile: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  downloadFile,
  apiClient: { get, post, patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { ImportInventoryModal } from './ImportInventoryModal';
import { renderWithClient } from '../clinical/test-utils/billingReviewHarness';

// ===========================================================================
// PIECE 3 — the onboarding path.
//
// A spreadsheet of 200 medicines WILL have mistakes in it. The difference
// between "3 problems, by line" and "row 47 failed" is whether the clinic
// makes one pass through the file or forty-seven.
// ===========================================================================

const FILE = new File(['Name,Price to Patient (RM)\nParacetamol,0.20\n'], 'stock.csv', { type: 'text/csv' });

const clean = { dryRun: true, created: 2, updated: 1, needsAttention: 0, problems: [] };
const dirty = {
  dryRun: true,
  created: 1,
  updated: 0,
  needsAttention: 0,
  problems: [
    { line: 4, column: 'Price to Patient (RM)', message: '"RM4.50" is not a price. Write a number like 4.50.' },
    { line: 9, column: 'Frequency', message: '"TDSS" is not on this clinic\'s list.' },
  ],
};

async function chooseFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, FILE);
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom's File has no .text() in this environment.
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value: () => Promise.resolve('Name,Price to Patient (RM)\nParacetamol,0.20\n'),
  });
});

const render = () => renderWithClient(<ImportInventoryModal open onClose={vi.fn()} />);

describe('the template comes first', () => {
  it('offers the template before anything is uploaded', async () => {
    render();
    await userEvent.click(screen.getByRole('button', { name: /download template/i }));
    expect(downloadFile).toHaveBeenCalledWith('/items/csv-template', 'kuwick-inventory-template.csv');
  });

  it('explains the DISPENSED_WHOLE case, which nobody would guess from a header', async () => {
    render();
    expect(screen.getByText('DISPENSED_WHOLE')).toBeTruthy();
  });

  it('says a re-upload updates rather than duplicates', async () => {
    render();
    expect(screen.getByText(/does not create second copies/i)).toBeTruthy();
  });
});

describe('the file is checked before it is applied', () => {
  it('checks as a dry run, writing nothing', async () => {
    post.mockResolvedValue(clean);
    render();
    await chooseFile();
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/items/csv-import', expect.objectContaining({ dryRun: true })),
    );
  });

  it('will not let Apply be pressed before a clean check', async () => {
    post.mockResolvedValue(dirty);
    render();
    await chooseFile();
    expect(screen.getByRole('button', { name: /apply/i }).hasAttribute('disabled')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    await screen.findByText(/2 problems/i);
    // Still refused: the server would refuse the file anyway, and offering the
    // button is inviting a refusal.
    expect(screen.getByRole('button', { name: /apply/i }).hasAttribute('disabled')).toBe(true);
  });

  it('lists every problem with its spreadsheet line', async () => {
    post.mockResolvedValue(dirty);
    render();
    await chooseFile();
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));

    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText(/"TDSS" is not on this clinic's list/)).toBeTruthy();
  });

  it('says plainly that nothing was imported', async () => {
    post.mockResolvedValue(dirty);
    render();
    await chooseFile();
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    expect(await screen.findByText(/nothing has been imported/i)).toBeTruthy();
  });

  it('applies for real only after a clean check', async () => {
    post.mockResolvedValue(clean);
    render();
    await chooseFile();
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));
    await screen.findByText(/2 to add, 1 to update/i);

    await userEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/items/csv-import', expect.objectContaining({ dryRun: false })),
    );
  });
});

describe('a missing divisor is reported, not refused', () => {
  it('warns that those rows land on the pricing worklist', async () => {
    // Refusing them would keep the medicine out of the catalogue entirely to
    // protect a number that is already missing on 149 rows.
    post.mockResolvedValue({ ...clean, needsAttention: 132 });
    render();
    await chooseFile();
    await userEvent.click(screen.getByRole('button', { name: /check file/i }));

    expect(await screen.findByText(/132 rows have no quantity per stock unit/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /apply/i }).hasAttribute('disabled')).toBe(false);
  });
});
