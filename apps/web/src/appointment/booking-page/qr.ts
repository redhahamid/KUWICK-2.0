/**
 * A QR CODE, GENERATED IN THE BROWSER.
 *
 * No library, and no external service. The obvious alternative — an <img> at
 * api.qrserver.com or chart.googleapis.com — sends the clinic's booking URL to
 * a third party every time somebody opens this tab, and produces a print sheet
 * that is blank without an internet connection. A clinic printing a QR code
 * for its own front door should not need either.
 *
 * This is a byte-mode QR encoder with the fixed error-correction level M,
 * choosing the smallest version that fits. It covers the range a booking URL
 * lands in comfortably; anything longer than version 10 (up to 213 bytes at
 * level M) is rejected rather than silently mis-encoded.
 */

const EC_CODEWORDS_M: Record<number, number> = {
  1: 10, 2: 16, 3: 26, 4: 36, 5: 48, 6: 64, 7: 72, 8: 88, 9: 110, 10: 130,
};
const DATA_CODEWORDS_M: Record<number, number> = {
  1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216,
};
/** Blocks per version at level M: [group1 blocks, group2 blocks]. */
const BLOCKS_M: Record<number, number> = {
  1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4, 7: 4, 8: 4, 9: 5, 10: 5,
};
const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const EXP: number[] = new Array(512);
const LOG: number[] = new Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
})();

function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let position = 0; position < poly.length; position += 1) {
      next[position] ^= poly[position];
      next[position + 1] ^= multiply(poly[position], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: number[], count: number): number[] {
  const generator = generatorPolynomial(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < count; index += 1) {
      remainder[index] ^= multiply(generator[index + 1], factor);
    }
  }
  return remainder;
}

/** The smallest version at level M that holds this many bytes, or null. */
function versionFor(byteLength: number): number | null {
  for (let version = 1; version <= 10; version += 1) {
    // 4 mode bits + length bits (8 for v1-9, 16 for v10) + the data itself.
    const lengthBits = version < 10 ? 8 : 16;
    const capacityBits = DATA_CODEWORDS_M[version] * 8;
    if (4 + lengthBits + byteLength * 8 <= capacityBits) return version;
  }
  return null;
}

/**
 * Returns a square matrix of booleans — true is a dark module — or null when
 * the text is too long to encode honestly.
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  const version = versionFor(bytes.length);
  if (!version) return null;

  const size = 17 + version * 4;
  const totalData = DATA_CODEWORDS_M[version];
  const blockCount = BLOCKS_M[version];
  // EC_CODEWORDS_M is the VERSION total; each block carries its share. Used
  // per-block it doubled (and worse) the EC stream, overflowing the symbol
  // for every multi-block version — v4+ never scanned. Found by 6J's pin.
  const ecPerBlock = EC_CODEWORDS_M[version] / blockCount;

  // --- bit stream ----------------------------------------------------------
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >> index) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = totalData * 8;
  for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(parseInt(bits.slice(index, index + 8).join(''), 2));
  }
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < totalData) {
    codewords.push(PAD[padIndex % 2]);
    padIndex += 1;
  }

  // --- blocks and interleaving --------------------------------------------
  const shortLength = Math.floor(totalData / blockCount);
  const longBlocks = totalData % blockCount;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const length = shortLength + (index >= blockCount - longBlocks ? 1 : 0);
    const block = codewords.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(errorCorrection(block, ecPerBlock));
  }
  const interleaved: number[] = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let index = 0; index < longest; index += 1) {
    for (const block of dataBlocks) if (index < block.length) interleaved.push(block[index]);
  }
  for (let index = 0; index < ecPerBlock; index += 1) {
    for (const block of ecBlocks) interleaved.push(block[index]);
  }

  // --- matrix --------------------------------------------------------------
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );
  const setFinder = (row: number, column: number) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const r = row + dr;
        const c = column + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inRing =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        matrix[r][c] = inRing;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0;
    if (matrix[6][index] === null) matrix[6][index] = dark;
    if (matrix[index][6] === null) matrix[index][6] = dark;
  }

  for (const row of ALIGNMENT[version]) {
    for (const column of ALIGNMENT[version]) {
      // Only the three centres that would land INSIDE a finder pattern are
      // dropped (the spec's rule). The old guard skipped any centre whose
      // cell was already reserved — which silently discarded every alignment
      // pattern on the timing lines from version 2 up, and a scanner uses
      // those to correct sampling. Found by the jsQR decode pin (6J).
      const inFinder =
        (row < 9 && column < 9) || (row < 9 && column > size - 9) || (row > size - 9 && column < 9);
      if (inFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          matrix[row + dr][column + dc] =
            Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }

  matrix[size - 8][8] = true; // the always-dark module

  // Format information, level M with mask 0. The indicator for M is 0b00
  // (L=01, M=00, Q=11, H=10) — this said 0b01, which ANNOUNCED level L over
  // a symbol whose blocks were built at level M, so every real scanner
  // sliced the codewords with the wrong structure and read noise. The
  // structural pins could never see it; the jsQR decode pin (6J) did.
  const formatBits = formatInformation(0b00, 0);
  for (let index = 0; index < 15; index += 1) {
    const bit = ((formatBits >> (14 - index)) & 1) === 1;
    if (index < 6) matrix[8][index] = bit;
    else if (index < 8) matrix[8][index + 1] = bit;
    else if (index === 8) matrix[7][8] = bit;
    else matrix[14 - index][8] = bit;

    // The SECOND copy, split 7/8 and not 8/7: bits 0-6 climb the bottom-left
    // column (rows size-1 to size-7), and bits 7-14 run along the top-right
    // row (columns size-8 to size-1). Getting this boundary wrong leaves the
    // always-dark module at (size-8, 8) overwritten and one data module
    // wrongly reserved — the symbol still LOOKS right and decodes to noise
    // after the first dozen bytes.
    if (index < 7) matrix[size - 1 - index][8] = bit;
    else matrix[8][size - 15 + index] = bit;
  }

  // Data, snaking upward in two-column strips, with mask pattern 0.
  let bitIndex = 0;
  const stream = interleaved.flatMap((byte) =>
    [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => ((byte >> shift) & 1) === 1),
  );
  let upward = true;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [column, column - 1]) {
        if (matrix[row][c] !== null) continue;
        const value = bitIndex < stream.length ? stream[bitIndex] : false;
        bitIndex += 1;
        // Mask 0: invert where (row + column) is even.
        matrix[row][c] = (row + c) % 2 === 0 ? !value : value;
      }
    }
    upward = !upward;
  }

  return matrix.map((row) => row.map((cell) => cell === true));
}

function formatInformation(level: number, mask: number): number {
  const data = (level << 3) | mask;
  let value = data << 10;
  for (let index = 4; index >= 0; index -= 1) {
    if ((value >> (10 + index)) & 1) value ^= 0b10100110111 << index;
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/** The matrix as a standalone SVG, ready to print or download. */
export function qrSvg(text: string, size = 240): string | null {
  const matrix = qrMatrix(text);
  if (!matrix) return null;
  const modules = matrix.length;
  const quiet = 4;
  const total = modules + quiet * 2;
  const cells: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (matrix[row][column]) {
        cells.push(`<rect x="${column + quiet}" y="${row + quiet}" width="1" height="1"/>`);
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
    `<g fill="#000000">${cells.join('')}</g>`,
    '</svg>',
  ].join('');
}
