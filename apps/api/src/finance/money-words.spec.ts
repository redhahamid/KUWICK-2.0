import { numberInWords, ringgitInWords } from './money-words';

describe('a sum in words, as the payslip prints it under the net pay', () => {
  it('reads the figure from the UAT finding exactly', () => {
    expect(ringgitInWords(1380631)).toBe('Ringgit Malaysia Thirteen Thousand Eight Hundred Six and Thirty-One Sen Only');
  });

  it('reads the mockup figure in the same form', () => {
    expect(ringgitInWords(997914)).toBe('Ringgit Malaysia Nine Thousand Nine Hundred Seventy-Nine and Fourteen Sen Only');
  });

  it('says nothing about sen when there are none, and handles the small and the odd', () => {
    expect(ringgitInWords(950000)).toBe('Ringgit Malaysia Nine Thousand Five Hundred Only');
    expect(ringgitInWords(5)).toBe('Ringgit Malaysia Zero and Five Sen Only');
    expect(ringgitInWords(100000)).toBe('Ringgit Malaysia One Thousand Only');
    expect(ringgitInWords(1532570)).toBe('Ringgit Malaysia Fifteen Thousand Three Hundred Twenty-Five and Seventy Sen Only');
    expect(ringgitInWords(-1050)).toBe('Ringgit Malaysia Minus Ten and Fifty Sen Only');
  });

  it('spells numbers the cheque way, every word capitalised', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(19)).toBe('Nineteen');
    expect(numberInWords(40)).toBe('Forty');
    expect(numberInWords(1_000_000)).toBe('One Million');
    expect(numberInWords(2_345_678)).toBe('Two Million Three Hundred Forty-Five Thousand Six Hundred Seventy-Eight');
  });
});
