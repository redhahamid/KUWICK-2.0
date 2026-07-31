import { Provider } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { tenantContextStorage } from './tenant-context';

// Query-wrapping half of the tenant-context mechanism; the request-scoping
// half is TenantContextMiddleware. Every model query run through the injected
// TENANT_SCOPED_PRISMA client first sets the RLS session variable in the same
// transaction as the query itself — Prisma's own documented pattern for RLS
// integration (a bare SET LOCAL in the middleware alone is not reliable under
// connection pooling).
export const TENANT_SCOPED_PRISMA = Symbol('TENANT_SCOPED_PRISMA');

function createTenantScopedClient(prisma: PrismaService) {
  return prisma.$extends({
    name: 'tenant-scoping',
    query: {
      $allOperations({ args, query }) {
        const store = tenantContextStorage.getStore();
        if (!store) {
          throw new Error(
            'Tenant context not set — every tenant-scoped DB call must run behind TenantContextGuard',
          );
        }
        return prisma
          .$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${store.tenantId}, true)`,
            query(args),
          ])
          .then(([, result]) => result);
      },
    },
  });
}

export type TenantScopedPrismaClient = ReturnType<typeof createTenantScopedClient>;

export const tenantScopedPrismaProvider: Provider = {
  provide: TENANT_SCOPED_PRISMA,
  useFactory: createTenantScopedClient,
  inject: [PrismaService],
};
