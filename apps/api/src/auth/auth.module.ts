import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '../core/core.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';

// Real auth, D-034. AuthController's routes (login/refresh/platform-login)
// and PlatformTenantController's routes are both excluded from
// TenantContextMiddleware in AppModule — the former because you can't be
// required to hold a token to obtain one, the latter because platform-admin
// tokens carry no tenantId claim to verify against.
@Module({
  imports: [CoreModule, JwtModule.register({})],
  controllers: [AuthController, PlatformTenantController],
  providers: [AuthService, PlatformAuthGuard, PlatformTenantService],
})
export class AuthModule {}
