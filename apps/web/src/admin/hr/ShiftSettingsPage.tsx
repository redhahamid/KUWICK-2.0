import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Input, InputNumber, Select, Switch, TimePicker } from 'antd';
import dayjs from 'dayjs';
import { HrPage, Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { Drawer } from './ui/Drawer';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useAttendancePolicy, useSaveAttendancePolicy } from '../hooks/useAdmin';
import {
  useRemoveShiftTemplate,
  useSaveShiftTemplate,
  useShiftTemplates,
  type ShiftGroup,
  type ShiftTemplate,
  type ShiftTemplateInput,
} from '../../appointment/hooks/useRoster';

/**
 * SHIFTS (UAT, 14 October 2026): "Shift templates per staff group (doctors /
 * staff), set by the clinic: name, start, end, rest break, crosses midnight,
 * night or day, colour. Branch opening hours (24h or not). Week start day
 * (default Monday)."
 *
 * Kuwick ships no shifts of its own: every clinic's day is different, so the
 * list starts empty and says how to fill it. Crossing midnight is not a
 * switch: an end at or before the start is the next day, as everywhere on
 * the roster. Changing a shift here never rewrites one already rostered.
 */
export const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Eight distinct colours for a roster cell; any #rrggbb may be typed instead. */
const SWATCHES = ['#2e90fa', '#12b76a', '#f79009', '#7a5af8', '#ee46bc', '#0e9384', '#475467', '#f04438'];

const GROUP_LABEL: Record<ShiftGroup, string> = { DOCTOR: 'Doctor shifts', STAFF: 'Staff shifts' };

export function ShiftSettingsPage() {
  return (
    <HrPage
      title="Shifts"
      sub="The clinic's own shifts for doctors and staff, the day a roster week starts, and each branch's opening hours."
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp;{' '}
          <Link to="/admin/hr/settings/attendance-leave">Attendance &amp; leave</Link> &nbsp;/&nbsp; Shifts
        </>
      }
    >
      <WeekAndHoursPanel />
      <div className="hr-mt">
        <TemplatesPanel group="DOCTOR" />
      </div>
      <div className="hr-mt">
        <TemplatesPanel group="STAFF" />
      </div>
    </HrPage>
  );
}

/** Week start and opening hours: the group default, or one branch's own. */
function WeekAndHoursPanel() {
  const { message } = App.useApp();
  const { clinics } = useClinicFilter();
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const { data } = useAttendancePolicy(branch);
  const save = useSaveAttendancePolicy();
  const canManage = useCan('hr.attendance.manage');
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [hours, setHours] = useState<'UNSET' | 'ALL_DAY' | 'TIMES'>('UNSET');
  const [openTime, setOpenTime] = useState<string | null>(null);
  const [closeTime, setCloseTime] = useState<string | null>(null);

  useEffect(() => {
    const policy = data?.policy;
    if (!policy) return;
    setWeekStartDay(policy.weekStartDay ?? 1);
    const opening = policy.openingHours ?? null;
    setHours(!opening ? 'UNSET' : opening.open24Hours ? 'ALL_DAY' : 'TIMES');
    setOpenTime(opening?.openTime ?? null);
    setCloseTime(opening?.closeTime ?? null);
  }, [data]);

  const submit = async () => {
    if (hours === 'TIMES' && (!openTime || !closeTime)) {
      message.error('Give an opening and a closing time, or choose "Open 24 hours".');
      return;
    }
    try {
      await save.mutateAsync({
        clinicId: branch,
        weekStartDay,
        open24Hours: hours === 'UNSET' ? null : hours === 'ALL_DAY',
        openTime: hours === 'TIMES' ? openTime : null,
        closeTime: hours === 'TIMES' ? closeTime : null,
      });
      message.success('Saved.');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  const overnight = hours === 'TIMES' && openTime && closeTime && closeTime <= openTime;

  return (
    <Panel>
      <PanelHead
        title="Week and opening hours"
        sub={
          data
            ? data.source === 'CLINIC'
              ? 'This branch has its own settings.'
              : data.source === 'GROUP_DEFAULT'
                ? 'From the group default.'
                : "Kuwick's default: the week starts on Monday; opening hours not set."
            : undefined
        }
        actions={
          <button
            type="button"
            className="hr-btn hr-btn--sm hr-btn--primary"
            onClick={submit}
            disabled={!canManage || save.isPending}
            title={canManage ? undefined : permissionHint('hr.attendance.manage')}
          >
            Save
          </button>
        }
      />
      <div className="hr-pad">
        <div className="hr-form">
          <div className="hr-form__row">
            <div>
              <label htmlFor="shift-branch">Settings for</label>
              <Select
                id="shift-branch"
                value={branch ?? ''}
                onChange={(value: string) => setBranch(value || undefined)}
                style={{ width: '100%' }}
                options={[{ value: '', label: 'Every branch (group default)' }, ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))]}
              />
            </div>
            <div>
              <label htmlFor="week-start">The roster week starts on</label>
              <Select
                id="week-start"
                value={weekStartDay}
                onChange={setWeekStartDay}
                style={{ width: '100%' }}
                options={WEEK_DAYS.map((label, value) => ({ value, label }))}
              />
            </div>
          </div>
          <div>
            <label htmlFor="opening-hours">Opening hours</label>
            <Select
              id="opening-hours"
              value={hours}
              onChange={setHours}
              style={{ width: '100%' }}
              options={[
                { value: 'UNSET', label: 'Not set' },
                { value: 'ALL_DAY', label: 'Open 24 hours' },
                { value: 'TIMES', label: 'Opens and closes at set times' },
              ]}
            />
          </div>
          {hours === 'TIMES' ? (
            <div className="hr-form__row">
              <div>
                <label htmlFor="opens-at">Opens</label>
                <TimePicker
                  id="opens-at"
                  format="HH:mm"
                  minuteStep={5}
                  needConfirm={false}
                  value={openTime ? dayjs(openTime, 'HH:mm') : null}
                  onChange={(value) => setOpenTime(value ? value.format('HH:mm') : null)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label htmlFor="closes-at">Closes</label>
                <TimePicker
                  id="closes-at"
                  format="HH:mm"
                  minuteStep={5}
                  needConfirm={false}
                  value={closeTime ? dayjs(closeTime, 'HH:mm') : null}
                  onChange={(value) => setCloseTime(value ? value.format('HH:mm') : null)}
                  style={{ width: '100%' }}
                />
                {overnight ? <div className="hr-form__help">Closes after midnight.</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

type Draft = ShiftTemplateInput & { id?: string };

const emptyDraft = (group: ShiftGroup): Draft => ({
  group,
  name: '',
  kind: 'WORKING',
  startTime: null,
  endTime: null,
  breakMinutes: 0,
  night: false,
  nightPayMode: null,
  nightRate: null,
  colour: SWATCHES[0],
  clinicId: null,
});

const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

function TemplatesPanel({ group }: { group: ShiftGroup }) {
  const { message, modal } = App.useApp();
  const { clinics } = useClinicFilter();
  const templates = useShiftTemplates({ group });
  const save = useSaveShiftTemplate();
  const remove = useRemoveShiftTemplate();
  const canWholeRoster = useCan('appointment.manage_roster');
  const canGroupRoster = useCan(group === 'DOCTOR' ? 'roster.manage_doctors' : 'roster.manage_staff');
  const canManage = canWholeRoster || canGroupRoster;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const branchName = (id: string | null) => (id ? (clinics ?? []).find((clinic) => clinic.id === id)?.name ?? 'One branch' : 'Every branch');

  const submit = async () => {
    if (!draft) return;
    setError(null);
    try {
      await save.mutateAsync(draft);
      message.success('Saved.');
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  const confirmRemove = (row: ShiftTemplate) =>
    modal.confirm({
      title: `Remove "${row.name}"?`,
      content: 'If it is already on the roster it is retired instead: those shifts keep their times, and it is no longer offered.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await remove.mutateAsync(row.id);
        message.success(result.retired ? `Retired: ${result.rosteredShifts} rostered shift(s) keep it.` : 'Removed.');
      },
    });

  return (
    <Panel>
      <PanelHead
        title={GROUP_LABEL[group]}
        sub={group === 'DOCTOR' ? 'Offered when rostering a doctor.' : 'Offered when rostering anybody who is not a doctor.'}
        actions={
          <button
            type="button"
            className="hr-btn hr-btn--sm hr-btn--primary"
            onClick={() => {
              setError(null);
              setDraft(emptyDraft(group));
            }}
            disabled={!canManage}
            title={canManage ? undefined : permissionHint(group === 'DOCTOR' ? 'roster.manage_doctors' : 'roster.manage_staff')}
          >
            Add shift
          </button>
        }
      />
      <Table<ShiftTemplate>
        rowKey="id"
        loading={templates.isLoading}
        rows={templates.data}
        emptyText={group === 'DOCTOR' ? 'No doctor shifts yet.' : 'No staff shifts yet.'}
        emptyHint="Add the shifts this clinic works, e.g. a morning, an evening and a night shift, and a named day off."
        columns={[
          {
            title: 'Shift',
            key: 'name',
            render: (_: unknown, row) => (
              <span>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: row.colour, marginRight: 8, verticalAlign: -1 }} />
                <span className="hr-strong">{row.name}</span>
              </span>
            ),
          },
          {
            title: 'Hours',
            key: 'hours',
            render: (_: unknown, row) =>
              row.kind === 'OFF' ? (
                <span className="hr-muted">Day off</span>
              ) : (
                <span>
                  {row.startTime}–{row.endTime}
                  {row.crossesMidnight ? <span className="hr-muted"> (next day)</span> : null}
                </span>
              ),
          },
          {
            title: 'Rest break',
            key: 'break',
            width: 110,
            render: (_: unknown, row) => (row.kind === 'OFF' ? '' : row.breakMinutes ? `${row.breakMinutes} min` : 'None'),
          },
          {
            title: 'Worked',
            key: 'worked',
            width: 110,
            render: (_: unknown, row) => (row.kind === 'OFF' ? '' : hoursText(row.workedMinutes)),
          },
          {
            title: '',
            key: 'night',
            width: 90,
            render: (_: unknown, row) => (row.kind === 'OFF' ? null : row.night ? <StatusChip tone="info">Night</StatusChip> : <StatusChip tone="muted">Day</StatusChip>),
          },
          { title: 'Branch', key: 'branch', width: 160, render: (_: unknown, row) => branchName(row.clinicId) },
          {
            title: '',
            key: 'actions',
            width: 150,
            render: (_: unknown, row) =>
              canManage ? (
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    className="hr-btn hr-btn--sm hr-btn--ghost"
                    onClick={() => {
                      setError(null);
                      setDraft({
                        id: row.id,
                        group: row.group,
                        name: row.name,
                        kind: row.kind,
                        startTime: row.startTime,
                        endTime: row.endTime,
                        breakMinutes: row.breakMinutes,
                        night: row.night,
                        nightPayMode: row.nightPayMode ?? null,
                        nightRate: row.nightRate ?? null,
                        colour: row.colour,
                        clinicId: row.clinicId,
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" onClick={() => confirmRemove(row)}>
                    Remove
                  </button>
                </span>
              ) : null,
          },
        ]}
      />

      <Drawer
        open={Boolean(draft)}
        title={draft?.id ? `Edit ${draft.name}` : group === 'DOCTOR' ? 'Add a doctor shift' : 'Add a staff shift'}
        sub="Changes apply to shifts rostered from now on. Shifts already on the roster keep their times."
        onClose={() => setDraft(null)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={submit} disabled={save.isPending}>
              Save
            </button>
          </>
        }
      >
        {draft ? (
          <div className="hr-form">
            {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
            <div>
              <label htmlFor="shift-name">Name</label>
              <Input id="shift-name" value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Morning, Evening, Night, Off…" />
            </div>
            <div>
              <label htmlFor="shift-kind">Kind</label>
              <Select
                id="shift-kind"
                value={draft.kind}
                onChange={(kind: 'WORKING' | 'OFF') => setDraft({ ...draft, kind })}
                style={{ width: '100%' }}
                options={[
                  { value: 'WORKING', label: 'Working shift' },
                  { value: 'OFF', label: 'Day off (e.g. Off, Post-night)' },
                ]}
              />
            </div>
            {draft.kind === 'WORKING' ? (
              <>
                <div className="hr-form__row">
                  <div>
                    <label htmlFor="shift-start">Starts</label>
                    <TimePicker
                      id="shift-start"
                      format="HH:mm"
                      minuteStep={5}
                      needConfirm={false}
                      value={draft.startTime ? dayjs(draft.startTime, 'HH:mm') : null}
                      onChange={(value) => setDraft({ ...draft, startTime: value ? value.format('HH:mm') : null })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="shift-end">Ends</label>
                    <TimePicker
                      id="shift-end"
                      format="HH:mm"
                      minuteStep={5}
                      needConfirm={false}
                      value={draft.endTime ? dayjs(draft.endTime, 'HH:mm') : null}
                      onChange={(value) => setDraft({ ...draft, endTime: value ? value.format('HH:mm') : null })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                {draft.startTime && draft.endTime && draft.endTime <= draft.startTime ? (
                  <div className="hr-form__help">Ends the next day: this shift crosses midnight.</div>
                ) : null}
                <div className="hr-form__row">
                  <div>
                    <label htmlFor="shift-break">Rest break (minutes, unpaid)</label>
                    <InputNumber
                      id="shift-break"
                      min={0}
                      max={600}
                      step={15}
                      value={draft.breakMinutes}
                      onChange={(value) => setDraft({ ...draft, breakMinutes: Number(value ?? 0) })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label htmlFor="shift-night">Night shift</label>
                    <div>
                      <Switch id="shift-night" checked={draft.night} onChange={(checked) => setDraft({ ...draft, night: checked })} />
                    </div>
                  </div>
                </div>
                {draft.night && draft.group === 'DOCTOR' ? (
                  <div className="hr-form__row">
                    <div>
                      <label htmlFor="shift-night-mode">Doctor night pay</label>
                      <Select
                        id="shift-night-mode"
                        value={draft.nightPayMode ?? 'PER_SHIFT'}
                        onChange={(value) => setDraft({ ...draft, nightPayMode: value })}
                        style={{ width: '100%' }}
                        options={[
                          { value: 'PER_SHIFT', label: 'Fixed per night' },
                          { value: 'PER_HOUR', label: 'Per night hour worked' },
                        ]}
                      />
                    </div>
                    <div>
                      <label htmlFor="shift-night-rate">RM</label>
                      <Input
                        id="shift-night-rate"
                        inputMode="decimal"
                        value={draft.nightRate ?? ''}
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^0-9.]/g, '');
                          setDraft({ ...draft, nightRate: value || null, nightPayMode: draft.nightPayMode ?? 'PER_SHIFT' });
                        }}
                      />
                    </div>
                    <div className="hr-form__help" style={{ gridColumn: '1 / -1' }}>
                      Paid apart from the weekly hours. A doctor’s own night rate, on their employee record, comes first.
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            <div>
              <label>Colour</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {SWATCHES.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    aria-label={`Colour ${colour}`}
                    aria-pressed={draft.colour === colour}
                    onClick={() => setDraft({ ...draft, colour })}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: colour,
                      border: draft.colour === colour ? '2px solid #101828' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <Input aria-label="Colour code" value={draft.colour} onChange={(event) => setDraft({ ...draft, colour: event.target.value })} style={{ width: 110 }} />
              </div>
            </div>
            <div>
              <label htmlFor="shift-branch-only">Branch</label>
              <Select
                id="shift-branch-only"
                value={draft.clinicId ?? ''}
                onChange={(value: string) => setDraft({ ...draft, clinicId: value || null })}
                style={{ width: '100%' }}
                options={[{ value: '', label: 'Every branch' }, ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))]}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </Panel>
  );
}
