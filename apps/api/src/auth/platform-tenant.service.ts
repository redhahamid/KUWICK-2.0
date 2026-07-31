import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

const TRIAL_DURATION_DAYS = 14;
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

  async create(dto: CreateTenantDto) {
    const tenant = await this.withBypass((tx) =>
      tx.tenant.create({ data: { name: dto.name, slug: dto.slug, registrationNo: dto.registrationNo } }),
    );

    await this.withTenantScope(tenant.id, async (tx) => {
      await tx.clinic.create({
        data: { tenantId: tenant.id, name: dto.name, address: dto.address, phone: dto.phone, email: dto.email },
      });

      const [defaultPanels, defaultProcedures] = await Promise.all([
        tx.defaultPanelClinic.findMany({ where: { active: true } }),
        tx.defaultProcedure.findMany({ where: { active: true } }),
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
          const [clinic, staffCount, patientCount] = await Promise.all([
            tx.clinic.findFirst({ where: { tenantId: tenant.id } }),
            tx.staff.count({ where: { tenantId: tenant.id } }),
            tx.patient.count({ where: { tenantId: tenant.id } }),
          ]);
          return { clinic, staffCount, patientCount };
        });
        return {
          ...tenant,
          clinics: stats.clinic ? [stats.clinic] : [],
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

  async update(id: string, dto: UpdateTenantDto) {
    await this.findById(id);
    return this.withBypass((tx) => tx.tenant.update({ where: { id }, data: dto }));
  }
}
