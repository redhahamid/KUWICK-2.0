import { createHash } from 'node:crypto';

// C0 (D-051) — deterministic content hashing for signed clinical records.
//
// A signed note must be verifiable later: "is this byte-for-byte what the
// doctor signed?" That requires the SAME clinical content to always produce
// the SAME hash, independent of JavaScript object key order, Decimal
// formatting (36.5 vs 36.50 are the same clinical value), or Unicode
// normalisation form.
//
// HASH_SCHEMA_VERSION is stored alongside every hash so these rules can be
// changed later without making historical hashes look invalid — a verifier
// re-canonicalises using the version recorded on the revision row, not the
// version that happens to be current.
export const HASH_SCHEMA_VERSION = 1;

// Fixed field order, defined in CODE rather than derived from object keys —
// a renamed/reordered TypeScript interface must not silently change hashes.
const NOTE_FIELDS = [
  'noteType',
  'notes',
  'noteLanguage',
  'status',
  'entryType',
  'clinicalEntryAt',
  'lateEntryReason',
  'supersedesNoteId',
  'amendmentReason',
] as const;

const OBSERVATION_FIELDS = [
  'bpSystolic',
  'bpDiastolic',
  'pulse',
  'temperature',
  'spo2',
  'respRate',
  'painScore',
  'weight',
  'height',
  'headCircumference',
  'glucose',
  'source',
] as const;

// Decimal columns arrive from Prisma as Decimal | string | number depending
// on the call path. Normalise to a fixed-scale decimal string so 36.5, 36.50
// and Decimal(36.5) all canonicalise identically. Non-finite input is
// rejected rather than silently hashed as something else.
function normaliseScalar(value: unknown, scale?: number): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'boolean') {
    return value;
  }
  // Decimal-scaled fields are normalised FIRST, before the string branch:
  // Prisma hands Decimal columns back as a string on some code paths and as a
  // Decimal object on others, so '36.50', 36.5 and Decimal(36.5) must all
  // collapse to the same canonical form. Checking `typeof value === 'string'`
  // ahead of this would NFC-normalise '36.50' into a different hash than 36.5
  // — caught by the canonical-content-hash spec.
  if (scale !== undefined) {
    const numeric = Number(value as number | string);
    if (Number.isFinite(numeric)) {
      return numeric.toFixed(scale);
    }
  }
  if (typeof value === 'string') {
    // NFC so visually identical text hashes identically regardless of the
    // composition form the browser submitted.
    return value.normalize('NFC');
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  // Prisma Decimal (decimal.js) — has toFixed/toString but isn't a JS number.
  const maybeDecimal = value as { toFixed?: (n: number) => string; toString: () => string };
  if (typeof maybeDecimal.toFixed === 'function' && scale !== undefined) {
    return maybeDecimal.toFixed(scale);
  }
  return String(maybeDecimal.toString()).normalize('NFC');
}

// Column scales mirror schema.prisma exactly — @db.Decimal(4,1) / (5,2).
const DECIMAL_SCALE: Record<string, number> = {
  temperature: 1,
  weight: 2,
  height: 2,
  headCircumference: 2,
  glucose: 2,
};

function canonicalise(source: Record<string, unknown>, fields: readonly string[]): string {
  // Serialise from an explicit ordered array of [key, value] pairs rather
  // than an object literal, so no JS engine's key-ordering rules can affect
  // the output. Nulls are retained explicitly, never omitted — "field was
  // cleared" and "field was never present" must not collide.
  const pairs = fields.map((field) => [field, normaliseScalar(source[field], DECIMAL_SCALE[field])]);
  return JSON.stringify(pairs);
}

export interface CanonicalHash {
  contentHash: string;
  hashSchemaVersion: number;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashNoteContent(note: Record<string, unknown>): CanonicalHash {
  return { contentHash: sha256(canonicalise(note, NOTE_FIELDS)), hashSchemaVersion: HASH_SCHEMA_VERSION };
}

export function hashObservationContent(observation: Record<string, unknown>): CanonicalHash {
  return {
    contentHash: sha256(canonicalise(observation, OBSERVATION_FIELDS)),
    hashSchemaVersion: HASH_SCHEMA_VERSION,
  };
}

// The exact payload persisted into a revision's content_snapshot. Kept
// alongside the hash functions so the snapshot and the hash can never drift
// apart — both read the same field lists.
export function noteContentSnapshot(note: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(NOTE_FIELDS.map((f) => [f, normaliseScalar(note[f], DECIMAL_SCALE[f])]));
}

export function observationContentSnapshot(observation: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    OBSERVATION_FIELDS.map((f) => [f, normaliseScalar(observation[f], DECIMAL_SCALE[f])]),
  );
}
