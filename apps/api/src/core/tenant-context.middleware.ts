import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { tenantContextStorage } from './tenant-context';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  staffId: string;
  role: string;
}

// Real auth (D-034) — the swap D-017 always anticipated: this middleware now
// verifies a JWT access token instead of trusting a raw x-tenant-id header.
// Everything downstream (tenant-scoped Prisma client, RLS) is unchanged, as
// D-017 predicted — only the source of tenantId moved.
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = authHeader.slice('Bearer '.length);

    let payload: AccessTokenPayload;
    try {
      payload = this.jwtService.verify<AccessTokenPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (!payload.tenantId) {
      throw new UnauthorizedException('Token has no tenant context');
    }

    // RLS (FORCE ROW LEVEL SECURITY, see the force_rls_core_foundation migration)
    // means even this raw connection can't see a tenants row until app.tenant_id
    // is set — so the candidate id from the token is set first, inside the same
    // transaction as the existence check, on the same connection.
    const tenant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${payload.tenantId}, true)`;
      return tx.tenant.findUnique({ where: { id: payload.tenantId } });
    });
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException('Unknown or inactive tenant');
    }

    tenantContextStorage.run(
      { tenantId: payload.tenantId, userId: payload.sub, staffId: payload.staffId, role: payload.role },
      () => next(),
    );
  }
}
