import { CatalogueSourceRow, catalogueCategories, catalogueCounts, catalogueRow } from './item-catalogue';

const base: CatalogueSourceRow = {
  id: 'i1',
  code: 'MED-1',
  name: 'Paracetamol 500mg',
  category: 'Medication',
  active: true,
  sellPrice: '4.50',
  cost: '1.20',
  earliestExpiry: null,
  quantityPerStockUnit: null,
  unitsPerPack: null,
  dispensedWholeAt: null,
  packDescription: '10 BIJI / STRIP',
  stockUnit: null,
  stockLevels: [],
};

const row = (over: Partial<CatalogueSourceRow> = {}) => catalogueRow({ ...base, ...over });

describe('the balance, and whose it is', () => {
  it('sums every branch when no clinic is named', () => {
    const result = row({
      stockLevels: [
        { clinicId: 'a', quantityOnHand: 40, minThreshold: 0 },
        { clinicId: 'b', quantityOnHand: 59, minThreshold: 0 },
      ],
    });
    expect(result.quantityOnHand).toBe(99);
  });

  it('shows one branch when one is named', () => {
    const result = catalogueRow(
      {
        ...base,
        stockLevels: [
          { clinicId: 'a', quantityOnHand: 40, minThreshold: 0 },
          { clinicId: 'b', quantityOnHand: 59, minThreshold: 0 },
        ],
      },
      'b',
    );
    expect(result.quantityOnHand).toBe(59);
  });

  it('flags low stock when ANY branch is under, not when the sum looks healthy', () => {
    // The reading that sends nobody to reorder: 200 in total, and the branch
    // the patient is standing in has two left.
    const result = row({
      stockLevels: [
        { clinicId: 'a', quantityOnHand: 198, minThreshold: 10 },
        { clinicId: 'b', quantityOnHand: 2, minThreshold: 10 },
      ],
    });
    expect(result.quantityOnHand).toBe(200);
    expect(result.belowThreshold).toBe(true);
  });

  it('does not flag a branch that has set no threshold', () => {
    expect(row({ stockLevels: [{ clinicId: 'a', quantityOnHand: 0, minThreshold: 0 }] }).belowThreshold).toBe(false);
  });
});

describe('money and dates leave as they were stored', () => {
  it('keeps prices as strings — Decimal(10,2) all the way out', () => {
    const result = row({ sellPrice: '4.50', cost: null });
    expect(result.sellPrice).toBe('4.50');
    expect(result.cost).toBeNull();
  });

  it('renders expiry as a plain date, not a timestamp', () => {
    expect(row({ earliestExpiry: new Date('2027-03-31T00:00:00.000Z') }).earliestExpiry).toBe('2027-03-31');
  });
});

describe('the row carries its divisor and where it came from', () => {
  it('marks a divisorless row for attention and says nothing about a number', () => {
    const result = row();
    expect(result).toMatchObject({ divisor: null, divisorSource: 'NONE', attention: 'NO_DIVISOR' });
  });

  it('carries a declared whole through as settled', () => {
    const result = row({ quantityPerStockUnit: 1, dispensedWholeAt: new Date('2026-08-18') });
    expect(result).toMatchObject({ divisor: 1, dispensedWhole: true, attention: null });
  });
});

describe('the worklist count', () => {
  const rows = [
    row(),                                                        // no divisor    → counted
    row({ quantityPerStockUnit: 10 }),                            // priced        → not
    row({ unitsPerPack: 1 }),                                     // bare 1        → counted
    row({ active: false }),                                       // deactivated   → not
  ];

  it('counts unpriced ACTIVE rows only — a deactivated item is not outstanding work', () => {
    expect(catalogueCounts(rows)).toEqual({ items: 4, needsAttention: 2 });
  });
});

describe('the category tabs', () => {
  it('unions the registry with the strings actually on items', () => {
    const result = catalogueCategories(
      [
        { id: 'c1', name: 'Medication', sortOrder: 0 },
        { id: 'c2', name: 'Vaccine', sortOrder: 1 },
      ],
      ['Medication', 'Medication', 'Item'],
    );
    expect(result).toEqual([
      { id: 'c1', name: 'Medication', count: 2, registered: true },
      // Named and not yet filled. Dropping it makes "add a category" look broken.
      { id: 'c2', name: 'Vaccine', count: 0, registered: true },
      // Arrived on an imported row and never registered. Hiding it hides stock.
      { id: null, name: 'Item', count: 1, registered: false },
    ]);
  });

  it('ignores blank and whitespace-only categories, and trims the rest', () => {
    const result = catalogueCategories([], [null, '', '   ', '  Medication  ', 'Medication']);
    expect(result).toEqual([{ id: null, name: 'Medication', count: 2, registered: false }]);
  });

  it('keeps the clinic’s own arrangement, then falls back to alphabetical', () => {
    const result = catalogueCategories(
      [
        { id: 'c1', name: 'Zinc', sortOrder: 0 },
        { id: 'c2', name: 'Antibiotik', sortOrder: 1 },
      ],
      ['Batuk', 'Demam'],
    );
    expect(result.map((c) => c.name)).toEqual(['Zinc', 'Antibiotik', 'Batuk', 'Demam']);
  });
});
