import { JwtService } from '@nestjs/jwt';
import { PrismaClient, Role } from '@prisma/client';
import { withTenantContext } from './test-db';

// The specs in this directory used to hit the API with a bare x-tenant-id
// header — the D-017 stopgap. D-034 replaced that with a verified JWT, so a
// spec authenticates the same way the real client does: a signed access
// token whose claims TenantContextMiddleware verifies and trusts.
//
// The tokens are signed with the SAME secret the app verifies with
// (JWT_ACCESS_SECRET, from .env.test / the CI step env) — no test-only
// bypass path is added to the app for this, deliberately: a back door built
// for tests is a back door.
const jwtService = new JwtService({});

export function bearerFor(tenantId: string, staffId: string, role: Role = Role.OWNER_ADMIN): string {
  const token = jwtService.sign(
    { sub: `test-user-${staffId}`, tenantId, staffId, role },
    { secret: process.env.JWT_ACCESS_SECRET as string, expiresIn: '1h' },
  );
  return `Bearer ${token}`;
}

// Creates the acting staff row the token points at — OWNER_ADMIN so
// permission checks (core/permissions.ts) and actor lookups
// (clinical-actor.ts, staff.service.ts) resolve against a real, active row
// exactly as they would for a signed-in clinic owner.
export async function createOwnerAndBearer(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ staffId: string; bearer: string }> {
  const staff = await withTenantContext(prisma, tenantId, (tx) =>
    tx.staff.create({ data: { tenantId, role: Role.OWNER_ADMIN, fullName: 'Test Owner' } }),
  );
  return { staffId: staff.id, bearer: bearerFor(tenantId, staff.id) };
}
