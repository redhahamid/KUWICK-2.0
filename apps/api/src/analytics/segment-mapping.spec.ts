import { accumulateSegments, grossProfitCents, marginPercent, segmentFor } from './segment-mapping';

const rules = [
  { id: 'r1', segmentId: 'minor-ot', priority: 10, serviceCatalogId: 'svc-suture' },
  { id: 'r2', segmentId: 'weight-loss', priority: 20, itemId: 'item-semaglutide' },
  { id: 'r3', segmentId: 'ncd', priority: 30, itemCategory: 'Antidiabetic' },
  { id: 'r4', segmentId: 'maternal', priority: 40, descriptionMatch: 'antenatal' },
  { id: 'r5', segmentId: 'outpatient', priority: 999, serviceCategory: 'Consultation' },
];

describe('segment mapping', () => {
  it('matches a service, an item, a category and a description', () => {
    expect(segmentFor(rules, { description: 'Suturing', serviceCatalogId: 'svc-suture' })).toBe('minor-ot');
    expect(segmentFor(rules, { description: 'Wegovy 0.25mg', itemId: 'item-semaglutide' })).toBe('weight-loss');
    expect(segmentFor(rules, { description: 'Metformin', itemCategory: 'Antidiabetic' })).toBe('ncd');
    expect(segmentFor(rules, { description: 'Antenatal review' })).toBe('maternal');
    expect(segmentFor(rules, { description: 'GP consult', serviceCategory: 'Consultation' })).toBe('outpatient');
  });

  it('gives a line to EXACTLY ONE segment — the first match by priority', () => {
    // A semaglutide line whose description also says "antenatal" (nonsense
    // clinically, but the point is the precedence) belongs to weight-loss,
    // because that rule has the lower priority number.
    const line = { description: 'antenatal semaglutide', itemId: 'item-semaglutide' };
    expect(segmentFor(rules, line)).toBe('weight-loss');
  });

  it('is case-insensitive on a description match', () => {
    expect(segmentFor(rules, { description: 'ANTENATAL PACKAGE' })).toBe('maternal');
  });

  it('returns NULL for an unmapped line rather than bucketing it into a default', () => {
    // Revenue nobody has classified is exactly what a clinic needs to see.
    expect(segmentFor(rules, { description: 'Miscellaneous' })).toBeNull();
  });

  it('ignores a rule with no criterion instead of letting it match everything', () => {
    const bad = [{ id: 'r0', segmentId: 'everything', priority: 1 }];
    expect(segmentFor(bad, { description: 'Anything at all' })).toBeNull();
  });

  it('breaks a priority tie deterministically', () => {
    const tied = [
      { id: 'b', segmentId: 'second', priority: 10, descriptionMatch: 'x' },
      { id: 'a', segmentId: 'first', priority: 10, descriptionMatch: 'x' },
    ];
    expect(segmentFor(tied, { description: 'x' })).toBe('first');
    expect(segmentFor([...tied].reverse(), { description: 'x' })).toBe('first');
  });

  describe('accumulation', () => {
    it('never counts a line into two segments, so segment revenue equals total revenue', () => {
      const lines = [
        { invoiceId: 'i1', patientId: 'p1', description: 'Suturing', serviceCatalogId: 'svc-suture', revenueCents: 15000, costCents: 3000 },
        { invoiceId: 'i1', patientId: 'p1', description: 'Wegovy', itemId: 'item-semaglutide', revenueCents: 60000, costCents: 40000 },
        { invoiceId: 'i2', patientId: 'p2', description: 'Something odd', revenueCents: 5000, costCents: 0 },
      ];
      const totals = accumulateSegments(rules, lines);
      const summed = [...totals.values()].reduce((total, bucket) => total + bucket.revenueCents, 0);
      expect(summed).toBe(80000);
      expect(totals.get('minor-ot')!.revenueCents).toBe(15000);
      expect(totals.get('weight-loss')!.revenueCents).toBe(60000);
      // The unclassified line is its own bucket, visible rather than absorbed.
      expect(totals.get(null)!.revenueCents).toBe(5000);
    });

    it('counts distinct invoices and patients rather than lines', () => {
      const lines = [
        { invoiceId: 'i1', patientId: 'p1', description: 'Suturing', serviceCatalogId: 'svc-suture', revenueCents: 100, costCents: 0 },
        { invoiceId: 'i1', patientId: 'p1', description: 'Suturing', serviceCatalogId: 'svc-suture', revenueCents: 100, costCents: 0 },
        { invoiceId: 'i2', patientId: 'p2', description: 'Suturing', serviceCatalogId: 'svc-suture', revenueCents: 100, costCents: 0 },
      ];
      const bucket = accumulateSegments(rules, lines).get('minor-ot')!;
      expect(bucket.lines).toBe(3);
      expect(bucket.invoiceIds.size).toBe(2);
      expect(bucket.patientIds.size).toBe(2);
    });
  });

  describe('profit', () => {
    it('is GROSS, and margin is null rather than infinite on zero revenue', () => {
      expect(grossProfitCents(10000, 4000)).toBe(6000);
      expect(marginPercent(10000, 4000)).toBe(60);
      expect(marginPercent(0, 0)).toBeNull();
    });

    it('reports a loss rather than clamping at zero', () => {
      expect(grossProfitCents(1000, 4000)).toBe(-3000);
      expect(marginPercent(1000, 4000)).toBe(-300);
    });
  });
});
