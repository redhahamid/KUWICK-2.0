import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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
  const app = await NestFactory.create(AppModule);
  app.enableCors(corsOptions());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = process.env.PORT ?? 3000;
  // Explicit host: container platforms route to the published port on all
  // interfaces, and a service bound only to loopback is unreachable there.
  await app.listen(port, '0.0.0.0');
}

bootstrap();
