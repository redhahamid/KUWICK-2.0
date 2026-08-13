import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PHASE 0 — the boot check that stops a misconfigured environment from silently
 * losing every row-level guarantee.
 *
 * Row-level security is not applied to a superuser, and it is not applied to a
 * role with BYPASSRLS. Every tenant-isolation policy in this schema, and every
 * append-only claim that rests on one, is therefore worth exactly nothing if the
 * application connects as either. That is not hypothetical: it was the state of
 * this project in every environment until it was measured — the postgres image
 * makes POSTGRES_USER a superuser, and the local container role was created that
 * way as well.
 *
 * So the application refuses to start. Loudly, at boot, naming the role and what
 * to do about it — not as a warning in a log nobody reads, because a warning
 * here means patient data from one clinic is reachable from another and the
 * clinic has no way to find that out.
 *
 * `KUWICK_ALLOW_SUPERUSER_DB=yes` exists for exactly one situation: a developer
 * who has not yet provisioned the app role and is not testing isolation. It says
 * what it costs when it is used.
 */
export async function assertNotSuperuser(
  query: (sql: string) => Promise<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>>,
  allowOverride = process.env.KUWICK_ALLOW_SUPERUSER_DB === 'yes',
  warn: (message: string) => void = console.warn,
): Promise<void> {
  const rows = await query(
    'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  const role = rows[0];
  // A role we cannot read is not a role we may assume is safe — but neither is
  // it grounds to refuse boot, because `pg_roles` is readable by everyone and a
  // failure here means something else is wrong. Say so and continue.
  if (!role) {
    warn('[Database] Could not determine the connected role; RLS enforcement is unverified.');
    return;
  }
  if (!role.rolsuper && !role.rolbypassrls) return;

  const why = role.rolsuper ? 'a SUPERUSER' : 'has BYPASSRLS';
  const message =
    `[Database] The application is connected as "${role.rolname}", which is ${why}. ` +
    'Row-level security does NOT apply to such a role, so tenant isolation and every ' +
    'append-only guarantee in this schema are unenforced. Create a dedicated role ' +
    '(NOSUPERUSER NOBYPASSRLS) and point DATABASE_URL at it — see ' +
    'docs/STAGING_DEPLOYMENT.md. To run anyway, knowing isolation is off, set ' +
    'KUWICK_ALLOW_SUPERUSER_DB=yes.';

  if (allowOverride) {
    warn(`${message} (continuing because KUWICK_ALLOW_SUPERUSER_DB=yes)`);
    return;
  }
  throw new Error(message);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleInit() {
    await this.$connect();
    // NOT CALLED FROM HERE YET, and the reason is worth knowing before trying
    // again: `tenant-scoped-prisma.provider` extends this client with an
    // `$allOperations` hook that throws "Tenant context not set" for any query
    // outside a request. A raw query issued here goes through that hook, so the
    // check killed the process at boot — measured, not guessed.
    //
    // The check itself is complete and tested (`assertNotSuperuser` above, 7
    // cases). Wiring it needs a connection that does NOT go through the
    // extension — a short-lived `pg` client built from DATABASE_URL in
    // `main.ts` before Nest starts is the obvious shape, since PrismaPg already
    // brings `pg` in. That is the next step, and it is the ONLY thing standing
    // between here and connecting as `kuwick_app`.
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
