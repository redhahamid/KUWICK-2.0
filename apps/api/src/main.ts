import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { assertNotSuperuser } from './core/prisma.service';
import { withSystemConnection } from './core/system-db';

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
  await withSystemConnection((query) =>
    assertNotSuperuser(
      (sql) => query(sql) as Promise<Array<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>>,
    ),
  );

  const app = await NestFactory.create(AppModule);
  app.enableCors(corsOptions());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3000;
  // Explicit host: container platforms route to the published port on all
  // interfaces, and a service bound only to loopback is unreachable there.
  await app.listen(port, '0.0.0.0');
}

bootstrap();
