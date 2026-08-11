// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VisitCompletionBar } from './VisitCompletionBar';
import { Visit } from './types';

// ===========================================================================
// G4.5d3c-3a0v (D-090) — the top Visit Actions surface after the closure.
//
// With the duplicate bottom sections removed, this bar is the ONLY standing
// current-visit entry point for documents and the invoice, so its actions —
// and where they lead — are now load-bearing rather than a shortcut.
// ===========================================================================

vi.mock('./hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [] }),
}));
vi.mock('./hooks/useInvoices', () => ({
  useInvoices: () => ({
    data: [{ id: 'inv-1', invoiceNumber: 'INV-000222', totalAmount: '35.00', status: 'UNPAID' }],
  }),
}));
// The create flow is its own tested surface; here only the entry matters.
vi.mock('./documents/CreateDocumentDrawer', () => ({
  CreateDocumentDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-document-drawer" /> : null,
}));

const VISIT = { id: 'visit-1', panelClinicId: null, billingType: 'Cash' } as Visit;

function renderBar(overrides: { onOpenDocuments?: () => void; onOpenInvoice?: () => void } = {}) {
  return render(
    <VisitCompletionBar
      visit={VISIT}
      patientName="Test Patient"
      patientIdentifier="NRIC 000"
      onOpenDocuments={overrides.onOpenDocuments ?? vi.fn()}
      onOpenInvoice={overrides.onOpenInvoice ?? vi.fn()}
    />,
  );
}

describe('top Visit Actions', () => {
  it('1. document actions are all present', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /create mc/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create referral/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /more documents/i })).toBeInTheDocument();
  });

  it('2. Create MC opens the document creation flow directly', async () => {
    const user = userEvent.setup();
    renderBar();
    expect(screen.queryByTestId('create-document-drawer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create mc/i }));
    expect(screen.getByTestId('create-document-drawer')).toBeInTheDocument();
  });

  it('2b. More Documents hands over to the full Documents surface', async () => {
    const user = userEvent.setup();
    const onOpenDocuments = vi.fn();
    renderBar({ onOpenDocuments });
    await user.click(screen.getByRole('button', { name: /more documents/i }));
    expect(onOpenDocuments).toHaveBeenCalledTimes(1);
  });

  it('3. the invoice action opens the invoice surface', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    renderBar({ onOpenInvoice });
    await user.click(screen.getByRole('button', { name: /open invoice/i }));
    expect(onOpenInvoice).toHaveBeenCalledTimes(1);
  });

  it('13. the bar carries no completion action — that is the footer’s alone', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
  });
});
