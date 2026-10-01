import { DAY_NAMES } from './StatutoryStandingManager';
import { downloadCsv } from './ui/csv';
import type { EmployeeIntakeRowDto } from '../types';

/**
 * ONE ROW OF THE INTAKE GRID, and the sheet it can be typed into instead.
 *
 * The grid carries only what payroll refuses a month on — who, which
 * document, the salary, the branch, the company and the statutory standing —
 * plus the two things nothing can be written without: an account role, and
 * a start date to date the salary and the standing from. The address and the
 * emergency contact stay on the single form; a grid column nobody blocks on
 * is a column nobody fills.
 *
 * Every row goes to the server as the SAME shape the single form sends, and
 * the server checks both the same way; this module only turns cells into
 * that shape and a sheet into cells.
 */
export interface IntakeRow {
  /** A key for React; never sent. */
  key: string;
  fullName: string;
  role: string;
  clinicId: string;
  legalEmployerId: string;
  /** YYYY-MM-DD. */
  startDate: string;
  identifierType: 'NRIC' | 'PASSPORT';
  identifierValue: string;
  /** YYYY-MM-DD; blank means "from the IC". */
  dateOfBirth: string;
  gender: '' | 'MALE' | 'FEMALE';
  /** Monthly, in ringgit. */
  salaryAmount: string;
  epfMembership: string;
  taxResidence: string;
  pcbCategory: string;
  /** '0'..'6', 'VARIES' or blank. */
  restDay: string;
  lindungParticipation: string;
}

export const ROLE_OPTIONS = [
  { value: 'DOCTOR_RESIDENT', label: 'Doctor (resident)' },
  { value: 'DOCTOR_LOCUM', label: 'Doctor (locum)' },
  { value: 'FRONT_DESK_CLINICAL_STAFF', label: 'Front desk / clinical staff' },
  { value: 'FINANCE_STAFF', label: 'Finance' },
  { value: 'HR_STAFF', label: 'HR' },
  { value: 'CLINIC_MANAGER', label: 'Clinic manager' },
  { value: 'STOCK_STAFF', label: 'Stock / pharmacy' },
  { value: 'PANEL_STAFF', label: 'Panel' },
  { value: 'OWNER_ADMIN', label: 'Owner / administrator' },
];

export const EPF_OPTIONS = [
  { value: 'MALAYSIAN_CITIZEN', label: 'Malaysian citizen' },
  { value: 'PERMANENT_RESIDENT', label: 'Permanent resident' },
  { value: 'NON_CITIZEN_ELECTED_PRE_1998', label: 'Non-citizen, elected before Aug 1998' },
  { value: 'NON_CITIZEN', label: 'Non-citizen' },
];

export const TAX_RESIDENCE_OPTIONS = [
  { value: 'RESIDENT', label: 'Resident' },
  { value: 'NON_RESIDENT', label: 'Non-resident' },
];

export const PCB_OPTIONS = [
  { value: 'CATEGORY_1', label: 'Category 1 — single' },
  { value: 'CATEGORY_2', label: 'Category 2 — married, spouse not working' },
  { value: 'CATEGORY_3', label: 'Category 3 — married, spouse working' },
];

export const REST_DAY_OPTIONS = [
  ...DAY_NAMES.map((name, index) => ({ value: String(index), label: name })),
  { value: 'VARIES', label: 'Varies week to week' },
];

export const LINDUNG_OPTIONS = [
  { value: 'ENROLLED', label: 'Enrolled' },
  { value: 'NOT_PARTICIPATING', label: 'Opted out through PERKESO' },
  { value: 'MANDATORY_FOREIGN_WORKER', label: 'Mandatory — foreign worker' },
];

export const GENDER_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
];

export const DOCUMENT_OPTIONS = [
  { value: 'NRIC', label: 'Malaysian IC' },
  { value: 'PASSPORT', label: 'Passport' },
];

let counter = 0;
export function emptyRow(defaults: Partial<IntakeRow> = {}): IntakeRow {
  counter += 1;
  return {
    key: `row-${Date.now()}-${counter}`,
    fullName: '',
    role: '',
    clinicId: '',
    legalEmployerId: '',
    startDate: '',
    identifierType: 'NRIC',
    identifierValue: '',
    dateOfBirth: '',
    gender: '',
    salaryAmount: '',
    epfMembership: '',
    taxResidence: '',
    pcbCategory: '',
    restDay: '',
    lindungParticipation: '',
    ...defaults,
  };
}

/** True when nothing on the row was typed: a blank line on the sheet, not a person with no name. */
export function rowIsBlank(row: IntakeRow): boolean {
  return (Object.keys(row) as (keyof IntakeRow)[])
    .filter((key) => key !== 'key' && key !== 'identifierType' && key !== 'clinicId' && key !== 'legalEmployerId')
    .every((key) => row[key] === '');
}

const or = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim());

/** The row as the intake endpoint reads it — the shape the single form sends for one person. */
export function toIntakeRowDto(row: IntakeRow): EmployeeIntakeRowDto {
  const standing: NonNullable<EmployeeIntakeRowDto['standing']> = {};
  if (or(row.epfMembership)) standing.epfMembership = row.epfMembership;
  if (or(row.taxResidence)) standing.taxResidence = row.taxResidence;
  if (or(row.pcbCategory)) standing.pcbCategory = row.pcbCategory;
  if (or(row.lindungParticipation)) standing.lindungParticipation = row.lindungParticipation;
  if (row.restDay === 'VARIES') {
    standing.restDayOfWeek = null;
    standing.restDayVaries = true;
  } else if (or(row.restDay)) {
    standing.restDayOfWeek = Number(row.restDay);
    standing.restDayVaries = false;
  }
  return {
    fullName: or(row.fullName),
    role: or(row.role),
    clinicId: or(row.clinicId),
    legalEmployerId: or(row.legalEmployerId),
    startDate: or(row.startDate),
    identifierType: or(row.identifierValue) ? row.identifierType : undefined,
    identifierValue: or(row.identifierValue),
    dateOfBirth: or(row.dateOfBirth),
    gender: or(row.gender),
    // A Malaysian citizen is Malaysian; the sheet has no nationality column, and a non-citizen's is asked for on their record.
    nationality: row.epfMembership === 'MALAYSIAN_CITIZEN' ? 'Malaysian' : undefined,
    salary: or(row.salaryAmount) ? { amount: row.salaryAmount.trim(), basis: 'MONTHLY' } : undefined,
    standing: Object.keys(standing).length > 0 ? standing : undefined,
  };
}

/*
 * THE SHEET. One column per grid column, headed in words; a branch and a
 * company are named, not numbered, because a clinic's spreadsheet knows
 * "Contoh Central" and has never seen a UUID.
 */
export interface IntakeColumn {
  key: keyof Omit<IntakeRow, 'key'>;
  header: string;
  /** What the template's example row shows. */
  example: string;
}

export const INTAKE_COLUMNS: IntakeColumn[] = [
  { key: 'fullName', header: 'Full name', example: 'Demo Pekerja binti Contoh' },
  { key: 'role', header: 'Account role', example: 'Front desk / clinical staff' },
  { key: 'clinicId', header: 'Branch', example: 'Contoh Central' },
  { key: 'legalEmployerId', header: 'Employer', example: 'Klinik Contoh Sdn Bhd' },
  { key: 'startDate', header: 'Start date (YYYY-MM-DD)', example: '2026-01-01' },
  { key: 'identifierType', header: 'Document (IC or Passport)', example: 'IC' },
  { key: 'identifierValue', header: 'IC or passport number', example: '900101-14-5566' },
  { key: 'dateOfBirth', header: 'Date of birth (YYYY-MM-DD; blank = from IC)', example: '' },
  { key: 'gender', header: 'Gender (blank = from IC)', example: '' },
  { key: 'salaryAmount', header: 'Monthly salary (RM)', example: '2500' },
  { key: 'epfMembership', header: 'EPF membership', example: 'Malaysian citizen' },
  { key: 'taxResidence', header: 'Tax residence', example: 'Resident' },
  { key: 'pcbCategory', header: 'Monthly tax category', example: 'Category 1' },
  { key: 'restDay', header: 'Rest day', example: 'Sunday' },
  { key: 'lindungParticipation', header: 'LINDUNG 24 JAM (blank = enrolled)', example: '' },
];

export function downloadIntakeTemplate(): void {
  downloadCsv(
    'employees-template',
    INTAKE_COLUMNS.map((column) => column.header),
    [INTAKE_COLUMNS.map((column) => column.example)],
  );
}

/** RFC 4180: quoted cells, doubled quotes, CRLF or LF, a BOM in front. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          cell += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[at + 1] === '\n') at += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''));
}

const norm = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A cell's words turned into the stored code: the label, the code itself, or a usual short form. */
function codeOf(value: string, options: { value: string; label: string }[], aliases: Record<string, string> = {}): string | null {
  const key = norm(value);
  if (key === '') return '';
  const direct = options.find((option) => norm(option.value) === key || norm(option.label) === key);
  if (direct) return direct.value;
  const alias = aliases[key];
  if (alias) return alias;
  // "Category 1" and "Category 1 — single" are the same answer.
  const prefix = options.find((option) => norm(option.label).startsWith(key) && key.length >= 4);
  return prefix ? prefix.value : null;
}

export interface SheetProblem {
  /** Zero-based row of the sheet's data, matching the grid row it became. */
  row: number;
  field: keyof Omit<IntakeRow, 'key'>;
  message: string;
}

export interface SheetReading {
  rows: IntakeRow[];
  problems: SheetProblem[];
  /** Headers on the sheet that match no column; said, not silently dropped. */
  unknownHeaders: string[];
}

/**
 * THE SHEET, READ. Names become ids where a branch or a company of that name
 * exists; a name that matches nothing is a problem on that cell, with the
 * cell left blank for the grid's picker.
 */
export function readIntakeSheet(
  text: string,
  lookups: { clinics: { id: string; name: string }[]; employers: { id: string; name: string }[] },
): SheetReading {
  const lines = parseCsv(text);
  if (lines.length === 0) return { rows: [], problems: [], unknownHeaders: [] };
  const [header, ...body] = lines;
  const columnAt = header.map((label) => INTAKE_COLUMNS.find((column) => norm(column.header) === norm(label) || norm(column.key) === norm(label)) ?? null);
  const unknownHeaders = header.filter((label, index) => columnAt[index] === null && label.trim() !== '');
  const problems: SheetProblem[] = [];
  const rows: IntakeRow[] = [];

  body.forEach((line) => {
    const row = emptyRow();
    const index = rows.length;
    const cells: Partial<Record<keyof IntakeRow, string>> = {};
    line.forEach((value, at) => {
      const column = columnAt[at];
      if (column) cells[column.key] = value.trim();
    });
    // The template's example row is a row to overwrite, not a person to add.
    if (INTAKE_COLUMNS.every((column) => (cells[column.key] ?? '') === column.example)) return;

    row.fullName = cells.fullName ?? '';
    row.startDate = cells.startDate ?? '';
    row.identifierValue = cells.identifierValue ?? '';
    row.dateOfBirth = cells.dateOfBirth ?? '';
    row.salaryAmount = (cells.salaryAmount ?? '').replace(/^RM\s*/i, '').replace(/,/g, '');

    const document = codeOf(cells.identifierType ?? '', DOCUMENT_OPTIONS, { ic: 'NRIC', nric: 'NRIC', mykad: 'NRIC', passport: 'PASSPORT' });
    row.identifierType = document === 'PASSPORT' ? 'PASSPORT' : 'NRIC';
    if (document === null) problems.push({ row: index, field: 'identifierType', message: `"${cells.identifierType}" is not a document: IC or Passport.` });

    const pick = (field: keyof Omit<IntakeRow, 'key'>, options: { value: string; label: string }[], aliases: Record<string, string>, what: string) => {
      const typed = cells[field] ?? '';
      const code = codeOf(typed, options, aliases);
      if (code === null) {
        problems.push({ row: index, field, message: `"${typed}" is not ${what}.` });
        return '';
      }
      return code;
    };
    row.role = pick('role', ROLE_OPTIONS, { doctor: 'DOCTOR_RESIDENT', locum: 'DOCTOR_LOCUM', frontdesk: 'FRONT_DESK_CLINICAL_STAFF', nurse: 'FRONT_DESK_CLINICAL_STAFF', clinicalstaff: 'FRONT_DESK_CLINICAL_STAFF', manager: 'CLINIC_MANAGER', owner: 'OWNER_ADMIN', admin: 'OWNER_ADMIN', stock: 'STOCK_STAFF', pharmacy: 'STOCK_STAFF' }, 'an account role');
    row.gender = pick('gender', GENDER_OPTIONS, { m: 'MALE', f: 'FEMALE', lelaki: 'MALE', perempuan: 'FEMALE' }, 'a gender') as IntakeRow['gender'];
    row.epfMembership = pick('epfMembership', EPF_OPTIONS, { citizen: 'MALAYSIAN_CITIZEN', malaysian: 'MALAYSIAN_CITIZEN', pr: 'PERMANENT_RESIDENT', foreigner: 'NON_CITIZEN', foreign: 'NON_CITIZEN', noncitizenpre1998: 'NON_CITIZEN_ELECTED_PRE_1998' }, 'an EPF membership');
    row.taxResidence = pick('taxResidence', TAX_RESIDENCE_OPTIONS, { nonresident: 'NON_RESIDENT', nr: 'NON_RESIDENT', r: 'RESIDENT' }, 'a tax residence');
    row.pcbCategory = pick('pcbCategory', PCB_OPTIONS, { '1': 'CATEGORY_1', '2': 'CATEGORY_2', '3': 'CATEGORY_3', cat1: 'CATEGORY_1', cat2: 'CATEGORY_2', cat3: 'CATEGORY_3', single: 'CATEGORY_1' }, 'a monthly tax category');
    row.restDay = pick('restDay', REST_DAY_OPTIONS, { sun: '0', mon: '1', tue: '2', tues: '2', wed: '3', thu: '4', thur: '4', thurs: '4', fri: '5', sat: '6', varies: 'VARIES', variesweektoweek: 'VARIES', ahad: '0', isnin: '1', selasa: '2', rabu: '3', khamis: '4', jumaat: '5', sabtu: '6' }, 'a rest day');
    row.lindungParticipation = pick('lindungParticipation', LINDUNG_OPTIONS, { optedout: 'NOT_PARTICIPATING', optout: 'NOT_PARTICIPATING', no: 'NOT_PARTICIPATING', yes: 'ENROLLED', mandatory: 'MANDATORY_FOREIGN_WORKER', foreignworker: 'MANDATORY_FOREIGN_WORKER' }, 'a LINDUNG answer');

    const named = (field: 'clinicId' | 'legalEmployerId', list: { id: string; name: string }[], what: string) => {
      const typed = cells[field] ?? '';
      if (typed === '') return '';
      const hit = list.find((entry) => norm(entry.name) === norm(typed) || entry.id === typed);
      if (hit) return hit.id;
      problems.push({ row: index, field, message: `No ${what} called "${typed}". Pick one.` });
      return '';
    };
    row.clinicId = named('clinicId', lookups.clinics, 'branch');
    row.legalEmployerId = named('legalEmployerId', lookups.employers, 'company');

    if (!rowIsBlank(row)) rows.push(row);
  });

  return { rows, problems, unknownHeaders };
}
