import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReferenceCatalogService, isReferenceCatalog } from './reference-catalog.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import {
  SEED_CONSUMPTION_METHODS,
  SEED_DOSAGE_UNITS,
  SEED_FREQUENCIES,
  SEED_INDICATIONS,
  SEED_STOCK_UNITS,
  SEED_STOCK_UNIT_MALAY,
} from './prescription-reference-seed';

// ===========================================================================
// b1 PHASE 1 — THE PLATFORM'S ROWS ARE THE PLATFORM'S.
//
// The clinic's channel is this API and it refuses SYSTEM rows; the platform's
// channel is the seeder. The tests that matter are the refusals, and the ones
// that prove a clinic cannot dress its own row up as a platform row.
// ===========================================================================

const TENANT = 'tenant-1';

function createService(row: Record<string, unknown> | null = null) {
  const delegate = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockImplementation(async (args: { data: unknown }) => args.data),
    update: jest.fn().mockImplementation(async (args: { data: unknown }) => args.data),
  });
  const prisma = {
    prescriptionFrequency: delegate(),
    dosageUnit: delegate(),
    consumptionMethodRef: delegate(),
    indicationPreset: delegate(),
    stockUnitRef: delegate(),
  };
  return {
    service: new ReferenceCatalogService(prisma as unknown as TenantScopedPrismaClient),
    prisma,
  };
}

const withTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId: TENANT, staffId: 'staff-1' }, fn);

const SYSTEM_ROW = { id: 'row-1', tenantId: TENANT, origin: 'SYSTEM', active: true };
const CUSTOM_ROW = { id: 'row-2', tenantId: TENANT, origin: 'CUSTOM', active: true };

describe('the seeded vocabulary is complete and shaped as specified', () => {
  it('every catalogue is seeded, at the counts the owner listed', () => {
    expect(SEED_FREQUENCIES).toHaveLength(7);
    expect(SEED_DOSAGE_UNITS).toHaveLength(12);
    expect(SEED_CONSUMPTION_METHODS).toHaveLength(19);
    expect(SEED_INDICATIONS).toHaveLength(47);
    expect(SEED_STOCK_UNITS).toHaveLength(13);
  });

  it('PRN and STAT carry NO daily count, and every other frequency does', () => {
    // The load-bearing one. `timesPerDay` drives quantity auto-compute, and a
    // when-required painkiller given a count of 1 produces a quantity nobody
    // decided — so the absence has to survive in the data.
    const byCode = new Map(SEED_FREQUENCIES.map((f) => [f.code, f.timesPerDay]));
    expect(byCode.get('PRN')).toBeNull();
    expect(byCode.get('STAT')).toBeNull();
    expect(byCode.get('OD')).toBe(1);
    expect(byCode.get('BD')).toBe(2);
    expect(byCode.get('TDS')).toBe(3);
    expect(byCode.get('QID')).toBe(4);
    expect(byCode.get('ON')).toBe(1);
  });

  it('every frequency has a Malay patient label, because the label prints it', () => {
    for (const frequency of SEED_FREQUENCIES) {
      expect(frequency.patientLabelBm.trim().length).toBeGreaterThan(0);
      // And it is not just the code echoed back — that would print "OD (OD)".
      expect(frequency.patientLabelBm).not.toBe(frequency.code);
    }
  });

  it('every consumption method carries the instruction that prints for it', () => {
    // A route with no instruction leaves the patient to guess, which is the
    // whole reason this catalogue exists rather than a plain enum.
    for (const method of SEED_CONSUMPTION_METHODS) {
      expect(method.patientInstructionBm.trim().length).toBeGreaterThan(0);
    }
  });

  it('four different English units share the Malay label BIJI, on purpose', () => {
    // A patient counts pieces. Tablet, capsule, lozenge and suppository are the
    // system's distinctions, not the patient's.
    const biji = SEED_DOSAGE_UNITS.filter((u) => u.patientLabelBm === 'BIJI').map((u) => u.systemNameEn);
    expect(biji).toEqual(['Tablet', 'Capsule', 'Lozenge', 'Suppository']);
  });

  it('every indication is bilingual — one language would defeat the point', () => {
    for (const indication of SEED_INDICATIONS) {
      expect(indication.labelEn.trim().length).toBeGreaterThan(0);
      expect(indication.labelBm.trim().length).toBeGreaterThan(0);
    }
  });

  it('no catalogue has duplicate natural keys', () => {
    const unique = (values: string[]) => expect(new Set(values).size).toBe(values.length);
    unique(SEED_FREQUENCIES.map((f) => f.code));
    unique(SEED_DOSAGE_UNITS.map((u) => u.systemNameEn));
    unique(SEED_CONSUMPTION_METHODS.map((m) => m.methodBilingual));
    unique(SEED_INDICATIONS.map((i) => i.labelEn));
    unique(SEED_STOCK_UNITS);
  });

  // INVENTORY PIECE 1 — the shelf is read in two languages, and the Malay half
  // lives in a map beside the list rather than on it. That is the drift this
  // closes: a unit added to one and not the other would render "99 Strip / "
  // with nothing after the slash on the screen the stock staff actually use.
  it('every seeded stock unit has a Malay label, and nothing else does', () => {
    expect(Object.keys(SEED_STOCK_UNIT_MALAY).sort()).toEqual([...SEED_STOCK_UNITS].sort());
    for (const [en, ms] of Object.entries(SEED_STOCK_UNIT_MALAY)) {
      expect(ms.trim()).not.toBe('');
      // VIAL is VIAL in both languages; everything else is a real translation
      // rather than the English word copied across to fill the column.
      if (en !== 'VIAL') expect(ms).not.toBe(en);
    }
  });
});

describe('SYSTEM rows are immutable through the API', () => {
  it.each(['frequencies', 'dosage-units', 'consumption-methods', 'indications', 'stock-units'] as const)(
    'refuses to edit a SYSTEM row in %s',
    async (catalog) => {
      const { service } = createService(SYSTEM_ROW);
      await expect(withTenant(() => service.update(catalog, 'row-1', { labelBm: 'x', patientLabelBm: 'x', name: 'x' })))
        .rejects.toThrow(ForbiddenException);
    },
  );

  it.each(['frequencies', 'dosage-units', 'consumption-methods', 'indications', 'stock-units'] as const)(
    'refuses to retire a SYSTEM row in %s',
    async (catalog) => {
      const { service } = createService(SYSTEM_ROW);
      await expect(withTenant(() => service.setActive(catalog, 'row-1', false))).rejects.toThrow(ForbiddenException);
    },
  );

  it('the refusal explains what to do instead, and blames nobody', async () => {
    const { service } = createService(SYSTEM_ROW);
    await expect(withTenant(() => service.setActive('frequencies', 'row-1', false))).rejects.toThrow(
      /standard entry provided with Kuwick.*Add your own entry instead/,
    );
  });

  it('a CUSTOM row IS editable — the lock is about origin, not about the table', async () => {
    const { service, prisma } = createService(CUSTOM_ROW);
    await withTenant(() => service.update('frequencies', 'row-2', { patientLabelBm: 'Empat kali' }));
    expect(prisma.prescriptionFrequency.update).toHaveBeenCalledWith({
      where: { id: 'row-2' },
      data: { patientLabelBm: 'Empat kali' },
    });
  });

  it('a row from another tenant is NOT FOUND, not a server error', async () => {
    const { service } = createService({ ...CUSTOM_ROW, tenantId: 'other-tenant' });
    await expect(withTenant(() => service.update('frequencies', 'row-2', { code: 'X' }))).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('what a clinic may add', () => {
  it('a created row is always CUSTOM, whatever the body says', async () => {
    // A clinic that could post origin: SYSTEM could make its own row
    // un-editable by its own owner, and shadow a platform default the seeder
    // would then refuse to repair.
    const { service, prisma } = createService();
    await withTenant(() =>
      service.create('frequencies', {
        code: 'QDS',
        doctorDisplay: 'Four times daily',
        patientLabelBm: 'Empat kali sehari',
        origin: 'SYSTEM',
        tenantId: 'somebody-else',
        active: false,
        sortOrder: -1,
      }),
    );
    const { data } = prisma.prescriptionFrequency.create.mock.calls[0][0];
    expect(data.origin).toBe('CUSTOM');
    expect(data.tenantId).toBe(TENANT);
    // The body's `active` and `sortOrder` never reach the row either.
    expect(data.active).toBeUndefined();
    expect(data.sortOrder).toBe(1000);
  });

  it('stock units are the platform\'s list — a clinic cannot add one', async () => {
    // The number a clinic types beside a stock unit is what deduction
    // multiplies by, so the word has to mean the same thing everywhere.
    const { service } = createService();
    await expect(withTenant(() => service.create('stock-units', { name: 'BAG OF THINGS' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('requires the fields a row cannot do without', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.create('frequencies', { code: 'QDS' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a blank string, which is not the same as an absent field', async () => {
    const { service } = createService();
    await expect(
      withTenant(() => service.create('indications', { labelEn: 'Fever', labelBm: '   ' })),
    ).rejects.toThrow(/labelBm cannot be blank/);
  });

  it('KEEPS a null timesPerDay — that is how PRN says "cannot be counted"', async () => {
    const { service, prisma } = createService();
    await withTenant(() =>
      service.create('frequencies', {
        code: 'MANE',
        doctorDisplay: 'In the morning',
        patientLabelBm: 'Pada waktu pagi',
        timesPerDay: null,
      }),
    );
    expect(prisma.prescriptionFrequency.create.mock.calls[0][0].data.timesPerDay).toBeNull();
  });

  it('trims what it stores, so " OD " and "OD" are not two frequencies', async () => {
    const { service, prisma } = createService();
    await withTenant(() =>
      service.create('frequencies', { code: '  MANE  ', doctorDisplay: ' Morning ', patientLabelBm: ' Pagi ' }),
    );
    expect(prisma.prescriptionFrequency.create.mock.calls[0][0].data.code).toBe('MANE');
  });

  it('an empty update is refused rather than silently doing nothing', async () => {
    const { service } = createService(CUSTOM_ROW);
    await expect(withTenant(() => service.update('frequencies', 'row-2', { nonsense: 1 }))).rejects.toThrow(
      /Nothing to change/,
    );
  });
});

describe('listing', () => {
  it('hides retired rows by default — a retired frequency must not be prescribable', async () => {
    const { service, prisma } = createService();
    await withTenant(async () => service.list('frequencies'));
    expect(prisma.prescriptionFrequency.findMany.mock.calls[0][0].where).toMatchObject({ active: true });
  });

  it('Settings can ask for retired rows, so a clinic can bring one back', async () => {
    const { service, prisma } = createService();
    await withTenant(async () => service.list('frequencies', true));
    expect(prisma.prescriptionFrequency.findMany.mock.calls[0][0].where.active).toBeUndefined();
  });

  it('only the five known catalogues are addressable', () => {
    expect(isReferenceCatalog('frequencies')).toBe(true);
    expect(isReferenceCatalog('items')).toBe(false);
    // A prototype key must not resolve to a catalogue.
    expect(isReferenceCatalog('constructor')).toBe(false);
    expect(isReferenceCatalog('__proto__')).toBe(false);
  });
});
