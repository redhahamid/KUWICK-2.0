import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';

// Foundation module: Tenant, Clinic, User, Patient, GlobalSetting,
// NotificationLog, AuditLog. RBAC guards, tenant-isolation guard, and the
// audit interceptor described in docs/SYSTEM_ARCHITECTURE.md land here as
// Phase 1 begins — not part of initialization.
@Module({
  providers: [PrismaService],
  controllers: [HealthController],
  exports: [PrismaService],
})
export class CoreModule {}
