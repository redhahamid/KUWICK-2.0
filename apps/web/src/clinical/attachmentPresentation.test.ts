import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  UploadEntry,
  attachmentKind,
  buildUploadQueue,
  canRenderAsImage,
  formatFileSize,
  summariseUploads,
} from './attachmentPresentation';

// ===========================================================================
// G4.5d3c-3c — ATTACHMENTS
//
// Two owner-reported defects: upload behaved as single-file even when several
// were chosen, and PDFs did not present properly. The second is the one with
// clinical consequence — a broken-image glyph inside a patient record reads
// as "the file is missing", not "this is a document".
// ===========================================================================

const file = (name: string, type: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type });

describe('what kind of thing is attached', () => {
  it.each([
    ['1. a photo', 'wound.jpg', 'image/jpeg', 'IMAGE'],
    ['2. a PNG', 'otoscope.png', 'image/png', 'IMAGE'],
    ['3. a PDF', 'referral.pdf', 'application/pdf', 'PDF'],
    ['4. anything else', 'results.docx', 'application/msword', 'OTHER'],
  ])('%s is %s', (_n, fileName, mimeType, expected) => {
    expect(attachmentKind({ fileName, mimeType })).toBe(expected);
  });

  it('5. a PDF sent as octet-stream is still a PDF', () => {
    // Several scanner and phone-share paths send application/octet-stream.
    // Before this fallback such a file rendered as a bare count with no icon,
    // no name and nothing to click.
    expect(attachmentKind({ fileName: 'lab.pdf', mimeType: 'application/octet-stream' })).toBe('PDF');
  });

  it('6. an image sent as octet-stream is still an image', () => {
    expect(attachmentKind({ fileName: 'rash.JPEG', mimeType: 'application/octet-stream' })).toBe('IMAGE');
  });

  it('7. a missing mime type and a missing name are handled without throwing', () => {
    expect(attachmentKind({})).toBe('OTHER');
    expect(attachmentKind({ fileName: null, mimeType: null })).toBe('OTHER');
  });

  it('8. the extension guess never overrides an explicit image mime type', () => {
    expect(attachmentKind({ fileName: 'scan.pdf', mimeType: 'image/png' })).toBe('IMAGE');
  });
});

describe('a PDF is never rendered as a picture', () => {
  it('9. even when a blob URL somehow exists for it', () => {
    // This is the defect: pointing <img> at PDF bytes shows the browser's
    // broken-image glyph inside the clinical record.
    expect(canRenderAsImage({ fileName: 'r.pdf', mimeType: 'application/pdf' }, 'blob:x')).toBe(false);
  });

  it('10. an image with bytes is rendered as a picture', () => {
    expect(canRenderAsImage({ fileName: 'w.png', mimeType: 'image/png' }, 'blob:x')).toBe(true);
  });

  it('11. an image whose bytes could not be fetched falls back to a file card', () => {
    // A blank grey square invites the reader to assume there is nothing there.
    expect(canRenderAsImage({ fileName: 'w.png', mimeType: 'image/png' }, undefined)).toBe(false);
    expect(canRenderAsImage({ fileName: 'w.png', mimeType: 'image/png' }, '')).toBe(false);
  });

  it('12. an unknown type is never a picture', () => {
    expect(canRenderAsImage({ fileName: 'x.docx', mimeType: 'application/msword' }, 'blob:x')).toBe(false);
  });
});

describe('choosing files', () => {
  it('13. the picker offers exactly the four approved types', () => {
    // G4.5d3c-3c1 — narrowed from the `image/*` wildcard, which offered
    // formats (SVG, TIFF, HEIC, BMP) the server does not accept, so the
    // dialog invited uploads that could only fail on arrival.
    expect(ATTACHMENT_ACCEPT).toBe('image/jpeg,image/png,image/webp,application/pdf');
    expect(ATTACHMENT_ACCEPT).not.toContain('image/*');
    expect(ATTACHMENT_ACCEPT).toContain('application/pdf');
  });

  it('14. a queue is built for EVERY chosen file, not just the first', () => {
    const queue = buildUploadQueue([
      file('a.png', 'image/png'),
      file('b.pdf', 'application/pdf'),
      file('c.jpg', 'image/jpeg'),
    ]);
    expect(queue).toHaveLength(3);
    expect(queue.map((entry) => entry.fileName)).toEqual(['a.png', 'b.pdf', 'c.jpg']);
  });

  it('15. every entry starts queued', () => {
    expect(buildUploadQueue([file('a.png', 'image/png')])[0].state).toBe('QUEUED');
  });

  it('16. files with identical names still get distinct keys', () => {
    // Scanning several pages produces scan.pdf, scan.pdf, scan.pdf.
    const queue = buildUploadQueue([
      file('scan.pdf', 'application/pdf', 10),
      file('scan.pdf', 'application/pdf', 10),
    ]);
    expect(new Set(queue.map((entry) => entry.key)).size).toBe(2);
  });

  it('17. an empty selection produces an empty queue', () => {
    expect(buildUploadQueue([])).toEqual([]);
  });
});

describe('one failure does not cancel the successes', () => {
  const entry = (fileName: string, state: UploadEntry['state']): UploadEntry => ({
    key: fileName,
    fileName,
    size: 10,
    state,
  });

  it('18. a wholly successful batch says so', () => {
    const summary = summariseUploads([entry('a', 'DONE'), entry('b', 'DONE')]);
    expect(summary).toMatchObject({ succeeded: 2, failed: 0, tone: 'success' });
    expect(summary.message).toBe('2 files uploaded');
  });

  it('19. a mixed batch reports BOTH numbers', () => {
    // Summarising a mixed batch by its failure alone teaches staff to
    // re-upload everything, which is how duplicates of a wound photo appear.
    const summary = summariseUploads([entry('a', 'DONE'), entry('b', 'FAILED'), entry('c', 'DONE')]);
    expect(summary).toMatchObject({ succeeded: 2, failed: 1, tone: 'warning' });
    expect(summary.message).toMatch(/2 of 3 files uploaded/);
    expect(summary.message).toMatch(/1 failed/);
  });

  it('20. a wholly failed batch is an error, and claims no successes', () => {
    const summary = summariseUploads([entry('a', 'FAILED'), entry('b', 'FAILED')]);
    expect(summary).toMatchObject({ succeeded: 0, failed: 2, tone: 'error' });
    // It must not claim any file landed — "2 files uploaded" and "2 files
    // could not be uploaded" differ by three words and by everything.
    expect(summary.message).toMatch(/could not be uploaded/);
    expect(summary.message).not.toMatch(/\d+ files? uploaded/);
  });

  it('21. a single file is described in the singular', () => {
    expect(summariseUploads([entry('a', 'DONE')]).message).toBe('1 file uploaded');
    expect(summariseUploads([entry('a', 'FAILED')]).message).toBe('1 file could not be uploaded');
  });

  it('22. no summary wording leaks an enum or a status code', () => {
    for (const entries of [
      [entry('a', 'DONE')],
      [entry('a', 'FAILED')],
      [entry('a', 'DONE'), entry('b', 'FAILED')],
    ]) {
      const { message } = summariseUploads(entries);
      expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(message).not.toMatch(/DONE|FAILED|QUEUED|UPLOADING/);
    }
  });
});

describe('file sizes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [3 * 1024 * 1024, '3.0 MB'],
  ])('23. %s bytes reads as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it('24. a nonsense size is a dash, not NaN', () => {
    expect(formatFileSize(Number.NaN)).toBe('—');
    expect(formatFileSize(-1)).toBe('—');
  });
});
