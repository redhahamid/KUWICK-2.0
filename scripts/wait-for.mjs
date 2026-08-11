#!/usr/bin/env node
/**
 * Wait until every URL given on the command line answers, or give up loudly.
 *
 * A test suite that starts before the server does fails with a timeout deep
 * inside a page object, which reads as "the app is broken" rather than "the
 * app had not started". This makes the difference visible in one line.
 *
 *   node scripts/wait-for.mjs http://localhost:3000/health http://localhost:5173
 */
const TIMEOUT_MS = Number(process.env.WAIT_FOR_TIMEOUT_MS ?? 120_000);
const INTERVAL_MS = 1_000;

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('wait-for: no URLs given');
  process.exit(1);
}

/** Any answer at all counts. A 404 still proves something is listening. */
async function isUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

const startedAt = Date.now();
for (const url of targets) {
  process.stdout.write(`wait-for ${url} `);
  for (;;) {
    if (await isUp(url)) {
      console.log(`up (${Math.round((Date.now() - startedAt) / 1000)}s)`);
      break;
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      console.log('TIMED OUT');
      console.error(`wait-for: ${url} never answered within ${TIMEOUT_MS}ms`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}
