import { useMemo, useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCan, permissionHint } from '../../core/hooks/useCan';
import { useEmployees, useLeaveBalances } from '../hooks/useAdmin';
import { useStaff } from '../../hr/hooks/useStaff';
import {
  useApproveLeaveRequest,
  useCreateLeaveRequest,
  useLeaveRequests,
  useRejectLeaveRequest,
} from '../../hr/hooks/useLeaveRequests';
import type { LeaveRequest, LeaveStatus, LeaveType } from '../../hr/types';
import { ApiError } from '../../core/api-client';
import { clinicDayjs } from '../../clinical/clinicTime';
import { AuthImage, Drawer, HrPage, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconCalendar, IconDoc, IconPlus } from './ui/icons';
import { initialsOf } from './ui/who';
import { LeaveCalendar } from './LeaveCalendar';

const TYPES: { value: LeaveType; label: string }[] = [
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'OTHER', label: 'Other' },
];
const TYPE_LABEL = (value: LeaveType) => TYPES.find((type) => type.value === value)?.label ?? value;

const STATUS: Record<LeaveStatus, { tone: 'attn' | 'done' | 'block'; label: string }> = {
  PENDING: { tone: 'attn', label: 'Waiting' },
  APPROVED: { tone: 'done', label: 'Approved' },
  REJECTED: { tone: 'block', label: 'Rejected' },
};

type Tab = 'requests' | 'calendar' | 'balances';
type Filter = 'ALL' | LeaveStatus;

const daysOf = (row: Pick<LeaveRequest, 'startDate' | 'endDate'>) =>
  dayjs(row.endDate).diff(dayjs(row.startDate), 'day') + 1;

const dateRange = (row: Pick<LeaveRequest, 'startDate' | 'endDate'>) => {
  const from = dayjs(row.startDate);
  const to = dayjs(row.endDate);
  if (from.isSame(to, 'day')) return from.format('ddd D MMM YYYY');
  return from.isSame(to, 'month')
    ? `${from.format('ddd D')} – ${to.format('ddd D MMM YYYY')}`
    : `${from.format('ddd D MMM')} – ${to.format('ddd D MMM YYYY')}`;
};

/** The file id inside `/me/files/<id>`, read back by HR from its own route. */
function staffFilePath(filePath: string): string | null {
  const id = filePath.startsWith('/me/files/') ? filePath.slice('/me/files/'.length) : null;
  return id ? `/workforce/staff-files/${id}` : null;
}

/**
 * LEAVE, after `leave.html` — the queue, then the archive.
 *
 * A DECISION IS MADE IN A DRAWER, against the list it came from. Everything
 * the decision turns on is in it: what was asked for, what it leaves in the
 * balance, who else is away over the same days, the certificate the policy
 * asked for, and what it does to payroll. A manager who has to open three
 * screens to answer "can I spare her" approves without answering it.
 *
 * THE APPROVER IS THE SESSION, never a dropdown. This screen once had a
 * control headed "Approving/Rejecting as:" where you picked a colleague to
 * record as the approver; the server wrote it down as fact with no permission
 * check. The server now reads the approver from the session (`hr.leave.approve`,
 * audited, never your own request), so the question is gone.
 */
export function LeavePage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const { data: staff } = useStaff();
  const requests = useLeaveRequests();
  // The job title is on the employment record, not on the staff row, and the
  // mockup names it under every person. One list, read once.
  const employees = useEmployees({});
  const balances = useLeaveBalances({ clinicId, year: dayjs().year() });
  const createRequest = useCreateLeaveRequest();
  const approve = useApproveLeaveRequest();
  const reject = useRejectLeaveRequest();
  const canApprove = useCan('hr.leave.approve');

  const [tab, setTab] = useState<Tab>('requests');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [reviewing, setReviewing] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [form, setForm] = useState({ staffId: '', leaveType: 'ANNUAL' as LeaveType, startDate: dayjs().format('YYYY-MM-DD'), endDate: dayjs().format('YYYY-MM-DD'), reason: '' });

  const positionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of employees.data ?? []) if (row.position) map.set(row.staffId, row.position);
    return map;
  }, [employees.data]);
  const role = (row: LeaveRequest) =>
    positionOf.get(row.staffId) ?? (row.staff?.role ? row.staff.role.toLowerCase().replace(/_/g, ' ') : 'No position recorded');

  const today = clinicDayjs(new Date()).format('YYYY-MM-DD');
  const rows = useMemo(() => requests.data ?? [], [requests.data]);
  const waiting = rows.filter((row) => row.status === 'PENDING');
  const awayToday = rows.filter(
    (row) => row.status === 'APPROVED' && row.startDate.slice(0, 10) <= today && row.endDate.slice(0, 10) >= today,
  );
  const nextWeek = clinicDayjs(new Date()).add(7, 'day').format('YYYY-MM-DD');
  const awaySoon = rows.filter(
    (row) => row.status === 'APPROVED' && row.startDate.slice(0, 10) > today && row.startDate.slice(0, 10) <= nextWeek,
  );
  const unpaidThisMonth = rows.filter(
    (row) =>
      row.status === 'APPROVED' &&
      row.leaveType === 'UNPAID' &&
      row.startDate.slice(0, 7) === today.slice(0, 7),
  );
  const unpaidDays = unpaidThisMonth.reduce((total, row) => total + daysOf(row), 0);
  const oldest = waiting.reduce<LeaveRequest | null>(
    (oldestSoFar, row) => (!oldestSoFar || row.createdAt < oldestSoFar.createdAt ? row : oldestSoFar),
    null,
  );

  const filtered = useMemo(
    () => (filter === 'ALL' ? rows : rows.filter((row) => row.status === filter)),
    [rows, filter],
  );

  /** What the balance looks like after this request, from the server's own figures. */
  const balanceAfter = (row: LeaveRequest) => {
    const person = balances.data?.employees.find((entry) => entry.staffId === row.staffId);
    const balance = person?.balances.find((entry) => entry.leaveType === row.leaveType);
    if (!balance || !balance.paid) return null;
    return { remaining: balance.remaining, available: balance.available, after: balance.remaining - daysOf(row) };
  };

  /** Who else is away over the same days — the question a manager actually asks. */
  const clashes = (row: LeaveRequest) =>
    rows.filter(
      (other) =>
        other.id !== row.id &&
        other.staffId !== row.staffId &&
        other.status !== 'REJECTED' &&
        other.startDate.slice(0, 10) <= row.endDate.slice(0, 10) &&
        other.endDate.slice(0, 10) >= row.startDate.slice(0, 10),
    );

  const decide = async (accept: boolean) => {
    if (!reviewing) return;
    if (!accept && note.trim().length < 3) {
      message.error('A refusal carries its reason. The employee sees it.');
      return;
    }
    try {
      if (accept) {
        await approve.mutateAsync({ id: reviewing.id, dto: {} });
        message.success(`Approved ${reviewing.staff?.fullName ?? 'the request'}.`);
      } else {
        await reject.mutateAsync({ id: reviewing.id, dto: { rejectReason: note.trim() } });
        message.success('Rejected, and the reason is on the record.');
      }
      setReviewing(null);
      setNote('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record that.');
    }
  };

  const record = async () => {
    if (!form.staffId) {
      message.error('Choose who this is for.');
      return;
    }
    if (form.endDate < form.startDate) {
      message.error('Leave cannot end before it starts.');
      return;
    }
    try {
      await createRequest.mutateAsync({
        staffId: form.staffId,
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim() || undefined,
      });
      message.success('Recorded. It still needs a decision.');
      setRecording(false);
      setForm({ staffId: '', leaveType: 'ANNUAL', startDate: today, endDate: today, reason: '' });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record that.');
    }
  };

  const after = reviewing ? balanceAfter(reviewing) : null;
  const alsoAway = reviewing ? clashes(reviewing) : [];

  return (
    <HrPage
      title="Leave"
      sub="Requests come in from the staff portal. Balances are entitlement minus what's taken."
      error={requests.isError ? 'Leave requests could not be loaded.' : null}
      actions={
        <button type="button" className="hr-btn hr-btn--primary" onClick={() => setRecording(true)}>
          <IconPlus />
          Record leave
        </button>
      }
    >
      <StatRow>
        <StatCard
          label="Waiting for decision"
          value={waiting.length}
          tone={waiting.length > 0 ? 'gold' : 'plain'}
          sub={oldest ? `Oldest applied ${dayjs(oldest.createdAt).format('D MMM')}` : 'Nothing waiting'}
        />
        <StatCard
          label="Away today"
          value={awayToday.length}
          sub={
            awayToday.length > 0
              ? awayToday.map((row) => `${row.staff?.fullName ?? '—'}, ${TYPE_LABEL(row.leaveType).toLowerCase()}`).join(' · ')
              : 'Everybody is in'
          }
        />
        <StatCard
          label="Away next 7 days"
          value={awaySoon.length}
          sub={
            awaySoon.length > 0
              ? `${awaySoon[0].staff?.fullName ?? '—'} from ${dayjs(awaySoon[0].startDate).format('ddd D')}`
              : 'Nobody booked'
          }
        />
        <StatCard
          label={`Unpaid leave, ${clinicDayjs(new Date()).format('MMM')}`}
          value={`${unpaidDays} ${unpaidDays === 1 ? 'day' : 'days'}`}
          tone={unpaidDays > 0 ? 'gold' : 'plain'}
          sub="Feeds into payroll deductions"
        />
      </StatRow>

      <Panel className="hr-mt">
        <div className="hr-tabs" role="tablist" aria-label="Leave views">
          {([
            ['requests', `Requests`, rows.length],
            ['calendar', 'Calendar', 0],
            ['balances', 'Balances', 0],
          ] as [Tab, string, number][]).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'is-active' : undefined}
              onClick={() => setTab(key)}
            >
              {label}
              {count > 0 ? <span className="hr-tabs__n">{count}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'requests' ? (
          <Table<LeaveRequest>
            rows={filtered}
            loading={requests.isLoading}
            rowKey="id"
            searchFields={['reason']}
            searchPlaceholder="Search employee"
            searchLabel="Search employee"
            emptyText="No leave has been requested"
            emptyHint="Staff apply from their portal; you can also record one here."
            toolbar={
              <SegControl<Filter>
                label="Status"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'ALL', label: `All ${rows.length}` },
                  { value: 'PENDING', label: `Waiting ${waiting.length}` },
                  { value: 'APPROVED', label: 'Approved' },
                  { value: 'REJECTED', label: 'Rejected' },
                ]}
              />
            }
            columns={[
              {
                title: 'Employee',
                key: 'who',
                render: (_: unknown, row) => (
                  <div className="hr-who">
                    <span className="hr-who__avatar">{initialsOf(row.staff?.fullName ?? '—')}</span>
                    <div>
                      <div className="hr-who__name">{row.staff?.fullName ?? '—'}</div>
                      <div className="hr-who__role">{role(row)}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Type',
                key: 'type',
                width: 110,
                render: (_: unknown, row) => (
                  <span className="hr-dots">
                    {TYPE_LABEL(row.leaveType)}
                    {row.attachments?.length ? <IconDoc /> : null}
                  </span>
                ),
              },
              { title: 'Dates', key: 'dates', width: 220, render: (_: unknown, row) => dateRange(row) },
              { title: 'Days', key: 'days', num: true, width: 70, render: (_: unknown, row) => daysOf(row) },
              {
                title: 'Applied',
                key: 'applied',
                width: 110,
                render: (_: unknown, row) => dayjs(row.createdAt).format('D MMM'),
              },
              {
                title: 'Decided · by',
                key: 'decided',
                width: 200,
                render: (_: unknown, row) =>
                  row.status === 'PENDING' ? (
                    <span className="hr-tn">—</span>
                  ) : (
                    <span>
                      {row.approvedAt ? `${dayjs(row.approvedAt).format('D MMM')} · ` : ''}
                      {row.approvedBy?.fullName ?? '—'}
                    </span>
                  ),
              },
              {
                title: 'Status',
                key: 'status',
                width: 120,
                render: (_: unknown, row) => <StatusChip tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusChip>,
              },
              {
                title: '',
                key: 'review',
                width: 90,
                render: (_: unknown, row) => (
                  <button
                    type="button"
                    className="hr-btn hr-btn--sm"
                    onClick={() => {
                      setReviewing(row);
                      setNote('');
                    }}
                  >
                    Review
                  </button>
                ),
              },
            ]}
          />
        ) : null}

        {tab === 'calendar' ? (
          <>
            <div className="hr-toolbar">
              <div className="hr-seg" role="group" aria-label="Month">
                <button type="button" aria-label="Previous month" onClick={() => setMonth(month.subtract(1, 'month'))}>
                  ‹
                </button>
                <button type="button" className="is-active" onClick={() => setMonth(dayjs().startOf('month'))}>
                  {month.format('MMMM YYYY')}
                </button>
                <button type="button" aria-label="Next month" onClick={() => setMonth(month.add(1, 'month'))}>
                  ›
                </button>
              </div>
              <span className="hr-toolbar__right hr-legend">
                <StatusChip tone="done">Approved</StatusChip>
                <StatusChip tone="attn">Waiting</StatusChip>
              </span>
            </div>
            <LeaveCalendar month={month} requests={rows} />
          </>
        ) : null}

        {tab === 'balances' ? (
          <Table
            rows={balances.data?.employees}
            loading={balances.isLoading}
            rowKey="staffId"
            searchFields={['name']}
            searchPlaceholder="Search employee"
            searchLabel="Search employee"
            emptyText="Nobody has a leave policy yet"
            emptyHint="Assign a leave policy on an employee's record, or write one in Settings."
            columns={[
              {
                title: 'Employee',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <div className="hr-who">
                    <span className="hr-who__avatar">{initialsOf(value)}</span>
                    <div>
                      <div className="hr-who__name">{value}</div>
                      <div className="hr-who__role">
                        {row.policyName ?? 'No leave policy assigned'}
                        {/*
                          * THE CAP, WHERE THE POLICY IS NAMED. It has existed
                          * since leave shipped and has never been on a screen,
                          * so nobody could be held to it — and nothing read it
                          * either. It is enforced now, so it has to be legible.
                          */}
                        {row.carryForwardCap !== null
                          ? ` · carries forward ${row.carryForwardCap} ${row.carryForwardCap === 1 ? 'day' : 'days'}`
                          : ''}
                      </div>
                    </div>
                  </div>
                ),
              },
              ...TYPES.map((type) => ({
                title: type.label,
                key: type.value,
                num: true,
                width: 130,
                render: (_: unknown, row: NonNullable<typeof balances.data>['employees'][number]) => {
                  const balance = row.balances.find((entry) => entry.leaveType === type.value);
                  if (!balance) return <span className="hr-tn">—</span>;
                  /*
                   * UNPAID LEAVE HAS NO BALANCE TO BE OVERDRAWN ON. Its
                   * entitlement is zero by design, so the ordinary arithmetic
                   * made one day off read as "−1" in red — a warning about a
                   * rule nobody broke. What matters for unpaid is how many
                   * days were taken, because that is what reduces the wages.
                   */
                  if (!balance.paid) {
                    return balance.taken === 0 ? (
                      <span className="hr-tn">none</span>
                    ) : (
                      <span>
                        <b>{balance.taken}</b>
                        <div className="hr-tdSub">taken · reduces pay</div>
                      </span>
                    );
                  }
                  return (
                    <span>
                      <b className={balance.remaining < 0 ? 'hr-ts' : undefined}>{balance.remaining}</b>
                      <div className="hr-tdSub">
                        {balance.taken} of {balance.available} taken
                        {balance.pending > 0 ? ` · ${balance.pending} waiting` : ''}
                        {/*
                          * Carried-in days are part of `available` and were
                          * invisible inside it. A balance that looks generous
                          * because last year's days are in it should say so.
                          */}
                        {balance.carriedIn > 0 ? ` · ${balance.carriedIn} carried in` : ''}
                      </div>
                    </span>
                  );
                },
              })),
            ]}
          />
        ) : null}
      </Panel>

      {/* THE DECISION, beside the list. */}
      <Drawer
        open={reviewing !== null}
        title={
          <span className="hr-who">
            <span className="hr-who__avatar">{initialsOf(reviewing?.staff?.fullName ?? '—')}</span>
            <span>
              <span className="hr-who__name">{reviewing?.staff?.fullName ?? '—'}</span>
              <span className="hr-who__role">{reviewing ? role(reviewing) : ''}</span>
            </span>
          </span>
        }
        sub={reviewing ? STATUS[reviewing.status].label : undefined}
        onClose={() => setReviewing(null)}
        footer={
          reviewing?.status === 'PENDING' ? (
            <>
              <button
                type="button"
                className="hr-btn"
                disabled={!canApprove || reject.isPending}
                title={canApprove ? undefined : permissionHint('decide leave')}
                onClick={() => decide(false)}
              >
                Reject
              </button>
              <button
                type="button"
                className="hr-btn hr-btn--primary"
                disabled={!canApprove || approve.isPending}
                title={canApprove ? undefined : permissionHint('decide leave')}
                onClick={() => decide(true)}
              >
                Approve
              </button>
            </>
          ) : (
            <button type="button" className="hr-btn" onClick={() => setReviewing(null)}>
              Close
            </button>
          )
        }
      >
        {reviewing ? (
          <>
            <div className="hr-kv2">
              <span className="hr-kv2__k">Type</span>
              <span className="hr-kv2__v">{TYPE_LABEL(reviewing.leaveType)} leave</span>
              <span className="hr-kv2__k">Dates</span>
              <span className="hr-kv2__v">
                {dateRange(reviewing)} · {daysOf(reviewing)} {daysOf(reviewing) === 1 ? 'day' : 'days'}
              </span>
              <span className="hr-kv2__k">Applied</span>
              <span className="hr-kv2__v">{dayjs(reviewing.createdAt).format('D MMM YYYY, HH:mm')}</span>
              <span className="hr-kv2__k">Reason</span>
              <span className="hr-kv2__v">{reviewing.reason ?? <span className="hr-tn">None given</span>}</span>
              <span className="hr-kv2__k">Balance after</span>
              <span className="hr-kv2__v">
                {after ? (
                  <>
                    {after.after} of {after.available} days left
                    {after.after < 0 ? <span className="hr-ts"> · overdrawn</span> : null}
                  </>
                ) : (
                  <span className="hr-tn">No balance for this kind of leave</span>
                )}
              </span>
              <span className="hr-kv2__k">Also away</span>
              <span className="hr-kv2__v">
                {alsoAway.length === 0 ? (
                  <span className="hr-tn">Nobody else</span>
                ) : (
                  alsoAway
                    .map((row) => `${row.staff?.fullName ?? '—'} on ${dayjs(row.startDate).format('D MMM')}`)
                    .join(' · ')
                )}
              </span>
            </div>

            {reviewing.attachments?.length ? (
              <>
                <h3 className="hr-drawer__h3">Attachments</h3>
                {reviewing.attachments.map((file) => {
                  const path = staffFilePath(file.filePath);
                  return (
                    <div className="hr-rcpt" key={file.id}>
                      {path && file.mimeType.startsWith('image/') ? (
                        <AuthImage path={path} alt={file.fileName} className="hr-rcpt__th" />
                      ) : (
                        <span className="hr-rcpt__th" aria-hidden="true" />
                      )}
                      <div>
                        <span className="hr-rcpt__name">{file.fileName}</span>
                        <span className="hr-rcpt__meta">{(file.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : null}

            <div className="hr-tl">
              <div className="hr-tl__row is-done">
                <b>Applied</b> · {dayjs(reviewing.createdAt).format('D MMM, HH:mm')}
              </div>
              <div className={reviewing.status === 'PENDING' ? 'hr-tl__row' : 'hr-tl__row is-done'}>
                <b>Decision</b> ·{' '}
                {reviewing.status === 'PENDING'
                  ? 'pending — you'
                  : `${STATUS[reviewing.status].label.toLowerCase()} by ${reviewing.approvedBy?.fullName ?? '—'}`}
              </div>
              <div className="hr-tl__row">
                <b>Feeds payroll</b> ·{' '}
                {reviewing.leaveType === 'UNPAID'
                  ? `${dayjs(reviewing.startDate).format('MMM')} run, deducted as unpaid leave`
                  : `${dayjs(reviewing.startDate).format('MMM')} run, no deduction (paid leave)`}
              </div>
            </div>

            {reviewing.status === 'PENDING' ? (
              <div className="hr-pform">
                <div className="hr-pform__full">
                  <label htmlFor="leave-note">Note to employee (required if rejecting)</label>
                  <textarea id="leave-note" className="hr-f" value={note} onChange={(event) => setNote(event.target.value)} />
                </div>
              </div>
            ) : reviewing.rejectReason ? (
              <div className="hr-notice hr-notice--block">{reviewing.rejectReason}</div>
            ) : null}
          </>
        ) : null}
      </Drawer>

      {/* LEAVE THE CLINIC RECORDS ITSELF — somebody rang in, somebody is on a
          form the portal cannot take. It still needs a decision. */}
      <Drawer
        open={recording}
        title="Record leave"
        sub="For leave asked for away from the portal. It joins the queue like any other."
        onClose={() => setRecording(false)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setRecording(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={record} disabled={createRequest.isPending}>
              <IconCalendar />
              Record it
            </button>
          </>
        }
      >
        <div className="hr-pform">
          <div className="hr-pform__full">
            <label htmlFor="rec-staff">Employee</label>
            <select
              id="rec-staff"
              className="hr-f"
              value={form.staffId}
              onChange={(event) => setForm((current) => ({ ...current, staffId: event.target.value }))}
            >
              <option value="">Choose…</option>
              {(staff ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rec-type">Type</label>
            <select
              id="rec-type"
              className="hr-f"
              value={form.leaveType}
              onChange={(event) => setForm((current) => ({ ...current, leaveType: event.target.value as LeaveType }))}
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label} leave
                </option>
              ))}
            </select>
          </div>
          <div />
          <div>
            <label htmlFor="rec-from">From</label>
            <input
              id="rec-from"
              type="date"
              className="hr-f"
              value={form.startDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startDate: event.target.value,
                  endDate: current.endDate < event.target.value ? event.target.value : current.endDate,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="rec-to">To</label>
            <input
              id="rec-to"
              type="date"
              className="hr-f"
              min={form.startDate}
              value={form.endDate}
              onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))}
            />
          </div>
          <div className="hr-pform__full">
            <label htmlFor="rec-reason">Reason</label>
            <textarea
              id="rec-reason"
              className="hr-f"
              placeholder="Optional"
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
            />
          </div>
        </div>
      </Drawer>
    </HrPage>
  );
}
