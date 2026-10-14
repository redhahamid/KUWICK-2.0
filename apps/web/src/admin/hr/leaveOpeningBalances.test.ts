import { describe, expect, it } from 'vitest';
import { parseOpeningBalances } from './OpeningBalancesImport';

// OPENING LEAVE BALANCES (Section D): the CSV the HR officer fills in. Demo numbers.
describe('parseOpeningBalances', () => {
  it('reads taken and carried-in days by Employee No.', () => {
    const parsed = parseOpeningBalances('﻿employee_no,leave_type,taken_days,carried_in_days\nE001,annual,3,2\nE002,MEDICAL,1,\n');
    expect(parsed).toEqual({
      rows: [
        { employeeNo: 'E001', leaveType: 'ANNUAL', takenDays: 3, carriedInDays: 2 },
        { employeeNo: 'E002', leaveType: 'MEDICAL', takenDays: 1 },
      ],
    });
  });

  it('names the line that is wrong', () => {
    expect(parseOpeningBalances('employee_no,leave_type,taken_days\nE001,ANNUAL,three\n')).toEqual({ error: 'Line 2: taken_days must be a number of days.' });
    expect(parseOpeningBalances('name,days\nA,1\n')).toEqual({ error: 'The header must have employee_no, leave_type and taken_days.' });
  });
});
