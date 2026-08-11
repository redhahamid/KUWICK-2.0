import { useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Empty, Input, Skeleton, Space, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { VisitHistoryCard } from './VisitHistoryCard';
import { useVisitHistory } from './useVisitHistory';

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface VisitHistoryPanelProps {
  patientId: string;
  /** The consultation in progress — excluded from history, never switched to. */
  currentVisitId?: string;
  compact?: boolean;
}

/**
 * G4 (D-067) — Previous Visits, as a review surface.
 *
 * Before this, clicking a previous visit REPLACED the current visit in the
 * workspace: it could swap the record under an open editor, raise an
 * unsaved-note prompt mid-consultation, and leave the doctor unsure which
 * visit they were documenting against. Nothing in this panel changes the
 * current visit. It reads history and that is all it can do.
 *
 * Search and the date range are sent to the SERVER, so a filter that returns
 * nothing means the clinic has no such record — not "not on this page". The
 * result count says how many visits matched in total, so the difference
 * between "3 visits" and "3 of 42 visits" is never hidden.
 */
export function VisitHistoryPanel({ patientId, currentVisitId, compact }: VisitHistoryPanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      from: range?.[0] ? range[0].startOf('day').toISOString() : undefined,
      to: range?.[1] ? range[1].endOf('day').toISOString() : undefined,
    }),
    [search, range],
  );

  const query = useVisitHistory(patientId, filters);
  const pages = query.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  // The visit being worked on is not "previous". It stays in the workspace.
  const visits = pages.flatMap((page) => page.items).filter((visit) => visit.id !== currentVisitId);

  const toggle = (visitId: string) =>
    setExpanded((prev) => (prev.includes(visitId) ? prev.filter((id) => id !== visitId) : [...prev, visitId]));

  const applySearch = () => setSearch(searchInput.trim());

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }} className="kw-history-panel">
      <Space wrap size={8} style={{ width: '100%' }}>
        <Input
          allowClear
          value={searchInput}
          placeholder="Search diagnosis, medication, doctor…"
          prefix={<SearchOutlined />}
          onChange={(event) => setSearchInput(event.target.value)}
          onPressEnter={applySearch}
          onBlur={applySearch}
          style={{ minWidth: 220, flex: 1 }}
        />
        <RangePicker
          value={range as never}
          onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
          allowEmpty={[true, true]}
          style={{ minWidth: 230 }}
        />
      </Space>

      <Space wrap size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {query.isLoading
            ? 'Loading visit history…'
            : `${visits.length} shown${total > visits.length ? ` of ${total} matching` : ''}`}
        </Text>
        <Space size={4}>
          <Button
            size="small"
            style={{ minHeight: 44, paddingInline: 12 }}
            disabled={visits.length === 0}
            onClick={() => setExpanded(visits.map((visit) => visit.id))}
          >
            Expand All
          </Button>
          <Button
            size="small"
            style={{ minHeight: 44, paddingInline: 12 }}
            disabled={expanded.length === 0}
            onClick={() => setExpanded([])}
          >
            Collapse All
          </Button>
        </Space>
      </Space>

      {query.isLoading && <Skeleton active paragraph={{ rows: 4 }} />}

      {query.isError && (
        <Alert
          type="error"
          showIcon
          message="This patient’s history could not be loaded"
          description="Nothing has been changed. Try again, or check that you are authorised for this patient’s branch."
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => query.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      {!query.isLoading && !query.isError && visits.length === 0 && (
        <Empty
          description={
            search || range
              ? 'No previous visit matches these filters.'
              : 'This patient has no previous visits on record.'
          }
        />
      )}

      {visits.map((visit) => (
        <VisitHistoryCard
          key={visit.id}
          patientId={patientId}
          summary={visit}
          expanded={expanded.includes(visit.id)}
          onToggle={toggle}
          compact={compact}
        />
      ))}

      {query.hasNextPage && (
        <Button
          block
          loading={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
          style={{ minHeight: 44 }}
        >
          Load More
        </Button>
      )}

      {!query.hasNextPage && visits.length > 0 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          End of this patient’s recorded history{range ? ' for the selected dates' : ''}.
        </Text>
      )}
    </Space>
  );
}

/** Exported for the full-page route's header line. */
export function historyDateRangeLabel(from?: string, to?: string): string | null {
  if (!from && !to) return null;
  const start = from ? dayjs(from).format('D MMM YYYY') : '…';
  const end = to ? dayjs(to).format('D MMM YYYY') : '…';
  return `${start} – ${end}`;
}
