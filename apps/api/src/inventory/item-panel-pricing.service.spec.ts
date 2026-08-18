import { NotFoundException } from '@nestjs/common';
import { ItemPanelPricingService } from './item-panel-pricing.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// PANEL PRICING, SEEN FROM THE ITEM.
//
// Same table the Panel detail screen writes, read the other way round. The
// assertions that matter are about the EFFECTIVE price: a screen that showed
// the override and left the clinic to work out what the patient is charged
// would be exactly the silently-divergent money field this package forbids.
// ===========================================================================

function createService(over: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    item: { findUnique: jest.fn().mockResolvedValue({ id: 'i1', sellPrice: '10.00' }) },
    panelClinic: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p-specific', name: 'AIA', code: 'AIA', inventoryMarkupAmount: null },
        { id: 'p-markup', name: 'Great Eastern', code: 'GE', inventoryMarkupAmount: '2.50' },
        { id: 'p-plain', name: 'Allianz', code: null, inventoryMarkupAmount: null },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: 'p-specific' }),
    },
    panelPriceOverride: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'o1', panelClinicId: 'p-specific', overridePrice: '7.00' },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ...over,
  } as unknown as TenantScopedPrismaClient;
  return { service: new ItemPanelPricingService(prisma), prisma };
}

const withTenant = <T,>(fn: () => Promise<T>) => tenantContextStorage.run({ tenantId: 't1' }, fn);

describe('what each panel actually pays', () => {
  it('prices all three rules through the invoice’s own function, not a second one', async () => {
    const { service } = createService();
    const rows = await withTenant(() => service.listForItem('i1'));

    // A specific price REPLACES the markup rather than stacking with it.
    expect(rows[0]).toMatchObject({
      panelName: 'AIA',
      overridePrice: '7.00',
      effectivePrice: '7.00',
      priceRule: 'SPECIFIC_PANEL_PRICE',
    });
    // No override: cash + the panel's blanket inventory markup.
    expect(rows[1]).toMatchObject({
      panelName: 'Great Eastern',
      overridePrice: null,
      markupAmount: '2.50',
      effectivePrice: '12.50',
      priceRule: 'CASH_PLUS_MARKUP',
    });
    // Neither: the cash price stands, and the screen says which rule that is.
    expect(rows[2]).toMatchObject({ effectivePrice: '10.00', priceRule: 'CASH' });
  });

  it('lists a panel with no override rather than hiding it', async () => {
    // A panel missing from the list reads as "not covered", which is a
    // different and much more expensive claim than "no special price".
    const { service } = createService();
    const rows = await withTenant(() => service.listForItem('i1'));
    expect(rows).toHaveLength(3);
  });

  it('404s on an item that is not this clinic’s', async () => {
    const { service } = createService({ item: { findUnique: jest.fn().mockResolvedValue(null) } });
    await expect(withTenant(() => service.listForItem('gone'))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('setting a panel price', () => {
  it('creates an override where there was none', async () => {
    const { service, prisma } = createService();
    await withTenant(() => service.setForItem('i1', 'p-specific', 7.5));
    expect(prisma.panelPriceOverride.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', panelClinicId: 'p-specific', itemId: 'i1', overridePrice: 7.5 },
    });
  });

  it('updates the existing one rather than stacking a second', async () => {
    const { service, prisma } = createService();
    (prisma.panelPriceOverride.findFirst as jest.Mock).mockResolvedValue({ id: 'o1' });
    await withTenant(() => service.setForItem('i1', 'p-specific', 8));
    expect(prisma.panelPriceOverride.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { overridePrice: 8 },
    });
    expect(prisma.panelPriceOverride.create).not.toHaveBeenCalled();
  });

  it('clearing DELETES the override — it does not store zero', async () => {
    // Zero is a real and different statement: this panel pays nothing for this
    // medicine. A cleared field that became a free medicine is the worst kind
    // of silent divergence.
    const { service, prisma } = createService();
    (prisma.panelPriceOverride.findFirst as jest.Mock).mockResolvedValue({ id: 'o1' });
    await withTenant(() => service.setForItem('i1', 'p-specific', null));
    expect(prisma.panelPriceOverride.delete).toHaveBeenCalledWith({ where: { id: 'o1' } });
    expect(prisma.panelPriceOverride.update).not.toHaveBeenCalled();
  });

  it('stores an explicit zero when that is what the clinic means', async () => {
    const { service, prisma } = createService();
    await withTenant(() => service.setForItem('i1', 'p-specific', 0));
    expect(prisma.panelPriceOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ overridePrice: 0 }) }),
    );
  });

  it('refuses a negative price', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.setForItem('i1', 'p-specific', -1))).rejects.toThrow(
      'cannot be negative',
    );
  });

  it('refuses another clinic’s panel id — an FK would have accepted it', async () => {
    const { service, prisma } = createService();
    (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(withTenant(() => service.setForItem('i1', 'someone-elses', 5))).rejects.toThrow(
      'Panel not found',
    );
  });
});
