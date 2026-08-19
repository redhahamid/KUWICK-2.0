import { useEffect, useState } from 'react';
import { Button, Card, Space, Switch, TimePicker, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../core/api-client';

const { Text } = Typography;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface WeeklyDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface FixedWeeklyEditorProps {
  clinicId: string;
  staffId: string;
  staffName: string;
  onSwitchToRoster: () => void;
}

/**
 * FIXED WEEKLY AVAILABILITY (§18) — the standing pattern most single-doctor
 * clinics actually have.
 *
 * Kept because forcing them onto a monthly matrix would be work with no
 * benefit: a GP who works the same seven days every week does not want to
 * re-enter them every month.
 *
 * SAVING NO LONGER DESTROYS HISTORY. This form used to delete every schedule
 * row for the provider and write seven new ones — including the effective-dated
 * rows a different screen had created. It now end-dates them: the old pattern
 * remains a true statement about last week, and the new one takes effect today.
 */
export function FixedWeeklyEditor({
  clinicId,
  staffId,
  staffName,
  onSwitchToRoster,
}: FixedWeeklyEditorProps) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<WeeklyDay[]>([]);
  const [saving, setSaving] = useState(false);
  // §15 — collapsed by default. Six providers times seven day-rows is a wall
  // of forty-two toggles; a clinic looks at ONE doctor's week at a time. The
  // summary line says what matters at a glance, Edit opens the week.
  const [editing, setEditing] = useState(false);

  const { data } = useQuery({
    queryKey: ['weekly-availability', staffId, clinicId],
    queryFn: () =>
      apiClient.get<WeeklyDay[]>(
        `/doctor-schedules/weekly?staffId=${staffId}&clinicId=${clinicId}`,
      ),
  });

  useEffect(() => {
    if (data) setDays(data);
  }, [data]);

  const dayFor = (dayOfWeek: number) => days.find((day) => day.dayOfWeek === dayOfWeek);

  const toggle = (dayOfWeek: number, on: boolean) => {
    setDays((current) =>
      on
        ? [...current, { dayOfWeek, startTime: '09:00', endTime: '17:00' }]
        : current.filter((day) => day.dayOfWeek !== dayOfWeek),
    );
  };

  const setTime = (dayOfWeek: number, key: 'startTime' | 'endTime', value: string) => {
    setDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, [key]: value } : day)),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put('/doctor-schedules/weekly', { clinicId, staffId, days });
      queryClient.invalidateQueries({ queryKey: ['weekly-availability', staffId] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      message.success(`${staffName}'s week saved`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That week could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const summary = (() => {
    // DISTINCT days — a split-shift day is two rows but one day, and
    // "11 days a week" is not a schedule anybody works.
    const distinct = new Set(days.map((day) => day.dayOfWeek)).size;
    if (distinct === 0) return 'No working days configured';
    const sorted = [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const split = days.length > distinct;
    const sameHours =
      !split &&
      sorted.every(
        (day) => day.startTime === sorted[0].startTime && day.endTime === sorted[0].endTime,
      );
    const hours = sameHours ? ` · ${sorted[0].startTime}–${sorted[0].endTime}` : split ? ' · split shifts' : '';
    return `${distinct} day${distinct === 1 ? '' : 's'} a week${hours}`;
  })();

  if (!editing) {
    return (
      <div className="kw-weekly-summary" data-testid={`weekly-${staffId}`}>
        <div className="kw-weekly-summary-text">
          <Text strong>{staffName}</Text>
          <Text type="secondary">{summary}</Text>
        </div>
        <Button size="small" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <Card
      size="small"
      style={{ marginTop: 12 }}
      title={staffName}
      data-testid={`weekly-${staffId}`}
      extra={
        <Space>
          <Button size="small" onClick={onSwitchToRoster}>
            Move to the monthly roster
          </Button>
          <Button size="small" onClick={() => setEditing(false)}>
            Done
          </Button>
          <Button size="small" type="primary" loading={saving} onClick={save}>
            Save week
          </Button>
        </Space>
      }
    >
      <div className="kw-weekly-grid">
        {DAYS.map((label, dayOfWeek) => {
          const entry = dayFor(dayOfWeek);
          return (
            <div key={label} className="kw-weekly-row">
              <Switch
                size="small"
                checked={Boolean(entry)}
                onChange={(on) => toggle(dayOfWeek, on)}
                aria-label={label}
              />
              <Text style={{ minWidth: 88 }}>{label}</Text>
              {entry ? (
                <Space size={4}>
                  <TimePicker
                    size="small"
                    format="HH:mm"
                    minuteStep={15}
                    needConfirm={false}
                    value={dayjs(entry.startTime, 'HH:mm')}
                    onChange={(value) =>
                      value && setTime(dayOfWeek, 'startTime', value.format('HH:mm'))
                    }
                  />
                  <Text type="secondary">to</Text>
                  <TimePicker
                    size="small"
                    format="HH:mm"
                    minuteStep={15}
                    needConfirm={false}
                    value={dayjs(entry.endTime, 'HH:mm')}
                    onChange={(value) =>
                      value && setTime(dayOfWeek, 'endTime', value.format('HH:mm'))
                    }
                  />
                  {entry.endTime <= entry.startTime ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      runs overnight
                    </Text>
                  ) : null}
                </Space>
              ) : (
                <Text type="secondary">Not working</Text>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
