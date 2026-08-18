import { ConflictException, NotFoundException } from '@nestjs/common';
import { ItemCategoryService } from './item-category.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const tx = {
    itemCategory: { update: jest.fn() },
    item: { updateMany: jest.fn() },
  };
  const prisma = {
    itemCategory: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    item: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((fn: (c: typeof tx) => unknown) => fn(tx)),
  } as unknown as TenantScopedPrismaClient;
  return { service: new ItemCategoryService(prisma), prisma, tx };
}

const withTenant = <T,>(fn: () => Promise<T>) => tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);

describe('adding a category', () => {
  it('appends to the end rather than sorting itself in', async () => {
    // A clinic that has arranged its sections keeps that arrangement; a new
    // one lands where they can see it.
    const { service, prisma } = createService();
    (prisma.itemCategory.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // no collision
      .mockResolvedValueOnce({ sortOrder: 4 }); // the current last

    await withTenant(() => service.create('  Antibiotik  '));

    expect(prisma.itemCategory.create).toHaveBeenCalledWith({
      data: { tenantId: 'test-tenant', name: 'Antibiotik', sortOrder: 5 },
    });
  });

  it('refuses a name already on the list', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findFirst as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Medication' });
    await expect(withTenant(() => service.create('Medication'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a blank name', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.create('   '))).rejects.toThrow('A category needs a name');
  });
});

describe('renaming a category', () => {
  it('moves the registry row AND every item carrying the old string, together', async () => {
    // Renaming only the list leaves those items filed under a name no longer
    // on it — and they still show, because the tabs union in-use strings. The
    // clinic sees the old category reappear beside the new one.
    const { service, prisma, tx } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Medication' });
    (prisma.itemCategory.findFirst as jest.Mock).mockResolvedValue(null);
    tx.itemCategory.update.mockResolvedValue({ id: 'c1', name: 'Ubat' });

    await withTenant(() => service.rename('c1', 'Ubat'));

    expect(tx.itemCategory.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { name: 'Ubat' } });
    expect(tx.item.updateMany).toHaveBeenCalledWith({
      where: { category: 'Medication' },
      data: { category: 'Ubat' },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('refuses to rename one category onto another — that is a merge, not a rename', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Medication' });
    (prisma.itemCategory.findFirst as jest.Mock).mockResolvedValue({ id: 'c2', name: 'Vaccine' });

    await expect(withTenant(() => service.rename('c1', 'Vaccine'))).rejects.toThrow('Merging two categories');
  });

  it('is a no-op when the name has not actually changed', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Medication' });
    await withTenant(() => service.rename('c1', '  Medication '));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('deleting a category is guarded, and the refusal names the number', () => {
  it('refuses while items are filed under it, and says how many', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'ANTIBIOTIK' });
    (prisma.item.count as jest.Mock).mockResolvedValue(23);

    await expect(withTenant(() => service.remove('c1'))).rejects.toThrow(
      '23 items are filed under "ANTIBIOTIK"',
    );
    expect(prisma.itemCategory.delete).not.toHaveBeenCalled();
  });

  it('says "1 item is" rather than "1 items are"', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Vaccine' });
    (prisma.item.count as jest.Mock).mockResolvedValue(1);
    await expect(withTenant(() => service.remove('c1'))).rejects.toThrow('1 item is filed under');
  });

  it('deletes an unused one', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', name: 'Vaccine' });
    (prisma.item.count as jest.Mock).mockResolvedValue(0);
    await expect(withTenant(() => service.remove('c1'))).resolves.toEqual({ deleted: true, name: 'Vaccine' });
    expect(prisma.itemCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('404s on a category that is not there', async () => {
    const { service, prisma } = createService();
    (prisma.itemCategory.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(withTenant(() => service.remove('nope'))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('adopting an imported name', () => {
  it('registers a name items already carry, so it becomes renameable', async () => {
    const { service, prisma } = createService();
    (prisma.item.count as jest.Mock).mockResolvedValue(41);
    (prisma.itemCategory.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await withTenant(() => service.adopt('BATUK'));

    expect(prisma.itemCategory.create).toHaveBeenCalledWith({
      data: { tenantId: 'test-tenant', name: 'BATUK', sortOrder: 0 },
    });
  });

  it('refuses to adopt a name nothing uses — that is an Add', async () => {
    const { service, prisma } = createService();
    (prisma.item.count as jest.Mock).mockResolvedValue(0);
    await expect(withTenant(() => service.adopt('Nothing'))).rejects.toThrow('No items are filed under');
  });
});
