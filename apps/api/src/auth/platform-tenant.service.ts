import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantOwnerDto } from './dto/update-tenant-owner.dto';

const TRIAL_DURATION_DAYS = 14;
const PASSWORD_HASH_ROUNDS = 10;
// Task Orders (procedures) default to a nominal duration since the owner's
// "Default Procedures" reference screen has no duration field of its own —
// clinics can adjust it per-tenant after the copy lands in their own
// ServiceCatalog.
const DEFAULT_PROCEDURE_DURATION_MINUTES = 15;

// Platform-admin tenant management (D-034/D-037) — deliberately cross-tenant
// (creating/onboarding new clinic businesses onto the SaaS), so this uses
// plain PrismaService, never TENANT_SCOPED_PRISMA. Guarded by
// PlatformAuthGuard, not TenantContextMiddleware.
//
// Every call sets app.bypass_tenant_scope first (migration
// 20260731280000): the tenants table's RLS policy normally requires
// id = app.tenant_id, which no platform-admin operation can satisfy (there
// is no single tenant being scoped to — that's the point of this service).
@Injectable()
export class PlatformTenantService {
  constructor(private readonly prisma: PrismaService) {}

  private async withBypass<T>(fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return fn(tx);
    });
  }

  // Once a tenant exists, everything it owns (its first Clinic, seeded
  // catalogs, a trial subscription) is ordinary tenant-scoped data — setting
  // app.tenant_id to the new tenant's own id satisfies every other table's
  // normal tenant_isolation policy without needing the bypass GUC at all.
  private async withTenantScope<T>(
    tenantId: string,
    fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  // D-049 — the slug is auto-derived from the clinic name ("Klinik Alpha
  // Kajang" → klinik-alpha-kajang, then -2/-3... if taken) so the platform
  // console never has to ask for it; since unified login, it only matters
  // in the rare multi-clinic-email disambiguation case.
  private async resolveSlug(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], name: string) {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'clinic';
    const taken = new Set(
      (await tx.tenant.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((t) => t.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i += 1) {
      if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    }
  }

  async create(dto: CreateTenantDto) {
    const tenant = await this.withBypass(async (tx) =>
      tx.tenant.create({
        data: { name: dto.name, slug: dto.slug ?? (await this.resolveSlug(tx, dto.name)), registrationNo: dto.registrationNo },
      }),
    );

    // Hash outside the transaction — bcrypt at 10 rounds takes ~100ms and
    // has no business holding a DB transaction open.
    const ownerPasswordHash =
      dto.ownerEmail && dto.ownerPassword ? await bcrypt.hash(dto.ownerPassword, PASSWORD_HASH_ROUNDS) : null;

    await this.withTenantScope(tenant.id, async (tx) => {
      const clinic = await tx.clinic.create({
        data: { tenantId: tenant.id, name: dto.name, address: dto.address, phone: dto.phone, email: dto.email },
      });

      // D-049 — the clinic's first OWNER_ADMIN login, so the clinic owner
      // can sign in on day one and create their own staff logins
      // (Management > HR > Staff). Home clinic set to the first branch —
      // a single-location tenant auto-resolves everywhere (D-045).
      if (ownerPasswordHash && dto.ownerEmail) {
        const ownerUser = await tx.user.create({
          data: { tenantId: tenant.id, email: dto.ownerEmail, passwordHash: ownerPasswordHash },
        });
        await tx.staff.create({
          data: {
            tenantId: tenant.id,
            userId: ownerUser.id,
            role: 'OWNER_ADMIN',
            fullName: dto.ownerFullName?.trim() || 'Clinic Owner',
            clinicId: clinic.id,
          },
        });
      }

      const [defaultPanels, defaultProcedures, defaultDocumentTemplates] = await Promise.all([
        tx.defaultPanelClinic.findMany({ where: { active: true } }),
        tx.defaultProcedure.findMany({ where: { active: true } }),
        tx.defaultDocumentTemplate.findMany({ where: { active: true } }),
      ]);
      if (defaultPanels.length > 0) {
        await tx.panelClinic.createMany({
          data: defaultPanels.map((panel) => ({ tenantId: tenant.id, name: panel.name })),
        });
      }
      if (defaultProcedures.length > 0) {
        await tx.serviceCatalog.createMany({
          data: defaultProcedures.map((procedure) => ({
            tenantId: tenant.id,
            name: procedure.name,
            code: procedure.code,
            price: procedure.price,
            orderType: 'TASK_ORDER',
            durationMinutesDefault: DEFAULT_PROCEDURE_DURATION_MINUTES,
          })),
        });
      }

      if (defaultDocumentTemplates.length > 0) {
        await tx.customDocumentTemplate.createMany({
          data: defaultDocumentTemplates.map((template) => ({
            tenantId: tenant.id,
            name: template.name,
            content: template.content,
            sourceDefaultId: template.id,
          })),
        });
      }

      if (dto.startAsTrial) {
        const endsAt = new Date();
        endsAt.setDate(endsAt.getDate() + TRIAL_DURATION_DAYS);
        await tx.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'TRIAL', endsAt } });
      }
    });

    return tenant;
  }

  // The tenants + tenant_subscriptions reads honor app.bypass_tenant_scope,
  // but clinics/staff/patients RLS policies deliberately do not — so each
  // tenant's own stats are read in that tenant's ordinary scope instead.
  // N+1 by design: the platform operator has tens of tenants, not thousands,
  // and widening the bypass GUC into every table's policy just to save a few
  // queries here would weaken the whole isolation model.
  async findAll() {
    const tenants = await this.withBypass((tx) =>
      tx.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: true } } },
      }),
    );

    return Promise.all(
      tenants.map(async (tenant) => {
        const stats = await this.withTenantScope(tenant.id, async (tx) => {
          const [clinic, staffCount, patientCount, ownerStaff] = await Promise.all([
            tx.clinic.findFirst({ where: { tenantId: tenant.id } }),
            tx.staff.count({ where: { tenantId: tenant.id } }),
            tx.patient.count({ where: { tenantId: tenant.id } }),
            tx.staff.findFirst({
              where: { role: 'OWNER_ADMIN', userId: { not: null } },
              include: { user: { select: { email: true } } },
            }),
          ]);
          return { clinic, staffCount, patientCount, ownerStaff };
        });
        return {
          ...tenant,
          clinics: stats.clinic ? [stats.clinic] : [],
          owner: stats.ownerStaff
            ? { staffId: stats.ownerStaff.id, fullName: stats.ownerStaff.fullName, email: stats.ownerStaff.user!.email }
            : null,
          _count: { staff: stats.staffCount, patients: stats.patientCount },
        };
      }),
    );
  }

  async findById(id: string) {
    const tenant = await this.withBypass((tx) => tx.tenant.findUnique({ where: { id } }));
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  // D-049 — Edit Clinic in the console: tenant-level fields live on Tenant,
  // contact details live on the tenant's first Clinic row (same split as
  // create). Renaming the tenant renames that clinic too — for a
  // single-location tenant (every clinic onboarded so far) they are the
  // same real-world thing, and multi-branch tenants rename branches from
  // their own Management > Operation > Clinics screen.
  async update(id: string, dto: UpdateTenantDto) {
    await this.findById(id);
    const { address, phone, email, ...tenantFields } = dto;
    const tenant = await this.withBypass((tx) => tx.tenant.update({ where: { id }, data: tenantFields }));

    if (address !== undefined || phone !== undefined || email !== undefined || tenantFields.name !== undefined) {
      await this.withTenantScope(id, async (tx) => {
        const clinic = await tx.clinic.findFirst({ where: { tenantId: id }, orderBy: { createdAt: 'asc' } });
        if (clinic) {
          await tx.clinic.update({
            where: { id: clinic.id },
            data: {
              ...(tenantFields.name !== undefined ? { name: tenantFields.name } : {}),
              ...(address !== undefined ? { address } : {}),
              ...(phone !== undefined ? { phone } : {}),
              ...(email !== undefined ? { email } : {}),
            },
          });
        }
      });
    }
    return tenant;
  }

  // D-049 — edit the tenant's OWNER_ADMIN login (name/email/password;
  // password omitted = unchanged). A tenant with no owner login yet
  // (created before owner-at-creation existed) gets one created instead —
  // all three fields required in that case, since there's nothing to
  // partially update.
  async updateOwner(id: string, dto: UpdateTenantOwnerDto) {
    await this.findById(id);
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS) : null;

    return this.withTenantScope(id, async (tx) => {
      const owner = await tx.staff.findFirst({
        where: { role: 'OWNER_ADMIN', userId: { not: null } },
        include: { user: true },
      });

      try {
        if (!owner) {
          if (!dto.fullName || !dto.email || !dto.password) {
            throw new BadRequestException(
              'This clinic has no owner login yet — full name, email, and password are all required to create one',
            );
          }
          const clinic = await tx.clinic.findFirst({ where: { tenantId: id }, orderBy: { createdAt: 'asc' } });
          const user = await tx.user.create({ data: { tenantId: id, email: dto.email, passwordHash: passwordHash! } });
          const staff = await tx.staff.create({
            data: { tenantId: id, userId: user.id, role: 'OWNER_ADMIN', fullName: dto.fullName, clinicId: clinic?.id ?? null },
          });
          return { staffId: staff.id, fullName: staff.fullName, email: user.email };
        }

        if (dto.fullName !== undefined) {
          await tx.staff.update({ where: { id: owner.id }, data: { fullName: dto.fullName } });
        }
        if (dto.email !== undefined || passwordHash) {
          await tx.user.update({
            where: { id: owner.userId! },
            data: {
              ...(dto.email !== undefined ? { email: dto.email } : {}),
              ...(passwordHash ? { passwordHash } : {}),
            },
          });
        }
        return {
          staffId: owner.id,
          fullName: dto.fullName ?? owner.fullName,
          email: dto.email ?? owner.user!.email,
        };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('A user with this email already exists for this clinic');
        }
        throw error;
      }
    });
  }
}
