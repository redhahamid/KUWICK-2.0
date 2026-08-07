import { Badge, Empty, Input, Segmented, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { KuwickStatusTag } from '../../design-system/kuwick';
import type { DispensaryRow } from '../hooks/useDispensary';
import { EMPTY_BOARD_TEXT, progressText, waitingText } from './dispensaryPresentation';

const { Text } = Typography;

/**
 * G4.5d5b-3 — the waiting list.
 *
 * Ordered longest-waiting-first by the server and left in that order here.
 * A dispensary board that re-sorts by name or by number teaches staff to scan
 * for a patient they already know about, when the whole point of the list is
 * to answer "who next".
 *
 * The list scrolls independently of the detail pane. On a busy afternoon the
 * two panes hold very different amounts of content, and a single page scroll
 * means finding your place again after every hand-over.
 */

export type ListFilter = 'ALL' | 'READY' | 'STOCK_ISSUE';

export interface DispensaryPatientListProps {
  rows: DispensaryRow[];
  selectedVisitId: string | null;
  onSelect: (visitId: string) => void;
  search: string;
  onSearch: (value: string) => void;
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  loading?: boolean;
}

/** Name, visit number and queue number — whichever the counter calls out. */
export function matchesSearch(row: DispensaryRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [row.patientName, row.visitNumber, row.displayNumber ?? '']
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function applyFilter(row: DispensaryRow, filter: ListFilter): boolean {
  if (filter === 'READY') return row.counts.remaining > 0 && !row.hasStockWarning;
  if (filter === 'STOCK_ISSUE') return row.hasStockWarning;
  return true;
}

export function DispensaryPatientList({
  rows,
  selectedVisitId,
  onSelect,
  search,
  onSearch,
  filter,
  onFilter,
  loading = false,
}: DispensaryPatientListProps) {
  const visible = rows.filter((row) => matchesSearch(row, search) && applyFilter(row, filter));

  return (
    <div className="kw-dispensary-list" data-testid="dispensary-patient-list">
      <div className="kw-dispensary-list-controls">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search patient, visit or queue number"
          aria-label="Search waiting patients"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <Segmented
          block
          size="small"
          value={filter}
          onChange={(value) => onFilter(value as ListFilter)}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Ready', value: 'READY' },
            { label: 'Stock issue', value: 'STOCK_ISSUE' },
          ]}
        />
      </div>

      <ul className="kw-dispensary-list-scroll" aria-label="Patients waiting for dispensing">
        {visible.length === 0 && (
          <li className="kw-dispensary-list-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                loading
                  ? 'Loading the dispensary board…'
                  : rows.length === 0
                    ? EMPTY_BOARD_TEXT
                    : 'No waiting patient matches this search.'
              }
            />
          </li>
        )}
        {visible.map((row) => {
          const selected = row.visitId === selectedVisitId;
          const waiting = waitingText(row.checkInAt);
          return (
            <li key={row.visitId}>
              <button
                type="button"
                className="kw-dispensary-list-item"
                data-selected={selected || undefined}
                // The selected row is announced, not only outlined: the pane
                // beside it changes wholesale when this button is pressed.
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(row.visitId)}
              >
                <div className="kw-dispensary-list-item-top">
                  <span className="kw-dispensary-list-number">{row.displayNumber ?? '—'}</span>
                  <span className="kw-dispensary-list-name">{row.patientName}</span>
                  {row.counts.remaining > 0 && (
                    <Badge
                      count={row.counts.remaining}
                      // The count is the workload, not an alarm.
                      color="var(--kw-accent, #0f766e)"
                      title={`${row.counts.remaining} medication(s) still to dispense`}
                    />
                  )}
                </div>
                <div className="kw-dispensary-list-item-meta">
                  <Text type="secondary">{progressText(row.counts)}</Text>
                  {waiting && <Text type="secondary">· {waiting}</Text>}
                </div>
                {(row.hasStockWarning || row.unresolvedCount > 0) && (
                  <div className="kw-dispensary-list-item-flags">
                    {row.hasStockWarning && (
                      <KuwickStatusTag tone="error" label="Stock issue" />
                    )}
                    {row.unresolvedCount > 0 && (
                      <KuwickStatusTag
                        tone="attention"
                        label="Supply not confirmed"
                        detail={row.unresolvedCount}
                      />
                    )}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
