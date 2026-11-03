import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * KUWICK STORES NO PANEL PORTAL CREDENTIAL (N-10).
 *
 * Owner instruction, 2026-11-03, from a competitor's failure: they stored
 * clinic staff's panel portal passwords, the passwords were readable back, and
 * the browser offered to autofill them.
 *
 * WHY THESE CREDENTIALS ARE WORSE THAN MOST. They are for a THIRD PARTY's
 * system — the panel's own portal — shared across a clinic's staff and almost
 * never rotated. One leak reaches every panel a clinic claims from, and Kuwick
 * can revoke exactly none of them. Nothing about the claim workflow needs them
 * either: a human logs into the portal and keys the claim in (D-031), so the
 * most Kuwick can usefully hold is the address.
 *
 * UNTIL THIS FILE, THE PROTECTION WAS ABSENCE. A grep found no such field
 * anywhere — which is the right state and was nobody's decision. The next
 * person to add `portalPassword` beside `portalUrl` would have been doing the
 * obvious, helpful thing, and no test or reviewer note would have stopped
 * them. This fails if they do.
 *
 * It is deliberately a NAME check rather than anything cleverer. The failure
 * being guarded against is not subtle — it is a field called roughly what it
 * is — and a cleverer guard would be a second implementation of the thing it
 * is checking.
 *
 * IF IT IS EVER GENUINELY REQUIRED, the only acceptable shape is write-only
 * (set, never read back), encrypted at rest, with an audit row per reveal —
 * and that is a new owner decision, which means editing this file on purpose.
 */
const API = join(__dirname, '..', '..');

/** What a credential field gets called, in practice. */
const CREDENTIAL = /\b\w*(password|passwd|passcode|pwd|secret|credential|apikey|api_key)\w*\b/i;

/** `portalUrl` is the thing we DO keep, and `accountReference` is a customer
    number on an invoice, not a secret. Named so the guard does not have to be
    loosened later by somebody who assumes it is over-broad. */
const ALLOWED = ['portalUrl', 'portal_url', 'accountReference', 'account_reference'];

const lines = (source: string) =>
  source
    // The explanations in this repo discuss passwords at length, deliberately.
    // A comment is not a column.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/\/.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .split('\n');

describe('the panel domain', () => {
  it('has a PanelClinic model to check, so this file means something', () => {
    const schema = readFileSync(join(API, 'prisma', 'schema.prisma'), 'utf-8');
    expect(schema).toContain('model PanelClinic {');
    expect(schema).toContain('portalUrl');
  });

  it('keeps no portal credential on PanelClinic', () => {
    const schema = readFileSync(join(API, 'prisma', 'schema.prisma'), 'utf-8');
    const model = schema.slice(
      schema.indexOf('model PanelClinic {'),
      schema.indexOf('\n}', schema.indexOf('model PanelClinic {')),
    );
    const offenders = lines(model).filter(
      (line) => CREDENTIAL.test(line) && !ALLOWED.some((name) => line.includes(name)),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps no portal credential on any panel DTO', () => {
    const dtoDir = join(__dirname, 'dto');
    const offenders: string[] = [];
    for (const file of readdirSync(dtoDir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(dtoDir, file), 'utf-8');
      for (const line of lines(source)) {
        if (CREDENTIAL.test(line) && !ALLOWED.some((name) => line.includes(name))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps no portal credential anywhere in the panel module', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(__dirname).filter(
      // This file names them all, by necessity.
      (name) => name.endsWith('.ts') && name !== 'panel-no-portal-credentials.spec.ts',
    )) {
      const source = readFileSync(join(__dirname, file), 'utf-8');
      for (const line of lines(source)) {
        if (CREDENTIAL.test(line) && !ALLOWED.some((name) => line.includes(name))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
