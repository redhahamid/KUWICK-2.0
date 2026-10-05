import { byEmployeeName, compareByEmployeeName } from './employee-order';

describe('the one order for lists of employees', () => {
  it('sorts by name A to Z, ignoring case, with numbers read as numbers', () => {
    const rows = [
      { name: 'puteri Balqis', staffId: 'c' },
      { name: 'Dr Meera Kaur', staffId: 'b' },
      { name: 'Staff 10', staffId: 'e' },
      { name: 'Hafiz Osman', staffId: 'a' },
      { name: 'Staff 9', staffId: 'd' },
    ];
    expect([...rows].sort(compareByEmployeeName).map((row) => row.name)).toEqual([
      'Dr Meera Kaur',
      'Hafiz Osman',
      'puteri Balqis',
      'Staff 9',
      'Staff 10',
    ]);
  });

  it('breaks a tie on the staff id, so two people with one name keep their places', () => {
    const rows = [
      { name: 'Aisyah', staffId: 'z' },
      { name: 'aisyah', staffId: 'a' },
    ];
    expect([...rows].sort(compareByEmployeeName).map((row) => row.staffId)).toEqual(['a', 'z']);
  });

  it('reads the name and id from wherever a row keeps them', () => {
    const lines = [
      { staffId: '2', staff: { fullName: 'Zul' } },
      { staffId: '1', staff: { fullName: 'Ana' } },
    ];
    expect([...lines].sort(byEmployeeName((line) => ({ name: line.staff.fullName, staffId: line.staffId }))).map((l) => l.staffId)).toEqual(['1', '2']);
  });
});
