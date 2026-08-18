import {
  DISPENSED_WHOLE_TOKEN,
  INVENTORY_CSV_COLUMNS,
  inventoryCsvTemplate,
  parseInventoryCsv,
} from './inventory-csv';

// ===========================================================================
// THE ONBOARDING PATH.
//
// 149 of 242 medicines need a person to state a divisor. One at a time
// through the form is 149 form opens; in a spreadsheet it is an afternoon.
// The risk that comes with the spreadsheet is somebody filling 1 down a
// column of 128 rows, which is why the quantity column takes a WORD.
// ===========================================================================

const HEADER = INVENTORY_CSV_COLUMNS.map((column) => column.header).join(',');

function csv(...rows: Array<Record<string, string>>): string {
  const lines = rows.map((row) =>
    INVENTORY_CSV_COLUMNS.map((column) => row[column.header] ?? '').join(','),
  );
  return [HEADER, ...lines].join('\n');
}

const MINIMAL = { Name: 'Paracetamol 500mg', 'Price to Patient (RM)': '0.20' };

describe('the template teaches the format', () => {
  it('carries every column the form has', () => {
    const [header] = inventoryCsvTemplate().split('\n');
    expect(header).toBe(HEADER);
  });

  it('shows the DISPENSED_WHOLE case, which nobody would guess', () => {
    // The row that makes D1 usable in a spreadsheet at all.
    expect(inventoryCsvTemplate()).toContain(DISPENSED_WHOLE_TOKEN);
  });

  it('shows a real medicine rather than "Item 1"', () => {
    expect(inventoryCsvTemplate()).toContain('Paracetamol 500mg');
  });
});

describe('a row is all-or-nothing', () => {
  it('imports a clean row', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, Category: 'Medication', 'Cost (RM)': '0.08' }));
    expect(result.problems).toEqual([]);
    expect(result.rows[0]).toMatchObject({ name: 'Paracetamol 500mg', sellPrice: 0.2, cost: 0.08 });
  });

  it('drops the WHOLE row when one cell is wrong, not just that cell', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Cost (RM)': 'about a dollar' }));
    expect(result.rows).toHaveLength(0);
    expect(result.problems).toHaveLength(1);
  });

  it('keeps counting lines the way the spreadsheet does — header is line 1', () => {
    const result = parseInventoryCsv(csv(MINIMAL, { ...MINIMAL, Name: 'Amoxil', 'Cost (RM)': 'x' }));
    expect(result.problems[0].line).toBe(3);
  });

  it('reports EVERY problem in a row, so one upload fixes the file', () => {
    const result = parseInventoryCsv(
      csv({ Name: '', 'Price to Patient (RM)': '', 'Duration Unit': 'FORTNIGHT' }),
    );
    expect(result.problems.map((problem) => problem.column).sort()).toEqual([
      'Duration Unit',
      'Name',
      'Price to Patient (RM)',
    ]);
  });
});

describe('required fields', () => {
  it('needs a name', () => {
    const result = parseInventoryCsv(csv({ 'Price to Patient (RM)': '1' }));
    expect(result.problems[0]).toMatchObject({ column: 'Name', message: 'A name is required.' });
  });

  it('needs a price to the patient, and says so rather than assuming zero', () => {
    // A medicine imported at RM 0.00 is one the clinic gives away without
    // noticing. Blank is not zero.
    const result = parseInventoryCsv(csv({ Name: 'Amoxil' }));
    expect(result.problems[0].column).toBe('Price to Patient (RM)');
  });

  it('refuses a price that is not a number, quoting what was written', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Price to Patient (RM)': 'RM4.50' }));
    expect(result.problems[0].message).toContain('"RM4.50"');
  });

  it('refuses the same medicine twice and names the other line', () => {
    // One would import and the other would overwrite it, and the clinic would
    // never learn which won.
    const result = parseInventoryCsv(csv(MINIMAL, MINIMAL));
    expect(result.problems[0].message).toContain('also on line 2');
  });
});

describe('D1 in a spreadsheet', () => {
  it('reads DISPENSED_WHOLE as the declaration, with a divisor of 1', () => {
    const result = parseInventoryCsv(
      csv({ ...MINIMAL, 'Quantity per Stock Unit': DISPENSED_WHOLE_TOKEN }),
    );
    expect(result.rows[0]).toMatchObject({ dispensedWhole: true, quantityPerStockUnit: 1 });
  });

  it('accepts the spellings a person actually types', () => {
    for (const spelling of ['dispensed whole', 'Dispensed-Whole', 'DISPENSED_WHOLE']) {
      const result = parseInventoryCsv(csv({ ...MINIMAL, 'Quantity per Stock Unit': spelling }));
      expect(result.rows[0].dispensedWhole).toBe(true);
    }
  });

  it('reads a bare 1 as a NUMBER, not as the declaration', () => {
    // The whole point of the word. A 1 typed into a column is not somebody
    // saying the bottle goes over the counter whole.
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Quantity per Stock Unit': '1' }));
    expect(result.rows[0]).toMatchObject({ quantityPerStockUnit: 1, dispensedWhole: false });
  });

  it('imports a blank divisor and COUNTS it rather than refusing the row', () => {
    // Refusing would keep the medicine out of the catalogue entirely to
    // protect a number that is already missing on 149 rows.
    const result = parseInventoryCsv(csv(MINIMAL));
    expect(result.rows[0].quantityPerStockUnit).toBeNull();
    expect(result.needsAttention).toBe(1);
    expect(result.problems).toEqual([]);
  });

  it('refuses a divisor that is not a count, and names the alternative', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Quantity per Stock Unit': 'a box' }));
    expect(result.problems[0].message).toContain(DISPENSED_WHOLE_TOKEN);
  });

  it('refuses zero and fractions — neither is a number of things in a pack', () => {
    expect(parseInventoryCsv(csv({ ...MINIMAL, 'Quantity per Stock Unit': '0' })).problems).toHaveLength(1);
    expect(parseInventoryCsv(csv({ ...MINIMAL, 'Quantity per Stock Unit': '2.5' })).problems).toHaveLength(1);
  });
});

describe('yes and no, as a spreadsheet writes them', () => {
  it.each([
    ['YES', true],
    ['y', true],
    ['TRUE', true],
    ['1', true],
    ['NO', false],
    ['n', false],
    ['FALSE', false],
    ['0', false],
  ])('reads %s', (written, expected) => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, Active: written }));
    expect(result.rows[0].active).toBe(expected);
  });

  it('leaves a blank flag alone rather than reading it as no', () => {
    // A blank in a 200-row template is "I did not fill this in". Reading it as
    // no would switch off expiry tracking across the catalogue.
    expect(parseInventoryCsv(csv(MINIMAL)).rows[0].tracksBatchExpiry).toBeUndefined();
  });

  it('REFUSES a word it does not know rather than guessing', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Track Batch & Expiry': 'sometimes' }));
    expect(result.problems[0].message).toContain('is not yes or no');
  });
});

describe('blank means "leave it alone"', () => {
  it('produces no value at all for an empty cell', () => {
    const row = parseInventoryCsv(csv(MINIMAL)).rows[0];
    expect(row.category).toBeUndefined();
    expect(row.remark).toBeUndefined();
    expect(row.cost).toBeUndefined();
  });

  it('ignores a row that is entirely empty', () => {
    const result = parseInventoryCsv(`${HEADER}\n${',,,,,,,,,,,,,,,,,,,,'}\n`);
    expect(result.rows).toHaveLength(0);
    expect(result.problems).toHaveLength(0);
  });
});

describe('duration', () => {
  it('takes the three units the model has', () => {
    for (const unit of ['DAY', 'week', 'Month']) {
      const result = parseInventoryCsv(csv({ ...MINIMAL, 'Duration Unit': unit }));
      expect(result.problems).toEqual([]);
      expect(result.rows[0].durationUnit).toBe(unit.toUpperCase());
    }
  });

  it('names the three when given a fourth', () => {
    const result = parseInventoryCsv(csv({ ...MINIMAL, 'Duration Unit': 'FORTNIGHT' }));
    expect(result.problems[0].message).toContain('DAY, WEEK, MONTH');
  });
});
