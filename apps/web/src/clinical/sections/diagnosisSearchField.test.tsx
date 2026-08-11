// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import {
  DiagnosisSearchField,
  catalogOptionLabel,
  looksLikeIcd10,
  resolveCatalogEntry,
} from './DiagnosisSearchField';
import { DiagnosisCatalogEntry } from '../types';

// ===========================================================================
// G4.5d6 — THE ICD-10 SEARCH BUG
//
// UAT reported it as one fault. It was three, and the first of them made the
// placeholder ("Search by diagnosis name or ICD-10 code") a lie: the server
// matched the code, and antd threw the match away on the client before it was
// ever drawn.
// ===========================================================================

const { get, post, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { get: vi.fn(), post: vi.fn(), MockApiError };
});
vi.mock('../../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
}));

const URTI: DiagnosisCatalogEntry = {
  id: 'cat-urti',
  tenantId: 'tenant-1',
  name: 'Acute upper respiratory infection',
  icd10Code: 'J06.9',
  category: 'SUMMARIZE',
  active: true,
};

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  message.destroy();
  get.mockResolvedValue([URTI]);
});

const renderField = (onAdd = vi.fn()) => {
  render(
    <Harness>
      <DiagnosisSearchField category="SUMMARIZE" onAdd={onAdd} />
    </Harness>,
  );
  return onAdd;
};

describe('searching by ICD-10 code', () => {
  it('1. offers the entry the SERVER matched, even though its name has no "J06.9" in it', async () => {
    // The whole defect in one assertion. antd filtered the server's result
    // against the option value (the name), so the code search returned the
    // right row and then hid it.
    renderField();
    await userEvent.type(screen.getByRole('combobox'), 'J06.9');
    expect(await screen.findByText('J06.9 — Acute upper respiratory infection')).toBeInTheDocument();
  });

  it('2. the code is asked of the SERVER, not filtered locally', async () => {
    renderField();
    await userEvent.type(screen.getByRole('combobox'), 'J06.9');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('J06.9'))),
    );
  });

  it('3. a typed code adds the CATALOG ENTRY, not a diagnosis literally named "J06.9"', async () => {
    // A custom row named "J06.9" carrying no ICD-10 code is invisible to
    // every report and claim that groups by code.
    const onAdd = renderField();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'J06.9');
    await screen.findByText('J06.9 — Acute upper respiratory infection');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('J06.9', 'cat-urti'));
  });

  it('4. a code that matches nothing is REFUSED, not invented', async () => {
    get.mockResolvedValue([]);
    const onAdd = renderField();
    await userEvent.type(screen.getByRole('combobox'), 'Z99.9');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/No diagnosis found for code Z99.9/)).toBeInTheDocument());
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('adding', () => {
  it('5. choosing a suggestion with Enter adds it ONCE', async () => {
    // onSelect and onKeyDown both fired on the same Enter, so picking from
    // the list put the diagnosis on the visit twice.
    const onAdd = renderField();
    await userEvent.type(screen.getByRole('combobox'), 'Acute');
    const option = await screen.findByText('J06.9 — Acute upper respiratory infection');
    // Click, then an Enter on the (now cleared) box: the select path must add
    // exactly one diagnosis, and the Enter must not add the typed text again.
    await userEvent.click(option);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith('Acute upper respiratory infection', 'cat-urti');
  });

  it('6. a diagnosis genuinely not in the catalog is still addable as free text', async () => {
    get.mockResolvedValue([]);
    const onAdd = renderField();
    await userEvent.type(screen.getByRole('combobox'), 'Post-viral fatigue');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Post-viral fatigue', undefined));
  });

  it('7. an empty box adds nothing', async () => {
    const onAdd = renderField();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('8. typing a name is ONE request, not one per keystroke', async () => {
    renderField();
    await userEvent.type(screen.getByRole('combobox'), 'asthma');
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.length).toBeLessThan(6);
  });
});

describe('the pure helpers', () => {
  it('9. resolves by exact name and by exact code, case-insensitively', () => {
    expect(resolveCatalogEntry('acute upper respiratory infection', [URTI])).toBe('cat-urti');
    expect(resolveCatalogEntry('j06.9', [URTI])).toBe('cat-urti');
    expect(resolveCatalogEntry('something else', [URTI])).toBeUndefined();
    expect(resolveCatalogEntry('J06.9', undefined)).toBeUndefined();
  });

  it('10. labels an entry with its code first, and copes with entries that have none', () => {
    expect(catalogOptionLabel(URTI)).toBe('J06.9 — Acute upper respiratory infection');
    expect(catalogOptionLabel({ ...URTI, icd10Code: null })).toBe('Acute upper respiratory infection');
  });

  it('11. recognises a code without mistaking a diagnosis name for one', () => {
    for (const code of ['J06.9', 'J069', 'E11', 'M54.5', 'j06.9']) {
      expect(looksLikeIcd10(code)).toBe(true);
    }
    for (const name of ['Asthma', 'Type 2 diabetes', 'Post-viral fatigue', '', 'COVID-19']) {
      expect(looksLikeIcd10(name)).toBe(false);
    }
  });
});
