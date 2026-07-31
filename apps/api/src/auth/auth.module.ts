import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '../core/core.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';
import { SubscriptionPlanController } from './subscription-plan.controller';
import { SubscriptionPlanService } from './subscription-plan.service';
import { TenantSubscriptionController } from './tenant-subscription.controller';
import { TenantSubscriptionService } from './tenant-subscription.service';
import { DefaultCatalogController } from './default-catalog.controller';
import { DefaultCatalogService } from './default-catalog.service';
import { PlatformDashboardController } from './platform-dashboard.controller';
import { PlatformDashboardService } from './platform-dashboard.service';
import { PlatformSettingService } from './platform-setting.service';

// Real auth (D-034) + Platform console (D-037). AuthController's routes
// (login/refresh/platform-login) and every platform/* controller are all
// excluded from TenantContextMiddleware in AppModule — the former because
// you can't be required to hold a token to obtain one, the latter because
// platform-admin tokens carry no tenantId claim to verify against
// (PlatformAuthGuard guards them instead).
@Module({
  imports: [CoreModule, JwtModule.register({})],
  controllers: [
    AuthController,
    PlatformTenantController,
    SubscriptionPlanController,
    TenantSubscriptionController,
    DefaultCatalogController,
    PlatformDashboardController,
  ],
  providers: [
    AuthService,
    PlatformAuthGuard,
    PlatformTenantService,
    SubscriptionPlanService,
    TenantSubscriptionService,
    DefaultCatalogService,
    PlatformDashboardService,
    PlatformSettingService,
  ],
})
export class AuthModule {}
