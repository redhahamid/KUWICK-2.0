// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { get, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 400;
  }
  return { get: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

import { IndicationTags } from './IndicationTags';
import { renderWithClient } from '../clinical/test-utils/billingReviewHarness';

const INDICATIONS = [
  { id: 'i1', labelEn: 'Fever', labelBm: 'Demam', active: true, origin: 'SYSTEM', sortOrder: 0, tenantId: 't' },
  { id: 'i2', labelEn: 'Cough', labelBm: 'Batuk', active: true, origin: 'SYSTEM', sortOrder: 1, tenantId: 't' },
];

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(INDICATIONS);
});

describe('indication is a list the clinic can actually reach', () => {
  it('offers the catalogue bilingually', async () => {
    renderWithClient(<IndicationTags onChange={vi.fn()} />);
    await userEvent.click(await screen.findByRole('combobox'));
    expect(await screen.findByTitle('Fever / Demam')).toBeTruthy();
  });

  it('renders a stored comma-joined value as separate tags', async () => {
    renderWithClient(<IndicationTags value="Fever, Cough" onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTitle('Fever')).toBeTruthy();
      expect(screen.getByTitle('Cough')).toBeTruthy();
    });
  });

  it('joins the choices back into the text column the prescription copies', async () => {
    const onChange = vi.fn();
    renderWithClient(<IndicationTags value="Fever" onChange={onChange} />);
    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Cough / Batuk'));
    expect(onChange).toHaveBeenCalledWith('Fever, Cough');
  });

  it('still accepts a typed indication the list has not caught up with', async () => {
    // Refusing would make the field unusable for anything new, and the
    // catalogue is the clinic's own — it is always behind their practice.
    const onChange = vi.fn();
    renderWithClient(<IndicationTags onChange={onChange} />);
    const input = await screen.findByRole('combobox');
    await userEvent.type(input, 'Dengue');
    // antd commits a tag on the raw keydown; userEvent's "{enter}" does not
    // reach its handler in jsdom.
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Dengue'));
  });

  it('clears to undefined rather than an empty string', async () => {
    // `undefined` means "leave it alone" to the API everywhere else on this
    // form; an empty string would write a blank the doctor did not ask for.
    const onChange = vi.fn();
    renderWithClient(<IndicationTags value="Fever" onChange={onChange} />);
    // Removing the only tag through its own close control.
    await userEvent.click(await screen.findByLabelText('close'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
  });
});
