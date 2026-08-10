import {
  cleanMedicationName,
  isCashOnly,
  parseCsv,
  parseDiagnosisRow,
  parseExpiry,
  parseMedicationRow,
  parseMoney,
  parseStock,
  parseUnitsPerPack,
} from './seed-import';

// ===========================================================================
// KW2-Q3 — reading the clinic's own exports.
//
// PRESERVE, THEN PRESENT. Everything cleaned for display keeps its original,
// and nothing is invented where the source is silent.
// ===========================================================================

describe('medicine names', () => {
  it('strips the sort-order prefix the clinic uses', () => {
    expect(cleanMedicationName('##***T. YASMIN 3MG')).toBe('T. YASMIN 3MG');
    expect(cleanMedicationName('***ARM SLING ADULT')).toBe('ARM SLING ADULT');
    expect(cleanMedicationName('## CR. SALICYLIC (ELLGY PLUS) 10ML')).toBe(
      'CR. SALICYLIC (ELLGY PLUS) 10ML',
    );
  });

  it('leaves an ordinary name alone', () => {
    expect(cleanMedicationName('T. PCM 500MG (AXCEL)')).toBe('T. PCM 500MG (AXCEL)');
  });

  it('KEEPS "(CASH ONLY)" visible as well as flagging it', () => {
    // It is a real commercial condition the counter needs at the moment of
    // prescribing. Moving it into a boolean the form might not render would
    // quietly lose it.
    const raw = '##***PATCH HERBA COUGH (CASH ONLY)';
    expect(cleanMedicationName(raw)).toContain('(CASH ONLY)');
    expect(isCashOnly(raw)).toBe(true);
  });

  it('does not flag an ordinary medicine as cash only', () => {
    expect(isCashOnly('T. PCM 500MG (AXCEL)')).toBe(false);
  });

  it('never strips a leading letter or digit that is part of the name', () => {
    expect(cleanMedicationName('5FU CREAM')).toBe('5FU CREAM');
  });
});

describe('packaging', () => {
  it('parses the leading count where the source states one', () => {
    expect(parseUnitsPerPack('10 BIJI / STRIP')).toBe(10);
    expect(parseUnitsPerPack('7 SHEETS / PACK')).toBe(7);
    expect(parseUnitsPerPack('6 PATCH/BOX')).toBe(6);
    expect(parseUnitsPerPack('21 BIJI / STRIP')).toBe(21);
  });

  it('returns NULL where there is no leading count', () => {
    // "Guessing 1" would be a quantity the clinic never stated, and every
    // pack-count division downstream would inherit the guess.
    for (const raw of ['Box', 'BOTTLE', 'Amp', 'Dose', '-', 'Tube', 'BIJI', 'PEN']) {
      expect(parseUnitsPerPack(raw)).toBeNull();
    }
    expect(parseUnitsPerPack(null)).toBeNull();
    expect(parseUnitsPerPack('')).toBeNull();
  });

  it('does not reach past the front for a number', () => {
    // "PLASTIC/6 SACHET" — the 6 is not the leading count, and reading it
    // would be a guess about which of "plastic" and "sachet" is the pack.
    expect(parseUnitsPerPack('PLASTIC/6 SACHET')).toBeNull();
    expect(parseUnitsPerPack('20TAB/2STRIP/PLASTIC')).toBe(20);
  });
});

describe('dates and money', () => {
  it('reads the export’s day-first dates', () => {
    const date = parseExpiry('01/06/2029');
    expect(date?.toISOString().slice(0, 10)).toBe('2029-06-01');
    expect(parseExpiry('29/02/2028')?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('refuses an impossible date rather than rolling it forward', () => {
    // new Date(2029, 1, 31) silently becomes 3 March. That would record an
    // expiry the clinic never wrote.
    expect(parseExpiry('31/02/2029')).toBeNull();
  });

  it('a blank expiry is absent, not epoch', () => {
    expect(parseExpiry('')).toBeNull();
    expect(parseExpiry(null)).toBeNull();
  });

  it('a blank price is "not stated", which is not zero', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('12.7714')).toBe(12.7714);
  });
});

describe('stock', () => {
  it('reads the balance', () => {
    expect(parseStock('83')).toBe(83);
    expect(parseStock('0')).toBe(0);
  });

  it('floors the export’s negative balances at zero', () => {
    // A negative stock balance is a counting error in the source, not a fact
    // about the shelf, and seeding it would make every downstream sum wrong.
    expect(parseStock('-1')).toBe(0);
  });

  it('treats an unreadable balance as none rather than throwing', () => {
    expect(parseStock('')).toBe(0);
    expect(parseStock('n/a')).toBe(0);
  });
});

describe('a whole medication row', () => {
  const row = {
    id: '118',
    category: 'Medication',
    name: '##***PATCH HERBA COUGH (CASH ONLY)',
    group: 'BATUK',
    cost_price: '12.7714',
    price_to_patient: '33',
    stock_balance: '39',
    stock_unit: '6 PATCH/BOX',
    earliest_expiry: '06/03/2029',
    status: 'Active',
  };

  it('keeps the source id, the source name and the clean name', () => {
    const parsed = parseMedicationRow(row)!;
    expect(parsed.externalRef).toBe('118');
    expect(parsed.sourceName).toBe('##***PATCH HERBA COUGH (CASH ONLY)');
    expect(parsed.name).toBe('PATCH HERBA COUGH (CASH ONLY)');
  });

  it('carries the Malay group through as a searchable tag', () => {
    expect(parseMedicationRow(row)!.groupTag).toBe('BATUK');
  });

  it('reads price, cost, stock, packaging and expiry', () => {
    const parsed = parseMedicationRow(row)!;
    expect(parsed.sellPrice).toBe(33);
    expect(parsed.cost).toBe(12.7714);
    expect(parsed.stockBalance).toBe(39);
    expect(parsed.packDescription).toBe('6 PATCH/BOX');
    expect(parsed.unitsPerPack).toBe(6);
    expect(parsed.cashOnly).toBe(true);
  });

  it('an ungrouped row has no tag rather than an empty one', () => {
    expect(parseMedicationRow({ ...row, group: '' })!.groupTag).toBeNull();
  });

  it('an inactive row is IMPORTED, not skipped', () => {
    // It still appears in Settings, and a visit from before it was retired
    // still has to render its name.
    const parsed = parseMedicationRow({ ...row, status: 'Inactive' })!;
    expect(parsed).not.toBeNull();
    expect(parsed.active).toBe(false);
  });

  it('a row with no price to the patient is refused', () => {
    // Importing it at 0 would silently give the medicine away.
    expect(parseMedicationRow({ ...row, price_to_patient: '' })).toBeNull();
  });

  it('a row with no id or no name is refused', () => {
    expect(parseMedicationRow({ ...row, id: '' })).toBeNull();
    expect(parseMedicationRow({ ...row, name: '' })).toBeNull();
  });
});

describe('a diagnosis row', () => {
  it('keeps code, full name and shortform', () => {
    expect(parseDiagnosisRow({ icd10_code: 'J06.9', name: 'Acute upper respiratory infection', shortform: 'URTI' })).toEqual(
      { icd10Code: 'J06.9', name: 'Acute upper respiratory infection', shortform: 'URTI' },
    );
  });

  it('a missing shortform is null, not an empty string', () => {
    expect(parseDiagnosisRow({ icd10_code: 'R05', name: 'Cough', shortform: '' })?.shortform).toBeNull();
  });

  it('a row with no code is refused — the visit stores the code', () => {
    expect(parseDiagnosisRow({ icd10_code: '', name: 'Cough', shortform: 'Cough' })).toBeNull();
  });
});

describe('the CSV reader', () => {
  it('handles a quoted field containing a comma', () => {
    const rows = parseCsv('id,group\n215,"ANTI RADANG, ANTIFUNGAL"\n');
    expect(rows).toEqual([{ id: '215', group: 'ANTI RADANG, ANTIFUNGAL' }]);
  });

  it('handles a quoted name containing a comma', () => {
    const rows = parseCsv('name\n"***T. VITAMIN B1, B6, B12 (NEUROBINE)"\n');
    expect(rows[0].name).toBe('***T. VITAMIN B1, B6, B12 (NEUROBINE)');
  });

  it('skips blank trailing lines', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('tolerates a row with fewer cells than the header', () => {
    expect(parseCsv('a,b,c\n1,2\n')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});
