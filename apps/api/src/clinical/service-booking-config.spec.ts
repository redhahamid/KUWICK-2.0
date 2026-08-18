import { BadRequestException } from '@nestjs/common';
import { ServiceCatalogService } from './service-catalog.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

const SERVICE = 'service-1';

function build(world: { existing?: Record<string, unknown> | null; mappedDoctors?: number } = {}) {
  const updates: Record<string, unknown>[] = [];
  const prisma = {
    serviceCatalog: {
      findUnique: jest.fn(async () =>
        world.existing === undefined ? { id: SERVICE, bookable: false, active: true } : world.existing,
      ),
      update: jest.fn(async ({ data }: never) => {
        updates.push(data as Record<string, unknown>);
        return data;
      }),
      findMany: jest.fn(async () => []),
    },
    doctorServiceQualification: {
      count: jest.fn(async () => world.mappedDoctors ?? 1),
    },
  } as unknown as TenantScopedPrismaClient;

  const service = new ServiceCatalogService(prisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 'tenant-1', staffId: 'staff-1', userId: 'user-1' }, fn);

  return { service, prisma, updates, run };
}

// ===========================================================================
// PUBLISHING A SERVICE IS NOT THE SAME ACT AS PRICING ONE.
//
// `updateBooking` is deliberately a separate endpoint from `update`: a
// clinical lead renames and reprices; whoever runs the public page decides
// what patients can see. Splitting them means a booking form cannot carry a
// price change, and a price change cannot publish a service.
// ===========================================================================

describe('a service nobody can perform cannot be published', () => {
  it('1. turning on `bookable` with no doctor mapped is refused, with the remedy', async () => {
    // The failure it prevents is silent: the service appears on the public
    // page, every doctor offers an empty date picker, and nothing says why.
    const ctx = build({ mappedDoctors: 0 });

    await expect(ctx.run(() => ctx.service.updateBooking(SERVICE, { bookable: true }))).rejects.toThrow(
      /No doctor is mapped/i,
    );
    expect(ctx.updates).toHaveLength(0);
  });

  it('2. the refusal names the screen that fixes it', async () => {
    const ctx = build({ mappedDoctors: 0 });

    await expect(
      ctx.run(() => ctx.service.updateBooking(SERVICE, { bookable: true })),
    ).rejects.toThrow(/Doctor-Service Mapping/);
  });

  it('3. one mapped doctor is enough', async () => {
    const ctx = build({ mappedDoctors: 1 });

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookable: true }));

    expect(ctx.updates[0]).toMatchObject({ bookable: true });
  });

  it('4. an ALREADY bookable service is not re-checked — the guard is on publishing', async () => {
    // Otherwise editing the fee of a live service would fail the moment its
    // last mapping was revoked, which is a different problem needing a
    // different answer.
    const ctx = build({ existing: { id: SERVICE, bookable: true, active: true }, mappedDoctors: 0 });

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookable: true, bookingFee: 10 }));

    expect(ctx.updates[0]).toMatchObject({ bookingFee: 10 });
  });

  it('5. UNpublishing is never blocked', async () => {
    const ctx = build({ existing: { id: SERVICE, bookable: true, active: true }, mappedDoctors: 0 });

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookable: false }));

    expect(ctx.updates[0]).toMatchObject({ bookable: false });
  });
});

describe('what the patient reads', () => {
  it('6. a blank description is stored as nothing, not as an empty string', async () => {
    // The page renders one and prints the other.
    const ctx = build();

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookingDescription: '   ' }));

    expect(ctx.updates[0].bookingDescription).toBeNull();
  });

  it('7. a description that was not mentioned is left alone', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookingFee: 5 }));

    expect(ctx.updates[0]).not.toHaveProperty('bookingDescription');
  });

  it('8. a blank photo url is stored as nothing', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.updateBooking(SERVICE, { bookingPhotoUrl: '' }));

    expect(ctx.updates[0].bookingPhotoUrl).toBeNull();
  });
});

describe('the bookable list is what a booking surface may offer', () => {
  it('9. retired services never appear, however bookable they were', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.bookable());

    expect((ctx.prisma.serviceCatalog.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      bookable: true,
      active: true,
    });
  });
});
