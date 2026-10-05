import { useMemo, useRef, useState } from 'react';
import { App, DatePicker, Input, Select } from 'antd';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../core/api-client';
import { useClinics } from '../../core/hooks/useClinics';
import { useClinicFilter, useDefaultClinicId } from '../../core/hooks/useClinicFilter';
import { useCan } from '../../core/hooks/useCan';
import { parseNric } from '../../core/nric';
import { useEmployeeIntake, useLegalEmployers } from '../hooks/useAdmin';
import { HrPage, Panel } from './ui';
import { IconDownload, IconPlus } from './ui/icons';
import {
  DOCUMENT_OPTIONS,
  EPF_OPTIONS,
  GENDER_OPTIONS,
  INTAKE_COLUMNS,
  LINDUNG_OPTIONS,
  PCB_OPTIONS,
  REST_DAY_OPTIONS,
  ROLE_OPTIONS,
  TAX_RESIDENCE_OPTIONS,
  downloadIntakeTemplate,
  emptyRow,
  readIntakeSheet,
  rowIsBlank,
  toIntakeRowDto,
  type IntakeRow,
} from './employeeIntake';
import type { EmployeeIntakeRowResult } from '../types';

/**
 * ADD SEVERAL EMPLOYEES — a grid, or a sheet typed elsewhere and uploaded.
 *
 * The single form takes one person through four stages. A clinic moving
 * twelve people over from a spreadsheet does not want twelve trips through
 * it, so this is the same intake laid out as rows: only the columns payroll
 * refuses a month on, plus the role and the start date nothing can be
 * written without. The address and the emergency contact are the record's
 * to finish; nobody blocks a payroll on them.
 *
 * ONE PATH IN. Every row goes to the SAME endpoint the single form submits
 * to, which checks every row the way the four record endpoints would and
 * writes nothing unless the whole batch is clean. "Check" is that call
 * without the write; "Add" is the call with it. A problem comes back
 * naming its row and its cell, and is shown under that cell.
 */
type Field = keyof Omit<IntakeRow, 'key'>;

/** The server names a field as its endpoints know it; the grid names its column. */
const FIELD_OF: Record<string, Field> = {
  'salary.amount': 'salaryAmount',
  'salary.basis': 'salaryAmount',
  'salary.effectiveFrom': 'startDate',
  'standing.effectiveFrom': 'startDate',
  'standing.epfMembership': 'epfMembership',
  'standing.taxResidence': 'taxResidence',
  'standing.pcbCategory': 'pcbCategory',
  'standing.restDayOfWeek': 'restDay',
  'standing.restDayVaries': 'restDay',
  'standing.restDayFollowsRoster': 'restDay',
  'standing.lindungParticipation': 'lindungParticipation',
  nationality: 'epfMembership',
  passportNumber: 'identifierValue',
};

interface RowProblem {
  field: Field | null;
  message: string;
}

/** The file as text, through FileReader, which every browser (and the test runner) has. */
const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });

const COLUMN_HEADS: Record<Field, string> = {
  fullName: 'Full name',
  role: 'Account role',
  clinicId: 'Branch',
  legalEmployerId: 'Employer',
  startDate: 'Start date',
  identifierType: 'Document',
  identifierValue: 'IC or passport no.',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  salaryAmount: 'Monthly salary (RM)',
  epfMembership: 'EPF membership',
  taxResidence: 'Tax residence',
  pcbCategory: 'Monthly tax category',
  restDay: 'Rest day',
  lindungParticipation: 'LINDUNG 24 JAM',
};

export function BulkEmployeesPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const mayManage = useCan('hr.employee.manage');
  const { data: clinics } = useClinics();
  const { clinicId: chosenClinic } = useClinicFilter();
  // The branch a new row starts on: the one chosen on the page, else the
  // account's own. The page filter alone flips while the clinic list loads,
  // which gave the first row a branch the rows after it did not get.
  const defaultClinic = useDefaultClinicId();
  const startingClinic = chosenClinic ?? defaultClinic ?? '';
  const employers = useLegalEmployers();
  const intake = useEmployeeIntake();
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** Which boxes a row's IC filled, so a typed answer is kept and a filled one is refilled. */
  const filled = useRef(new Map<string, { dob: boolean; gender: boolean }>());

  const activeEmployers = useMemo(() => (employers.data ?? []).filter((row) => row.active), [employers.data]);
  const defaults = (): Partial<IntakeRow> => ({
    clinicId: startingClinic,
    legalEmployerId: activeEmployers.length === 1 ? activeEmployers[0].id : '',
  });

  const [rows, setRows] = useState<IntakeRow[]>(() => [emptyRow(defaults())]);
  /** Problems by row key: the sheet's own (a name that matched nothing) and the server's. */
  const [problems, setProblems] = useState<Map<string, RowProblem[]>>(new Map());
  const [results, setResults] = useState<Map<string, EmployeeIntakeRowResult>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);

  const clinicOptions = (clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }));
  const employerOptions = activeEmployers.map((row) => ({ value: row.id, label: row.name }));

  const update = (key: string, patch: Partial<IntakeRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    // An edit makes the last check stale for that row.
    setResults((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setProblems((current) => {
      const mine = current.get(key);
      if (!mine) return current;
      const touched = new Set(Object.keys(patch));
      const kept = mine.filter((problem) => problem.field === null || !touched.has(problem.field));
      const next = new Map(current);
      if (kept.length > 0) next.set(key, kept);
      else next.delete(key);
      return next;
    });
  };

  /** The IC says when they were born and which they are; a box still typed over keeps the typed answer. */
  const identifierChanged = (row: IntakeRow, value: string) => {
    const patch: Partial<IntakeRow> = { identifierValue: value };
    if (row.identifierType === 'NRIC') {
      const parsed = parseNric(value);
      const mine = filled.current.get(row.key) ?? { dob: false, gender: false };
      if (parsed) {
        if (!row.dateOfBirth || mine.dob) {
          patch.dateOfBirth = parsed.dob.format('YYYY-MM-DD');
          mine.dob = true;
        }
        if (!row.gender || mine.gender) {
          patch.gender = parsed.gender === 'Male' ? 'MALE' : 'FEMALE';
          mine.gender = true;
        }
        filled.current.set(row.key, mine);
      }
    }
    update(row.key, patch);
  };

  const addRow = () => setRows((current) => [...current, emptyRow(defaults())]);
  const removeRow = (key: string) => {
    setRows((current) => (current.length === 1 ? [emptyRow(defaults())] : current.filter((row) => row.key !== key)));
    setResults((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setProblems((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };

  const upload = async (file: File) => {
    const text = await readText(file);
    const reading = readIntakeSheet(text, {
      clinics: (clinics ?? []).map((clinic) => ({ id: clinic.id, name: clinic.name })),
      employers: activeEmployers.map((row) => ({ id: row.id, name: row.name })),
    });
    if (reading.rows.length === 0) {
      setNotice('That file has no rows under the template’s headings. Download the template and keep its first line.');
      return;
    }
    const fresh = reading.rows.map((row) => ({
      ...row,
      clinicId: row.clinicId || startingClinic,
      legalEmployerId: row.legalEmployerId || (activeEmployers.length === 1 ? activeEmployers[0].id : ''),
    }));
    setRows((current) => [...current.filter((row) => !rowIsBlank(row)), ...fresh]);
    setProblems((current) => {
      const next = new Map(current);
      for (const problem of reading.problems) {
        const key = fresh[problem.row]?.key;
        if (!key) continue;
        next.set(key, [...(next.get(key) ?? []), { field: problem.field, message: problem.message }]);
      }
      return next;
    });
    setNotice(
      reading.unknownHeaders.length > 0
        ? `${fresh.length} ${fresh.length === 1 ? 'row' : 'rows'} read. Ignored ${reading.unknownHeaders.length === 1 ? 'a column' : 'columns'} the template does not have: ${reading.unknownHeaders.join(', ')}.`
        : `${fresh.length} ${fresh.length === 1 ? 'row' : 'rows'} read. Check them, then add.`,
    );
  };

  /** The rows with something on them, in order, with the keys they were sent under. */
  const batch = () => rows.filter((row) => !rowIsBlank(row));

  const send = async (commit: boolean) => {
    const sent = batch();
    if (sent.length === 0) {
      message.info('Nothing to add yet. Type a row or upload a sheet.');
      return;
    }
    setBusy(commit ? 'add' : 'check');
    try {
      const result = await intake.mutateAsync({ rows: sent.map(toIntakeRowDto), commit });
      const nextResults = new Map<string, EmployeeIntakeRowResult>();
      const nextProblems = new Map<string, RowProblem[]>();
      result.results.forEach((rowResult) => {
        const key = sent[rowResult.index]?.key;
        if (!key) return;
        nextResults.set(key, rowResult);
        if (rowResult.problems.length > 0) {
          nextProblems.set(
            key,
            rowResult.problems.map((problem) => ({ field: (FIELD_OF[problem.field] ?? (problem.field in COLUMN_HEADS ? (problem.field as Field) : null)), message: problem.message })),
          );
        }
      });
      setResults(nextResults);
      setProblems(nextProblems);
      const faulty = result.results.filter((row) => row.problems.length > 0).length;
      if (!result.clean) {
        setNotice(`${faulty} ${faulty === 1 ? 'row needs' : 'rows need'} fixing before anything is added. Nothing was written.`);
        return;
      }
      if (result.dryRun) {
        const blocked = result.results.filter((row) => row.readiness.blocking.length > 0).length;
        setNotice(
          blocked === 0
            ? `All ${sent.length} ${sent.length === 1 ? 'row is' : 'rows are'} clean and payroll-ready.`
            : `All ${sent.length} ${sent.length === 1 ? 'row is' : 'rows are'} clean. ${blocked} ${blocked === 1 ? 'is' : 'are'} missing something payroll refuses the month on; they can still be added and finished on their records.`,
        );
        return;
      }
      const stopped = result.results.filter((row) => row.failedAt);
      if (stopped.length > 0) {
        message.warning(
          `${result.created} added. ${stopped.map((row) => `${sent[row.index]?.fullName || `Row ${row.index + 1}`}: ${row.error ?? `the ${row.failedAt} was not recorded`}`).join(' · ')}. Finish them on their records.`,
          8,
        );
      } else {
        message.success(`${result.created} ${result.created === 1 ? 'employee' : 'employees'} added.`);
      }
      navigate('/admin/hr/employees');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const cellProblem = (row: IntakeRow, field: Field) => problems.get(row.key)?.find((problem) => problem.field === field) ?? null;
  const rowOnly = (row: IntakeRow) => (problems.get(row.key) ?? []).filter((problem) => problem.field === null);
  const count = batch().length;

  return (
    <HrPage
      title="Add several employees"
      crumb="Employees / Add several"
      sub="One row per person: the columns payroll blocks on, plus the role and the start date. Check first; nothing is added unless every row passes. Addresses and emergency contacts go on the record afterwards."
      error={!mayManage ? 'Adding employees needs employee-record access.' : null}
      actions={
        <>
          <button type="button" className="hr-btn" onClick={downloadIntakeTemplate}>
            <IconDownload />
            Template (CSV)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="Upload a CSV"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <button type="button" className="hr-btn" onClick={() => fileInput.current?.click()} disabled={!mayManage}>
            Upload CSV
          </button>
          <button type="button" className="hr-btn" onClick={() => void send(false)} disabled={!mayManage || busy !== null || count === 0}>
            {busy === 'check' ? 'Checking…' : 'Check rows'}
          </button>
          <button type="button" className="hr-btn hr-btn--primary" onClick={() => void send(true)} disabled={!mayManage || busy !== null || count === 0}>
            <IconPlus />
            {busy === 'add' ? 'Adding…' : `Add ${count} ${count === 1 ? 'employee' : 'employees'}`}
          </button>
        </>
      }
    >
      {notice ? (
        <div className="hr-notice" role="status">
          {notice}
        </div>
      ) : null}
      <Panel>
        <div className="hr-intake">
          <table className="hr-table">
            <thead>
              <tr>
                <th>#</th>
                {INTAKE_COLUMNS.map((column) => (
                  <th key={column.key}>{COLUMN_HEADS[column.key]}</th>
                ))}
                <th>Payroll</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const result = results.get(row.key);
                const at = (field: Field) => {
                  const problem = cellProblem(row, field);
                  return problem ? <div className="hr-form__error" role="alert">{problem.message}</div> : null;
                };
                const n = index + 1;
                const select = (field: Field, options: { value: string; label: string }[], extra: { search?: boolean } = {}) => (
                  <>
                    <Select
                      aria-label={`${COLUMN_HEADS[field]}, row ${n}`}
                      size="small"
                      value={row[field] || undefined}
                      onChange={(value) => update(row.key, { [field]: value ?? '' } as Partial<IntakeRow>)}
                      options={options}
                      allowClear
                      showSearch={extra.search}
                      optionFilterProp="label"
                      popupMatchSelectWidth={false}
                      status={cellProblem(row, field) ? 'error' : undefined}
                      disabled={!mayManage}
                    />
                    {at(field)}
                  </>
                );
                const date = (field: 'startDate' | 'dateOfBirth') => (
                  <>
                    <DatePicker
                      aria-label={`${COLUMN_HEADS[field]}, row ${n}`}
                      size="small"
                      format="D MMM YYYY"
                      value={row[field] ? dayjs(row[field]) : null}
                      onChange={(value) => update(row.key, { [field]: value ? value.format('YYYY-MM-DD') : '' } as Partial<IntakeRow>)}
                      status={cellProblem(row, field) ? 'error' : undefined}
                      disabled={!mayManage}
                    />
                    {at(field)}
                  </>
                );
                return (
                  <tr key={row.key}>
                    <td className="hr-intake__n">{n}</td>
                    <td>
                      <Input
                        aria-label={`Full name, row ${n}`}
                        size="small"
                        value={row.fullName}
                        onChange={(event) => update(row.key, { fullName: event.target.value })}
                        placeholder="e.g. Demo Pekerja binti Contoh"
                        status={cellProblem(row, 'fullName') ? 'error' : undefined}
                        disabled={!mayManage}
                      />
                      {at('fullName')}
                    </td>
                    <td>{select('role', ROLE_OPTIONS)}</td>
                    <td>{select('clinicId', clinicOptions, { search: true })}</td>
                    <td>{select('legalEmployerId', employerOptions, { search: true })}</td>
                    <td>{date('startDate')}</td>
                    <td>{select('identifierType', DOCUMENT_OPTIONS)}</td>
                    <td>
                      <Input
                        aria-label={`IC or passport no., row ${n}`}
                        size="small"
                        value={row.identifierValue}
                        onChange={(event) => identifierChanged(row, event.target.value)}
                        placeholder={row.identifierType === 'PASSPORT' ? 'e.g. A12345678' : 'e.g. 900101-14-5566'}
                        status={cellProblem(row, 'identifierValue') ? 'error' : undefined}
                        disabled={!mayManage}
                      />
                      {at('identifierValue')}
                    </td>
                    <td>{date('dateOfBirth')}</td>
                    <td>{select('gender', GENDER_OPTIONS)}</td>
                    <td>
                      <Input
                        aria-label={`Monthly salary (RM), row ${n}`}
                        size="small"
                        inputMode="decimal"
                        value={row.salaryAmount}
                        onChange={(event) => update(row.key, { salaryAmount: event.target.value })}
                        placeholder="e.g. 2500"
                        status={cellProblem(row, 'salaryAmount') ? 'error' : undefined}
                        disabled={!mayManage}
                      />
                      {at('salaryAmount')}
                    </td>
                    <td>{select('epfMembership', EPF_OPTIONS)}</td>
                    <td>{select('taxResidence', TAX_RESIDENCE_OPTIONS)}</td>
                    <td>{select('pcbCategory', PCB_OPTIONS)}</td>
                    <td>{select('restDay', REST_DAY_OPTIONS)}</td>
                    <td>{select('lindungParticipation', LINDUNG_OPTIONS)}</td>
                    <td className="hr-intake__payroll">
                      {rowOnly(row).map((problem) => (
                        <div key={problem.message} className="hr-form__error" role="alert">
                          {problem.message}
                        </div>
                      ))}
                      {result && result.problems.length === 0 ? (
                        result.readiness.blocking.length === 0 ? (
                          <span className="hr-intake__ready">Ready for payroll</span>
                        ) : (
                          <ul className="hr-intake__blocking">
                            {result.readiness.blocking.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        )
                      ) : result ? (
                        <span className="hr-intake__fix">Fix the cells marked</span>
                      ) : (
                        <span className="hr-intake__unchecked">Not checked yet</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="hr-btn hr-btn--sm" aria-label={`Remove row ${n}`} onClick={() => removeRow(row.key)} disabled={!mayManage}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="hr-intake__foot">
          <button type="button" className="hr-btn hr-btn--sm" onClick={addRow} disabled={!mayManage}>
            <IconPlus />
            Add a row
          </button>
          <span className="hr-intake__hint">Blank date of birth and gender are read from a Malaysian IC. A blank LINDUNG answer means enrolled.</span>
        </div>
      </Panel>
    </HrPage>
  );
}
