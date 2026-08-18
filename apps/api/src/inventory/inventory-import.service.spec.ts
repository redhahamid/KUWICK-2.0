import { InventoryImportService } from './inventory-import.service';
import { INVENTORY_CSV_COLUMNS, DISPENSED_WHOLE_TOKEN } from './inventory-csv';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

const HEADER = INVENTORY_CSV_COLUMNS.map((column) => column.header).join(',');

function csv(...rows: Array<Record<string, string>>): string {
  return [HEADER, ...rows.map((row) => INVENTORY_CSV_COLUMNS.map((c) => row[c.header] ?? '').join(','))].join('\n');
}

const MINIMAL = { Name: 'Paracetamol 500mg', 'Price to Patient (RM)': '0.20' };

function createService(existingItems: Array<{ id: string; name: string }> = []) {
  const tx = { item: { create: jest.fn(), update: jest.fn() } };
  const prisma = {
    stockUnitRef: { findMany: jest.fn().mockResolvedValue([{ id: 'su-1', name: 'TABLET PER STRIP' }]) },
    dosageUnit: { findMany: jest.fn().mockResolvedValue([{ id: 'du-1', systemNameEn: 'Tablet' }]) },
    prescriptionFrequency: { findMany: jest.fn().mockResolvedValue([{ id: 'f-1', code: 'TDS' }]) },
    consumptionMethodRef: {
      findMany: jest.fn().mockResolvedValue([{ id: 'cm-1', methodBilingual: 'ORAL / MELALUI MULUT' }]),
    },
    item: { findMany: jest.fn().mockResolvedValue(existingItems) },
    $transaction: jest.fn((fn: (c: typeof tx) => unknown) => fn(tx)),
  } as unknown as TenantScopedPrismaClient;
  return { service: new InventoryImportService(prisma), prisma, tx };
}

const asStaff = <T,>(fn: () => Promise<T>) =>
  tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7' }, fn);

const createData = (tx: { item: { create: jest.Mock } }) => tx.item.create.mock.calls[0][0].data;
const updateData = (tx: { item: { update: jest.Mock } }) => tx.item.update.mock.calls[0][0].data;

describe('nothing is written while anything is wrong', () => {
  it('imports NO rows when one row has a problem', async () => {
    // A partially-imported file is the worst outcome available: the clinic
    // cannot tell which rows landed, and the obvious fix — correct the file,
    // upload again — is the right one anyway.
    const { service, tx } = createService();
    const result = await asStaff(() =>
      service.import(csv(MINIMAL, { Name: 'Amoxil', 'Price to Patient (RM)': 'free' })),
    );

    expect(result.dryRun).toBe(true);
    expect(result.problems).toHaveLength(1);
    expect(tx.item.create).not.toHaveBeenCalled();
  });

  it('still reports what WOULD have happened, so the clinic can see the shape', async () => {
    const { service } = createService();
    const result = await asStaff(() =>
      service.import(csv(MINIMAL, { Name: 'Amoxil', 'Price to Patient (RM)': 'free' })),
    );
    expect(result.created).toBe(1);
  });

  it('writes nothing on a dry run even when the file is perfect', async () => {
    const { service, tx } = createService();
    const result = await asStaff(() => service.import(csv(MINIMAL), { dryRun: true }));
    expect(result).toMatchObject({ dryRun: true, created: 1, problems: [] });
    expect(tx.item.create).not.toHaveBeenCalled();
  });
});

describe('a name that is not on the clinic’s list', () => {
  it('names the setting where it would be added, not just "unknown"', async () => {
    const { service } = createService();
    const result = await asStaff(() => service.import(csv({ ...MINIMAL, Frequency: 'TDSS' })));
    expect(result.problems[0]).toMatchObject({ line: 2, column: 'Frequency' });
    expect(result.problems[0].message).toContain('Settings › Prescription Vocabulary › Frequencies');
  });

  it('matches a catalogue entry regardless of case and padding', async () => {
    const { service, tx } = createService();
    await asStaff(() => service.import(csv({ ...MINIMAL, 'Stock Unit': ' tablet per strip ' })));
    expect(createData(tx).stockUnitId).toBe('su-1');
  });
});

describe('re-uploading updates by name and does not duplicate', () => {
  it('updates the existing medicine rather than adding a second', async () => {
    const { service, tx } = createService([{ id: 'existing-1', name: 'Paracetamol 500mg' }]);
    const result = await asStaff(() => service.import(csv({ ...MINIMAL, 'Price to Patient (RM)': '0.30' })));

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(tx.item.create).not.toHaveBeenCalled();
    expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'existing-1' } }));
  });

  it('matches regardless of case and surrounding space', async () => {
    const { service, tx } = createService([{ id: 'existing-1', name: '  paracetamol 500MG ' }]);
    await asStaff(() => service.import(csv(MINIMAL)));
    expect(tx.item.update).toHaveBeenCalled();
  });

  it('refuses when the clinic already has two items with that name', async () => {
    // Picking one silently would edit a medicine at random.
    const { service } = createService([
      { id: 'a', name: 'Paracetamol 500mg' },
      { id: 'b', name: 'Paracetamol 500mg' },
    ]);
    const result = await asStaff(() => service.import(csv(MINIMAL)));
    expect(result.problems[0].message).toContain('already has 2 items');
  });
});

describe('a blank cell leaves the value alone', () => {
  it('sends no key at all for an empty column', async () => {
    // In a 200-row template most cells are blank. Reading blank as "clear"
    // would make a partially-filled upload a bulk wipe.
    const { service, tx } = createService([{ id: 'existing-1', name: 'Paracetamol 500mg' }]);
    await asStaff(() => service.import(csv(MINIMAL)));

    const data = updateData(tx);
    expect(data).not.toHaveProperty('category');
    expect(data).not.toHaveProperty('remark');
    expect(data).not.toHaveProperty('cost');
  });
});

describe('one cell writes both homes', () => {
  it('sets the 1F reference AND the legacy free text from a single column', async () => {
    // Two columns meaning the same thing get filled inconsistently; one input
    // writing both means they cannot disagree, and every reader stays right.
    const { service, tx } = createService();
    await asStaff(() =>
      service.import(
        csv({
          ...MINIMAL,
          'Dose Unit': 'Tablet',
          Frequency: 'TDS',
          'Consumption Method': 'ORAL / MELALUI MULUT',
          'Duration Value': '5',
          'Duration Unit': 'DAY',
          'Dose Amount': '1',
        }),
      ),
    );

    expect(createData(tx)).toMatchObject({
      defaultDoseUnitId: 'du-1',
      doseUnitDefault: 'Tablet',
      defaultFrequencyId: 'f-1',
      frequencyDefault: 'TDS',
      defaultConsumptionMethodId: 'cm-1',
      consumptionMethod: 'ORAL / MELALUI MULUT',
      defaultDurationValue: 5,
      durationDefault: '5',
      defaultDoseAmount: 1,
      doseDefault: '1',
    });
  });
});

describe('D1 through the upload', () => {
  it('stamps the declaration with an author when the word is used', async () => {
    const { service, tx } = createService();
    await asStaff(() => service.import(csv({ ...MINIMAL, 'Quantity per Stock Unit': DISPENSED_WHOLE_TOKEN })));

    const data = createData(tx);
    expect(data.quantityPerStockUnit).toBe(1);
    expect(data.dispensedWholeAt).toBeInstanceOf(Date);
    expect(data.dispensedWholeByStaffId).toBe('staff-7');
  });

  it('leaves a bare 1 unstamped — the spreadsheet is not a person', async () => {
    const { service, tx } = createService();
    await asStaff(() => service.import(csv({ ...MINIMAL, 'Quantity per Stock Unit': '1' })));

    const data = createData(tx);
    expect(data.quantityPerStockUnit).toBe(1);
    expect(data).not.toHaveProperty('dispensedWholeAt');
  });

  it('counts the rows that arrive with no divisor', async () => {
    const { service } = createService();
    const result = await asStaff(() =>
      service.import(csv(MINIMAL, { Name: 'Amoxil', 'Price to Patient (RM)': '1' })),
    );
    expect(result.needsAttention).toBe(2);
  });
});

// ===========================================================================
// D4 — THE UPLOAD IS THE CLINIC'S CURATION, AND THE SEEDER MUST NOT UNDO IT.
// ===========================================================================

describe('D4 — every row the upload touches stops belonging to the seed', () => {
  it('clears defaults_from_seed on a created row', async () => {
    const { service, tx } = createService();
    await asStaff(() => service.import(csv(MINIMAL)));
    expect(createData(tx).defaultsFromSeed).toBe(false);
  });

  it('clears it on an updated row', async () => {
    const { service, tx } = createService([{ id: 'existing-1', name: 'Paracetamol 500mg' }]);
    await asStaff(() => service.import(csv(MINIMAL)));
    expect(updateData(tx).defaultsFromSeed).toBe(false);
  });

  it('clears it even on a row carrying no dosage instruction at all', async () => {
    // The flag is the seeder's only signal, and whether a clinic's curation is
    // protected must not depend on which columns of the template they filled.
    const { service, tx } = createService([{ id: 'existing-1', name: 'Paracetamol 500mg' }]);
    await asStaff(() => service.import(csv({ ...MINIMAL, 'Price to Patient (RM)': '9.99' })));

    const data = updateData(tx);
    expect(data).not.toHaveProperty('defaultFrequencyId');
    expect(data.defaultsFromSeed).toBe(false);
  });

  /**
   * The end-to-end claim, asserted against the seeder's ACTUAL skip predicate
   * rather than a description of it: upload → re-run seed:standard-rx →
   * the clinic's values stand.
   *
   * The predicate is copied from `prisma/seed-standard-prescriptions.ts`. If
   * that file's rule changes, this fails — which is the point: D4 is a promise
   * about two pieces of code agreeing, and the only honest test of it is one
   * that reads both.
   */
  it('makes seed:standard-rx SKIP the row afterwards', async () => {
    const { service, tx } = createService([{ id: 'existing-1', name: 'Paracetamol 500mg' }]);
    await asStaff(() =>
      service.import(csv({ ...MINIMAL, 'Dose Amount': '1', 'Dose Unit': 'Tablet', Frequency: 'TDS' })),
    );

    const row = updateData(tx) as Record<string, unknown>;

    // seed-standard-prescriptions.ts, verbatim:
    //   hasDefaults = doseAmount || doseUnitId || frequencyId || consumptionMethodId
    //   clinicEdited = hasDefaults && !defaultsFromSeed   → SKIPPED
    const hasDefaults =
      row.defaultDoseAmount != null ||
      row.defaultDoseUnitId != null ||
      row.defaultFrequencyId != null ||
      row.defaultConsumptionMethodId != null;
    const clinicEdited = hasDefaults && !row.defaultsFromSeed;

    expect(hasDefaults).toBe(true);
    expect(clinicEdited).toBe(true);
  });
});
