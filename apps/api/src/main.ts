import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { writeSync } from 'node:fs';
import { AppModule } from './app.module';
import { assertNotSuperuser } from './core/prisma.service';
import { withSystemConnection } from './core/system-db';

/**
 * A boot failure must never be silent. `console.error` writes through an async
 * stream; when the host captures logs over a pipe (as Render does) and the
 * process exits immediately after a failure, that buffered write can be lost —
 * which is exactly how a failed start showed up as "Exited with status 1" with
 * nothing printed between it and "node dist/main". `writeSync` to fd 2 (stderr)
 * is synchronous and cannot be lost, so the reason is always on the record.
 */
function logToStderr(message: string): void {
  try {
    writeSync(2, message.endsWith('\n') ? message : `${message}\n`);
  } catch {
    // Logging must never throw on the crash path.
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function fatal(context: string, err: unknown): never {
  logToStderr(`\n[bootstrap] FATAL — ${context}. The API is exiting with status 1.`);
  logToStderr(describeError(err));
  process.exit(1);
}

// Safety net for anything that escapes the bootstrap promise chain (e.g. an
// async error thrown from a provider). This preserves Node's default "crash on
// an unhandled error" behaviour but guarantees the reason is printed first.
process.on('unhandledRejection', (reason) => fatal('unhandled promise rejection during startup', reason));
process.on('uncaughtException', (err) => fatal('uncaught exception during startup', err));

/**
 * G4.5-STAGING — CORS is configurable, and unchanged when it is not configured.
 *
 * Local development stays exactly as it was: with no CORS_ORIGINS set, this is
 * `app.enableCors()` and every origin is allowed, which is what every existing
 * script and dev server expects.
 *
 * A deployed environment sets CORS_ORIGINS to the one HTTPS origin its browser
 * front end is served from, because "allow everything" on a public URL means
 * any page on the internet can drive this API with a victim's session.
 */
function corsOptions(): Parameters<Awaited<ReturnType<typeof NestFactory.create>>['enableCors']>[0] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length === 0) return undefined;
  return { origin: configured, credentials: true };
}

async function bootstrap() {
  // PHASE 0 — BEFORE Nest, and on its own connection.
  //
  // Row-level security does not apply to a superuser or to a role with
  // BYPASSRLS, so if the application connects as either then tenant isolation
  // and every append-only guarantee in the schema are unenforced. This refuses
  // to start rather than warning: a warning here means one clinic's patient
  // data is reachable from another and nobody finds out.
  //
  // Deliberately here and not in `PrismaService.onModuleInit`. That was tried
  // and it killed the process: the Prisma client is extended with a
  // tenant-scoping hook that rejects any query outside a request, and a raw
  // query on the service still goes through it. A boot check has no business on
  // the request path — see `withSystemConnection`.
  //
  // The breadcrumbs below are printed synchronously so the deploy log always
  // shows how far startup got: which side of the database check failed, or
  // whether it reached Nest at all.
  logToStderr('[bootstrap] Phase 0 — connecting to the database and verifying the role is NOSUPERUSER/NOBYPASSRLS…');
  await withSystemConnection((query) =>
    assertNotSuperuser(
      (sql) => query(sql) as Promise<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>>,
    ),
  );
  logToStderr('[bootstrap] Phase 0 OK — creating the Nest application…');

  const app = await NestFactory.create(AppModule);
  app.enableCors(corsOptions());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3000;
  // Explicit host: container platforms route to the published port on all
  // interfaces, and a service bound only to loopback is unreachable there.
  await app.listen(port, '0.0.0.0');
  logToStderr(`[bootstrap] Listening on 0.0.0.0:${port} — startup complete.`);
}

// No silent exits: every path out of bootstrap that isn't a listening server
// prints its reason to stderr before the process dies.
bootstrap().catch((err) => fatal('startup failed before the server was listening', err));
