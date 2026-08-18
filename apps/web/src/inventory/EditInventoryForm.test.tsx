// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';

const { get, post, patch, put, del, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 400;
    body: unknown;
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, put, delete: del },
}));

vi.mock('../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({
    clinicId: 'clinic-1',
    setClinicId: vi.fn(),
    clinics: [{ id: 'clinic-1', name: 'Klinik Kuwick Bangsar' }],
    showSelector: false,
  }),
  useDefaultClinicId: () => 'clinic-1',
}));

import { DispensingSection } from './DispensingSection';
import { PanelPricingSection } from './PanelPricingSection';
import { Item } from './types';
import { renderWithClient } from '../clinical/test-utils/billingReviewHarness';

// ===========================================================================
// PIECE 2 — the two fields the pricing fix waits on, and the money field
// beside them.
//
// `quantity_per_stock_unit` was set on ZERO of 242 rows because no screen ever
// accepted it. These assert that the screen refuses to let a bare 1 pass for a
// decision (D1), and that panel pricing tells the truth about what is charged.
// ===========================================================================

const STOCK_UNITS = [
  { id: 'su-1', name: 'TABLET PER STRIP', nameMs: 'TABLET PER PAPAN', active: true, origin: 'SYSTEM', sortOrder: 0 },
  { id: 'su-2', name: 'PUNNET', nameMs: null, active: false, origin: 'CUSTOM', sortOrder: 1 },
];

const PANELS = [
  {
    panelClinicId: 'p1',
    panelName: 'AIA',
    panelCode: 'AIA',
    overrideId: 'o1',
    overridePrice: '7.00',
    markupAmount: null,
    effectivePrice: '7.00',
    priceRule: 'SPECIFIC_PANEL_PRICE',
  },
  {
    panelClinicId: 'p2',
    panelName: 'Great Eastern',
    panelCode: 'GE',
    overrideId: null,
    overridePrice: null,
    markupAmount: '2.50',
    effectivePrice: '12.50',
    priceRule: 'CASH_PLUS_MARKUP',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({});
  get.mockImplementation((url: string) => {
    if (url.startsWith('/reference-catalogs/stock-units')) return Promise.resolve(STOCK_UNITS);
    if (url.includes('/panel-pricing')) return Promise.resolve(PANELS);
    return Promise.resolve([]);
  });
});

function renderDispensing(item?: Partial<Item>, initial: Record<string, unknown> = {}) {
  function Harness() {
    const [form] = Form.useForm();
    return (
      <Form form={form} layout="vertical" initialValues={initial}>
        <DispensingSection item={item as Item | undefined} />
      </Form>
    );
  }
  return renderWithClient(<Harness />);
}

describe('the stock unit is offered in both languages', () => {
  it('shows the Malay half beside the English one', async () => {
    renderDispensing();
    await userEvent.click(await screen.findByRole('combobox'));
    expect(await screen.findByTitle('TABLET PER STRIP / TABLET PER PAPAN')).toBeTruthy();
  });

  it('keeps a retired unit on the list, marked — an item may still point at one', async () => {
    renderDispensing();
    await userEvent.click(await screen.findByRole('combobox'));
    expect(await screen.findByTitle('PUNNET (retired)')).toBeTruthy();
  });
});

describe('D1 — a bare 1 is never enough', () => {
  it('warns on an item with no divisor at all', async () => {
    renderDispensing();
    expect(await screen.findByText(/cannot be priced per dispense yet/i)).toBeTruthy();
  });

  it('still warns at a quantity of 1 that nobody has confirmed', async () => {
    renderDispensing(undefined, { quantityPerStockUnit: 1, dispensedWhole: false });
    expect(await screen.findByText(/A quantity of 1 on its own is not enough/i)).toBeTruthy();
  });

  it('goes quiet once the declaration is made, and sets the divisor to 1 with it', async () => {
    renderDispensing();
    await userEvent.click(await screen.findByRole('button', { name: /dispensed whole/i }));

    expect(await screen.findByText('Dispensed whole')).toBeTruthy();
    expect(screen.getByLabelText('Quantity per stock unit')).toHaveValue('1');
    expect(screen.queryByText(/is not enough/i)).toBeNull();
  });

  it('says the declaration will be attributed on save when it is new', async () => {
    renderDispensing();
    await userEvent.click(await screen.findByRole('button', { name: /dispensed whole/i }));
    expect(await screen.findByText(/recorded against you when you save/i)).toBeTruthy();
  });

  it('shows when a standing declaration was made', async () => {
    renderDispensing({ dispensedWholeAt: '2026-08-18T00:00:00.000Z' }, {
      quantityPerStockUnit: 1,
      dispensedWhole: true,
    });
    expect(await screen.findByText(/^Recorded /)).toBeTruthy();
  });

  it('withdraws the declaration WITHOUT blanking the divisor', async () => {
    // Withdrawing a statement is not stating the real count. Blanking the
    // number would make a priced item unpriceable via a checkbox.
    renderDispensing(undefined, { quantityPerStockUnit: 1, dispensedWhole: true });
    await userEvent.click(await screen.findByRole('button', { name: /withdraw dispensed whole/i }));
    expect(screen.getByLabelText('Quantity per stock unit')).toHaveValue('1');
  });

  it('drops the declaration the moment the divisor stops being 1', async () => {
    // The form must not keep claiming "handed over whole" beside a 30. The
    // server clears it either way; this is what stops the screen lying first.
    renderDispensing(undefined, { quantityPerStockUnit: 1, dispensedWhole: true });
    const field = await screen.findByLabelText('Quantity per stock unit');
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await waitFor(() => expect(screen.queryByText('Dispensed whole')).toBeNull());
  });
});

describe('panel pricing says what is charged, not just what is stored', () => {
  it('names the rule behind each panel’s price in words', async () => {
    renderWithClient(<PanelPricingSection itemId="i1" />);
    expect(await screen.findByText(/this panel’s own price/)).toBeTruthy();
    expect(screen.getByText(/cash \+ panel markup \(\+RM 2\.50\)/)).toBeTruthy();
  });

  it('shows the effective price, not only the override', async () => {
    // A panel with no override still charges something — cash plus the panel's
    // blanket markup. An override box alone leaves the clinic to work that out.
    renderWithClient(<PanelPricingSection itemId="i1" />);
    expect(await screen.findByText('RM 12.50')).toBeTruthy();
  });

  it('tells the truth about billing rather than the D2 caveat', async () => {
    // `resolveSourcedPrice` reads these overrides today, so "recorded — not yet
    // used in billing" would be a false reassurance about money.
    renderWithClient(<PanelPricingSection itemId="i1" />);
    expect(await screen.findByText(/Applies to invoices raised from now on/)).toBeTruthy();
    expect(screen.queryByText(/not yet used in billing/i)).toBeNull();
  });

  it('saves one panel’s price through the item’s own route', async () => {
    renderWithClient(<PanelPricingSection itemId="i1" />);
    const field = await screen.findByLabelText('Panel price for Great Eastern');
    await userEvent.type(field, '9');
    await userEvent.click(await screen.findByLabelText('Save price for Great Eastern'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/items/i1/panel-pricing/p2', { overridePrice: 9 }));
  });

  it('clearing sends null, so the override is deleted rather than zeroed', async () => {
    renderWithClient(<PanelPricingSection itemId="i1" />);
    await userEvent.click(await screen.findByLabelText('Clear panel price for AIA'));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/items/i1/panel-pricing/p1', { overridePrice: null }));
  });
});
