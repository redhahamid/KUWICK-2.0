import { cellValue, gridColumnsFor, type GridColumn } from './PayrollGrid';
import type { PayrollJourney } from '../types';

type PayRow = PayrollJourney['pay']['rows'][number];

/** Items that already have a column of their own in the export. */
const HAS_OWN_COLUMN = new Set(['OVERTIME', 'UNPAID_LEAVE', 'PCB']);
/** Grid columns the export replaces with one column per item. */
const ITEMISED = new Set(['otherIncome', 'claims', 'otherDeductions']);

const cents = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const money = (value: number) => (value / 100).toFixed(2);

/**
 * THE PAYROLL EXPORT, ONE COLUMN PER ITEM (UAT, 10 October 2026): "add
 * Employee No. as the first column, and one column per payroll item that has
 * an amount … instead of lumping them into Other income / Other deductions.
 * Needed to reconcile against an old payroll line by line."
 *
 * Every grid column stays, except the three lumps, which become a column for
 * each item with an amount this month: earnings where Other income stood,
 * deductions where Other deductions stood. Overtime, unpaid leave and PCB keep
 * the columns they already have. Should a row's items not add up to the lump
 * the server worked out, the difference gets its own column rather than
 * vanishing; on a month the engine worked out it never appears.
 */
export function payrollExportTable(pay: PayrollJourney['pay']): { header: string[]; rows: (string | number | null)[][] } {
  const grid = gridColumnsFor(pay.columns);
  const itemCodes = new Map<string, { label: string; direction: 'ADDS' | 'DEDUCTS' }>();
  for (const row of pay.rows) {
    for (const item of row.items) {
      if (HAS_OWN_COLUMN.has(item.componentCode) || cents(item.amount) === 0) continue;
      if (!itemCodes.has(item.componentCode)) {
        itemCodes.set(item.componentCode, { label: item.label, direction: item.direction ?? 'ADDS' });
      }
    }
  }
  const adds = [...itemCodes].filter(([, item]) => item.direction === 'ADDS');
  const deducts = [...itemCodes].filter(([, item]) => item.direction === 'DEDUCTS');
  const amountOf = (row: PayRow, code: string) =>
    row.items.filter((item) => item.componentCode === code).reduce((sum, item) => sum + cents(item.amount), 0);

  // The lumps as the server worked them out, against the items that make them up.
  const lumpedIncome = (row: PayRow) =>
    cents(row.otherIncome) + cents(row.claims) + pay.columns.reduce((sum, column) => sum + cents(row.columns?.[column.code]?.amount), 0);
  const incomeLeft = (row: PayRow) => lumpedIncome(row) - adds.reduce((sum, [code]) => sum + amountOf(row, code), 0);
  const deductionsLeft = (row: PayRow) => cents(row.otherDeductions) - deducts.reduce((sum, [code]) => sum + amountOf(row, code), 0);
  const showIncomeLeft = pay.rows.some((row) => incomeLeft(row) !== 0);
  const showDeductionsLeft = pay.rows.some((row) => deductionsLeft(row) !== 0);

  type Out = { title: string; value: (row: PayRow) => string | number | null };
  const columns: Out[] = [];
  const fromGrid = (column: GridColumn): Out => ({ title: column.exportTitle ?? column.title, value: (row) => cellValue(column, row) });
  for (const column of grid) {
    if (column.itemCode) continue; // an own column is an item: it comes with the others
    if (column.key === 'otherIncome') {
      for (const [code, item] of adds) columns.push({ title: item.label, value: (row) => money(amountOf(row, code)) });
      if (showIncomeLeft) columns.push({ title: 'Other income (not itemised)', value: (row) => money(incomeLeft(row)) });
      continue;
    }
    if (column.key === 'otherDeductions') {
      for (const [code, item] of deducts) columns.push({ title: item.label, value: (row) => money(amountOf(row, code)) });
      if (showDeductionsLeft) columns.push({ title: 'Other deductions (not itemised)', value: (row) => money(deductionsLeft(row)) });
      continue;
    }
    if (ITEMISED.has(column.key)) continue;
    columns.push(fromGrid(column));
  }

  return {
    header: ['Employee No.', 'Employee', 'Position', 'Status', ...columns.map((column) => column.title)],
    rows: pay.rows.map((row) => [
      row.employeeNo ?? '',
      row.name,
      row.position,
      row.blockers > 0 ? 'Blocked' : row.warnings > 0 ? 'Needs attention' : 'Ready',
      ...columns.map((column) => column.value(row)),
    ]),
  };
}
