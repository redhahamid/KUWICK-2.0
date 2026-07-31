import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TENANT_SCOPED_PRISMA, tenantScopedPrismaProvider } from './tenant-scoped-prisma.provider';
import { ClinicController } from './clinic.controller';
import { ClinicService } from './clinic.service';
import { PatientController } from './patient.controller';
import { PatientService } from './patient.service';
import { GlobalSettingController } from './global-setting.controller';
import { GlobalSettingService } from './global-setting.service';

// Foundation module: Tenant, Clinic, User, Patient, GlobalSetting,
// NotificationLog, AuditLog, plus the tenant-context middleware/client
// (docs/DECISIONS.md D-017/D-034). JwtModule.register({}) with no default
// secret/options — every sign()/verify() call in this codebase passes its
// own secret explicitly (JWT_ACCESS_SECRET vs JWT_REFRESH_SECRET), so there
// is no shared module-level config to get wrong. Per-endpoint RBAC guard and
// the audit interceptor described in docs/SYSTEM_ARCHITECTURE.md are a
// follow-up phase (D-034), not built here.
@Module({
  imports: [JwtModule.register({})],
  providers: [
    PrismaService,
    TenantContextMiddleware,
    tenantScopedPrismaProvider,
    ClinicService,
    PatientService,
    GlobalSettingService,
  ],
  controllers: [HealthController, ClinicController, PatientController, GlobalSettingController],
  exports: [PrismaService, TenantContextMiddleware, TENANT_SCOPED_PRISMA, JwtModule],
})
export class CoreModule {}
