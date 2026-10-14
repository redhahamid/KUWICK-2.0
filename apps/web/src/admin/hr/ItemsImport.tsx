import { useRef, useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useCalculatePayroll, useImportItems, useItemsImportCodes } from '../hooks/useAdmin';
import { parseCsv } from './employeeIntake';
import { StatusChip, TableModal } from './ui';
import { Table } from './ui/Table';
import { IconDownload } from './ui/icons';
import { downloadCsv } from './ui/csv';
import type { ItemsImportResult, ItemsImportRowInput, ItemsImportRowResult } from '../types';

/** The template's columns, in its order, and the field each fills. */
export const ITEMS_COLUMNS: { header: string; field: keyof ItemsImportRowInput; example: string }[] = [
  { header: 'Employee No.', field: 'employeeNo', example: 'EM-001' },
  { header: 'Item code', field: 'itemCode', example: 'OVERTIME' },
  { header: 'Amount (RM)', field: 'amount', example: '250.00' },
  { header: 'Earned in (YYYY-MM, optional)', field: 'earnedIn', example: '' },
  { header: 'PCB type (normal / additional)', field: 'pcbType', example: '' },
  { header: 'Note (optional)', field: 'note', example: 'From the old payroll' },
];

/** A heading matches by its first words, so "Amount" and "Amount (RM)" are the same column. */
const COLUMN_KEYS: [RegExp, keyof ItemsImportRowInput][] = [
  [/^employee\s*no/i, 'employeeNo'],
  [/^item\s*code/i, 'itemCode'],
  [/^amount/i, 'amount'],
  [/^earned\s*in/i, 'earnedIn'],
  [/^pcb\s*type/i, 'pcbType'],
  [/^note/i, 'note'],
];

/** Read a month's items file: rows as text, keyed by the template's columns; blank lines dropped. */
export function readItemsCsv(text: string): { rows: ItemsImportRowInput[]; unknownHeaders: string[]; missing: string[] } {
  const [header = [], ...body] = parseCsv(text);
  const fields = header.map((cell) => COLUMN_KEYS.find(([pattern]) => pattern.test(cell.trim()))?.[1] ?? null);
  const unknownHeaders = header.filter((cell, at) => cell.trim() !== '' && fields[at] === null).map((cell) => cell.trim());
  const missing = ITEMS_COLUMNS.slice(0, 3)
    .filter((column) => !fields.includes(column.field))
    .map((column) => column.header);
  const rows = body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const row: ItemsImportRowInput = {};
      fields.forEach((field, at) => {
        if (field) row[field] = (cells[at] ?? '').trim();
      });
      return row;
    });
  return { rows, unknownHeaders, missing };
}

/**
 * IMPORT THIS MONTH'S ITEMS (UAT, 10 October 2026): for moving a clinic's past
 * months in, one file per month. The same flow as adding several employees:
 * pick the file, every row is checked and shown, and nothing is saved until
 * every row passes; then "Add N lines" saves them all and works the month out
 * again. A second file for the month replaces the first.
 */
export function ItemsImport({ runId, period, canImport }: { runId: string; period: string; canImport: boolean }) {
  const { message } = App.useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const codes = useItemsImportCodes(canImport);
  const importItems = useImportItems();
  const calculate = useCalculatePayroll();
  const [file, setFile] = useState<{ name: string; rows: ItemsImportRowInput[] } | null>(null);
  const [result, setResult] = useState<ItemsImportResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  const month = dayjs(`${period}-01`).format('MMMM YYYY');

  if (!canImport) return null;

  const close = () => {
    setFile(null);
    setResult(null);
    setNotice(null);
  };

  const read = async (picked: File) => {
    const text = await picked.text();
    const reading = readItemsCsv(text);
    if (reading.missing.length > 0) {
      setNotice(`That file has no ${reading.missing.join(', ')} column. Download the template and keep its first line.`);
      setFile({ name: picked.name, rows: [] });
      setResult(null);
      return;
    }
    if (reading.rows.length === 0) {
      setNotice('That file has no rows under the template’s headings.');
      setFile({ name: picked.name, rows: [] });
      setResult(null);
      return;
    }
    setNotice(
      reading.unknownHeaders.length > 0
        ? `Ignored ${reading.unknownHeaders.length === 1 ? 'a column' : 'columns'} the template does not have: ${reading.unknownHeaders.join(', ')}.`
        : null,
    );
    setFile({ name: picked.name, rows: reading.rows });
    try {
      setResult(await importItems.mutateAsync({ runId, rows: reading.rows, fileName: picked.name }));
    } catch (error) {
      setResult(null);
      setNotice((error as Error).message);
    }
  };

  const save = async () => {
    if (!file || !result || result.failed > 0) return;
    try {
      const saved = await importItems.mutateAsync({ runId, rows: file.rows, fileName: file.name, commit: true });
      if (!saved.committed) {
        // Something changed between the preview and the save: show the fresh check.
        setResult(saved);
        setNotice('The rows were checked again and some no longer pass. Nothing was saved.');
        return;
      }
      close();
      try {
        await calculate.mutateAsync(runId);
        message.success(
          `${saved.added} ${saved.added === 1 ? 'line' : 'lines'} imported for ${month}` +
            `${saved.replaced > 0 ? `, replacing ${saved.replaced} earlier` : ''}, and the month worked out again.`,
        );
      } catch (error) {
        message.error(`Imported, but the month could not be worked out again: ${(error as Error).message}`);
      }
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const template = () =>
    downloadCsv(
      `payroll-items-${period}`,
      ITEMS_COLUMNS.map((column) => column.header),
      [
        ITEMS_COLUMNS.map((column) => column.example),
        ['EM-001', 'UNPAID_LEAVE_DAYS', '2', '', '', 'Days, not ringgit'],
      ],
    );

  const failedRows = result?.rows.filter((row) => !row.ok) ?? [];

  return (
    <>
      <button type="button" className="hr-btn" onClick={() => fileInput.current?.click()} disabled={importItems.isPending}>
        Import items (CSV)
      </button>
      <button type="button" className="hr-btn" onClick={template}>
        <IconDownload />
        Download template
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Items file"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) void read(picked);
        }}
      />

      <TableModal
        open={file !== null}
        onClose={close}
        title={`Import items for ${month}`}
        sub={
          file
            ? `${file.name} · ${file.rows.length} ${file.rows.length === 1 ? 'row' : 'rows'}` +
              (result ? ` · ${result.passed} ready, ${result.failed} to fix` : '')
            : undefined
        }
      >
        <div className="hr-importItems">
          {notice ? <div className="hr-notice hr-notice--attn">{notice}</div> : null}
          {result && result.failed > 0 ? (
            <div className="hr-notice hr-notice--attn" data-testid="import-fix">
              <strong>
                {result.failed} {result.failed === 1 ? 'row needs' : 'rows need'} fixing. Nothing has been saved.
              </strong>{' '}
              Correct the file and choose it again.
            </div>
          ) : null}
          {result && result.failed === 0 && result.previousImport > 0 ? (
            <div className="hr-notice hr-notice--info">
              Replaces the {result.previousImport} {result.previousImport === 1 ? 'line' : 'lines'} imported earlier for {month}.
            </div>
          ) : null}
          {result ? (
            <Table<ItemsImportRowResult>
              rows={failedRows.length > 0 ? [...failedRows, ...result.rows.filter((row) => row.ok)] : result.rows}
              rowKey={(row) => String(row.row)}
              columns={[
                { title: 'Row', dataIndex: 'row', width: 60 },
                {
                  title: 'Employee',
                  key: 'who',
                  render: (_: unknown, row) => (
                    <div>
                      <div className="hr-strong">{row.name ?? row.employeeNo ?? '—'}</div>
                      <span className="hr-faint hr-small">{row.employeeNo || 'No Employee No.'}</span>
                      {row.finalPay ? <div className="hr-small hr-muted">{row.finalPay}</div> : null}
                    </div>
                  ),
                },
                {
                  title: 'Item',
                  key: 'item',
                  render: (_: unknown, row) => (
                    <div>
                      <div>{row.itemName ?? row.itemCode ?? '—'}</div>
                      <span className="hr-faint hr-small">
                        {row.itemCode}
                        {row.addsOrDeducts ? ` · ${row.addsOrDeducts === 'DEDUCTS' ? 'deducts' : 'adds'}` : ''}
                        {row.pcbType ? ` · PCB ${row.pcbType}` : ''}
                      </span>
                    </div>
                  ),
                },
                {
                  title: 'Amount',
                  key: 'amount',
                  num: true,
                  render: (_: unknown, row) =>
                    row.days ? `${Number(row.days)} ${Number(row.days) === 1 ? 'day' : 'days'}` : row.amount ? `RM${Number(row.amount).toFixed(2)}` : '—',
                },
                {
                  title: 'Earned in',
                  key: 'earnedIn',
                  render: (_: unknown, row) => (row.earnedIn ? dayjs(`${row.earnedIn}-01`).format('MMM YYYY') : '—'),
                },
                {
                  title: 'Check',
                  key: 'check',
                  render: (_: unknown, row) =>
                    row.ok ? (
                      <div>
                        <StatusChip tone="done">Ready</StatusChip>
                        {row.replaces ? <div className="hr-faint hr-small">Replaces {row.replaces}</div> : null}
                      </div>
                    ) : (
                      <div>
                        <StatusChip tone="block">Fix</StatusChip>
                        {row.problems.map((problem) => (
                          <div key={problem} className="hr-small hr-importItems__problem">
                            {problem}
                          </div>
                        ))}
                      </div>
                    ),
                },
              ]}
            />
          ) : null}

          <details className="hr-details" open={showCodes} onToggle={(event) => setShowCodes((event.target as HTMLDetailsElement).open)}>
            <summary>Item codes you can use</summary>
            <ul className="hr-importItems__codes">
              {(codes.data?.codes ?? []).map((code) => (
                <li key={code.code}>
                  <code>{code.code}</code> {code.name} · {code.addsOrDeducts === 'DEDUCTS' ? 'deducts' : 'adds'}
                  {code.unit === 'days' ? ' · number of days, priced by payroll' : code.pcbType === 'additional' ? ' · additional pay for PCB' : ' · normal pay for PCB'}
                </li>
              ))}
            </ul>
          </details>

          <div className="hr-importItems__foot">
            <button type="button" className="hr-btn" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="hr-btn hr-btn--primary"
              disabled={!result || result.failed > 0 || result.passed === 0 || importItems.isPending || calculate.isPending}
              onClick={() => void save()}
            >
              Add {result?.passed ?? 0} {result?.passed === 1 ? 'line' : 'lines'}
            </button>
          </div>
        </div>
      </TableModal>
    </>
  );
}
