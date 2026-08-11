import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

/**
 * G4.5d3c-3c1 — what a clinical attachment is allowed to be.
 *
 * The endpoint enforced a size limit and nothing else. The browser's `accept`
 * attribute is a picker hint: it stops nobody, because a direct caller never
 * opens a file picker. Anything at all could be written into a patient's
 * record and served back with whatever Content-Type it claimed.
 *
 * Four types for v1, and no others. HEIC and TIFF are deliberately absent —
 * neither previews in the record today, and admitting a format the reader
 * cannot open is how a clinical image becomes a download nobody looks at.
 *
 * VALIDATION IS NOT BY EXTENSION. An extension is a naming convention, not a
 * fact about the bytes, and `payload.exe` renamed to `report.pdf` satisfies
 * every filename rule ever written. Three independent checks must all pass:
 *
 *   1. the DECLARED MIME type is on the allow-list;
 *   2. the EXTENSION is on the allow-list AND agrees with the declared type;
 *   3. the FILE'S OWN LEADING BYTES identify it as that type.
 *
 * The third is the one that cannot be talked around by a caller, and it is
 * available here for free: the upload interceptor uses `memoryStorage`, so
 * the whole buffer exists in memory before anything reaches disk. No new
 * dependency, no format parsing, no execution of the file's content — just a
 * comparison of the first few bytes against a fixed table.
 *
 * What this deliberately does NOT do: decode, re-encode, transcode or
 * sanitise image content. That needs an image library, which is a large
 * dependency with its own history of parser vulnerabilities, on a path that
 * handles hostile input. Signature checking plus a strict allow-list is the
 * strongest thing available without importing that risk.
 */

export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

interface TypeRule {
  mimeType: AllowedMimeType;
  /** Every extension a clinic legitimately produces for this type. */
  extensions: string[];
  /** Returns true when the buffer's leading bytes identify this type. */
  matchesSignature(buffer: Buffer): boolean;
}

const TYPE_RULES: TypeRule[] = [
  {
    mimeType: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    // SOI marker, then the start of the first segment.
    matchesSignature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    extensions: ['.png'],
    // \x89PNG\r\n\x1a\n — the full eight-byte signature, which also catches
    // a file mangled by a text-mode transfer.
    matchesSignature: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mimeType: 'image/webp',
    extensions: ['.webp'],
    // A RIFF container whose form type is WEBP. Both halves are required:
    // "RIFF" alone is also a WAV or an AVI.
    matchesSignature: (b) =>
      b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mimeType: 'application/pdf',
    extensions: ['.pdf'],
    // "%PDF-". The specification permits leading junk before the header, but
    // a clinic scanner does not emit it and accepting arbitrary prefixes
    // would reopen the hole this check exists to close.
    matchesSignature: (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export const ALLOWED_MIME_TYPES: AllowedMimeType[] = TYPE_RULES.map((rule) => rule.mimeType);
export const ALLOWED_EXTENSIONS: string[] = TYPE_RULES.flatMap((rule) => rule.extensions);

/**
 * The one message a caller sees, whichever check failed.
 *
 * Deliberately uniform. Telling an attacker *which* of the three checks they
 * tripped is a free oracle for probing the next attempt, and it tells a
 * clinic nothing they can act on — the remedy for every case is the same
 * four types.
 */
export const UNSUPPORTED_FILE_MESSAGE = 'Unsupported file type. Upload JPG, PNG, WebP or PDF.';

/**
 * Strip a filename down to something safe to store, display and put in a
 * Content-Disposition header.
 *
 * The stored name is not just a label: it is rendered in the record, used as
 * the download filename, and echoed into a response header. Path separators,
 * control characters, quotes and newlines all have to go — a newline in a
 * header value is a response-splitting primitive, and `../` in a name that
 * later reaches any path join is a traversal.
 *
 * The name is only ever cosmetic on disk: `saveUploadedFile` writes under a
 * fresh UUID, so this cannot influence where bytes land.
 */
export function sanitiseAttachmentFileName(originalName: string): string {
  const base = path.basename(originalName ?? '');
  const cleaned = base
    // Control characters, including CR and LF: a newline in a header value
    // is a response-splitting primitive.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    // Quotes and path separators: the first would break out of the quoted
    // Content-Disposition filename, the rest are path syntax.
    .replace(/["'\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A long name is a display problem, not a security one, but an unbounded
  // one is both.
  const bounded = cleaned.slice(0, 180);
  return bounded || 'attachment';
}

export interface ValidatedAttachment {
  mimeType: AllowedMimeType;
  fileName: string;
}

/**
 * Accept the file, or refuse it. There is no third outcome and no "allowed
 * but suspicious" path.
 */
export function validateClinicalAttachment(file: {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
  size?: number;
}): ValidatedAttachment {
  const declared = (file.mimetype ?? '').toLowerCase().split(';')[0].trim();
  const rule = TYPE_RULES.find((candidate) => candidate.mimeType === declared);
  if (!rule) {
    throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
  }

  const fileName = sanitiseAttachmentFileName(file.originalname ?? '');
  const extension = path.extname(fileName).toLowerCase();
  // The extension must be one this type actually uses. A PNG declared as
  // image/png but named `.pdf` is a mismatch, and a mismatch is a lie about
  // one of the two — there is no reason to guess which.
  if (!rule.extensions.includes(extension)) {
    throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
  }

  const buffer = file.buffer;
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
  }
  // The check a caller cannot satisfy by renaming or relabelling.
  if (!rule.matchesSignature(buffer)) {
    throw new BadRequestException(UNSUPPORTED_FILE_MESSAGE);
  }

  return { mimeType: rule.mimeType, fileName };
}
