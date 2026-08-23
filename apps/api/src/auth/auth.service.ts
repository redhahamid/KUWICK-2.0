import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';
import { CatalogueHealth, assessCatalogue } from '../core/catalogue-health';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { Staff, SystemRole } from '@prisma/client';
import { canAuthorNarrative } from '../clinical/clinical-authorization';
import { isCustomRoleGrantable, isIndividuallyGrantable, permissionPayload } from '../core/permissions';

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
  // D-049 — one login form for the whole product, same as the owner's
  // current kuwick.com: platform admin (system owner) and clinic staff all
  // sign in at the same place with just email + password, and the response
  // `kind` tells the frontend which workspace to open. Resolution order:
  // platform admin first (their email is globally unique), then clinic
  // staff. The clinic slug is only needed — and only asked for — when the
  // same email + password validates at more than one clinic, which is
  // signalled with a 409 rather than folded into "invalid credentials"
  // (safe to reveal: the caller has already proven they hold the password).
  async login(dto: LoginDto) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email } });
    if (admin && admin.active && (await bcrypt.compare(dto.password, admin.passwordHash))) {
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      const accessToken = this.jwtService.sign({ sub: admin.id, type: 'platform' } satisfies PlatformTokenClaims, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: PLATFORM_TOKEN_TTL,
      });
      return {
        kind: 'platform' as const,
        accessToken,
        admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
      };
    }

    if (dto.slug) {
      return this.loginWithSlug(dto.slug, dto.email, dto.password);
    }
    return this.loginByEmail(dto.email, dto.password);
  }

  // Email-only path: one cross-tenant read (the users/staff policies allow
  // the same bypass GUC the tenants/clinics bootstrap lookups already use —
  // migration 20260801190000), then the password decides which account wins.
  private async loginByEmail(email: string, password: string) {
    const candidates = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.user.findMany({
        where: { email, status: 'active' },
        include: { staff: { include: { clinic: true } }, tenant: true },
      });
    });

    const matches = [];
    for (const candidate of candidates) {
      if (candidate.tenant.status !== 'active' || !candidate.staff || !candidate.staff.active) continue;
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (matches.length > 1) {
      throw new ConflictException('This email is registered at more than one clinic — enter your clinic code');
    }
    return this.finalizeTenantLogin(matches[0], matches[0].tenant);
  }

  /**
   * Is THIS clinic's catalogue usable? Scoped to the tenant, which is the only
   * scope in which the question means anything.
   */
  private async catalogueHealthForTenant(tenantId: string): Promise<CatalogueHealth | null> {
    // NULL, never a throw. This is a diagnostic, and a diagnostic that can deny
    // a doctor their sign-in is worse than the problem it reports — login is the
    // front door to the entire clinical record. Same rule as the boot check: it
    // says what it can and gets out of the way. `null` means "not determined",
    // which the browser must not render as "empty".
    try {
      const [diagnoses, medications] = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return Promise.all([
          tx.diagnosisCatalog.count({ where: { tenantId } }),
          tx.item.count({ where: { tenantId, category: 'Medication' } }),
        ]);
      });
      return assessCatalogue({ diagnoses, medications });
    } catch {
      return null;
    }
  }

  // Original slug-scoped path (D-034), kept as the disambiguation fallback.
  private async loginWithSlug(slug: string, email: string, password: string) {
    const tenant = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.tenant.findUnique({ where: { slug } });
    });
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        include: { staff: { include: { clinic: true } } },
      });
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.staff || !user.staff.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.finalizeTenantLogin(user, tenant);
  }

  private async finalizeTenantLogin(
    user: {
      id: string;
      email: string;
      // The FULL staff row, not a hand-narrowed shape. Both callers already
      // fetch it whole; the narrow declaration was hiding the credential
      // fields that decide whether this person may author a clinical note.
      staff: (Staff & { clinic: { name: string } | null }) | null;
    },
    tenant: { id: string; name: string; slug: string | null },
  ) {
    const staff = user.staff!;
    // TASK 1 — the capability roles this person actually holds. Empty means
    // "none assigned yet", and the policy module falls back to the legacy
    // role's mapping rather than locking anybody out mid-migration.
    const assignedRoles = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const rows = await tx.staffRoleAssignment.findMany({
        where: { staffId: staff.id },
        select: { role: true, customRole: { select: { name: true, permissions: true } } },
      });
      const grants = await tx.staffPermissionGrant.findMany({
        where: { staffId: staff.id },
        select: { permission: true },
      });
      return {
        roles: rows.map((row) => row.role).filter((role): role is SystemRole => role !== null),
        customRoleNames: rows
          .map((row) => row.customRole?.name)
          .filter((name): name is string => Boolean(name)),
        // Person-specific additions, each filtered through its own closed
        // list — the session publishes exactly what the policy engine unions.
        extraPermissions: [
          ...grants.map((row) => row.permission).filter(isIndividuallyGrantable),
          ...rows
            .flatMap((row) => row.customRole?.permissions ?? [])
            .filter(isCustomRoleGrantable),
        ],
      };
    });

    const tokens = this.issueTenantTokens({
      sub: user.id,
      tenantId: tenant.id,
      staffId: staff.id,
      role: staff.role,
    });
    return {
      kind: 'tenant' as const,
      ...tokens,
      user: { id: user.id, email: user.email },
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
        clinicId: staff.clinicId,
        clinicName: staff.clinic?.name ?? null,
        // D1 — the CAPABILITY, decided by the same function the write path
        // uses. The Canvas used to re-derive this from the role alone and got
        // a different answer: a credentialed OWNER_ADMIN — the owner who is
        // also the GP, which is most single-doctor clinics in Malaysia — could
        // author a note on the server and was handed a read-only editor by the
        // browser. Two implementations of one clinical permission is one that
        // can disagree, and this one disagreed silently.
        canAuthorNarrative: canAuthorNarrative(staff),
        // TASK 1 — the whole permission set, from the central policy module.
        //
        // The browser renders this rather than deriving a second answer from
        // the role. That is D1's lesson made structural: a permission
        // implemented twice is one that will eventually be implemented
        // differently, and the disagreement is silent until a doctor cannot
        // type.
        permissions: permissionPayload(staff, assignedRoles.roles, assignedRoles.extraPermissions),
        roles: assignedRoles.roles,
        customRoles: assignedRoles.customRoleNames,
      },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      // PHASE 0 — the per-CLINIC catalogue answer, on the first authenticated
      // request, because this is the first moment a tenant exists.
      //
      // It used to be reported at BOOT from a cross-tenant count, which was only
      // ever right because the app connected as a superuser: under real RLS that
      // count is a confident ZERO. Worse, the wording said "this CLINIC holds
      // only N" from a number that described the whole database — reassuring and
      // wrong in both directions on a multi-clinic deployment.
      //
      // An empty catalogue means this clinic's doctors cannot record a diagnosis
      // or prescribe anything, so the browser is told at sign-in rather than
      // finding out when a search box answers nothing.
      catalogue: await this.catalogueHealthForTenant(tenant.id),
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
        include: { user: true, clinic: true },
      });
      if (ownerAdmin) return ownerAdmin;
      return tx.staff.findFirst({
        where: { active: true, userId: { not: null } },
        include: { user: true, clinic: true },
      });
    });
    if (!staff || !staff.user || staff.user.status !== 'active') {
      throw new UnauthorizedException('This clinic has no active staff login to impersonate');
    }

    const assignedRoles = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const rows = await tx.staffRoleAssignment.findMany({
        where: { staffId: staff.id },
        select: { role: true, customRole: { select: { name: true, permissions: true } } },
      });
      const grants = await tx.staffPermissionGrant.findMany({
        where: { staffId: staff.id },
        select: { permission: true },
      });
      return {
        roles: rows.map((row) => row.role).filter((role): role is SystemRole => role !== null),
        customRoleNames: rows
          .map((row) => row.customRole?.name)
          .filter((name): name is string => Boolean(name)),
        // Person-specific additions, each filtered through its own closed
        // list — the session publishes exactly what the policy engine unions.
        extraPermissions: [
          ...grants.map((row) => row.permission).filter(isIndividuallyGrantable),
          ...rows
            .flatMap((row) => row.customRole?.permissions ?? [])
            .filter(isCustomRoleGrantable),
        ],
      };
    });

    const tokens = this.issueTenantTokens({
      sub: staff.user.id,
      tenantId: tenant.id,
      staffId: staff.id,
      role: staff.role,
    });
    return {
      ...tokens,
      user: { id: staff.user.id, email: staff.user.email },
      staff: {
        id: staff.id,
        fullName: staff.fullName,
        role: staff.role,
        clinicId: staff.clinicId,
        clinicName: staff.clinic?.name ?? null,
        // D1 — the CAPABILITY, decided by the same function the write path
        // uses. The Canvas used to re-derive this from the role alone and got
        // a different answer: a credentialed OWNER_ADMIN — the owner who is
        // also the GP, which is most single-doctor clinics in Malaysia — could
        // author a note on the server and was handed a read-only editor by the
        // browser. Two implementations of one clinical permission is one that
        // can disagree, and this one disagreed silently.
        canAuthorNarrative: canAuthorNarrative(staff),
        // TASK 1 — the whole permission set, from the central policy module.
        //
        // The browser renders this rather than deriving a second answer from
        // the role. That is D1's lesson made structural: a permission
        // implemented twice is one that will eventually be implemented
        // differently, and the disagreement is silent until a doctor cannot
        // type.
        permissions: permissionPayload(staff, assignedRoles.roles, assignedRoles.extraPermissions),
        roles: assignedRoles.roles,
        customRoles: assignedRoles.customRoleNames,
      },
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
