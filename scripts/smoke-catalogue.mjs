#!/usr/bin/env node
/**
 * Fail the build if this environment's clinical catalogue was never loaded.
 *
 * Staging ran for weeks holding ONE diagnosis — the code the E2E seed plants
 * for itself — while every suite stayed green, because the guardrail only
 * ever searched that one code. A doctor found it by typing "urti" into a box
 * that answered nothing. An empty catalogue is a clinic where no diagnosis
 * can be recorded and nothing can be prescribed; it should never reach a
 * person before it reaches a build log.
 *
 *   node scripts/smoke-catalogue.mjs http://localhost:3000
 */
const base = process.argv[2] ?? 'http://localhost:3000';

const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) }).catch((error) => {
  console.error(`smoke-catalogue: /health did not answer: ${error}`);
  process.exit(1);
});

if (!response.ok) {
  console.error(`smoke-catalogue: /health answered ${response.status}`);
  process.exit(1);
}

const { catalogue } = await response.json();

if (!catalogue) {
  console.error('smoke-catalogue: /health carries no catalogue field — is this build older than the check?');
  process.exit(1);
}

if (!catalogue.ok) {
  console.error(`smoke-catalogue: ${catalogue.warning}`);
  process.exit(1);
}

console.log(
  `smoke-catalogue: ${catalogue.diagnoses} diagnoses, ${catalogue.medications} medications — usable.`,
);
