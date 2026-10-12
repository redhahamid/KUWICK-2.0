// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { ItemsImportResult } from '../types';

/*
 * IMPORT THIS MONTH'S ITEMS (UAT, 10 October 2026): the file read by the
 * template's headings, every row shown, and "Add N lines" only when every row
 * passes. Demo rows only.
 */
let preview: ItemsImportResult;
const mutateAsync = vi.fn(async (body: { commit?: boolean }) => (body.commit ? { ...preview, committed: true, added: preview.passed } : preview));
const calculate = vi.fn(async () => ({}));
vi.mock('../hooks/useAdmin', () => ({
  useItemsImportCodes: () => ({ data: { codes: [{ code: 'OVERTIME', name: 'Overtime', addsOrDeducts: 'ADDS', pcbType: 'normal', unit: 'RM' }] } }),
  useImportItems: () => ({ mutateAsync, isPending: false }),
  useCalculatePayroll: () => ({ mutateAsync: calculate, isPending: false }),
}));

const { ItemsImport, readItemsCsv } = await import('./ItemsImport');

const csv = [
  'Employee No.,Item code,Amount (RM),"Earned in (YYYY-MM, optional)",PCB type (normal / additional),Note (optional),Colour',
  'EM-001,OVERTIME,250.00,,,From the old payroll,red',
  ',,,,,,',
  'EM-002,UNPAID_LEAVE_DAYS,2,,,,',
].join('\r\n');

const result = (over: Partial<ItemsImportResult>): ItemsImportResult => ({
  runId: 'run-1',
  period: '2026-01',
  committed: false,
  rows: [
    { row: 1, employeeNo: 'EM-001', itemCode: 'OVERTIME', ok: true, problems: [], name: 'Demo Nurse', itemName: 'Overtime', amount: '250.00' },
    { row: 2, employeeNo: 'EM-002', itemCode: 'UNPAID_LEAVE_DAYS', ok: true, problems: [], name: 'Demo Clerk', itemName: 'Unpaid leave', days: '2.00' },
    { row: 3, employeeNo: '48', itemCode: 'OVERTIME', ok: true, problems: [], name: 'Demo Leaver', itemName: 'Overtime', amount: '300.00', earnedIn: '2026-02', finalPay: 'Final pay (left 21 Feb 2026)' },
  ],
  passed: 3,
  failed: 0,
  previousImport: 0,
  replaced: 0,
  added: 0,
  ...over,
});

const choose = (text: string) => {
  const file = new File([text], 'jan-2026.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  fireEvent.change(screen.getByLabelText('Items file'), { target: { files: [file] } });
};

describe('reading a month’s items file', () => {
  it('keys cells by the template’s headings, drops blank lines and names columns it ignores', () => {
    const read = readItemsCsv(csv);
    expect(read.rows).toEqual([
      { employeeNo: 'EM-001', itemCode: 'OVERTIME', amount: '250.00', earnedIn: '', pcbType: '', note: 'From the old payroll' },
      { employeeNo: 'EM-002', itemCode: 'UNPAID_LEAVE_DAYS', amount: '2', earnedIn: '', pcbType: '', note: '' },
    ]);
    expect(read.unknownHeaders).toEqual(['Colour']);
    expect(read.missing).toEqual([]);
  });

  it('says which of the three needed columns is missing', () => {
    expect(readItemsCsv('Employee No.,Amount\nEM-001,10').missing).toEqual(['Item code']);
  });
});

describe('the import', () => {
  const mount = () =>
    render(
      <App>
        <ItemsImport runId="run-1" period="2026-01" canImport />
      </App>,
    );

  it('saves nothing and offers no save while any row fails', async () => {
    preview = result({
      passed: 1,
      failed: 1,
      rows: [
        result({}).rows[0],
        { row: 2, employeeNo: 'EM-009', itemCode: 'OVERTIME', ok: false, problems: ['No employee has Employee No. EM-009.'] },
      ],
    });
    mutateAsync.mockClear();
    mount();
    choose(csv);
    expect(await screen.findByText('No employee has Employee No. EM-009.')).toBeTruthy();
    expect(screen.getByTestId('import-fix')).toHaveTextContent('1 row needs fixing. Nothing has been saved.');
    expect(screen.getByRole('button', { name: 'Add 1 line' })).toBeDisabled();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect((mutateAsync.mock.calls[0] as unknown as [{ commit?: boolean }])[0].commit).toBeUndefined();
  });

  it('adds every line once all pass, then works the month out again', async () => {
    preview = result({});
    mutateAsync.mockClear();
    calculate.mockClear();
    mount();
    choose(csv);
    expect(await screen.findByText('2 days')).toBeTruthy();
    expect(screen.getByText('Final pay (left 21 Feb 2026)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 lines' }));
    await waitFor(() => expect(calculate).toHaveBeenCalledWith('run-1'));
    expect((mutateAsync.mock.calls[1] as unknown as [{ commit?: boolean; fileName: string }])[0]).toMatchObject({ commit: true, fileName: 'jan-2026.csv' });
  });

  it('is not offered on a month that is not a draft', () => {
    render(
      <App>
        <ItemsImport runId="run-1" period="2026-01" canImport={false} />
      </App>,
    );
    expect(screen.queryByRole('button', { name: 'Import items (CSV)' })).toBeNull();
  });
});
