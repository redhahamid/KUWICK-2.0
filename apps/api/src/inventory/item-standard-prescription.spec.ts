import { BadRequestException } from '@nestjs/common';
import { ItemService } from './item.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import {
  STANDARD_PRESCRIPTION_KEYS,
  touchesStandardPrescription,
} from './dto/standard-prescription-defaults.dto';

// ===========================================================================
// PHASE 1G — THE MEDICINE FORM WRITES DEFAULTS, AND THE ROW BECOMES THEIRS.
//
// Two claims are worth this file. First, that a reference the clinic does not
// own is REFUSED here rather than by the foreign key — PostgreSQL checks FKs
// through internal triggers that RLS does not apply to, so a cross-tenant id
// is accepted by the constraint and then reads back as nothing. Second, that
// editing defaults clears `defaults_from_seed`, because that flag is the only
// thing stopping the next `seed:standard-rx` run from reverting a doctor.
// ===========================================================================

const TENANT = 'tenant-1';
const OTHER = 'tenant-2';

const UNIT = '11111111-1111-4111-8111-111111111111';
const FREQ = '22222222-2222-4222-8222-222222222222';
const METHOD = '33333333-3333-4333-8333-333333333333';

/**
 * A prisma stand-in whose reference lookups behave like the real ones under
 * RLS: `findFirst` matches only rows of the tenant named in the where clause,
 * and only active ones.
 */
function createService(rows: {
  units?: Array<{ id: string; tenantId: string; active: boolean }>;
  frequencies?: Array<{ id: string; tenantId: string; active: boolean }>;
  methods?: Array<{ id: string; tenantId: string; active: boolean }>;
} = {}) {
  const table = (all: Array<{ id: string; tenantId: string; active: boolean }> = []) => ({
    findFirst: jest.fn(async (args: { where: { id: string; tenantId: string; active: boolean } }) =>
      all.find(
        (row) =>
          row.id === args.where.id &&
          row.tenantId === args.where.tenantId &&
          row.active === args.where.active,
      ) ?? null,
    ),
  });
  const prisma = {
    dosageUnit: table(rows.units),
    prescriptionFrequency: table(rows.frequencies),
    consumptionMethodRef: table(rows.methods),
    item: {
      create: jest.fn(async (args: { data: unknown }) => args.data),
      update: jest.fn(async (args: { data: unknown }) => args.data),
    },
  };
  return {
    service: new ItemService(prisma as unknown as TenantScopedPrismaClient),
    prisma,
  };
}

/** Everything this clinic owns, active. The ordinary case. */
const ownedAndActive = {
  units: [{ id: UNIT, tenantId: TENANT, active: true }],
  frequencies: [{ id: FREQ, tenantId: TENANT, active: true }],
  methods: [{ id: METHOD, tenantId: TENANT, active: true }],
};

const withTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  tenantContextStorage.run({ tenantId: TENANT, staffId: 'staff-1' }, fn);

describe('the standard prescription writes through', () => {
  it('saves all seven fields on an edit', async () => {
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() =>
      service.update('item-1', {
        defaultDoseAmount: 2,
        defaultDoseUnitId: UNIT,
        defaultFrequencyId: FREQ,
        defaultDurationValue: 5,
        defaultDurationUnit: 'DAY',
        defaultQuantity: 30,
        defaultConsumptionMethodId: METHOD,
      }),
    );
    const { data } = prisma.item.update.mock.calls[0][0] as { data: Record<string, unknown> };
    for (const key of STANDARD_PRESCRIPTION_KEYS) {
      expect(data).toHaveProperty(key);
    }
    expect(data.defaultDurationUnit).toBe('DAY');
  });

  it('accepts null as "no default for this one"', async () => {
    // Distinct from not sending the field. A doctor clearing the frequency on a
    // PRN medicine must be able to leave it empty, and the row is still theirs.
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() => service.update('item-1', { defaultFrequencyId: null }));
    const { data } = prisma.item.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.defaultFrequencyId).toBeNull();
    expect(data.defaultsFromSeed).toBe(false);
  });
});

describe('editing the defaults makes the row the clinic\'s own', () => {
  it.each(STANDARD_PRESCRIPTION_KEYS)('%s clears defaults_from_seed', async (key) => {
    const { service, prisma } = createService(ownedAndActive);
    // Whichever field it is, the ids have to be real ones or the check refuses
    // before ownership is ever reached.
    const value =
      key === 'defaultDoseUnitId'
        ? UNIT
        : key === 'defaultFrequencyId'
          ? FREQ
          : key === 'defaultConsumptionMethodId'
            ? METHOD
            : key === 'defaultDurationUnit'
              ? 'DAY'
              : 1;
    await withTenant(() => service.update('item-1', { [key]: value }));
    const { data } = prisma.item.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.defaultsFromSeed).toBe(false);
  });

  it('a write that does not touch the defaults leaves the flag alone', async () => {
    // Renaming a medicine, or correcting its price, is not the clinic claiming
    // its dosing. If this set the flag, one price edit would opt every medicine
    // out of platform updates for good.
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() => service.update('item-1', { sellPrice: 4.5, name: 'PCM 500mg' }));
    const { data } = prisma.item.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('defaultsFromSeed');
  });

  it('a new medicine created with defaults is the clinic\'s from the start', async () => {
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() =>
      service.create({ name: 'Something new', sellPrice: 1, defaultFrequencyId: FREQ }),
    );
    const { data } = prisma.item.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.defaultsFromSeed).toBe(false);
    expect(data.tenantId).toBe(TENANT);
  });

  it('the key list and the helper agree', () => {
    expect(touchesStandardPrescription({ name: 'x' })).toBe(false);
    for (const key of STANDARD_PRESCRIPTION_KEYS) {
      expect(touchesStandardPrescription({ [key]: null })).toBe(true);
    }
  });
});

describe('a reference the clinic does not own is refused here, not by the foreign key', () => {
  it('refuses another clinic\'s frequency', async () => {
    // The FK would ACCEPT this: PostgreSQL checks it through an internal
    // trigger that row-level security does not apply to. The doctor's form
    // would then open blank, because reading the row back is RLS-blocked.
    const { service, prisma } = createService({
      ...ownedAndActive,
      frequencies: [{ id: FREQ, tenantId: OTHER, active: true }],
    });
    await expect(withTenant(() => service.update('item-1', { defaultFrequencyId: FREQ }))).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.item.update).not.toHaveBeenCalled();
  });

  it('refuses a RETIRED entry', async () => {
    const { service } = createService({
      ...ownedAndActive,
      methods: [{ id: METHOD, tenantId: TENANT, active: false }],
    });
    await expect(
      withTenant(() => service.update('item-1', { defaultConsumptionMethodId: METHOD })),
    ).rejects.toThrow(/not on this clinic's list/);
  });

  it('names every offending field at once, not just the first', async () => {
    // Three separate round trips to fix three fields is how a form gets
    // abandoned. The refusal says what is wrong and where to fix it.
    const { service } = createService({ units: [], frequencies: [], methods: [] });
    await expect(
      withTenant(() =>
        service.update('item-1', { defaultDoseUnitId: UNIT, defaultFrequencyId: FREQ }),
      ),
    ).rejects.toThrow(/Dose unit and Frequency/);
  });

  it('says where to fix it', async () => {
    const { service } = createService({ units: [], frequencies: [], methods: [] });
    await expect(withTenant(() => service.update('item-1', { defaultDoseUnitId: UNIT }))).rejects.toThrow(
      /Settings › Prescription Vocabulary/,
    );
  });

  it('does not query for references that were not sent', async () => {
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() => service.update('item-1', { defaultDoseAmount: 2 }));
    expect(prisma.dosageUnit.findFirst).not.toHaveBeenCalled();
    expect(prisma.prescriptionFrequency.findFirst).not.toHaveBeenCalled();
    expect(prisma.consumptionMethodRef.findFirst).not.toHaveBeenCalled();
  });

  it('clearing a reference to null is not a lookup', async () => {
    const { service, prisma } = createService(ownedAndActive);
    await withTenant(() => service.update('item-1', { defaultFrequencyId: null }));
    expect(prisma.prescriptionFrequency.findFirst).not.toHaveBeenCalled();
  });
});
