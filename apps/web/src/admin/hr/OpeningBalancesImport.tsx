import { useState } from 'react';
import { Alert, App, Modal } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../../core/api-client';
import { useImportOpeningBalances } from '../hooks/useAdmin';

const TEMPLATE = 'employee_no,leave_type,taken_days,carried_in_days\nE001,ANNUAL,3,2\n';

type Row = { employeeNo: string; leaveType: string; takenDays: number; carriedInDays?: number };

/** The CSV as rows, or the first problem in it. Header: employee_no,leave_type,taken_days[,carried_in_days]. */
export function parseOpeningBalances(text: string): { rows: Row[] } | { error: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) return { error: 'The file has no rows under the header.' };
  const head = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const at = (name: string) => head.indexOf(name);
  if (at('employee_no') < 0 || at('leave_type') < 0 || at('taken_days') < 0) {
    return { error: 'The header must have employee_no, leave_type and taken_days.' };
  }
  const rows: Row[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split(',').map((cell) => cell.trim());
    const taken = Number(cells[at('taken_days')]);
    const carriedText = at('carried_in_days') >= 0 ? cells[at('carried_in_days')] : '';
    if (!Number.isFinite(taken) || taken < 0) return { error: `Line ${index + 2}: taken_days must be a number of days.` };
    rows.push({
      employeeNo: cells[at('employee_no')],
      leaveType: (cells[at('leave_type')] ?? '').toUpperCase(),
      takenDays: taken,
      ...(carriedText ? { carriedInDays: Number(carriedText) } : {}),
    });
  }
  return { rows };
}

/**
 * OPENING BALANCES (Section D): leave already taken this year before the
 * clinic used Kuwick, and days carried in from last year, by Employee No.
 * Nothing is written if any line is wrong; every problem is listed.
 */
export function OpeningBalancesImport() {
  const { message } = App.useApp();
  const importRows = useImportOpeningBalances();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const year = dayjs().year();

  const read = async (file: File | undefined) => {
    setProblems([]);
    setRows(null);
    if (!file) return;
    const parsed = parseOpeningBalances(await file.text());
    if ('error' in parsed) setProblems([parsed.error]);
    else setRows(parsed.rows);
  };

  const submit = async () => {
    if (!rows) return;
    try {
      const result = await importRows.mutateAsync({ year, rows });
      if (result.problems.length > 0) {
        setProblems(result.problems.map((row) => `Line ${row.line}: ${row.message}`));
        return;
      }
      message.success(`${result.imported} opening balance${result.imported === 1 ? '' : 's'} imported`);
      setOpen(false);
      setRows(null);
    } catch (e) {
      setProblems([e instanceof ApiError ? e.message : 'The file could not be imported.']);
    }
  };

  return (
    <>
      <button type="button" className="hr-btn" onClick={() => setOpen(true)}>
        Import opening balances
      </button>
      <Modal
        open={open}
        title={`Opening leave balances, ${year}`}
        okText={rows ? `Import ${rows.length} line${rows.length === 1 ? '' : 's'}` : 'Import'}
        okButtonProps={{ disabled: !rows }}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={importRows.isPending}
        destroyOnHidden
      >
        <p>
          Leave each person already took this year before Kuwick, and days carried in from last year. One line per person and leave type,
          matched by Employee No.
        </p>
        <p>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="opening-leave-balances.csv">
            Download template
          </a>
        </p>
        <input type="file" accept=".csv,text/csv" aria-label="Opening balances CSV" onChange={(event) => void read(event.target.files?.[0])} />
        {rows ? <p className="hr-faint">{rows.length} lines read.</p> : null}
        {problems.length > 0 ? (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message="Nothing was imported" description={<ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} />
        ) : null}
      </Modal>
    </>
  );
}
