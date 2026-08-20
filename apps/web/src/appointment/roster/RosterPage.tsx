import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  DatePicker,
  Empty,
  Modal,
  Popconfirm,
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
import { getDoctorColor } from '../calendar/doctor-color';

const { Text } = Typography;

// §5 — planning states keep the same language as everywhere else: leave is
// PLANNED (violet, an HR fact this screen reads), blocked is a dark neutral
// (unavailable, not an error), and amber/red stay reserved for people
// physically waiting and for released slots.
const SHIFT_TONE: Record<string, { bg: string; fg: string; edge: string; label?: string }> = {
  WORKING: { bg: '#e9f1fd', fg: '#1d4ed8', edge: '#1d4ed8' },
  LOCUM: { bg: '#eef2ff', fg: '#4338ca', edge: '#4338ca', label: 'Locum' },
  OFF: { bg: '#f2f4f7', fg: '#667085', edge: '#98a2b3', label: 'OFF' },
  LEAVE: { bg: '#f4ebff', fg: '#6941c6', edge: '#7f56d9', label: 'Leave' },
  BLOCKED: { bg: '#e4e7ec', fg: '#344054', edge: '#475467', label: 'Blocked' },
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
  const boardRef = useRef<HTMLDivElement>(null);

  const todayKey = dayjs().format('YYYY-MM-DD');

  // The board OPENS on the meaningful part of the month: today's column when
  // the month contains it, otherwise the first date that actually holds a
  // shift — never thirty-one empty columns with the work off-screen right.
  // Scroll position only; every date is still there.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !data) return;
    const target =
      board.querySelector<HTMLElement>('th[data-today]') ??
      board.querySelector<HTMLElement>('th[data-first-shift]');
    if (!target) return;
    const rail = board.querySelector<HTMLElement>('.kw-roster-provider-head');
    const railWidth = rail?.offsetWidth ?? 0;
    board.scrollLeft = Math.max(0, target.offsetLeft - railWidth);
  }, [data, monthKey]);

  // The first date in this month with any shift on it, for the initial
  // scroll when today is in a different month.
  const firstShiftDate = useMemo(() => {
    if (!data) return null;
    for (const date of data.dates) {
      if (data.providers.some((row) => (row.cells[date]?.shifts.length ?? 0) > 0)) return date;
    }
    return null;
  }, [data]);

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
          <span className="kw-roster-heading">{month.format('MMMM YYYY')}</span>
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
          <Tooltip
            title={selection ? undefined : 'Click one or more dates on the board first.'}
          >
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
                : 'Add shift'}
            </Button>
          </Tooltip>
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
        <div className="kw-roster-scroll" ref={boardRef}>
          <table className="kw-roster-grid">
            <thead>
              <tr>
                <th className="kw-roster-provider-head">Provider</th>
                {(data?.dates ?? []).map((date) => {
                  const day = dayjs(date);
                  const weekday = day.day();
                  const closed = data?.closedDates?.[date] !== undefined;
                  return (
                    <th
                      key={date}
                      data-closed={closed || undefined}
                      data-weekend={weekday === 0 || weekday === 6 || undefined}
                      data-today={date === todayKey || undefined}
                      data-first-shift={date === firstShiftDate || undefined}
                    >
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
                    <div className="kw-roster-provider-cell">
                      <Avatar
                        size={28}
                        style={{
                          background: getDoctorColor(provider.staffId),
                          fontSize: 11,
                          fontWeight: 700,
                          flex: 'none',
                        }}
                      >
                        {provider.fullName
                          .replace(/^Dr\.?\s+/i, '')
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0] ?? '')
                          .join('')
                          .toUpperCase()}
                      </Avatar>
                      <div className="kw-roster-provider-text">
                        <span className="kw-roster-provider-name">{provider.fullName}</span>
                        <Button
                          size="small"
                          type="link"
                          style={{ padding: 0, height: 'auto', fontSize: 11, textAlign: 'left' }}
                          onClick={() =>
                            setMode.mutate({ staffId: provider.staffId, mode: 'FIXED_WEEKLY' })
                          }
                        >
                          Use a weekly pattern instead
                        </Button>
                      </div>
                    </div>
                  </th>
                  {(data?.dates ?? []).map((date) => {
                    const day = dayjs(date);
                    const weekday = day.day();
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
                        data-weekend={weekday === 0 || weekday === 6 || undefined}
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
        // Kept, but SECONDARY: the board answers "who is working, when"; the
        // standing patterns live in a quiet panel underneath it.
        <div className="kw-apt3-panel" style={{ marginTop: 16 }}>
          <p className="kw-apt3-panel-title">Weekly templates</p>
          <p className="kw-apt3-panel-sub">
            These providers work the same hours every week. Their pattern is edited below, and
            changing it end-dates the old one rather than deleting it.
          </p>
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
        </div>
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
          <span
            className="kw-roster-chip"
            style={{ background: '#f4ebff', color: '#6941c6', borderLeftColor: '#7f56d9' }}
          >
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
              style={{ background: tone.bg, color: tone.fg, borderLeftColor: tone.edge }}
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
