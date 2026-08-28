import { computeLineTax, rateInForce, summariseTax, TaxCodeSnapshot } from './tax';

const SST6: TaxCodeSnapshot = {
  id: 'tax-sst6',
  code: 'SST-6',
  treatment: 'STANDARD_RATED',
  rates: [{ ratePercent: '6.000', effectiveFrom: '2020-01-01' }],
};

describe('tax', () => {
  describe('rateInForce', () => {
    it('picks the rate in force on the day, inclusive at both edges', () => {
      const rates = [
        { ratePercent: '6.000', effectiveFrom: '2020-01-01', effectiveTo: '2026-02-28' },
        { ratePercent: '8.000', effectiveFrom: '2026-03-01' },
      ];
      expect(rateInForce(rates, new Date('2026-02-28T12:00:00Z'))).toBe(6);
      expect(rateInForce(rates, new Date('2026-03-01T00:00:00Z'))).toBe(8);
      expect(rateInForce(rates, new Date('2027-01-01T00:00:00Z'))).toBe(8);
    });

    it('returns null before any rate begins — a gap is not a zero rate', () => {
      expect(rateInForce([{ ratePercent: '6.000', effectiveFrom: '2026-03-01' }], new Date('2026-01-01'))).toBeNull();
    });

    it('does not let a rate change rewrite an older bill', () => {
      const rates = [
        { ratePercent: '6.000', effectiveFrom: '2020-01-01' },
        { ratePercent: '8.000', effectiveFrom: '2026-03-01' },
      ];
      // The March row exists, but a January invoice still computes at 6%.
      expect(rateInForce(rates, new Date('2026-01-15'))).toBe(6);
    });
  });

  describe('computeLineTax', () => {
    it('charges the rate on the discounted line, not the gross one', () => {
      const tax = computeLineTax({
        amount: '100.00',
        lineDiscountAmount: '20.00',
        taxCode: SST6,
        on: new Date('2026-08-01'),
      });
      expect(tax.taxableBaseCents).toBe(8000);
      expect(tax.taxCents).toBe(480);
      expect(tax.ratePercent).toBe(6);
    });

    it('reports an unmapped line as UNMAPPED, not as zero-rated', () => {
      const tax = computeLineTax({ amount: '100.00', taxCode: null, on: new Date() });
      expect(tax.unmapped).toBe(true);
      expect(tax.taxCents).toBe(0);
      expect(tax.treatment).toBeNull();
    });

    it('distinguishes exempt from zero-rated — both add nothing and report apart', () => {
      const exempt = computeLineTax({
        amount: '100.00',
        taxCode: { id: 'x', code: 'EX', treatment: 'EXEMPT', rates: [] },
        on: new Date(),
      });
      const zero = computeLineTax({
        amount: '100.00',
        taxCode: { id: 'z', code: 'ZR', treatment: 'ZERO_RATED', rates: [] },
        on: new Date(),
      });
      expect(exempt.taxCents).toBe(0);
      expect(zero.taxCents).toBe(0);
      expect(exempt.treatment).toBe('EXEMPT');
      expect(zero.treatment).toBe('ZERO_RATED');
      expect(exempt.unmapped).toBe(false);
      expect(zero.unmapped).toBe(false);
    });

    it('flags a standard-rated code with no rate in force rather than charging a guess', () => {
      const tax = computeLineTax({
        amount: '100.00',
        taxCode: { ...SST6, rates: [{ ratePercent: '6.000', effectiveFrom: '2030-01-01' }] },
        on: new Date('2026-08-01'),
      });
      expect(tax.taxCents).toBe(0);
      expect(tax.ratePercent).toBeNull();
      expect(tax.unmapped).toBe(true);
    });

    it('taxes only the patient portion when that is the configured basis', () => {
      // Owner brief §6H: the panel's share is not taxed unless configuration
      // says it is. PATIENT_PORTION is how a clinic says it is not.
      const tax = computeLineTax({
        amount: '100.00',
        patientResponsibilityAmount: '30.00',
        basis: 'PATIENT_PORTION',
        taxCode: SST6,
        on: new Date('2026-08-01'),
      });
      expect(tax.taxableBaseCents).toBe(3000);
      expect(tax.taxCents).toBe(180);
    });

    it('taxes nothing on a patient-portion basis when the split is unresolved', () => {
      const tax = computeLineTax({
        amount: '100.00',
        patientResponsibilityAmount: null,
        basis: 'PATIENT_PORTION',
        taxCode: SST6,
        on: new Date('2026-08-01'),
      });
      expect(tax.taxCents).toBe(0);
    });
  });

  describe('summariseTax', () => {
    it('sums per-line tax rather than re-applying a rate to a total', () => {
      const on = new Date('2026-08-01');
      const lines = [
        computeLineTax({ amount: '8.33', taxCode: SST6, on }),
        computeLineTax({ amount: '8.33', taxCode: SST6, on }),
        computeLineTax({ amount: '8.33', taxCode: SST6, on }),
      ];
      // Each line rounds to 50 cents; the total is 150, NOT 6% of 24.99 (150).
      // They agree here — the point is that the report reports what was
      // charged, line by line.
      const summary = summariseTax(lines, [833, 833, 833]);
      expect(summary.taxCents).toBe(150);
      expect(summary.taxableCents).toBe(2499);
      expect(summary.grossTaxableCents).toBe(2649);
    });

    it('keeps taxable, zero-rated, exempt and unmapped in separate buckets', () => {
      const on = new Date('2026-08-01');
      const lines = [
        computeLineTax({ amount: '100.00', taxCode: SST6, on }),
        computeLineTax({ amount: '50.00', taxCode: { id: 'z', code: 'ZR', treatment: 'ZERO_RATED', rates: [] }, on }),
        computeLineTax({ amount: '25.00', taxCode: { id: 'e', code: 'EX', treatment: 'EXEMPT', rates: [] }, on }),
        computeLineTax({ amount: '10.00', taxCode: null, on }),
      ];
      const summary = summariseTax(lines, [10000, 5000, 2500, 1000]);
      expect(summary.taxableCents).toBe(10000);
      expect(summary.taxCents).toBe(600);
      expect(summary.zeroRatedCents).toBe(5000);
      expect(summary.exemptCents).toBe(2500);
      expect(summary.unmappedCents).toBe(1000);
    });
  });
});
