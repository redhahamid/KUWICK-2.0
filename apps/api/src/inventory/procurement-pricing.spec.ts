import {
  deliveryPerformance,
  effectiveUnitCostCents,
  findPossibleDuplicate,
  lineCostCents,
  nameSimilarity,
  normaliseItemName,
  promotionApplies,
  promotionSavingCents,
} from './procurement-pricing';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('promotional pricing — MIN(unit, bonus)', () => {
  it('pays the lower of the two quoted prices', () => {
    // The clinic's order queue values every line at MIN(unit, bonus) × qty.
    expect(effectiveUnitCostCents('6.84', '5.80')).toBe(580);
    expect(lineCostCents(90, '6.84', '5.80')).toBe(52200);
  });

  it('an ABSENT promotion is not a promotion of zero', () => {
    // Treating a null bonus as 0 would value every line at nothing — the single
    // most damaging way to get this wrong.
    expect(effectiveUnitCostCents('6.84', null)).toBe(684);
    expect(effectiveUnitCostCents('6.84', undefined)).toBe(684);
    expect(lineCostCents(90, '6.84')).toBe(61560);
  });

  it('ignores a promotion that is not actually cheaper', () => {
    expect(effectiveUnitCostCents('5.00', '6.00')).toBe(500);
    expect(promotionApplies('5.00', '6.00')).toBe(false);
    expect(promotionSavingCents(10, '5.00', '6.00')).toBe(0);
  });

  it('reports what the promotion saved', () => {
    expect(promotionApplies('6.84', '5.80')).toBe(true);
    expect(promotionSavingCents(90, '6.84', '5.80')).toBe(9360);
    expect(promotionSavingCents(90, '6.84', null)).toBe(0);
  });
});

describe('supplier delivery performance', () => {
  it('measures the SLA that lives in a column heading today', () => {
    // "Received date (max 1 week)" — seven days, and nothing measures it.
    const onTime = deliveryPerformance(d('2026-08-01'), d('2026-08-06'), 7);
    expect(onTime.days).toBe(5);
    expect(onTime.withinSla).toBe(true);
    expect(onTime.breachedSla).toBe(false);
    expect(onTime.daysLate).toBe(-2);

    const late = deliveryPerformance(d('2026-08-01'), d('2026-08-15'), 7);
    expect(late.days).toBe(14);
    expect(late.breachedSla).toBe(true);
    expect(late.daysLate).toBe(7);
  });

  it('not knowing the SLA is not the same as meeting it', () => {
    const unknown = deliveryPerformance(d('2026-08-01'), d('2026-09-30'), null);
    expect(unknown.days).toBe(60);
    expect(unknown.slaKnown).toBe(false);
    expect(unknown.withinSla).toBe(false);
    expect(unknown.breachedSla).toBe(false);
    expect(unknown.daysLate).toBeNull();
  });

  it('an undelivered order is neither on time nor late', () => {
    const pending = deliveryPerformance(d('2026-08-01'), null, 7);
    expect(pending.days).toBeNull();
    expect(pending.withinSla).toBe(false);
    expect(pending.breachedSla).toBe(false);
  });
});

describe('duplicate detection before a new item is created', () => {
  it('sees through strengths, forms and punctuation', () => {
    expect(normaliseItemName('Amoxicillin 500mg Cap')).toBe('amoxicillin');
    expect(normaliseItemName('AMOXICILLIN 500 MG capsules')).toBe('amoxicillin');
    expect(nameSimilarity('Amoxicillin 500mg Cap', 'AMOXICILLIN 500 MG capsules')).toBe(1);
  });

  it('finds the catalogue entry a request probably already is', () => {
    const catalogue = [
      { id: 'a', name: 'Amoxicillin 500mg Capsule' },
      { id: 'b', name: 'Metformin 500mg Tablet' },
      { id: 'c', name: 'Paracetamol 500mg Tablet' },
    ];
    const hit = findPossibleDuplicate('amoxicillin 250 mg caps', catalogue);
    expect(hit?.item.id).toBe('a');
  });

  it('does not invent a match for something genuinely new', () => {
    const catalogue = [{ id: 'a', name: 'Amoxicillin 500mg Capsule' }];
    expect(findPossibleDuplicate('Semaglutide 0.25mg injection', catalogue)).toBeNull();
  });

  it('is a prompt for a person, not an automatic merge', () => {
    // Two genuinely different medicines that share a word must not score high
    // enough to be treated as the same thing.
    const catalogue = [{ id: 'a', name: 'Sodium Chloride 0.9% Injection' }];
    const hit = findPossibleDuplicate('Sodium Valproate 200mg Tablet', catalogue);
    expect(hit).toBeNull();
  });
});
