import { ItemService } from './item.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// D1 — "DISPENSED WHOLE" IS A STATEMENT, AND THE SERVER OWNS ITS AUTHOR.
//
// A divisor of 1 somebody looked at and a divisor of 1 nobody looked at are
// the same number and opposite facts. These assert the three ways the pair can
// come apart, because the CHECK constraint only refuses the row — it cannot
// explain anything to anybody.
// ===========================================================================

function createService(existing: { quantityPerStockUnit: number | null; dispensedWholeAt: Date | null } | null) {
  const prisma = {
    item: {
      create: jest.fn((args) => Promise.resolve(args.data)),
      update: jest.fn((args) => Promise.resolve(args.data)),
      findUnique: jest.fn().mockResolvedValue(existing),
    },
    dosageUnit: { findFirst: jest.fn() },
    prescriptionFrequency: { findFirst: jest.fn() },
    consumptionMethodRef: { findFirst: jest.fn() },
    stockUnitRef: { findFirst: jest.fn().mockResolvedValue({ id: 'su-1' }) },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ItemService(prisma), prisma };
}

const asStaff = <T,>(fn: () => Promise<T>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-7' }, fn);

const dataOf = (mock: jest.Mock) => mock.mock.calls[0][0].data;

describe('declaring an item dispensed whole', () => {
  it('sets the divisor to 1 and stamps who and when', async () => {
    const { service, prisma } = createService({ quantityPerStockUnit: null, dispensedWholeAt: null });
    await asStaff(() => service.update('i1', { dispensedWhole: true }));

    const data = dataOf(prisma.item.update as jest.Mock);
    expect(data.quantityPerStockUnit).toBe(1);
    expect(data.dispensedWholeAt).toBeInstanceOf(Date);
    expect(data.dispensedWholeByStaffId).toBe('staff-7');
  });

  it('never takes the date or the author from the caller', async () => {
    // A caller that could set these could backdate a clinical decision and
    // sign somebody else's name to it. The ValidationPipe's whitelist already
    // strips them; the service strips them again, because the guarantee should
    // not rest on an option configured in another file.
    const { service, prisma } = createService({ quantityPerStockUnit: null, dispensedWholeAt: null });
    const forged = new Date('2020-01-01');
    await asStaff(() =>
      service.update('i1', {
        dispensedWhole: true,
        dispensedWholeAt: forged,
        dispensedWholeByStaffId: 'somebody-else',
      } as never),
    );
    const data = dataOf(prisma.item.update as jest.Mock);
    expect(data.dispensedWholeAt).not.toEqual(forged);
    expect(data.dispensedWholeByStaffId).toBe('staff-7');
  });

  it('drops a forged stamp even when the payload says nothing about the declaration', async () => {
    // The branch where `dispensedWholeOf` returns {} and the spread is the
    // only thing standing between a forged date and the row.
    const { service, prisma } = createService({ quantityPerStockUnit: 10, dispensedWholeAt: null });
    await asStaff(() =>
      service.update('i1', { dispensedWholeAt: new Date('2020-01-01') } as never),
    );
    expect(dataOf(prisma.item.update as jest.Mock).dispensedWholeAt).toBeUndefined();
  });
});

describe('withdrawing the declaration', () => {
  it('clears the marker and LEAVES THE DIVISOR ALONE', async () => {
    // Withdrawing a statement is not stating the real count. Blanking the
    // number would take a priced item and make it unpriceable as a side effect
    // of a checkbox.
    const { service, prisma } = createService({ quantityPerStockUnit: 1, dispensedWholeAt: new Date() });
    await asStaff(() => service.update('i1', { dispensedWhole: false }));

    const data = dataOf(prisma.item.update as jest.Mock);
    expect(data.dispensedWholeAt).toBeNull();
    expect(data.dispensedWholeByStaffId).toBeNull();
    expect(data.quantityPerStockUnit).toBeUndefined();
  });
});

describe('moving the divisor out from under a standing declaration', () => {
  it('clears the marker even though the payload never mentions it', async () => {
    // "Handed over whole" and "counted in thirties" cannot both be true, and
    // the CHECK constraint would refuse the row. Being refused by PostgreSQL
    // is not an explanation anybody can act on.
    const { service, prisma } = createService({ quantityPerStockUnit: 1, dispensedWholeAt: new Date() });
    await asStaff(() => service.update('i1', { quantityPerStockUnit: 30 }));

    const data = dataOf(prisma.item.update as jest.Mock);
    expect(data.quantityPerStockUnit).toBe(30);
    expect(data.dispensedWholeAt).toBeNull();
  });

  it('leaves a standing declaration alone when the divisor is re-sent as 1', async () => {
    const { service, prisma } = createService({ quantityPerStockUnit: 1, dispensedWholeAt: new Date() });
    await asStaff(() => service.update('i1', { quantityPerStockUnit: 1 }));
    expect(dataOf(prisma.item.update as jest.Mock).dispensedWholeAt).toBeUndefined();
  });

  it('does not touch the marker on an item that never had one', async () => {
    const { service, prisma } = createService({ quantityPerStockUnit: null, dispensedWholeAt: null });
    await asStaff(() => service.update('i1', { quantityPerStockUnit: 10 }));
    expect(dataOf(prisma.item.update as jest.Mock).dispensedWholeAt).toBeUndefined();
  });
});

describe('the stock unit is checked for tenancy, like every other FK on this row', () => {
  it('refuses an id that is not this clinic’s, naming the field', async () => {
    // FK triggers are not subject to RLS: the constraint accepts a
    // cross-tenant id and every read of it comes back empty, so the form opens
    // with the packaging blank and no error anywhere. This is also the id the
    // DIVISOR hangs off, so a silent failure here is a pricing failure.
    const { service, prisma } = createService({ quantityPerStockUnit: null, dispensedWholeAt: null });
    (prisma.stockUnitRef.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(asStaff(() => service.update('i1', { stockUnitId: 'someone-elses' }))).rejects.toThrow(
      /Stock unit is not on this clinic's list/,
    );
  });
});

describe('creating an item', () => {
  it('carries the declaration through create, not only update', async () => {
    const { service, prisma } = createService(null);
    await asStaff(() => service.create({ name: 'Cough syrup', sellPrice: 12, dispensedWhole: true }));

    const data = dataOf(prisma.item.create as jest.Mock);
    expect(data.quantityPerStockUnit).toBe(1);
    expect(data.dispensedWholeByStaffId).toBe('staff-7');
    // The boolean is the API's word, not a column — it must not reach Prisma.
    expect(data.dispensedWhole).toBeUndefined();
  });
});
