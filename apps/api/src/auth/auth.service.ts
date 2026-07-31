import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const PLATFORM_TOKEN_TTL = '1h';

interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  staffId: string;
  role: string;
}

interface RefreshTokenClaims extends AccessTokenClaims {
  type: 'refresh';
}

interface PlatformTokenClaims {
  sub: string;
  type: 'platform';
}

// Real auth (D-034). Uses plain PrismaService, not TENANT_SCOPED_PRISMA —
// login happens *before* any tenant context exists (there's nothing in
// AsyncLocalStorage yet to scope a query against), so these lookups are
// necessarily direct, same as TenantContextMiddleware's own tenant-existence
// check. Tenant.slug (not email alone) identifies which tenant to log into,
// since User.email is only unique per-tenant (the same email can exist at
// two different clinics).
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private issueTenantTokens(claims: AccessTokenClaims) {
    const accessToken = this.jwtService.sign(claims, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: ACCESS_TOKEN_TTL,
    });
    const refreshToken = this.jwtService.sign(
      { ...claims, type: 'refresh' } satisfies RefreshTokenClaims,
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: REFRESH_TOKEN_TTL },
    );
    return { accessToken, refreshToken };
  }

  // Deliberately vague ("Invalid credentials") on every failure path below —
  // never reveals whether the slug, email, or password was the wrong part,
  // which would let an attacker enumerate valid clinic slugs/emails.
  //
  // Both DB calls below run inside a transaction that sets a session GUC
  // first (see migration 20260731280000): the tenants table's RLS policy
  // normally requires id = app.tenant_id, which is impossible to satisfy
  // when resolving a tenant *from* its login slug (there is no tenant
  // context yet — that's the whole point of this lookup). Once the tenant
  // is known, the user lookup instead sets the ordinary app.tenant_id GUC
  // that every other tenant-scoped query already relies on.
  async login(dto: LoginDto) {
    const tenant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.tenant.findUnique({ where: { slug: dto.slug } });
    });
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
        include: { staff: true },
      });
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.staff || !user.staff.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    });

    const tokens = this.issueTenantTokens({
      sub: user.id,
      tenantId: tenant.id,
      staffId: user.staff.id,
      role: user.staff.role,
    });
    return {
      ...tokens,
      user: { id: user.id, email: user.email },
      staff: { id: user.staff.id, fullName: user.staff.fullName, role: user.staff.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    let claims: RefreshTokenClaims;
    try {
      claims = this.jwtService.verify<RefreshTokenClaims>(dto.refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (claims.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Re-checks the account is still active on every refresh — a
    // deactivated staff member's still-valid refresh token cannot silently
    // keep minting new access tokens. The tenantId in the (signature-
    // verified) refresh token sets app.tenant_id so this read satisfies the
    // users table's ordinary tenant_isolation RLS policy.
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${claims.tenantId}, true)`;
      return tx.user.findUnique({ where: { id: claims.sub }, include: { staff: true } });
    });
    if (!user || user.status !== 'active' || !user.staff || !user.staff.active) {
      throw new UnauthorizedException('Account is no longer active');
    }

    return this.issueTenantTokens({
      sub: user.id,
      tenantId: claims.tenantId,
      staffId: user.staff.id,
      role: user.staff.role,
    });
  }

  // "Login As" (D-037, owner's reference screen) — a platform admin opens a
  // clinic's own workspace without knowing any password, for support. Finds
  // the tenant's most-senior active login (OWNER_ADMIN first) and issues
  // ordinary tenant tokens for it — from that point on the session is
  // indistinguishable from that staff member logging in themselves.
  async loginAsTenant(tenantId: string) {
    const tenant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.tenant.findUnique({ where: { id: tenantId } });
    });
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException('Unknown or inactive tenant');
    }

    const staff = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const ownerAdmin = await tx.staff.findFirst({
        where: { active: true, role: 'OWNER_ADMIN', userId: { not: null } },
        include: { user: true },
      });
      if (ownerAdmin) return ownerAdmin;
      return tx.staff.findFirst({
        where: { active: true, userId: { not: null } },
        include: { user: true },
      });
    });
    if (!staff || !staff.user || staff.user.status !== 'active') {
      throw new UnauthorizedException('This clinic has no active staff login to impersonate');
    }

    const tokens = this.issueTenantTokens({
      sub: staff.user.id,
      tenantId: tenant.id,
      staffId: staff.id,
      role: staff.role,
    });
    return {
      ...tokens,
      user: { id: staff.user.id, email: staff.user.email },
      staff: { id: staff.id, fullName: staff.fullName, role: staff.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    };
  }

  async loginPlatformAdmin(dto: PlatformLoginDto) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email } });
    if (!admin || !admin.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordValid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    const accessToken = this.jwtService.sign({ sub: admin.id, type: 'platform' } satisfies PlatformTokenClaims, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: PLATFORM_TOKEN_TTL,
    });
    return { accessToken, admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
  }
}
