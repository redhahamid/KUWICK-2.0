import { BadRequestException } from '@nestjs/common';
import { MediaService, mediaIdOf, mediaRef } from './media.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// PHASE 6 — what the booking page's image shelf accepts, and what it refuses.
//
// The bytes are hostile input from a browser; the reference scheme is the
// contract every URL column relies on. Both are pinned.
// ===========================================================================

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4 fake');

function build(world: { role?: string } = {}) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    staff: {
      findUnique: jest.fn(async () => ({
        id: 'staff-1',
        fullName: 'Aisyah',
        // Permissions are RESOLVED from the role, exactly as in production.
        role: world.role ?? 'OWNER_ADMIN',
        active: true,
        clinicId: 'clinic-1',
      })),
    },
    staffRoleAssignment: { findMany: jest.fn(async () => []) },
    staffPermissionGrant: { findMany: jest.fn(async () => []) },
    mediaAsset: {
      create: jest.fn(async ({ data }: never) => {
        created.push(data as Record<string, unknown>);
        return { id: 'media-1', kind: (data as { kind: string }).kind, contentType: 'image/png', byteSize: 11, createdAt: new Date() };
      }),
      findUnique: jest.fn(async () => null),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    $executeRaw: jest.fn(async () => 0),
  };
  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const service = new MediaService(rawPrisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-1', userId: 'u1' }, fn);
  return { service, tx, created, run };
}

const file = (buffer: Buffer, mimetype: string, originalname: string) => ({
  buffer,
  mimetype,
  originalname,
  size: buffer.length,
});

describe('the image shelf accepts pictures and only pictures', () => {
  it('1. a real PNG is stored with its proven type and the media:// reference', async () => {
    const ctx = build();

    const result = await ctx.run(() =>
      ctx.service.upload('SERVICE_PHOTO', file(PNG, 'image/png', 'ear-suction.png')),
    );

    expect(result.ref).toBe('media://media-1');
    expect(ctx.created[0]).toMatchObject({ kind: 'SERVICE_PHOTO', contentType: 'image/png' });
  });

  it('2. a PDF is refused — the shared validator admits it, a booking page does not', async () => {
    const ctx = build();

    await expect(
      ctx.run(() => ctx.service.upload('SERVICE_PHOTO', file(PDF, 'application/pdf', 'menu.pdf'))),
    ).rejects.toThrow(/JPG, PNG or WebP/);
  });

  it('3. bytes that are not what they claim are refused — renaming proves nothing', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upload('SERVICE_PHOTO', file(Buffer.from('MZ\x90\x00exe'), 'image/png', 'x.png')),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(ctx.created).toHaveLength(0);
  });

  it('4. an unknown kind is refused before any byte is looked at', async () => {
    const ctx = build();

    await expect(
      ctx.run(() => ctx.service.upload('PATIENT_SELFIE', file(PNG, 'image/png', 'x.png'))),
    ).rejects.toThrow(/SERVICE_PHOTO or CLINIC_LOGO/);
  });

  it('5. an image over 2 MB is refused, in words', async () => {
    const ctx = build();
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);

    await expect(
      ctx.run(() => ctx.service.upload('CLINIC_LOGO', file(big, 'image/png', 'logo.png'))),
    ).rejects.toThrow(/over 2 MB/);
  });

  it('6. uploading needs the CONFIGURE permission, like every booking-surface setting', async () => {
    // A stock clerk has plenty of permissions; configuring the public
    // booking surface is not one of them.
    const ctx = build({ role: 'STOCK_STAFF' });

    await expect(
      ctx.run(() => ctx.service.upload('SERVICE_PHOTO', file(PNG, 'image/png', 'x.png'))),
    ).rejects.toThrow();
    expect(ctx.created).toHaveLength(0);
  });
});

describe('the media:// reference scheme', () => {
  it('7. a ref round-trips; an http URL and junk both resolve to nothing', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(mediaIdOf(mediaRef(id))).toBe(id);
    expect(mediaIdOf('https://cdn.example.com/x.png')).toBeNull();
    expect(mediaIdOf('media://../../etc/passwd')).toBeNull();
    expect(mediaIdOf(null)).toBeNull();
  });
});
