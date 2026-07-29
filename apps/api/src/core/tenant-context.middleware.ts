import { BadRequestException, Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { tenantContextStorage } from './tenant-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TODO(real-auth): this is an interim placeholder pending JWT auth
// (docs/SYSTEM_ARCHITECTURE.md §2 Auth row). Tracked in docs/DECISIONS.md D-017.
// Swap the tenantId source below for the JWT's tenant claim when auth ships;
// everything downstream (tenant-scoped Prisma client, RLS) is unchanged.
//
// Implemented as middleware, not a CanActivate guard: AsyncLocalStorage.run()
// must wrap the call that continues the rest of the pipeline for its context to
// propagate to the controller handler. A guard's canActivate() resolves back up
// to Nest's own internal await, which is a sibling continuation, not a
// descendant of the guard's own execution — context entered there is lost by
// the time the handler runs. Middleware's next() is invoked synchronously
// inside run()'s callback, so it (and everything downstream of it) is a true
// descendant and correctly inherits the store.
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenantId = req.header('x-tenant-id');

    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new BadRequestException(
        'x-tenant-id header is required and must be a UUID (interim auth placeholder — see docs/DECISIONS.md D-017)',
      );
    }

    // RLS (FORCE ROW LEVEL SECURITY, see the force_rls_core_foundation migration)
    // means even this raw connection can't see a tenants row until app.tenant_id
    // is set — so the candidate id from the header is set first, inside the same
    // transaction as the existence check, on the same connection.
    const tenant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.tenant.findUnique({ where: { id: tenantId } });
    });
    if (!tenant) {
      throw new UnauthorizedException('Unknown tenant');
    }

    tenantContextStorage.run({ tenantId }, () => next());
  }
}
