import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './core/core.module';
import { TenantContextMiddleware } from './core/tenant-context.middleware';
import { HrModule } from './hr/hr.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CoreModule, HrModule],
})
export class AppModule implements NestModule {
  // Interim tenant-context middleware (docs/DECISIONS.md D-017) applies to
  // every route except the unauthenticated health check.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).exclude('health').forRoutes('*');
  }
}
