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
  it('1. the document ACTIONS are gone — the Documents card owns issuing now', () => {
    // b4 PIECE 1. Create MC, Create Referral and More Documents lived here
    // because the canvas had no Documents card and this was a doctor's only
    // way to issue an MC. The card landed in Phase F and the owner confirmed
    // it works, so three controls doing what the card does is exactly the
    // one-button-one-function rule this band is supposed to obey.
    renderBar();
    expect(screen.queryByRole('button', { name: /create mc/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create referral/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more documents/i })).not.toBeInTheDocument();
  });

  it('2. the whole documents strip is gone — the card reports it now', () => {
    // The summary went too, in a later pass. Once the Documents card existed
    // it was the same fact in two places, and the band was costing vertical
    // space the rail does not have. (It bought no height in the end — the
    // strip sat side by side with the invoice group — but the duplication was
    // real and the removal stands.)
    renderBar();
    expect(screen.queryByText(/^DOCUMENTS$/)).not.toBeInTheDocument();
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
