import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './core/core.module';
import { TenantContextMiddleware } from './core/tenant-context.middleware';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CoreModule],
})
export class AppModule implements NestModule {
  // Interim tenant-context middleware (docs/DECISIONS.md D-017) applies to
  // every route except the unauthenticated health check.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).exclude('health').forRoutes('*');
  }
}
