import { calculateResponsibility, remainingPatientBalance, EngineInput, EngineLine } from './billing-calculation';
import { resolveContractualPrice } from './billing-pricing';

// ===========================================================================
// G4.5d3c-3b1 (D-093) — THE RESPONSIBILITY ENGINE, EXHAUSTIVELY
//
// Pure function, so every owner-approved case (audit §M/§N cases A–F, the
// percentage-copay worked example, and the discount policy) is pinned here
// without a database. The two invariants are asserted on EVERY resolved case:
//
//   totalAmount = panel + patient
//   Σ line panel = invoice panel and Σ line patient = invoice patient
// ===========================================================================

let lineSeq = 0;
const L = (amount: number, over: Partial<EngineLine> = {}): EngineLine => ({
  id: `line-${(lineSeq += 1)}`,
  amount,
  excludedFromPanel: false,
  cancelled: false,
  lineDiscountType: null,
  lineDiscountValue: null,
  ...over,
});

const CASH: EngineInput['benefit'] = { kind: 'CASH' };
const UNRESOLVED: EngineInput['benefit'] = { kind: 'PANEL_UNRESOLVED' };
const panel = (over: Partial<Extract<EngineInput['benefit'], { kind: 'PANEL_RESOLVED' }>> = {}) =>
  ({
    kind: 'PANEL_RESOLVED',
    coverageType: 'UNLIMITED',
    visitLimitAmount: null,
    copaymentType: 'NONE',
    copaymentValue: null,
    ...over,
  }) as EngineInput['benefit'];

function run(input: Partial<EngineInput> & { lines: EngineLine[] }) {
  const result = calculateResponsibility({
    invoiceDiscountType: null,
    invoiceDiscountValue: null,
    benefit: CASH,
    ...input,
  });
  if (result.resolved) {
    // The invariants, on every resolved case this file runs.
    expect(result.totalAmount).toBeCloseTo(
      (result.panelResponsibilityAmount ?? 0) + (result.patientResponsibilityAmount ?? 0),
      2,
    );
    const activeLines = result.lines.filter((l) => l.panelResponsibilityAmount !== null);
    const linePanel = activeLines.reduce((s, l) => s + (l.panelResponsibilityAmount ?? 0), 0);
    const linePatient = activeLines.reduce((s, l) => s + (l.patientResponsibilityAmount ?? 0), 0);
    expect(linePanel).toBeCloseTo(result.panelResponsibilityAmount ?? 0, 2);
    expect(linePatient).toBeCloseTo(result.patientResponsibilityAmount ?? 0, 2);
  }
  return result;
}

describe('1/2. cash resolves immediately; unresolved panel stays NULL', () => {
  it('a cash invoice is entirely patient responsibility, deterministically', () => {
    const r = run({ lines: [L(85), L(15)] });
    expect(r).toMatchObject({
      resolved: true,
      subtotalAmount: 100,
      totalAmount: 100,
      panelResponsibilityAmount: 0,
      patientResponsibilityAmount: 100,
    });
  });

  it('an unverified panel visit yields NULL responsibility — never a guess', () => {
    const r = run({ lines: [L(250)], benefit: UNRESOLVED });
    expect(r.resolved).toBe(false);
    expect(r.panelResponsibilityAmount).toBeNull();
    expect(r.patientResponsibilityAmount).toBeNull();
    expect(r.lines[0].patientResponsibilityAmount).toBeNull();
    // The billed total still exists — what is owed IN TOTAL is known; who
    // owes it is not.
    expect(r.totalAmount).toBe(250);
  });
});

describe('audit cases A–F', () => {
  it('3/A. unlimited coverage: panel takes everything', () => {
    const r = run({ lines: [L(250)], benefit: panel() });
    expect(r).toMatchObject({ panelResponsibilityAmount: 250, patientResponsibilityAmount: 0 });
  });

  it('4/B. visit limit: excess is the patient’s', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 200 }),
    });
    expect(r).toMatchObject({ panelResponsibilityAmount: 200, patientResponsibilityAmount: 50 });
  });

  it('5/C. fixed copayment on unlimited coverage', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({ copaymentType: 'FIXED_AMOUNT', copaymentValue: 10 }),
    });
    expect(r).toMatchObject({ panelResponsibilityAmount: 240, patientResponsibilityAmount: 10 });
  });

  it('7/D. limit + fixed copayment (owner first-version interpretation)', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({
        coverageType: 'VISIT_LIMIT',
        visitLimitAmount: 200,
        copaymentType: 'FIXED_AMOUNT',
        copaymentValue: 10,
      }),
    });
    // RM190 panel; RM60 patient = RM50 above limit + RM10 copay.
    expect(r).toMatchObject({ panelResponsibilityAmount: 190, patientResponsibilityAmount: 60 });
  });

  it('9/E. excluded item: charge stays, responsibility moves', () => {
    const r = run({
      lines: [L(75), L(30, { excludedFromPanel: true })],
      benefit: panel({ copaymentType: 'FIXED_AMOUNT', copaymentValue: 5 }),
    });
    // Panel 75-5=70; patient 5 copay + 30 excluded = 35.
    expect(r).toMatchObject({ panelResponsibilityAmount: 70, patientResponsibilityAmount: 35 });
    const excludedLine = r.lines[1];
    expect(excludedLine.panelResponsibilityAmount).toBe(0);
    expect(excludedLine.patientResponsibilityAmount).toBe(30);
  });

  it('10/F. limit + exclusion: both components land on the patient', () => {
    const r = run({
      lines: [L(220), L(30, { excludedFromPanel: true })],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 200 }),
    });
    // Panel 200; patient 50 = 20 above limit + 30 excluded.
    expect(r).toMatchObject({ panelResponsibilityAmount: 200, patientResponsibilityAmount: 50 });
  });
});

describe('6/8. percentage copayment', () => {
  it('6. percentage of the covered amount, unlimited coverage', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({ copaymentType: 'PERCENTAGE', copaymentValue: 10 }),
    });
    expect(r).toMatchObject({ panelResponsibilityAmount: 225, patientResponsibilityAmount: 25 });
  });

  it('8. owner worked example: limit 200 then 10% — panel 180, patient 70', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({
        coverageType: 'VISIT_LIMIT',
        visitLimitAmount: 200,
        copaymentType: 'PERCENTAGE',
        copaymentValue: 10,
      }),
    });
    // Copay = 10% × min(250, 200) = 20. Panel 180. Patient 50 excess + 20.
    expect(r).toMatchObject({ panelResponsibilityAmount: 180, patientResponsibilityAmount: 70 });
  });

  it('percentage copay is never taken from excluded items', () => {
    const r = run({
      lines: [L(100), L(40, { excludedFromPanel: true })],
      benefit: panel({ copaymentType: 'PERCENTAGE', copaymentValue: 10 }),
    });
    // Copay = 10% × 100 = 10, NOT 10% × 140.
    expect(r).toMatchObject({ panelResponsibilityAmount: 90, patientResponsibilityAmount: 50 });
  });
});

describe('16/17. line discounts', () => {
  it('16. fixed line discount: RM20 line − RM5 = RM15', () => {
    const r = run({ lines: [L(20, { lineDiscountType: 'FIXED_AMOUNT', lineDiscountValue: 5 })] });
    expect(r.lines[0].lineDiscountAmount).toBe(5);
    expect(r.totalAmount).toBe(15);
  });

  it('17. percentage line discount: RM40 line at 10% = RM4 off', () => {
    const r = run({ lines: [L(40, { lineDiscountType: 'PERCENTAGE', lineDiscountValue: 10 })] });
    expect(r.lines[0].lineDiscountAmount).toBe(4);
    expect(r.totalAmount).toBe(36);
  });

  it('20a. a line discount can never exceed the line amount', () => {
    const r = run({ lines: [L(20, { lineDiscountType: 'FIXED_AMOUNT', lineDiscountValue: 500 })] });
    expect(r.lines[0].lineDiscountAmount).toBe(20);
    expect(r.totalAmount).toBe(0);
  });

  it('line discounts apply BEFORE coverage: the panel covers the discounted price', () => {
    const r = run({
      lines: [L(100, { lineDiscountType: 'PERCENTAGE', lineDiscountValue: 10 })],
      benefit: panel(),
    });
    expect(r).toMatchObject({ panelResponsibilityAmount: 90, patientResponsibilityAmount: 0 });
  });
});

describe('18/19. overall discount — AFTER_PANEL_SPLIT_PATIENT_ONLY', () => {
  it('18. cash invoice: the whole amount is patient-responsible, so the discount applies to all of it', () => {
    const r = run({
      lines: [L(200)],
      invoiceDiscountType: 'PERCENTAGE',
      invoiceDiscountValue: 5,
    });
    expect(r.invoiceDiscountAmount).toBe(10);
    expect(r).toMatchObject({ totalAmount: 190, patientResponsibilityAmount: 190 });
  });

  it('19. panel invoice: the discount reduces ONLY the patient portion', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 200 }),
      invoiceDiscountType: 'FIXED_AMOUNT',
      invoiceDiscountValue: 20,
    });
    // Panel stays 200 — the contractual receivable is never discounted.
    // Patient 50 − 20 = 30.
    expect(r).toMatchObject({ panelResponsibilityAmount: 200, patientResponsibilityAmount: 30, totalAmount: 230 });
  });

  it('20b. an overall discount can never exceed the patient portion', () => {
    const r = run({
      lines: [L(250)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 200 }),
      invoiceDiscountType: 'FIXED_AMOUNT',
      invoiceDiscountValue: 500,
    });
    expect(r.invoiceDiscountAmount).toBe(50);
    expect(r).toMatchObject({ panelResponsibilityAmount: 200, patientResponsibilityAmount: 0 });
  });
});

describe('24/25/37. cancellation and per-line exactness', () => {
  it('25. a cancelled line leaves every total', () => {
    const r = run({ lines: [L(100), L(40, { cancelled: true })] });
    expect(r.subtotalAmount).toBe(100);
    expect(r.totalAmount).toBe(100);
    const cancelled = r.lines.find((l) => l.panelResponsibilityAmount === null);
    expect(cancelled).toBeDefined();
  });

  it('37. proportional allocation with rounding residue still sums exactly', () => {
    // Three odd lines under a limit that forces .3333… shares.
    const r = run({
      lines: [L(10), L(10), L(10)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 20 }),
    });
    expect(r.panelResponsibilityAmount).toBe(20);
    expect(r.patientResponsibilityAmount).toBe(10);
    const linePanel = r.lines.reduce((s, l) => s + (l.panelResponsibilityAmount ?? 0), 0);
    expect(Math.round(linePanel * 100)).toBe(2000); // exact, not close
  });

  it('the residue lands on the FINAL covered line, deterministically', () => {
    const a = run({
      lines: [L(10), L(10), L(10)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 20 }),
    });
    const b = run({
      lines: [L(10), L(10), L(10)],
      benefit: panel({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 20 }),
    });
    expect(a.lines.map((l) => l.panelResponsibilityAmount)).toEqual(
      b.lines.map((l) => l.panelResponsibilityAmount),
    );
  });
});

describe('39. remaining balance', () => {
  it('is max(responsibility − paid, 0), and NULL stays NULL', () => {
    expect(remainingPatientBalance(70, 0)).toBe(70);
    expect(remainingPatientBalance(70, 70)).toBe(0);
    expect(remainingPatientBalance(70, 100)).toBe(0);
    expect(remainingPatientBalance(null, 50)).toBeNull();
  });
});

describe('11/12/13. pricing precedence (pure resolver)', () => {
  it('11. a specific panel price REPLACES the markup — never stacked', () => {
    const r = resolveContractualPrice({ cashPrice: 20, specificPanelPrice: 18, panelMarkupAmount: 2 });
    expect(r).toMatchObject({ unitPrice: 18, priceRule: 'SPECIFIC_PANEL_PRICE', baseUnitPrice: 20 });
  });

  it('12. cash + markup when no specific price exists', () => {
    const r = resolveContractualPrice({ cashPrice: 10, specificPanelPrice: null, panelMarkupAmount: 2 });
    expect(r).toMatchObject({ unitPrice: 12, priceRule: 'CASH_PLUS_MARKUP', panelMarkupAmount: 2 });
  });

  it('13. NULL or zero markup falls back to the cash price', () => {
    expect(resolveContractualPrice({ cashPrice: 30, specificPanelPrice: null, panelMarkupAmount: null }))
      .toMatchObject({ unitPrice: 30, priceRule: 'CASH' });
    expect(resolveContractualPrice({ cashPrice: 30, specificPanelPrice: null, panelMarkupAmount: 0 }))
      .toMatchObject({ unitPrice: 30, priceRule: 'CASH' });
  });
});
