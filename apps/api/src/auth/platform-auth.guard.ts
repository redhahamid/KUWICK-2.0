import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

// Guards platform-admin routes (tenant management) — a plain CanActivate
// guard is fine here, unlike TenantContextMiddleware: these routes never
// call TENANT_SCOPED_PRISMA (no AsyncLocalStorage propagation to worry
// about), they use plain PrismaService directly, deliberately cross-tenant
// (D-034). Routes protected by this guard must also be excluded from
// TenantContextMiddleware in AppModule, since a platform-admin token has no
// tenantId claim at all.
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify<{ sub: string; type: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      if (payload.type !== 'platform') {
        throw new UnauthorizedException('Not a platform admin token');
      }
      (request as Request & { platformAdminId: string }).platformAdminId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
