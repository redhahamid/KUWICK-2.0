import { describe, expect, it } from 'vitest';
import { emptyRow, parseCsv, readIntakeSheet, rowIsBlank, toIntakeRowDto, INTAKE_COLUMNS } from './employeeIntake';

/*
 * THE SHEET AND THE ROW. A clinic's spreadsheet names its branch and its
 * company in words and writes "Sunday", "Category 1" and "RM 2,500"; the
 * server wants ids, codes and a plain number. This is the translation, and
 * a cell it cannot translate is a problem on that cell, not a silent blank.
 */
const lookups = {
  clinics: [{ id: 'clinic-1', name: 'Contoh Central' }],
  employers: [{ id: 'emp-1', name: 'Klinik Contoh Sdn Bhd' }],
};

const header = INTAKE_COLUMNS.map((column) => column.header).join(',');

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
});

describe('readIntakeSheet', () => {
  it('turns names into ids and words into codes, and skips the template’s own example row', () => {
    const example = INTAKE_COLUMNS.map((column) => column.example).join(',');
    const sheet = `${header}\n${example}\nDemo Pekerja binti Contoh,Front desk / clinical staff,Contoh Central,Klinik Contoh Sdn Bhd,2026-01-01,IC,900101-14-5566,,,"RM 2,500",Malaysian citizen,Resident,Category 1,Sunday,\n`;
    const reading = readIntakeSheet(sheet, lookups);
    expect(reading.problems).toEqual([]);
    expect(reading.unknownHeaders).toEqual([]);
    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0]).toMatchObject({
      fullName: 'Demo Pekerja binti Contoh',
      role: 'FRONT_DESK_CLINICAL_STAFF',
      clinicId: 'clinic-1',
      legalEmployerId: 'emp-1',
      startDate: '2026-01-01',
      identifierType: 'NRIC',
      identifierValue: '900101-14-5566',
      salaryAmount: '2500',
      epfMembership: 'MALAYSIAN_CITIZEN',
      taxResidence: 'RESIDENT',
      pcbCategory: 'CATEGORY_1',
      restDay: '0',
      lindungParticipation: '',
    });
  });

  it('names the cell it could not read, leaves it blank for the picker, and says which columns it ignored', () => {
    const sheet = `${header},Shoe size\nDemo Dua bin Contoh,Nurse,Contoh Utara,Klinik Contoh Sdn Bhd,2026-02-01,Passport,A1234567,1990-05-05,F,3000,PR,Non-resident,2,Varies,Opted out,42\n`;
    const reading = readIntakeSheet(sheet, lookups);
    expect(reading.unknownHeaders).toEqual(['Shoe size']);
    expect(reading.problems).toEqual([{ row: 0, field: 'clinicId', message: 'No branch called "Contoh Utara". Pick one.' }]);
    expect(reading.rows[0]).toMatchObject({
      role: 'FRONT_DESK_CLINICAL_STAFF',
      clinicId: '',
      identifierType: 'PASSPORT',
      gender: 'FEMALE',
      epfMembership: 'PERMANENT_RESIDENT',
      taxResidence: 'NON_RESIDENT',
      pcbCategory: 'CATEGORY_2',
      restDay: 'VARIES',
      lindungParticipation: 'NOT_PARTICIPATING',
    });
  });

  it('reads nothing from a sheet without the template’s headings', () => {
    expect(readIntakeSheet('Name,Salary\nSomebody,100\n', lookups).rows).toEqual([]);
  });
});

describe('toIntakeRowDto', () => {
  it('sends the standing as the record endpoints read it, with a varying rest day as an answer', () => {
    const row = emptyRow({ fullName: 'Demo', role: 'HR_STAFF', clinicId: 'clinic-1', salaryAmount: '2500', epfMembership: 'MALAYSIAN_CITIZEN', restDay: 'VARIES' });
    expect(toIntakeRowDto(row)).toMatchObject({
      fullName: 'Demo',
      nationality: 'Malaysian',
      salary: { amount: '2500', basis: 'MONTHLY' },
      standing: { epfMembership: 'MALAYSIAN_CITIZEN', restDayOfWeek: null, restDayVaries: true },
    });
    expect(toIntakeRowDto(emptyRow({ restDay: '3' })).standing).toEqual({ restDayOfWeek: 3, restDayVaries: false });
    expect(toIntakeRowDto(emptyRow()).standing).toBeUndefined();
  });

  it('knows a blank line from a person with a branch already chosen', () => {
    expect(rowIsBlank(emptyRow({ clinicId: 'clinic-1', legalEmployerId: 'emp-1' }))).toBe(true);
    expect(rowIsBlank(emptyRow({ fullName: 'D' }))).toBe(false);
  });
});
