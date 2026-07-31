import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './core/core.module';
import { TenantContextMiddleware } from './core/tenant-context.middleware';
import { AuthModule } from './auth/auth.module';
import { HrModule } from './hr/hr.module';
import { AppointmentModule } from './appointment/appointment.module';
import { InventoryModule } from './inventory/inventory.module';
import { ClinicalModule } from './clinical/clinical.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CoreModule,
    AuthModule,
    HrModule,
    AppointmentModule,
    InventoryModule,
    ClinicalModule,
    ReportsModule,
  ],
})
export class AppModule implements NestModule {
  // Real auth (D-034) — TenantContextMiddleware now verifies a JWT access
  // token. Excluded: the unauthenticated health check, the login/refresh/
  // platform-login routes themselves (a client cannot be required to hold a
  // token to obtain one), and every platform-admin route (guarded instead by
  // PlatformAuthGuard, since a platform-admin token carries no tenantId
  // claim to verify against).
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantContextMiddleware)
      .exclude('health', 'auth/login', 'auth/refresh', 'auth/platform/login', 'platform', 'platform/(.*)')
      .forRoutes('*');
  }
}
