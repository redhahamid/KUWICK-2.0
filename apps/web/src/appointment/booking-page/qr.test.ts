import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from './qr';

// ===========================================================================
// THE QR CODE IS GENERATED HERE, NOT FETCHED.
//
// The obvious alternative — an <img> pointing at a QR web service — sends the
// clinic's booking URL to a third party every time somebody opens the Sharing
// tab, and produces a print sheet that is blank without an internet
// connection. A clinic printing a QR code for its own front door should need
// neither.
//
// These tests pin the structure a scanner depends on: the right size for the
// version, the three finder patterns in the right corners, the timing
// patterns, and a refusal rather than a silently wrong code when the text is
// too long.
// ===========================================================================

describe('the encoder produces a well-formed symbol', () => {
  it('1. a six-byte payload fits version 1 — 21 modules square', () => {
    const matrix = qrMatrix('k.my/x')!;
    expect(matrix).toHaveLength(21);
    expect(matrix[0]).toHaveLength(21);
  });

  it('2. a longer URL grows to a bigger version', () => {
    const small = qrMatrix('https://k.my/b/x')!.length;
    const large = qrMatrix('https://kuwick.example.com/book/klinik-hijraa-bangi-cawangan-dua')!
      .length;
    expect(large).toBeGreaterThan(small);
    // Every QR version is 4 modules larger than the last.
    expect((large - 21) % 4).toBe(0);
  });

  it('3. the three finder patterns are in the three corners', () => {
    const matrix = qrMatrix('https://k.my/b/x')!;
    const size = matrix.length;
    const finderAt = (row: number, column: number) =>
      matrix[row][column] &&
      matrix[row + 6][column] &&
      matrix[row][column + 6] &&
      !matrix[row + 1][column + 1] &&
      matrix[row + 2][column + 2];

    expect(finderAt(0, 0)).toBe(true);
    expect(finderAt(0, size - 7)).toBe(true);
    expect(finderAt(size - 7, 0)).toBe(true);
  });

  it('4. the timing patterns alternate along row and column 6', () => {
    const matrix = qrMatrix('https://k.my/b/x')!;
    for (let index = 8; index < matrix.length - 8; index += 1) {
      expect(matrix[6][index]).toBe(index % 2 === 0);
      expect(matrix[index][6]).toBe(index % 2 === 0);
    }
  });

  it('5. the always-dark module is dark', () => {
    const matrix = qrMatrix('https://k.my/b/x')!;
    expect(matrix[matrix.length - 8][8]).toBe(true);
  });

  it('6. the same text always produces the same code', () => {
    // A QR that changed between renders would send a clinic reprinting its
    // window sticker for no reason.
    expect(qrMatrix('https://k.my/b/x')).toEqual(qrMatrix('https://k.my/b/x'));
  });

  it('7. text too long to encode honestly is REFUSED, not truncated', () => {
    // A silently truncated code scans to the wrong URL, which is worse than no
    // code at all: nobody checks a QR they printed.
    expect(qrMatrix('x'.repeat(400))).toBeNull();
    expect(qrSvg('x'.repeat(400))).toBeNull();
  });
});

describe('the SVG is standalone', () => {
  it('8. it carries its own quiet zone', () => {
    // A QR printed flush against other ink does not scan. Four modules of
    // white on every side is the specification's minimum.
    const svg = qrSvg('k.my/x')!;
    const viewBox = /viewBox="0 0 (\d+) \1"/.exec(svg);
    expect(viewBox).not.toBeNull();
    expect(Number(viewBox![1])).toBe(21 + 8);
  });

  it('9. it fetches nothing — the only URL in it is the SVG namespace', () => {
    const svg = qrSvg('https://k.my/b/x')!;
    expect(svg).not.toMatch(/<image|xlink:href|url\(/);
    expect(svg.match(/https?:\/\/[^"]+/g)).toEqual(['http://www.w3.org/2000/svg']);
    expect(svg).toContain('<rect');
  });
});


// ===========================================================================
// A ROUND TRIP, READ BACK OFF THE MATRIX.
//
// The traversal below is written INDEPENDENTLY of the encoder — it walks the
// symbol in the opposite direction and recovers the byte-mode payload. It
// cannot prove the code scans on a physical phone (nothing in a unit test
// can), but it does catch the asymmetric bugs that are the common kind: a
// mask applied to the wrong modules, a length field written at the wrong
// width, data placed in the reserved areas.
// ===========================================================================

/** Modules that carry FORMAT or FUNCTION information, and never data. */
function isReserved(size: number, row: number, column: number): boolean {
  const inFinder = (r0: number, c0: number) =>
    row >= r0 - 1 && row <= r0 + 7 && column >= c0 - 1 && column <= c0 + 7;
  if (inFinder(0, 0) || inFinder(0, size - 7) || inFinder(size - 7, 0)) return true;
  if (row === 6 || column === 6) return true;
  // The format-information strips: row 8 beside the top-left and top-right
  // finders, and column 8 beside the top-left and bottom-left ones.
  if (row === 8 && (column <= 8 || column >= size - 8)) return true;
  if (column === 8 && (row <= 8 || row >= size - 7)) return true;
  // Version 2 and up carry one alignment pattern at (size-7, size-7) centre.
  if (size >= 25) {
    const centre = size - 7;
    if (Math.abs(row - centre) <= 2 && Math.abs(column - centre) <= 2) return true;
  }
  if (row === size - 8 && column === 8) return true;
  return false;
}

function readBack(matrix: boolean[][]): string {
  const size = matrix.length;
  const bits: number[] = [];
  let upward = true;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [column, column - 1]) {
        if (isReserved(size, row, c)) continue;
        // Mask 0 again — applying it twice returns the original bit.
        const value = (row + c) % 2 === 0 ? !matrix[row][c] : matrix[row][c];
        bits.push(value ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const mode = parseInt(bits.slice(0, 4).join(''), 2);
  expect(mode).toBe(0b0100); // byte mode
  const lengthBits = size < 45 ? 8 : 16;
  const length = parseInt(bits.slice(4, 4 + lengthBits).join(''), 2);
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const offset = 4 + lengthBits + index * 8;
    bytes.push(parseInt(bits.slice(offset, offset + 8).join(''), 2));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe('what goes in comes back out', () => {
  it.each([
    'k.my/x',
    'https://kuwick.my/book/hijraa-bangi',
  ])('10. %s survives the round trip', (text) => {
    // Only single-block versions round-trip through this simple reader — the
    // interleaving of a multi-block symbol would need de-interleaving too, and
    // reimplementing that here would test the test.
    const matrix = qrMatrix(text)!;
    expect(readBack(matrix)).toBe(text);
  });
});
