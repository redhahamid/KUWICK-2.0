import { divisorAttentionReason, divisorFacts } from './dispensing-divisor';

describe('divisorFacts — clinic over import', () => {
  it('takes the clinic number when both are present', () => {
    // 1E's whole point: the source said 10, the clinic counted 12.
    const facts = divisorFacts({ quantityPerStockUnit: 12, unitsPerPack: 10 });
    expect(facts).toMatchObject({ divisor: 12, source: 'CLINIC', attention: null });
  });

  it('falls back to the imported pack count', () => {
    expect(divisorFacts({ unitsPerPack: 3 })).toMatchObject({ divisor: 3, source: 'IMPORT', attention: null });
  });

  it('has no divisor when neither column is set — the 149-row case', () => {
    expect(divisorFacts({})).toMatchObject({ divisor: null, source: 'NONE', attention: 'NO_DIVISOR' });
  });

  it('treats zero and negatives as not stated, never as a divisor', () => {
    // Dividing by zero and pricing a course as a refund are both worse than
    // saying "nobody has stated this".
    expect(divisorFacts({ quantityPerStockUnit: 0 }).attention).toBe('NO_DIVISOR');
    expect(divisorFacts({ quantityPerStockUnit: -5 }).source).toBe('NONE');
    // A zero on the clinic column must not hide a real imported count.
    expect(divisorFacts({ quantityPerStockUnit: 0, unitsPerPack: 10 })).toMatchObject({
      divisor: 10,
      source: 'IMPORT',
    });
  });
});

describe('a bare 1 is never enough (D1)', () => {
  it('flags a clinic-typed 1 with no declaration', () => {
    expect(divisorFacts({ quantityPerStockUnit: 1 })).toMatchObject({
      divisor: 1,
      dispensedWhole: false,
      attention: 'UNCONFIRMED_ONE',
    });
  });

  it('flags an IMPORT-parsed 1 too — a pack string is not a person', () => {
    expect(divisorFacts({ unitsPerPack: 1 }).attention).toBe('UNCONFIRMED_ONE');
  });

  it('clears once somebody declares the item dispensed whole', () => {
    const facts = divisorFacts({ quantityPerStockUnit: 1, dispensedWholeAt: new Date('2026-08-18') });
    expect(facts).toMatchObject({ divisor: 1, dispensedWhole: true, attention: null });
  });

  it('does not flag any divisor above 1, declared or not', () => {
    expect(divisorFacts({ quantityPerStockUnit: 10 }).attention).toBeNull();
  });
});

describe('the reason is words, not a code', () => {
  it('names what is missing and what to do', () => {
    expect(divisorAttentionReason('NO_DIVISOR')).toContain('how many are in a pack');
    expect(divisorAttentionReason('UNCONFIRMED_ONE')).toContain('dispensed whole');
  });
});
