import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  UNSUPPORTED_FILE_MESSAGE,
  sanitiseAttachmentFileName,
  validateClinicalAttachment,
} from './attachment-validation';

// ===========================================================================
// G4.5d3c-3c1 — SERVER-SIDE ATTACHMENT VALIDATION
//
// The endpoint enforced a size limit and nothing else, so anything at all
// could be written into a patient's record. The browser's `accept` attribute
// stops nobody: a direct caller never opens a file picker.
//
// Every test below either accepts one of the four approved types or refuses
// something that lied about being one.
// ===========================================================================

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);
const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary');

const file = (originalname: string, mimetype: string, buffer: Buffer) => ({
  originalname,
  mimetype,
  buffer,
  size: buffer.length,
});

const refuses = (input: Parameters<typeof validateClinicalAttachment>[0]) => {
  expect(() => validateClinicalAttachment(input)).toThrow(BadRequestException);
  expect(() => validateClinicalAttachment(input)).toThrow(UNSUPPORTED_FILE_MESSAGE);
};

describe('the approved v1 types are accepted', () => {
  it('1. JPEG', () => {
    expect(validateClinicalAttachment(file('wound.jpg', 'image/jpeg', JPEG))).toEqual({
      mimeType: 'image/jpeg',
      fileName: 'wound.jpg',
    });
  });

  it('2. JPEG with the .jpeg spelling', () => {
    expect(validateClinicalAttachment(file('wound.jpeg', 'image/jpeg', JPEG)).mimeType).toBe('image/jpeg');
  });

  it('3. PNG', () => {
    expect(validateClinicalAttachment(file('otoscope.png', 'image/png', PNG)).mimeType).toBe('image/png');
  });

  it('4. WebP', () => {
    expect(validateClinicalAttachment(file('rash.webp', 'image/webp', WEBP)).mimeType).toBe('image/webp');
  });

  it('5. PDF', () => {
    expect(validateClinicalAttachment(file('referral.pdf', 'application/pdf', PDF)).mimeType).toBe('application/pdf');
  });

  it('6. a charset parameter on the declared type is tolerated', () => {
    expect(validateClinicalAttachment(file('scan.pdf', 'application/pdf; charset=binary', PDF)).mimeType).toBe(
      'application/pdf',
    );
  });

  it('7. an upper-case extension is still the same type', () => {
    expect(validateClinicalAttachment(file('WOUND.JPG', 'image/jpeg', JPEG)).mimeType).toBe('image/jpeg');
  });

  it('8. the allow-list is exactly the four approved types', () => {
    expect([...ALLOWED_MIME_TYPES].sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].sort(),
    );
  });

  it('9. HEIC and TIFF are NOT admitted — neither previews in the record yet', () => {
    expect(ALLOWED_EXTENSIONS).not.toContain('.heic');
    expect(ALLOWED_EXTENSIONS).not.toContain('.tif');
    expect(ALLOWED_EXTENSIONS).not.toContain('.tiff');
  });
});

describe('an unsupported declared type is refused', () => {
  it.each([
    ['10. an executable', 'payload.exe', 'application/x-msdownload'],
    ['11. HTML', 'page.html', 'text/html'],
    ['12. JavaScript', 'script.js', 'text/javascript'],
    ['13. SVG — scriptable, and not on the list', 'diagram.svg', 'image/svg+xml'],
    ['14. a Word document', 'letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['15. an unknown binary', 'thing.bin', 'application/octet-stream'],
    ['16. a missing type', 'thing', ''],
  ])('%s', (_name, filename, mimetype) => {
    refuses(file(filename, mimetype, PDF));
  });
});

describe('extension and declared type must agree', () => {
  it('17. a PDF declared as image/png is refused', () => {
    refuses(file('scan.pdf', 'image/png', PNG));
  });

  it('18. an image declared as application/pdf is refused', () => {
    refuses(file('photo.png', 'application/pdf', PDF));
  });

  it('19. an allowed type with a disallowed extension is refused', () => {
    refuses(file('report.exe', 'application/pdf', PDF));
  });

  it('20. an allowed type with NO extension is refused', () => {
    refuses(file('report', 'application/pdf', PDF));
  });

  it('21. a double extension is judged on the LAST one', () => {
    // `invoice.pdf.exe` is a .exe, and every part of this must agree with it.
    refuses(file('invoice.pdf.exe', 'application/pdf', PDF));
  });
});

describe('the bytes decide — a renamed file is still what it is', () => {
  it('22. an executable renamed to .pdf and declared as PDF is refused', () => {
    // The whole point of signature inspection: extension and MIME type are
    // both claims the caller controls, and both are satisfied here.
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    refuses(file('report.pdf', 'application/pdf', mz));
  });

  it('23. HTML renamed to .png and declared as PNG is refused', () => {
    refuses(file('image.png', 'image/png', Buffer.from('<html><script>alert(1)</script>', 'utf8')));
  });

  it('24. a shell script renamed to .jpg is refused', () => {
    refuses(file('photo.jpg', 'image/jpeg', Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8')));
  });

  it('25. a PNG relabelled and renamed as a JPEG is still refused', () => {
    // Even an entirely benign image must match what it says it is, or the
    // stored Content-Type would be wrong for the bytes served back.
    refuses(file('photo.jpg', 'image/jpeg', PNG));
  });

  it('26. a RIFF container that is not WebP is refused', () => {
    // "RIFF" alone is also a WAV and an AVI.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVEfmt ', 'ascii'),
    ]);
    refuses(file('sound.webp', 'image/webp', wav));
  });

  it('27. a truncated file too short to carry its signature is refused', () => {
    refuses(file('tiny.png', 'image/png', Buffer.from([0x89, 0x50])));
  });

  it('28. an empty file is refused', () => {
    refuses(file('empty.pdf', 'application/pdf', Buffer.alloc(0)));
  });

  it('29. a PDF with junk BEFORE the header is refused', () => {
    // The spec tolerates it; a clinic scanner does not emit it, and allowing
    // arbitrary prefixes would reopen the hole this check closes.
    refuses(file('odd.pdf', 'application/pdf', Buffer.concat([Buffer.from('GARBAGE'), PDF])));
  });
});

describe('the filename is sanitised before it is stored, shown or sent in a header', () => {
  it('30. path traversal is stripped', () => {
    expect(sanitiseAttachmentFileName('../../etc/passwd')).toBe('passwd');
  });

  it('31. a quote cannot break out of the Content-Disposition filename', () => {
    expect(sanitiseAttachmentFileName('evil".pdf')).not.toContain('"');
  });

  it('32. CR and LF are removed — a header newline is response splitting', () => {
    const cleaned = sanitiseAttachmentFileName('scan\r\nSet-Cookie: a=b.pdf');
    expect(cleaned).not.toMatch(/[\r\n]/);
  });

  it('33. other control characters are removed', () => {
    // Escapes, not literal bytes: a source file carrying raw control
    // characters is one a diff viewer, an editor or a copy-paste can
    // silently repair, and the test would then pass for no reason.
    const name = `scan\u0000\u0007\u001b.pdf`;
    const cleaned = sanitiseAttachmentFileName(name);
    expect(cleaned).toBe('scan.pdf');
    expect(/[\u0000-\u001f\u007f]/.test(cleaned)).toBe(false);
  });

  it('34. an unbounded name is bounded', () => {
    expect(sanitiseAttachmentFileName(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(180);
  });

  it('35. a name that sanitises away entirely still gets one', () => {
    expect(sanitiseAttachmentFileName('///')).toBe('attachment');
    expect(sanitiseAttachmentFileName('')).toBe('attachment');
  });

  it('36. an ordinary clinical filename is left alone', () => {
    expect(sanitiseAttachmentFileName('wound-photo_2026-08-06.jpg')).toBe('wound-photo_2026-08-06.jpg');
  });

  it('37. the validator returns the SANITISED name, not the submitted one', () => {
    const result = validateClinicalAttachment(file('../../wound.jpg', 'image/jpeg', JPEG));
    expect(result.fileName).toBe('wound.jpg');
  });
});

describe('the refusal says the same thing however it was reached', () => {
  it('38. one message, naming the four accepted types', () => {
    expect(UNSUPPORTED_FILE_MESSAGE).toBe('Unsupported file type. Upload JPG, PNG, WebP or PDF.');
  });

  it('39. it leaks no enum, path, header or internal vocabulary', () => {
    expect(UNSUPPORTED_FILE_MESSAGE).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(UNSUPPORTED_FILE_MESSAGE).not.toMatch(/mime|signature|magic|buffer|multer/i);
  });
});
