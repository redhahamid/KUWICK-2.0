import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TENANT_SCOPED_PRISMA, tenantScopedPrismaProvider } from './tenant-scoped-prisma.provider';

// Foundation module: Tenant, Clinic, User, Patient, GlobalSetting,
// NotificationLog, AuditLog, plus the interim tenant-context middleware/client
// (docs/DECISIONS.md D-017). RBAC guard and the audit interceptor described
// in docs/SYSTEM_ARCHITECTURE.md land once real auth exists.
@Module({
  providers: [PrismaService, TenantContextMiddleware, tenantScopedPrismaProvider],
  controllers: [HealthController],
  exports: [PrismaService, TenantContextMiddleware, TENANT_SCOPED_PRISMA],
})
export class CoreModule {}
