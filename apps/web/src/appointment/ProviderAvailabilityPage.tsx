import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Space,
  Switch,
  TimePicker,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { PageHeader } from '../design-system/components/PageHeader';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { apiClient, ApiError } from '../core/api-client';
import { useScheduleExceptions } from './hooks/useScheduleExceptions';
import { useSaveWeeklyAvailability, useWeeklyAvailability, WeeklyDay } from './hooks/useWeeklyAvailability';
import { useQueryClient } from '@tanstack/react-query';

// Roster times are a WALL CLOCK. Read without .utc() they shift by the
// reader's offset — see time.util.ts on the API side.
dayjs.extend(utc);

const TIME_FORMAT = 'HH:mm';
const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

const toPicker = (value: string) => dayjs.utc(`1970-01-01T${value}:00Z`);

interface DayRow {
  dayOfWeek: number;
  on: boolean;
  start: string;
  end: string;
}

function rowsFrom(days: WeeklyDay[] | undefined): DayRow[] {
  return DAYS.map((day) => {
    const stored = days?.find((entry) => entry.dayOfWeek === day.value);
    return {
      dayOfWeek: day.value,
      on: Boolean(stored),
      start: stored?.startTime ?? DEFAULT_START,
      end: stored?.endTime ?? DEFAULT_END,
    };
  });
}

/**
 * SETTINGS → APPOINTMENTS & SCHEDULING → PROVIDER AVAILABILITY
 *
 * A doctor's week as one statement, and the dates that override it.
 *
 * The week is seven toggles and seven time ranges, saved in ONE call, because
 * that is how a person reads it: "Dr Lim works Monday to Friday, 9 to 5." The
 * screen it replaces was a table of individual rows with an Add drawer, which
 * made the same statement take five separate acts and gave no way to see the
 * week at a glance.
 *
 * OVERRIDES ARE THE OTHER HALF and deliberately on the same screen. A doctor
 * away on the 24th is a fact about the same person's availability; on a
 * separate page it is a fact nobody checks.
 */
export function ProviderAvailabilityPage() {
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const { data: staff } = useStaff();
  const [staffId, setStaffId] = useState<string>();

  const doctors = useMemo(
    () => staff?.filter((member) => member.role === 'DOCTOR_RESIDENT' || member.role === 'DOCTOR_LOCUM') ?? [],
    [staff],
  );

  const { data: weekly, isLoading } = useWeeklyAvailability(staffId, clinicId);
  const saveWeekly = useSaveWeeklyAvailability();
  const [rows, setRows] = useState<DayRow[]>(rowsFrom(undefined));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(rowsFrom(weekly));
    setDirty(false);
  }, [weekly, staffId, clinicId]);

  const patch = (dayOfWeek: number, change: Partial<DayRow>) => {
    setRows((current) =>
      current.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, ...change } : row)),
    );
    setDirty(true);
  };

  const save = async () => {
    if (!staffId || !clinicId) return;
    const broken = rows.find((row) => row.on && row.end <= row.start);
    if (broken) {
      const name = DAYS.find((day) => day.value === broken.dayOfWeek)?.label;
      message.error(`${name} ends before it starts.`);
      return;
    }
    try {
      await saveWeekly.mutateAsync({
        staffId,
        clinicId,
        days: rows
          .filter((row) => row.on)
          .map((row) => ({ dayOfWeek: row.dayOfWeek, startTime: row.start, endTime: row.end })),
      });
      setDirty(false);
      message.success('Weekly hours saved.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the weekly hours.');
    }
  };

  const workingDays = rows.filter((row) => row.on).length;

  return (
    <div className="kw-settings-page">
      <PageHeader
        title="Provider availability"
        subtitle="A doctor's weekly hours, and the dates that override them."
      />

      <Space size={12} wrap className="kw-settings-pickers">
        {showSelector && (
          <Select
            placeholder="Branch"
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            style={{ minWidth: 200 }}
          />
        )}
        <Select
          placeholder="Choose a doctor"
          value={staffId}
          onChange={setStaffId}
          showSearch
          optionFilterProp="label"
          options={doctors.map((doctor) => ({ value: doctor.id, label: doctor.fullName }))}
          style={{ minWidth: 260 }}
        />
      </Space>

      {!staffId ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Choose a doctor to set their hours"
          className="kw-settings-empty"
        />
      ) : (
        <div className="kw-settings-grid">
          <Card
            title="Weekly hours"
            className="kw-settings-card"
            loading={isLoading}
            extra={
              <Typography.Text type="secondary">
                {workingDays === 0 ? 'Not working' : `${workingDays} day${workingDays === 1 ? '' : 's'} a week`}
              </Typography.Text>
            }
          >
            <ul className="kw-week-list">
              {rows.map((row) => {
                const label = DAYS.find((day) => day.value === row.dayOfWeek)?.label ?? '';
                return (
                  <li key={row.dayOfWeek} className={`kw-week-row${row.on ? ' kw-week-row-on' : ''}`}>
                    <Switch
                      checked={row.on}
                      onChange={(on) => patch(row.dayOfWeek, { on })}
                      aria-label={label}
                    />
                    <span className="kw-week-day">{label}</span>
                    {row.on ? (
                      <TimePicker.RangePicker
                        format={TIME_FORMAT}
                        minuteStep={5}
                        needConfirm={false}
                        allowClear={false}
                        value={[toPicker(row.start), toPicker(row.end)]}
                        onChange={(range) => {
                          if (!range?.[0] || !range?.[1]) return;
                          patch(row.dayOfWeek, {
                            start: range[0].format(TIME_FORMAT),
                            end: range[1].format(TIME_FORMAT),
                          });
                        }}
                      />
                    ) : (
                      <span className="kw-week-off">Not working</span>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="kw-week-save">
              <Button type="primary" onClick={save} loading={saveWeekly.isPending} disabled={!dirty}>
                Save weekly hours
              </Button>
              {dirty && <Typography.Text type="secondary">Unsaved changes</Typography.Text>}
            </div>
          </Card>

          <OverridesCard staffId={staffId} clinicId={clinicId} />
        </div>
      )}
    </div>
  );
}

/**
 * Per-date overrides. A date here WINS over the weekly pattern outright —
 * custom hours, or nothing at all if the doctor is away.
 *
 * Upcoming only. Last month's leave is not a setting, and a list that grows
 * forever is a list nobody reads.
 */
function OverridesCard({ staffId, clinicId }: { staffId: string; clinicId?: string }) {
  const queryClient = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const { data: exceptions, isLoading } = useScheduleExceptions({ staffId, clinicId, from: today });

  const [date, setDate] = useState<Dayjs | null>(null);
  const [away, setAway] = useState(true);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([toPicker('09:00'), toPicker('13:00')]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['schedule-exceptions'] });
    queryClient.invalidateQueries({ queryKey: ['availability'] });
  };

  const add = async () => {
    if (!date || !clinicId) return;
    setSaving(true);
    try {
      await apiClient.post('/schedule-exceptions', {
        staffId,
        clinicId,
        date: date.format('YYYY-MM-DD'),
        // No window at all means "away that whole day" — the engine reads a
        // null start/end exactly that way.
        startTime: away ? undefined : range[0].format(TIME_FORMAT),
        endTime: away ? undefined : range[1].format(TIME_FORMAT),
        reason: reason.trim() || undefined,
      });
      setDate(null);
      setReason('');
      refresh();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add that override.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiClient.delete(`/schedule-exceptions/${id}`);
      refresh();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not remove that override.');
    }
  };

  return (
    <Card title="Date overrides" className="kw-settings-card" loading={isLoading}>
      <Typography.Paragraph type="secondary" className="kw-settings-note">
        A date here replaces the weekly pattern for that day — different hours, or away entirely.
      </Typography.Paragraph>

      <Space direction="vertical" size={10} className="kw-override-add">
        <Space size={8} wrap>
          <DatePicker value={date} onChange={setDate} placeholder="Date" minDate={dayjs()} />
          <Space size={6}>
            <Switch checked={away} onChange={setAway} aria-label="Away all day" />
            <Typography.Text>{away ? 'Away all day' : 'Different hours'}</Typography.Text>
          </Space>
          {!away && (
            <TimePicker.RangePicker
              format={TIME_FORMAT}
              minuteStep={5}
              needConfirm={false}
              allowClear={false}
              value={range}
              onChange={(next) => next?.[0] && next?.[1] && setRange([next[0], next[1]])}
            />
          )}
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            maxLength={120}
            onPressEnter={add}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={add} disabled={!date} loading={saving}>
            Add
          </Button>
        </Space.Compact>
      </Space>

      {exceptions?.length ? (
        <ul className="kw-holiday-list">
          {exceptions.map((exception) => {
            const allDay = !exception.startTime || !exception.endTime;
            return (
              <li key={exception.id} className="kw-holiday-row">
                <div className="kw-holiday-when">
                  <span className="kw-holiday-date">{dayjs(exception.date).format('D MMM YYYY')}</span>
                  <span className="kw-holiday-day">{dayjs(exception.date).format('dddd')}</span>
                </div>
                <span className="kw-holiday-reason">
                  {allDay
                    ? 'Away all day'
                    : `${dayjs.utc(exception.startTime).format(TIME_FORMAT)}–${dayjs.utc(exception.endTime).format(TIME_FORMAT)}`}
                  {exception.reason ? ` · ${exception.reason}` : ''}
                </span>
                <Button
                  type="text"
                  size="small"
                  aria-label={`Remove ${dayjs(exception.date).format('D MMM YYYY')}`}
                  icon={<DeleteOutlined />}
                  onClick={() => remove(exception.id)}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No overrides coming up"
          className="kw-holiday-empty"
        />
      )}
    </Card>
  );
}
