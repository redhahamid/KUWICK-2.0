import { type ReactNode, useMemo, useState } from 'react';
import { Empty, Table as AntTable } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { ToolbarSearch } from './Toolbar';

export interface HrColumn<T> extends ColumnType<T> {
  /** Right-aligned, tabular figures. Money and counts. */
  num?: boolean;
}

/**
 * THE HR MODULE'S TABLE.
 *
 * `admin/components/DataTable` does this job for the other four modules and
 * for the HR screens that have not moved to Slate yet, and it is not restyled
 * in place: twenty-two screens outside HR draw themselves with it. This one
 * keeps the parts a Settings or Payroll screen actually uses — search, an
 * empty state that says something, a summary row — on the kit's own table
 * styles (`docs/design/hr-slate/kit.css`: `table`, `th`, `td.num`).
 *
 * What it deliberately does NOT carry from the old one: the column picker and
 * the CSV export button. Neither is on any Slate mockup, and a control that is
 * on every table is a control nobody reads.
 */
export function Table<T extends object>({
  rows,
  columns,
  rowKey,
  loading,
  searchFields,
  searchPlaceholder = 'Search…',
  searchLabel = 'Search',
  toolbarLead,
  toolbar,
  toolbarRight,
  emptyText = 'Nothing to show',
  emptyHint,
  summary,
  onRow,
  rowClassName,
}: {
  rows: T[] | undefined;
  columns: HrColumn<T>[];
  rowKey: string | ((row: T) => string);
  loading?: boolean;
  /** Which fields the search box looks in. Omit to draw no search box. */
  searchFields?: (keyof T)[];
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Controls that belong BEFORE the search box — a day or month pager, which the mockups put first. */
  toolbarLead?: ReactNode;
  /** Extra controls beside the search box. */
  toolbar?: ReactNode;
  toolbarRight?: ReactNode;
  emptyText?: string;
  emptyHint?: string;
  summary?: (rows: readonly T[]) => ReactNode;
  onRow?: (row: T) => { onClick?: () => void; className?: string };
  rowClassName?: (row: T) => string;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!query.trim() || !searchFields?.length) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      searchFields.some((field) => String(row[field] ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, query, searchFields]);

  const hasToolbar = Boolean(searchFields?.length || toolbarLead || toolbar || toolbarRight);

  return (
    <div className="hr-table">
      {hasToolbar ? (
        <div className="hr-toolbar">
          {toolbarLead}
          {searchFields?.length ? (
            <ToolbarSearch value={query} onChange={setQuery} placeholder={searchPlaceholder} label={searchLabel} />
          ) : null}
          {toolbar}
          {toolbarRight ? <div className="hr-toolbar__right">{toolbarRight}</div> : null}
        </div>
      ) : null}
      <AntTable<T>
        rowKey={rowKey as never}
        size="small"
        loading={loading}
        dataSource={filtered}
        pagination={false}
        columns={columns.map((column) => ({
          ...column,
          align: column.num ? 'right' : column.align,
          className: column.num ? [column.className, 'hr-num'].filter(Boolean).join(' ') : column.className,
        }))}
        summary={summary}
        onRow={onRow ? (row) => onRow(row) : undefined}
        rowClassName={(row) =>
          [onRow ? 'hr-table__row--clickable' : null, rowClassName?.(row)].filter(Boolean).join(' ')
        }
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span>
                  {emptyText}
                  {emptyHint ? (
                    <>
                      <br />
                      <small>{emptyHint}</small>
                    </>
                  ) : null}
                </span>
              }
            />
          ),
        }}
      />
    </div>
  );
}
