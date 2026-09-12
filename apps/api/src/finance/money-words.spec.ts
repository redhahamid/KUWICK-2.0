import { numberInWords, ringgitInWords } from './money-words';

describe('a sum in words, as the payslip prints it under the net pay', () => {
  it('reads the mockup figure exactly', () => {
    expect(ringgitInWords(997914)).toBe('Ringgit Malaysia nine thousand nine hundred seventy-nine and sen fourteen only');
  });

  it('says nothing about sen when there are none, and handles the small and the odd', () => {
    expect(ringgitInWords(950000)).toBe('Ringgit Malaysia nine thousand five hundred only');
    expect(ringgitInWords(5)).toBe('Ringgit Malaysia zero and sen five only');
    expect(ringgitInWords(100000)).toBe('Ringgit Malaysia one thousand only');
    expect(ringgitInWords(1532570)).toBe('Ringgit Malaysia fifteen thousand three hundred twenty-five and sen seventy only');
  });

  it('spells numbers the cheque way', () => {
    expect(numberInWords(0)).toBe('zero');
    expect(numberInWords(19)).toBe('nineteen');
    expect(numberInWords(40)).toBe('forty');
    expect(numberInWords(1_000_000)).toBe('one million');
    expect(numberInWords(2_345_678)).toBe('two million three hundred forty-five thousand six hundred seventy-eight');
  });
});
