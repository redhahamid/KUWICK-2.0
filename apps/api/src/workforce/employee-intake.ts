import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { RecordSalaryDto } from './dto/record-salary.dto';
import { RecordStatutoryClassificationDto } from './dto/record-statutory-classification.dto';
import type { EmployeeIntakeRowDto } from './dto/employee-intake.dto';
import { nricDigits, readNric } from './nric';

/**
 * ONE WAY IN FOR A NEW EMPLOYEE, whether one is typed on the form or twenty
 * on the grid. Each row is checked the way the four endpoints would check
 * it — the same DTOs, run here per row — plus what no endpoint could see on
 * its own: an IC that does not read, a birth date that disagrees with it, a
 * number or an IC already on another record, a branch the account does not
 * manage, a company that is archived. Every problem names the row and the
 * cell, so a grid can put it under the box and a form beside it.
 *
 * And what payroll will still be missing, said the same way for both: the
 * readiness list the run itself refuses on, worked out from the row before
 * anything is written.
 */
export interface RowProblem {
  field: string;
  message: string;
}

export interface IntakeContext {
  /** The branches the account may add people to; empty with `everyBranch` means all of them. */
  clinicIds: Set<string>;
  everyBranch: boolean;
  employers: Map<string, { name: string; active: boolean }>;
  jobTitles: Map<string, { name: string; active: boolean }>;
  existingEmployeeNos: Set<string>;
  /** Digits only, so a dashed and an undashed IC are the same IC. */
  existingIcs: Set<string>;
  existingLoginEmails: Set<string>;
  mayRecordPay: boolean;
  mayCreateLogins: boolean;
  today?: Date;
}

/** What a batch has already claimed, so two rows cannot share a number, an IC or a login. */
export interface IntakeSeen {
  employeeNos: Set<string>;
  ics: Set<string>;
  loginEmails: Set<string>;
}

export const newSeen = (): IntakeSeen => ({ employeeNos: new Set(), ics: new Set(), loginEmails: new Set() });

export interface IntakeReadiness {
  /** The run refuses the month on these. */
  blocking: string[];
  /** The month runs; these are said on the record. */
  advisory: string[];
}

export interface RowCheck {
  problems: RowProblem[];
  readiness: IntakeReadiness;
  /** Filled from the IC when the row left them blank; what the commit writes. */
  derived: { dateOfBirth?: string; gender?: string };
}

const EPF = ['MALAYSIAN_CITIZEN', 'PERMANENT_RESIDENT', 'NON_CITIZEN_ELECTED_PRE_1998', 'NON_CITIZEN'];
/** The roles an employee can hold: every Role but the patient portal's. */
const EMPLOYEE_ROLES: string[] = Object.values(Role).filter((role) => role !== 'PATIENT_PORTAL');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const blank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function dateOk(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function dtoProblems(instance: object, prefix: string): Promise<RowProblem[]> {
  const errors = await validate(instance, { whitelist: true, forbidUnknownValues: false });
  return errors.map((error) => ({
    field: prefix ? `${prefix}.${error.property}` : error.property,
    message: Object.values(error.constraints ?? {})[0] ?? `${error.property} is not valid`,
  }));
}

/** The flat part of a row as the create endpoint reads it. */
export function createBodyOf(row: EmployeeIntakeRowDto, derived: RowCheck['derived']): Record<string, unknown> {
  const { salary, standing, legalEmployerId, ...flat } = row;
  void salary;
  void standing;
  void legalEmployerId;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!blank(value)) body[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (!body.identifierType && body.identifierValue) body.identifierType = 'NRIC';
  // A passport on file as the document is the passport.
  if (body.identifierType === 'PASSPORT' && body.identifierValue && !body.passportNumber) body.passportNumber = body.identifierValue;
  if (!body.dateOfBirth && derived.dateOfBirth) body.dateOfBirth = derived.dateOfBirth;
  if (!body.gender && derived.gender) body.gender = derived.gender;
  // A Malaysian citizen is Malaysian; the row need not say so twice.
  if (!body.nationality && row.standing?.epfMembership === 'MALAYSIAN_CITIZEN') body.nationality = 'Malaysian';
  return body;
}

export function salaryBodyOf(row: EmployeeIntakeRowDto): { amount: string; basis: string; effectiveFrom: string } | null {
  if (!row.salary || blank(row.salary.amount)) return null;
  const effectiveFrom = row.salary.effectiveFrom?.trim() || row.startDate?.trim() || '';
  return { amount: String(row.salary.amount).trim().replace(/^RM\s*/i, '').replace(/,/g, ''), basis: row.salary.basis?.trim() || 'MONTHLY', effectiveFrom };
}

export function standingBodyOf(row: EmployeeIntakeRowDto): Record<string, unknown> | null {
  const s = row.standing;
  if (!s) return null;
  const given: Record<string, unknown> = {};
  for (const key of ['epfMembership', 'lindungParticipation', 'taxResidence', 'pcbCategory', 'overtimeContractPolicy'] as const) {
    if (!blank(s[key])) given[key] = String(s[key]).trim();
  }
  if (s.qualifyingChildren !== undefined && s.qualifyingChildren !== null) given.qualifyingChildren = s.qualifyingChildren;
  if (s.restDayVaries) {
    given.restDayOfWeek = null;
    given.restDayVaries = true;
  } else if (s.restDayOfWeek !== undefined && s.restDayOfWeek !== null) {
    given.restDayOfWeek = s.restDayOfWeek;
    given.restDayVaries = false;
  }
  if (Object.keys(given).length === 0) return null;
  const effectiveFrom = s.effectiveFrom?.trim() || row.startDate?.trim() || row.salary?.effectiveFrom?.trim() || '';
  return { ...given, effectiveFrom, reason: 'Recorded at hire' };
}

export async function checkIntakeRow(row: EmployeeIntakeRowDto, ctx: IntakeContext, seen: IntakeSeen): Promise<RowCheck> {
  const problems: RowProblem[] = [];
  const derived: RowCheck['derived'] = {};
  const today = ctx.today ?? new Date();

  // THE IC, READ BEFORE THE DTOS, so what it says can fill the blanks the DTOs then see.
  const identifierType = row.identifierType?.trim() || (row.identifierValue ? 'NRIC' : undefined);
  const ic = row.identifierValue?.trim();
  if (ic && identifierType === 'NRIC') {
    const read = readNric(ic, today);
    if (!read) {
      problems.push({ field: 'identifierValue', message: 'A Malaysian IC is 12 digits, YYMMDD-PB-####, e.g. 900101-14-5567.' });
    } else {
      derived.dateOfBirth = read.dateOfBirth.toISOString().slice(0, 10);
      derived.gender = read.gender;
      if (row.dateOfBirth && dateOk(row.dateOfBirth) && row.dateOfBirth !== derived.dateOfBirth) {
        problems.push({ field: 'dateOfBirth', message: `The IC says ${derived.dateOfBirth}; the date of birth typed is ${row.dateOfBirth}.` });
      }
      if (seen.ics.has(read.digits)) problems.push({ field: 'identifierValue', message: 'The same IC is on another row of this batch.' });
      else if (ctx.existingIcs.has(read.digits)) problems.push({ field: 'identifierValue', message: 'An employee with this IC is already on record.' });
      seen.ics.add(read.digits);
    }
  } else if (ic && identifierType !== 'PASSPORT') {
    problems.push({ field: 'identifierType', message: 'The document is a Malaysian IC or a passport.' });
  }

  const createBody = createBodyOf(row, derived);
  // THE TWO CELLS EVERY ROW NEEDS, in words: the DTO's own refusals read as
  // "fullName must be longer than or equal to 2 characters", which is a
  // sentence for a developer. One problem per cell, and the first one wins.
  const name = createBody.fullName as string | undefined;
  if (!name) problems.push({ field: 'fullName', message: 'Their full name.' });
  else if (name.length < 2) problems.push({ field: 'fullName', message: 'A name needs at least two characters.' });
  const role = createBody.role as string | undefined;
  if (!role) problems.push({ field: 'role', message: 'Which account role? Pick one.' });
  else if (!EMPLOYEE_ROLES.includes(role)) problems.push({ field: 'role', message: role === 'PATIENT_PORTAL' ? 'A patient portal login is not an employee role.' : 'Not an account role.' });
  problems.push(...(await dtoProblems(plainToInstance(CreateEmployeeDto, createBody), '')));
  for (const field of ['dateOfBirth', 'startDate'] as const) {
    const value = createBody[field];
    if (typeof value === 'string' && !dateOk(value)) problems.push({ field, message: `${field === 'startDate' ? 'The start date' : 'The date of birth'} must be YYYY-MM-DD.` });
  }

  // THE BRANCH, THE COMPANY AND THE TITLE: real, and the account's to use.
  const clinicId = createBody.clinicId as string | undefined;
  if (!clinicId) {
    if (!(ctx.clinicIds.size === 1 && !ctx.everyBranch)) problems.push({ field: 'clinicId', message: 'Which branch? Pick one.' });
  } else if (!ctx.everyBranch && !ctx.clinicIds.has(clinicId)) {
    problems.push({ field: 'clinicId', message: 'Not a branch this account manages.' });
  }
  const employerId = row.legalEmployerId?.trim();
  if (employerId) {
    const employer = ctx.employers.get(employerId);
    if (!employer) problems.push({ field: 'legalEmployerId', message: 'That company is not on file.' });
    else if (!employer.active) problems.push({ field: 'legalEmployerId', message: `${employer.name} is archived. Choose another company.` });
  }
  const titleId = createBody.jobTitleId as string | undefined;
  if (titleId) {
    const title = ctx.jobTitles.get(titleId);
    if (!title) problems.push({ field: 'jobTitleId', message: 'That job title is not on this clinic’s list.' });
    else if (!title.active) problems.push({ field: 'jobTitleId', message: `${title.name} is retired. Choose another title.` });
  }

  // NUMBERS AND LOGINS NOBODY ELSE HAS.
  const employeeNo = createBody.employeeNo as string | undefined;
  if (employeeNo) {
    const key = employeeNo.toLowerCase();
    if (seen.employeeNos.has(key)) problems.push({ field: 'employeeNo', message: 'The same employee number is on another row of this batch.' });
    else if (ctx.existingEmployeeNos.has(key)) problems.push({ field: 'employeeNo', message: 'Another employee already has this number.' });
    seen.employeeNos.add(key);
  }
  const loginEmail = createBody.loginEmail as string | undefined;
  const loginPassword = createBody.loginPassword as string | undefined;
  if (Boolean(loginEmail) !== Boolean(loginPassword)) {
    problems.push({ field: 'loginEmail', message: 'A login needs both an email and a password, or neither.' });
  } else if (loginEmail) {
    if (!ctx.mayCreateLogins) problems.push({ field: 'loginEmail', message: 'Creating a login needs user-management access. Add them without one.' });
    const key = loginEmail.toLowerCase();
    if (seen.loginEmails.has(key)) problems.push({ field: 'loginEmail', message: 'The same login email is on another row of this batch.' });
    else if (ctx.existingLoginEmails.has(key)) problems.push({ field: 'loginEmail', message: 'Somebody already signs in with that email address.' });
    seen.loginEmails.add(key);
  }

  // THE SALARY AND THE STANDING, CHECKED AS THEIR OWN ENDPOINTS WOULD.
  const salary = salaryBodyOf(row);
  if (salary) {
    if (!ctx.mayRecordPay) problems.push({ field: 'salary.amount', message: 'Recording a salary needs payroll access, not employee-record access alone.' });
    if (!salary.effectiveFrom) problems.push({ field: 'salary.effectiveFrom', message: 'A start date, or a date the salary is paid from.' });
    else if (!dateOk(salary.effectiveFrom)) problems.push({ field: 'salary.effectiveFrom', message: 'The salary date must be YYYY-MM-DD.' });
    problems.push(...(await dtoProblems(plainToInstance(RecordSalaryDto, salary), 'salary')));
  }
  const standing = standingBodyOf(row);
  if (standing) {
    if (!standing.effectiveFrom) problems.push({ field: 'standing.effectiveFrom', message: 'A start date, or a date the standing applies from.' });
    else if (!dateOk(standing.effectiveFrom as string)) problems.push({ field: 'standing.effectiveFrom', message: 'The standing date must be YYYY-MM-DD.' });
    problems.push(...(await dtoProblems(plainToInstance(RecordStatutoryClassificationDto, standing), 'standing')));
    if (standing.epfMembership && !EPF.includes(standing.epfMembership as string)) {
      problems.push({ field: 'standing.epfMembership', message: 'EPF membership is Malaysian citizen, permanent resident, non-citizen elected before 1998, or non-citizen.' });
    }
  }
  if (row.standing?.epfMembership && row.standing.epfMembership !== 'MALAYSIAN_CITIZEN' && !createBody.nationality) {
    problems.push({ field: 'nationality', message: 'Which country are they a citizen of?' });
  }

  return { problems: dedupe(problems), readiness: readinessOf(row, salary, standing, derived), derived };
}

/** One problem per cell: the first thing wrong with it is the one to fix first. */
function dedupe(problems: RowProblem[]): RowProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => (seen.has(problem.field) ? false : (seen.add(problem.field), true)));
}

/**
 * WHAT THE RUN WILL STILL REFUSE ON, in the order it raises them, said before
 * the row is written — the list the single form used to keep by hand.
 */
export function readinessOf(
  row: EmployeeIntakeRowDto,
  salary: ReturnType<typeof salaryBodyOf>,
  standing: ReturnType<typeof standingBodyOf>,
  derived: RowCheck['derived'],
): IntakeReadiness {
  const blocking: string[] = [];
  const advisory: string[] = [];
  if (!row.legalEmployerId?.trim()) blocking.push('No employing company — payroll refuses the month for them, and that refusal cannot be passed.');
  if (!salary) blocking.push('No salary in force — payroll leaves them out.');
  else if (salary.basis !== 'MONTHLY') blocking.push('Paid daily or hourly — payroll leaves them out until a monthly salary is recorded.');
  const restDay = standing && (standing.restDayVaries === true || (standing.restDayOfWeek !== undefined && standing.restDayOfWeek !== null));
  if (!restDay) blocking.push('No rest day — payroll refuses the month for them.');
  if (!row.dateOfBirth?.trim() && !derived.dateOfBirth) blocking.push('No date of birth — SOCSO and EIS need an age.');
  if (!standing?.epfMembership) blocking.push('No EPF membership — EPF, SOCSO and EIS cannot be worked out.');
  if (!standing?.taxResidence || !standing?.pcbCategory) advisory.push('No tax residence or MTD category — monthly tax has to be entered by hand each month.');
  if (!row.bankAccountNo?.trim()) advisory.push('No bank account — they cannot be paid out.');
  return { blocking, advisory };
}
