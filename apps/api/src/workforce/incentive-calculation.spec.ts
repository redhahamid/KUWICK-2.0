import { computeProcedureIncentive, computeSalesCommission, ruleInForce } from './incentive-calculation';

describe('incentive calculation', () => {
  describe('sales commission', () => {
    const rule = { thresholdAmount: '30000.00', flatAmount: '500.00', percentAbove: '5.000' };

    it('pays nothing below the threshold', () => {
      const result = computeSalesCommission('29999.99', rule);
      expect(result.qualified).toBe(false);
      expect(result.totalCents).toBe(0);
    });

    it('pays at EXACTLY the threshold — a strict inequality would lose the whole commission', () => {
      const result = computeSalesCommission('30000.00', rule);
      expect(result.qualified).toBe(true);
      expect(result.flatCents).toBe(50000);
      expect(result.percentCents).toBe(0);
      expect(result.totalCents).toBe(50000);
    });

    it('applies the percentage to the EXCESS only, never to the whole', () => {
      // Applying 5% to the whole 40,000 would be RM2,000 and would create a
      // cliff at the threshold where one more ringgit is worth hundreds.
      const result = computeSalesCommission('40000.00', rule);
      expect(result.aboveThresholdCents).toBe(1000000);
      expect(result.percentCents).toBe(50000);
      expect(result.totalCents).toBe(100000);
    });

    it('handles a rule with only a flat amount, and one with only a percentage', () => {
      expect(computeSalesCommission('50000.00', { thresholdAmount: '30000.00', flatAmount: '800.00' }).totalCents).toBe(
        80000,
      );
      expect(
        computeSalesCommission('50000.00', { thresholdAmount: '30000.00', percentAbove: '10.000' }).totalCents,
      ).toBe(200000);
    });

    it('has no threshold when none is configured — everything qualifies', () => {
      const result = computeSalesCommission('1000.00', { percentAbove: '3.000' });
      expect(result.qualified).toBe(true);
      expect(result.totalCents).toBe(3000);
    });
  });

  describe('procedure incentive', () => {
    const lines = [
      { serviceCatalogId: 'svc-minor-ot', amount: '300.00' },
      { serviceCatalogId: 'svc-minor-ot', amount: '250.00' },
      { serviceCatalogId: 'svc-consult', amount: '35.00' },
      { serviceCatalogId: null, amount: '10.00' },
    ];

    it('pays a flat rate per qualifying procedure from an allow-list', () => {
      const result = computeProcedureIncentive(lines, {
        serviceCatalogIds: ['svc-minor-ot'],
        perProcedureAmount: '25.00',
      });
      expect(result.qualifyingCount).toBe(2);
      expect(result.totalCents).toBe(5000);
    });

    it('pays a percentage of what qualifying procedures billed', () => {
      const result = computeProcedureIncentive(lines, {
        serviceCatalogIds: ['svc-minor-ot'],
        perProcedurePercent: '10.000',
      });
      expect(result.qualifyingAmountCents).toBe(55000);
      expect(result.totalCents).toBe(5500);
    });

    it('treats an empty allow-list as everything-minus-exclusions', () => {
      const result = computeProcedureIncentive(lines, {
        excludedServiceCatalogIds: ['svc-consult'],
        perProcedureAmount: '10.00',
      });
      expect(result.qualifyingCount).toBe(2);
      expect(result.excludedCount).toBe(1);
    });

    it('lets the exclusion list win over the allow-list', () => {
      const result = computeProcedureIncentive(lines, {
        serviceCatalogIds: ['svc-minor-ot', 'svc-consult'],
        excludedServiceCatalogIds: ['svc-consult'],
        perProcedureAmount: '10.00',
      });
      expect(result.qualifyingCount).toBe(2);
    });

    it('counts quantity, so three dressings pay three times', () => {
      const result = computeProcedureIncentive(
        [{ serviceCatalogId: 'svc-dressing', amount: '90.00', quantity: 3 }],
        { perProcedureAmount: '5.00' },
      );
      expect(result.qualifyingCount).toBe(3);
      expect(result.totalCents).toBe(1500);
    });
  });

  describe('ruleInForce — a paid incentive is never recalculated with today’s rules', () => {
    const rules = [
      { version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
      { version: 2, effectiveFrom: '2026-07-01' },
    ];

    it('picks the version in force at the start of the period', () => {
      expect(ruleInForce(rules, new Date('2026-03-15'))?.version).toBe(1);
      expect(ruleInForce(rules, new Date('2026-08-01'))?.version).toBe(2);
    });

    it('does not let a new version reach back over a closed month', () => {
      // The June run computed under v1 and must keep computing under v1
      // however many versions arrive afterwards.
      expect(ruleInForce(rules, new Date('2026-06-01'))?.version).toBe(1);
    });

    it('applies a mid-month rule from the FOLLOWING month, not part-way through', () => {
      const midMonth = [{ version: 1, effectiveFrom: '2026-08-15' }];
      expect(ruleInForce(midMonth, new Date('2026-08-01'))).toBeNull();
      expect(ruleInForce(midMonth, new Date('2026-09-01'))?.version).toBe(1);
    });

    it('ignores an inactive rule', () => {
      expect(ruleInForce([{ version: 1, effectiveFrom: '2026-01-01', active: false }], new Date('2026-08-01'))).toBeNull();
    });

    it('returns null when nothing is in force rather than inventing a rate', () => {
      expect(ruleInForce([], new Date('2026-08-01'))).toBeNull();
    });
  });
});
