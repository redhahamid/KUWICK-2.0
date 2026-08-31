import {
  feeEvidence,
  panelBillingPosition,
  panelFeeCost,
  reconcileWithholding,
  rollUpPanelFeeCost,
} from './panel-money';

/**
 * The arithmetic behind the Finance → Panel money screen.
 *
 * Every case here is a shape the clinic's own claim workbook actually contains
 * (docs/PANEL_LEGACY_WORKFLOW_AUDIT.md), not an invented edge case.
 */
describe('billed vs claimed — the Avixo reconciliation, in code', () => {
  it('1. billed and claimed to the cent is CLAIMED, with nothing outstanding', () => {
    const position = panelBillingPosition({ panelCoveredAmount: 100, activeClaimedAmount: 100 });
    expect(position.state).toBe('CLAIMED');
    expect(position.unclaimedCents).toBe(0);
    expect(position.overClaimedCents).toBe(0);
  });

  it('2. billed with no claim at all is UNCLAIMED — money the clinic never asked for', () => {
    const position = panelBillingPosition({ panelCoveredAmount: 80 });
    expect(position.state).toBe('UNCLAIMED');
    expect(position.unclaimedCents).toBe(8000);
  });

  it('3. claimed for less than billed is UNDER_CLAIMED, and names the shortfall', () => {
    const position = panelBillingPosition({ panelCoveredAmount: 100, activeClaimedAmount: 70 });
    expect(position.state).toBe('UNDER_CLAIMED');
    expect(position.unclaimedCents).toBe(3000);
  });

  it('4. claimed for MORE than billed is OVER_CLAIMED, never netted into "unclaimed"', () => {
    const position = panelBillingPosition({ panelCoveredAmount: 100, activeClaimedAmount: 130 });
    expect(position.state).toBe('OVER_CLAIMED');
    expect(position.overClaimedCents).toBe(3000);
    expect(position.unclaimedCents).toBe(0);
  });

  it('5. an invoice with no panel share is CLAIMED at zero, not UNCLAIMED', () => {
    const position = panelBillingPosition({ panelCoveredAmount: 0 });
    expect(position.state).toBe('CLAIMED');
    expect(position.unclaimedCents).toBe(0);
  });
});

describe('what the fee costs — the finance consequence of D-112', () => {
  it('6. a withheld fee on a settled, paid claim is BORNE', () => {
    const cost = panelFeeCost({
      feeAmount: 8,
      feeTreatment: 'WITHHELD_FROM_CLAIM',
      receivedAmount: 92,
      outstandingCents: 0,
    });
    expect(cost).toEqual({ costCents: 800, state: 'BORNE' });
  });

  it('7. a withheld fee on a claim still owed is EXPECTED, not yet spent', () => {
    const cost = panelFeeCost({
      feeAmount: 8,
      feeTreatment: 'WITHHELD_FROM_CLAIM',
      receivedAmount: 0,
      outstandingCents: 9200,
    });
    expect(cost).toEqual({ costCents: 800, state: 'EXPECTED' });
  });

  it('8. a claim closed by a write-off cost the CLAIM, not a fee — NOT_BORNE, zero', () => {
    const cost = panelFeeCost({
      feeAmount: 8,
      feeTreatment: 'WITHHELD_FROM_CLAIM',
      receivedAmount: 0,
      outstandingCents: 0,
    });
    expect(cost).toEqual({ costCents: 0, state: 'NOT_BORNE' });
  });

  it('9. a fee ADDED to the receivable is not a cost — the panel pays it', () => {
    const cost = panelFeeCost({
      feeAmount: 8,
      feeTreatment: 'ADDED_TO_RECEIVABLE',
      receivedAmount: 108,
      outstandingCents: 0,
    });
    expect(cost).toEqual({ costCents: 0, state: 'NOT_A_COST' });
  });

  it('10. a panel with NO_FEE costs nothing', () => {
    expect(panelFeeCost({ feeAmount: 0, feeTreatment: 'NO_FEE', outstandingCents: 0 }).costCents).toBe(0);
  });

  it('11. an UNCONFIGURED fee is never silently treated as a zero cost', () => {
    // It is excluded from the cost, and the roll-up counts it so the screen can
    // say the total is understated. Guessing here is the D-041 mistake.
    const cost = panelFeeCost({
      feeAmount: 8,
      feeTreatment: 'UNCONFIGURED',
      receivedAmount: 100,
      outstandingCents: 0,
    });
    expect(cost.costCents).toBe(0);

    const roll = rollUpPanelFeeCost([
      { feeAmount: 8, feeTreatment: 'UNCONFIGURED', receivedAmount: 100, outstandingCents: 0 },
    ]);
    expect(roll).toEqual({ borneCents: 0, expectedCents: 0, unresolvedCount: 1, unresolvedFeeCents: 800 });
  });

  it('12. the roll-up keeps borne and expected apart', () => {
    const roll = rollUpPanelFeeCost([
      { feeAmount: 8, feeTreatment: 'WITHHELD_FROM_CLAIM', receivedAmount: 92, outstandingCents: 0 },
      { feeAmount: 5, feeTreatment: 'WITHHELD_FROM_CLAIM', receivedAmount: 0, outstandingCents: 9500 },
      { feeAmount: 3, feeTreatment: 'WITHHELD_FROM_CLAIM', receivedAmount: 0, outstandingCents: 0 },
      { feeAmount: 9, feeTreatment: 'ADDED_TO_RECEIVABLE', receivedAmount: 109, outstandingCents: 0 },
    ]);
    expect(roll.borneCents).toBe(800);
    expect(roll.expectedCents).toBe(500);
    expect(roll.unresolvedCount).toBe(0);
  });
});

describe('was the fee actually taken? — the exceptions, found automatically', () => {
  // RM100 claimed, RM8 withheld fee, so RM92 is what the rule says arrives.
  const claim = { feeAmount: 8, feeTreatment: 'WITHHELD_FROM_CLAIM' as const, claimedCents: 10_000, expectedReceivableCents: 9_200 };

  it('13. RM92 received against a RM92 expectation is the fee TAKEN', () => {
    expect(feeEvidence({ ...claim, receivedCents: 9_200, outstandingCents: 0 })).toEqual({
      state: 'TAKEN',
      differenceCents: 0,
    });
  });

  it('14. the full RM100 arriving is the fee NOT TAKEN — the workbook exception, found by itself', () => {
    expect(feeEvidence({ ...claim, receivedCents: 10_000, outstandingCents: 0 })).toEqual({
      state: 'NOT_TAKEN',
      differenceCents: 800,
    });
  });

  it('15. more than the whole claim is an OVERPAYMENT, measured from the claim', () => {
    expect(feeEvidence({ ...claim, receivedCents: 10_500, outstandingCents: 0 })).toEqual({
      state: 'OVERPAID',
      differenceCents: 500,
    });
  });

  it('16. a claim still owed is PENDING — no evidence either way', () => {
    expect(feeEvidence({ ...claim, receivedCents: 0, outstandingCents: 9_200 }).state).toBe('PENDING');
  });

  it('17. a claim rejected outright is NOT_PAID, never "pending" — it is finished', () => {
    expect(feeEvidence({ ...claim, receivedCents: 0, outstandingCents: 0 })).toEqual({
      state: 'NOT_PAID',
      differenceCents: 0,
    });
  });

  it('18. short-paid and closed is INCONCLUSIVE, not "the fee was taken"', () => {
    // RM70 on a part-approved claim: the RM22 gap could be the rejection or the
    // fee, and nothing in these numbers tells them apart.
    expect(feeEvidence({ ...claim, receivedCents: 7_000, outstandingCents: 0 })).toEqual({
      state: 'INCONCLUSIVE',
      differenceCents: 0,
    });
  });

  it('19. a panel that adds its fee has no withholding to evidence', () => {
    expect(
      feeEvidence({
        feeAmount: 8,
        feeTreatment: 'ADDED_TO_RECEIVABLE',
        claimedCents: 10_000,
        expectedReceivableCents: 10_800,
        receivedCents: 10_800,
        outstandingCents: 0,
      }).state,
    ).toBe('NOT_APPLICABLE');
  });
});

describe('did they keep more than the fee?', () => {
  it('20. RM8 kept against RM8 of fees agrees, with nothing unexplained', () => {
    const check = reconcileWithholding({ withheldAmount: 8, expectedFeeCents: 800 });
    expect(check.applicable).toBe(true);
    expect(check.agrees).toBe(true);
    expect(check.unexplainedCents).toBe(0);
  });

  it('21. RM20 kept against RM8 of fees leaves RM12 nobody has accounted for', () => {
    const check = reconcileWithholding({ withheldAmount: 20, expectedFeeCents: 800 });
    expect(check.agrees).toBe(false);
    expect(check.explainedCents).toBe(800);
    expect(check.unexplainedCents).toBe(1200);
  });

  it('22. a remittance keyed NET is not a finding — the check does not apply', () => {
    // Gross 92, withheld 0, net 92 is a correct way to key a payment whose fee
    // was already deducted. Flagging it would flag every payment in the system.
    const check = reconcileWithholding({ withheldAmount: 0, expectedFeeCents: 800 });
    expect(check.applicable).toBe(false);
    expect(check.agrees).toBe(true);
    expect(check.unexplainedCents).toBe(0);
  });
});
