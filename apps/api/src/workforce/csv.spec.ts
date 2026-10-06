import { CSV_BOM, csvCell, csvTextCell } from './csv';

describe('CSV that Excel opens as written', () => {
  it('starts with the UTF-8 byte-order mark', () => {
    expect(Buffer.from(CSV_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('quotes a cell only when it has to', () => {
    expect(csvCell('Puteri Balqis')).toBe('Puteri Balqis');
    expect(csvCell('Rahman, Aisyah')).toBe('"Rahman, Aisyah"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });

  it('writes an identifier as text Excel will not turn into 9.63E+12', () => {
    expect(csvTextCell('900101145678')).toBe('"=""900101145678"""');
    expect(csvTextCell('0012345')).toBe('"=""0012345"""');
    expect(csvTextCell('')).toBe('');
    expect(csvTextCell(null)).toBe('');
  });
});
