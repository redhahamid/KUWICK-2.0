import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { CopyOutlined, LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { ApiError } from '../../core/api-client';
import {
  RosterCell,
  RosterShift,
  useCopyRosterMonth,
  useRemoveShift,
  useRosterMonth,
  useSetScheduleMode,
} from '../hooks/useRoster';
import { ShiftEditorModal } from './ShiftEditorModal';
import { FixedWeeklyEditor } from './FixedWeeklyEditor';

const { Text, Title } = Typography;

// §5 — planning states keep the same language as everywhere else: leave is
// PLANNED (violet, an HR fact this screen reads), blocked is a dark neutral
// (unavailable, not an error), and amber/red stay reserved for people
// physically waiting and for released slots.
const SHIFT_TONE: Record<string, { bg: string; fg: string; label?: string }> = {
  WORKING: { bg: '#e6f4ff', fg: '#0958d9' },
  LOCUM: { bg: '#f0f5ff', fg: '#2f54eb', label: 'Locum' },
  OFF: { bg: '#f2f4f7', fg: '#667085', label: 'OFF' },
  LEAVE: { bg: '#f4ebff', fg: '#6941c6', label: 'Leave' },
  BLOCKED: { bg: '#e4e7ec', fg: '#344054', label: 'Blocked' },
};

interface RosterPageProps {
  clinicId?: string;
}

/**
 * ROSTER & AVAILABILITY — the monthly matrix (§17).
 *
 * Providers down, dates across, and a cell that can hold as many shifts as the
 * day really has. That shape is the point: the representation it replaces was
 * a weekday plus two times, which could hold neither a night shift (23:00 to
 * 09:00 read as "ends before it starts") nor a split day (08:00–15:00 AND
 * 20:00–23:00).
 *
 * LEAVE IS READ, NEVER RE-ENTERED. Approved leave comes from HR and appears in
 * the cell as a fact this screen does not own. Typing it here as well is how
 * the two records come to disagree, and it is the second half of the defect
 * this redesign exists to close — the first half being that the availability
 * engine had never heard of leave at all.
 *
 * TWO MODES (§18). A provider is ROSTER_LINKED (this matrix) or FIXED_WEEKLY
 * (a standing pattern, edited below). Never both, and switching destroys
 * neither: the other model's rows stay where they are and stop being read.
 */
export function RosterPage({ clinicId }: RosterPageProps) {
  const [month, setMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [editing, setEditing] = useState<{
    staffId: string;
    staffName: string;
    dates: string[];
    shift?: RosterShift;
  } | null>(null);
  const [selection, setSelection] = useState<{ staffId: string; dates: string[] } | null>(null);

  const monthKey = month.format('YYYY-MM');
  const { data, isFetching } = useRosterMonth(clinicId, monthKey);
  const removeShift = useRemoveShift();
  const copyMonth = useCopyRosterMonth();
  const setMode = useSetScheduleMode();

  const rosterProviders = useMemo(
    () => (data?.providers ?? []).filter((row) => row.scheduleMode === 'ROSTER_LINKED'),
    [data],
  );
  const weeklyProviders = useMemo(
    () => (data?.providers ?? []).filter((row) => row.scheduleMode === 'FIXED_WEEKLY'),
    [data],
  );

  const toggleDate = (staffId: string, date: string) => {
    setSelection((current) => {
      if (!current || current.staffId !== staffId) return { staffId, dates: [date] };
      const has = current.dates.includes(date);
      const dates = has ? current.dates.filter((value) => value !== date) : [...current.dates, date];
      return dates.length > 0 ? { staffId, dates } : null;
    });
  };

  const onRemove = async (shiftId: string) => {
    try {
      const result = await removeShift.mutateAsync(shiftId);
      if (result.orphanedAppointments > 0) {
        // NOT a silent delete. The appointments booked into that shift still
        // exist and somebody has to decide what happens to them.
        Modal.warning({
          title: 'The shift is gone, the appointments are not',
          content: `${result.orphanedAppointments} appointment${result.orphanedAppointments === 1 ? ' was' : 's were'} booked in that shift. They have NOT been cancelled — move or cancel them from the calendar.`,
        });
      } else {
        message.success('Shift removed');
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not remove that shift.');
    }
  };

  const onCopyPrevious = async () => {
    if (!clinicId) return;
    try {
      const result = await copyMonth.mutateAsync({
        clinicId,
        fromMonth: month.subtract(1, 'month').format('YYYY-MM'),
        toMonth: monthKey,
      });
      message.success(
        result.skipped > 0
          ? `Copied ${result.created} shifts. ${result.skipped} had no matching weekday this month and were left out.`
          : `Copied ${result.created} shifts.`,
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not copy last month.');
    }
  };

  if (!clinicId) return <Empty description="Choose a branch to see its roster." />;

  return (
    <div className="kw-roster" data-testid="roster-page">
      <div className="kw-roster-toolbar">
        <Space wrap>
          <Button.Group>
            <Button
              icon={<LeftOutlined />}
              aria-label="Previous month"
              onClick={() => setMonth((current) => current.subtract(1, 'month'))}
            />
            <Button onClick={() => setMonth(dayjs().startOf('month'))}>This month</Button>
            <Button
              icon={<RightOutlined />}
              aria-label="Next month"
              onClick={() => setMonth((current) => current.add(1, 'month'))}
            />
          </Button.Group>
          <DatePicker
            picker="month"
            value={month}
            onChange={(value) => value && setMonth(value.startOf('month'))}
            allowClear={false}
          />
          <Text strong>{month.format('MMMM YYYY')}</Text>
        </Space>
        <Space wrap>
          <Popconfirm
            title="Copy last month's roster?"
            description="Shifts are aligned by WEEKDAY, and this month's existing shifts for those providers are replaced."
            onConfirm={onCopyPrevious}
          >
            <Button icon={<CopyOutlined />} loading={copyMonth.isPending}>
              Copy last month
            </Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!selection}
            onClick={() => {
              if (!selection) return;
              const provider = rosterProviders.find((row) => row.staffId === selection.staffId);
              setEditing({
                staffId: selection.staffId,
                staffName: provider?.fullName ?? '',
                dates: selection.dates,
              });
            }}
          >
            {selection
              ? `Add shift to ${selection.dates.length} date${selection.dates.length === 1 ? '' : 's'}`
              : 'Select dates to add a shift'}
          </Button>
        </Space>
      </div>

      {isFetching && !data ? <Spin /> : null}

      {rosterProviders.length === 0 && !isFetching ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="No provider is on the monthly roster yet"
          description="Providers below are on a standing weekly pattern. Switch one to the monthly roster when their hours change week to week."
        />
      ) : null}

      {rosterProviders.length > 0 ? (
        <div className="kw-roster-scroll">
          <table className="kw-roster-grid">
            <thead>
              <tr>
                <th className="kw-roster-provider-head">Provider</th>
                {(data?.dates ?? []).map((date) => {
                  const day = dayjs(date);
                  const closed = data?.closedDates?.[date] !== undefined;
                  return (
                    <th key={date} data-closed={closed || undefined}>
                      <div className="kw-roster-daynum">{day.format('D')}</div>
                      <div className="kw-roster-dayname">{day.format('dd')}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rosterProviders.map((provider) => (
                <tr key={provider.staffId}>
                  <th className="kw-roster-provider">
                    <div>{provider.fullName}</div>
                    <Button
                      size="small"
                      type="link"
                      style={{ padding: 0, height: 'auto', fontSize: 11 }}
                      onClick={() =>
                        setMode.mutate({ staffId: provider.staffId, mode: 'FIXED_WEEKLY' })
                      }
                    >
                      Use a weekly pattern instead
                    </Button>
                  </th>
                  {(data?.dates ?? []).map((date) => {
                    const cell = provider.cells[date];
                    const picked =
                      selection?.staffId === provider.staffId && selection.dates.includes(date);
                    const closedReason = data?.closedDates?.[date];
                    const isClosed = data?.closedDates ? date in data.closedDates : false;
                    return (
                      <td
                        key={date}
                        className="kw-roster-cell"
                        data-picked={picked || undefined}
                        data-closed={isClosed || undefined}
                        onClick={() => toggleDate(provider.staffId, date)}
                      >
                        {isClosed ? (
                          <Tooltip title={closedReason ?? 'The clinic is closed'}>
                            <span className="kw-roster-closed">Closed</span>
                          </Tooltip>
                        ) : null}
                        <RosterCellContent
                          cell={cell}
                          onEdit={(shift) =>
                            setEditing({
                              staffId: provider.staffId,
                              staffName: provider.fullName,
                              dates: [date],
                              shift,
                            })
                          }
                          onRemove={onRemove}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {weeklyProviders.length > 0 ? (
        <>
          <Title level={5} style={{ marginTop: 24 }}>
            Fixed weekly availability
          </Title>
          <Text type="secondary">
            These providers work the same hours every week. Their pattern is edited below, and
            changing it end-dates the old one rather than deleting it.
          </Text>
          {weeklyProviders.map((provider) => (
            <FixedWeeklyEditor
              key={provider.staffId}
              clinicId={clinicId}
              staffId={provider.staffId}
              staffName={provider.fullName}
              onSwitchToRoster={() =>
                setMode.mutate({ staffId: provider.staffId, mode: 'ROSTER_LINKED' })
              }
            />
          ))}
        </>
      ) : null}

      <ShiftEditorModal
        open={Boolean(editing)}
        clinicId={clinicId}
        staffId={editing?.staffId ?? ''}
        staffName={editing?.staffName ?? ''}
        dates={editing?.dates ?? []}
        shift={editing?.shift}
        onClose={() => {
          setEditing(null);
          setSelection(null);
        }}
      />
    </div>
  );
}

function RosterCellContent({
  cell,
  onEdit,
  onRemove,
}: {
  cell?: RosterCell;
  onEdit: (shift: RosterShift) => void;
  onRemove: (shiftId: string) => void;
}) {
  if (!cell) return null;
  return (
    <div className="kw-roster-cell-body">
      {cell.leave ? (
        // Read from HR, and NOT editable here. Two records of the same absence
        // is how they come to disagree.
        <Tooltip title="Approved leave, recorded in HR">
          <span className="kw-roster-chip" style={{ background: '#f4ebff', color: '#6941c6' }}>
            Leave
          </span>
        </Tooltip>
      ) : null}
      {cell.shifts.map((shift) => {
        const tone = SHIFT_TONE[shift.shiftType] ?? SHIFT_TONE.WORKING;
        // §14 — an overnight shift says so in words a roster reader uses:
        // "23:00→09:00 +1", not a superscript nobody notices.
        const label =
          tone.label ??
          (shift.crossesMidnight
            ? `${shift.startTime}→${shift.endTime} +1`
            : `${shift.startTime}–${shift.endTime}`);
        return (
          <Tooltip
            key={shift.id}
            title={
              <>
                {shift.startTime}–{shift.endTime}
                {shift.crossesMidnight ? ' (next day)' : ''}
                {shift.bookableStartTime
                  ? ` · bookable ${shift.bookableStartTime}–${shift.bookableEndTime}`
                  : ''}
                {shift.note ? ` · ${shift.note}` : ''}
              </>
            }
          >
            <span
              className="kw-roster-chip"
              style={{ background: tone.bg, color: tone.fg }}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(shift);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onRemove(shift.id);
              }}
            >
              {label}
              {shift.bookableStartTime ? <sup>•</sup> : null}
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
