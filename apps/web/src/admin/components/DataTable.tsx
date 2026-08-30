import { ReactNode, useMemo, useState } from 'react';
import { Button, Checkbox, Dropdown, Empty, Input, Table } from 'antd';
import type { ColumnType, TablePaginationConfig } from 'antd/es/table';
import type { ExpandableConfig } from 'antd/es/table/interface';
import { DownloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';

export interface DataTableColumn<T> extends ColumnType<T> {
  /** Hidden by default but available from the column picker. */
  optional?: boolean;
  /** Excluded from the CSV export — an action column, say. */
  noExport?: boolean;
}

/**
 * THE DENSE TABLE the whole admin area uses.
 *
 * Everything the brief asks a dense table for, in one component so that no
 * screen has to remember to add it: sticky header, search, column visibility,
 * CSV export, pagination, a real empty state, and totals.
 *
 * TWO DECISIONS WORTH NAMING:
 *
 *  - COLUMNS CAN BE OPTIONAL RATHER THAN ABSENT. The brief's warning about
 *    "150-column tables" and its demand for column visibility pull in opposite
 *    directions; `optional: true` resolves them by shipping a readable default
 *    set with the rest one click away.
 *
 *  - EXPORT COMES FROM THE ROWS, NOT THE SCREEN. It exports what the filter
 *    produced, including columns currently hidden, because somebody exporting
 *    to Excel wants the data and not the layout.
 */
export function DataTable<T extends object>({
  rows,
  columns,
  rowKey,
  loading,
  searchPlaceholder = 'Search…',
  searchFields,
  exportName,
  summary,
  emptyText = 'Nothing to show',
  emptyHint,
  pageSize = 25,
  scrollY,
  onRow,
  toolbar,
  expandable,
  fitWidth = false,
}: {
  rows: T[] | undefined;
  columns: DataTableColumn<T>[];
  rowKey: string | ((row: T) => string);
  loading?: boolean;
  searchPlaceholder?: string;
  /** Which fields the search box looks in. Omit to disable search. */
  searchFields?: (keyof T)[];
  /** Enables CSV export under this filename. */
  exportName?: string;
  summary?: (rows: readonly T[]) => ReactNode;
  emptyText?: string;
  emptyHint?: string;
  pageSize?: number;
  scrollY?: number | string;
  onRow?: (row: T) => { onClick?: () => void };
  toolbar?: ReactNode;
  /**
   * Detail in place. The row stays where it is and its detail opens under it,
   * which is the right shape when the detail is the evidence FOR the row —
   * the uses that add up to a benefit balance, say. Prefer a click-through
   * when the detail is a screen in its own right.
   */
  expandable?: ExpandableConfig<T>;
  /**
   * Fit the container instead of scrolling sideways.
   *
   * These tables default to `scroll.x: max-content`, which is right on a page:
   * a dense money table is read by scrolling it, not by squashing it. Inside a
   * MODAL it is wrong — the table grows past the dialog and takes the action
   * column with it, so the one control that does anything ends up off-screen
   * and unreachable. With this on, `ellipsis` and column widths actually bind.
   */
  fitWidth?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<string[]>(() =>
    columns.filter((column) => column.optional).map((column) => String(column.key ?? column.dataIndex)),
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!query.trim() || !searchFields?.length) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      searchFields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, query, searchFields]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => !hidden.includes(String(column.key ?? column.dataIndex))),
    [columns, hidden],
  );

  const pagination: TablePaginationConfig | false =
    filtered.length > pageSize
      ? { pageSize, size: 'small', showSizeChanger: true, showTotal: (total) => `${total} rows` }
      : false;

  return (
    <div className="kw-dataTable">
      {(searchFields?.length || exportName || toolbar) && (
        <div className="kw-dataTable__toolbar">
          {searchFields?.length ? (
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined />}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="kw-dataTable__search"
            />
          ) : (
            <span />
          )}
          <div className="kw-dataTable__toolbarRight">
            {toolbar}
            <Dropdown
              trigger={['click']}
              menu={{
                items: columns.map((column) => {
                  const key = String(column.key ?? column.dataIndex);
                  return {
                    key,
                    label: (
                      <Checkbox
                        checked={!hidden.includes(key)}
                        onChange={(event) =>
                          setHidden((current) =>
                            event.target.checked ? current.filter((item) => item !== key) : [...current, key],
                          )
                        }
                      >
                        {typeof column.title === 'string' ? column.title : key}
                      </Checkbox>
                    ),
                  };
                }),
              }}
            >
              <Button size="small" icon={<SettingOutlined />} title="Columns" />
            </Dropdown>
            {exportName ? (
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => exportRowsAsCsv(exportName, filtered, columns)}
              >
                Export
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <Table<T>
        rowKey={rowKey as never}
        size="small"
        loading={loading}
        dataSource={filtered}
        columns={visibleColumns as ColumnType<T>[]}
        pagination={pagination}
        sticky
        scroll={
          fitWidth
            ? scrollY
              ? { y: scrollY }
              : undefined
            : scrollY
              ? { y: scrollY, x: 'max-content' }
              : { x: 'max-content' }
        }
        tableLayout={fitWidth ? 'fixed' : undefined}
        summary={summary}
        expandable={expandable}
        onRow={onRow ? (row) => onRow(row) : undefined}
        rowClassName={onRow ? 'kw-dataTable__row--clickable' : undefined}
        locale={{
          emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>{emptyText}<br />{emptyHint ? <small>{emptyHint}</small> : null}</span>} />,
        }}
      />
    </div>
  );
}

/**
 * CSV from the rows and the column definitions.
 *
 * Values are quoted and internal quotes doubled — the RFC 4180 rule — because
 * a patient called O'Brien or a note containing a comma is not an edge case in
 * a clinic, and an export that corrupts on either is an export nobody trusts.
 */
export function exportRowsAsCsv<T extends object>(name: string, rows: T[], columns: DataTableColumn<T>[]): void {
  const exportable = columns.filter((column) => !column.noExport);
  const header = exportable.map((column) => (typeof column.title === 'string' ? column.title : String(column.key)));
  const lines = [header, ...rows.map((row) => exportable.map((column) => cellText(row, column)))];
  const csv = lines.map((line) => line.map(quote).join(',')).join('\r\n');

  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cellText<T extends object>(row: T, column: DataTableColumn<T>): string {
  const key = column.dataIndex ?? column.key;
  if (key === undefined) return '';
  const value = (row as Record<string, unknown>)[String(key)];
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** RM, always two decimals, minus sign in front. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}RM${Math.abs(value).toFixed(2)}`;
}

/**
 * A number that may legitimately be absent.
 *
 * Renders "—" for null and "0.00" for zero, which are different answers
 * everywhere in this system: a statutory contribution that was not computed and
 * one that is genuinely nil must not look the same.
 */
export function moneyOrDash(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : money(value);
}

/**
 * THE TOTALS ROW every money table ends with.
 *
 * It lived as a private helper inside one page and was copied nowhere, which
 * meant the second money table would have grown its own. A finance table
 * without a total is a table somebody adds up by hand, and two tables that
 * total differently are worse than one that does not total at all.
 *
 * `total` is summed over the rows CURRENTLY IN VIEW, not the whole dataset —
 * a filtered table showing a total for rows it is not showing is the kind of
 * number that gets quoted in a meeting.
 */
export function DataTableTotals({
  count,
  total,
  label = 'outstanding',
  countLabel = 'row(s)',
}: {
  count: number;
  total: number;
  label?: string;
  countLabel?: string;
}) {
  return (
    <tr className="kw-tableTotals">
      <td colSpan={99}>
        <span>
          {count} {countLabel}
        </span>
        <strong>
          {money(total)} {label}
        </strong>
      </td>
    </tr>
  );
}
