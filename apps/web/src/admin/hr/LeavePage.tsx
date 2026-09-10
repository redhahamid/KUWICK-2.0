import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, Segmented, Select } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { FilterBar, Filter } from '../components/FilterBar';
import { PersonCell } from '../components/Person';
import { StatusChip, humanise } from '../components/Chip';
import { EmptyState } from '../components/Panel';
import { TIME_VIEWS, WorkAreaTabs } from '../components/WorkAreaTabs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useLeaveBalances } from '../hooks/useAdmin';
import { useStaff } from '../../hr/hooks/useStaff';
import {
  useApproveLeaveRequest,
  useCreateLeaveRequest,
  useLeaveRequests,
  useRejectLeaveRequest,
} from '../../hr/hooks/useLeaveRequests';
import { CreateLeaveRequestDto, LeaveRequest, LeaveStatus, LeaveType } from '../../hr/types';
import { ApiError } from '../../core/api-client';
import { permissionHint, useCan } from '../../core/hooks/useCan';

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'OTHER', label: 'Other' },
];

const TYPE_LABEL = (value: LeaveType) => LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;

const STATUS_TONE: Record<LeaveStatus, 'ok' | 'attention' | 'blocked'> = {
  PENDING: 'attention',
  APPROVED: 'ok',
  REJECTED: 'blocked',
};

interface LeaveRequestFormValues {
  staffId: string;
  leaveType: LeaveType;
  dateRange: [Dayjs, Dayjs];
  reason?: string;
}

type View = 'requests' | 'calendar' | 'balances';

/**
 * LEAVE — three views of one subject, in the reference sheet's order:
 * Requests (the default, because a decision is what somebody is waiting on),
 * Calendar (who is away when), Balances (how many days are left).
 *
 * This replaces a Management-era page whose most telling control was a
 * dropdown headed **"Approving/Rejecting as:"**, where a manager picked which
 * colleague to record as the approver. It was not a convenience: the server
 * took that id from the request body and wrote it down as fact, with no
 * permission check and no audit row. The server now reads the approver from
 * the session (`hr.leave.approve`, audited, never your own request), and the
 * question is gone from the screen because it was never the manager's to
 * answer.
 */
export function LeavePage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const { data: staff } = useStaff();
  const { data: requests, isLoading, isError, error } = useLeaveRequests();
  const balances = useLeaveBalances({ clinicId, year: dayjs().year() });
  const createLeaveRequest = useCreateLeaveRequest();
  const approveLeaveRequest = useApproveLeaveRequest();
  const rejectLeaveRequest = useRejectLeaveRequest();
  const canApprove = useCan('hr.leave.approve');

  const [view, setView] = useState<View>('requests');
  const [status, setStatus] = useState<'ALL' | LeaveStatus>('ALL');
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [form] = Form.useForm<LeaveRequestFormValues>();
  const [rejectForm] = Form.useForm<{ rejectReason: string }>();

  const today = dayjs().format('YYYY-MM-DD');
  const rows = useMemo(() => requests ?? [], [requests]);
  const pending = rows.filter((row) => row.status === 'PENDING');
  const onLeaveToday = rows.filter(
    (row) => row.status === 'APPROVED' && row.startDate.slice(0, 10) <= today && row.endDate.slice(0, 10) >= today,
  );
  const upcoming = rows.filter((row) => row.status === 'APPROVED' && row.startDate.slice(0, 10) > today);

  const filtered = useMemo(
    () => (status === 'ALL' ? rows : rows.filter((row) => row.status === status)),
    [rows, status],
  );

  const submit = async (values: LeaveRequestFormValues) => {
    const dto: CreateLeaveRequestDto = {
      staffId: values.staffId,
      leaveType: values.leaveType,
      startDate: values.dateRange[0].format('YYYY-MM-DD'),
      endDate: values.dateRange[1].format('YYYY-MM-DD'),
      reason: values.reason,
    };
    try {
      await createLeaveRequest.mutateAsync(dto);
      message.success('Leave request submitted.');
      form.resetFields();
      setOpen(false);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Could not submit the request.');
    }
  };

  const approve = async (row: LeaveRequest) => {
    try {
      await approveLeaveRequest.mutateAsync({ id: row.id, dto: {} });
      message.success(`Approved ${row.staff?.fullName ?? 'the request'}.`);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Could not approve.');
    }
  };

  const reject = async (values: { rejectReason: string }) => {
    if (!rejecting) return;
    try {
      await rejectLeaveRequest.mutateAsync({ id: rejecting.id, dto: { rejectReason: values.rejectReason } });
      message.success('Rejected, and the reason is on the record.');
      rejectForm.resetFields();
      setRejecting(null);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Could not reject.');
    }
  };

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Leave"
      subtitle="What staff have asked for, and what was decided."
      actions={
        <Button type="primary" onClick={() => setOpen(true)}>
          + Record leave
        </Button>
      }
    >
      <WorkAreaTabs views={TIME_VIEWS} />

      <StatStrip
        stats={[
          { label: 'Waiting for you', value: pending.length, tone: pending.length > 0 ? 'warn' : 'good' },
          { label: 'On leave today', value: onLeaveToday.length },
          { label: 'Upcoming', value: upcoming.length },
          { label: 'Decided', value: rows.length - pending.length },
        ]}
      />

      <FilterBar
        right={
          <Segmented
            className="kw-workAreaTabs"
            value={view}
            onChange={(value) => setView(value as View)}
            options={[
              { value: 'requests', label: 'Requests' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'balances', label: 'Balances' },
            ]}
          />
        }
      >
        {view === 'requests' ? (
          <Filter label="Status">
            <Select
              size="small"
              style={{ width: 170 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'All requests' },
                { value: 'PENDING', label: 'Waiting for a decision' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
            />
          </Filter>
        ) : null}
        {view === 'calendar' ? (
          <Filter label="Month">
            <DatePicker
              picker="month"
              size="small"
              allowClear={false}
              value={month}
              onChange={(value) => value && setMonth(value.startOf('month'))}
            />
          </Filter>
        ) : null}
        {view === 'balances' ? (
          <Filter label="Year">
            <span className="kw-filter__static">{balances.data?.year ?? dayjs().year()}</span>
          </Filter>
        ) : null}
      </FilterBar>

      {view === 'requests' ? (
        <>
          {/* WAITING FIRST, and only when there is anything waiting. The queue
              somebody is blocked in is not a filter of the archive. */}
          {pending.length > 0 && status === 'ALL' ? (
            <AdminSection title={`${pending.length} waiting for a decision`} padded={false}>
              <DataTable
                rows={pending}
                loading={isLoading}
                rowKey="id"
                emptyText="Nothing waiting"
                columns={[
                  {
                    title: 'Employee',
                    key: 'staff',
                    width: 220,
                    render: (_: unknown, row) => (
                      <PersonCell name={row.staff?.fullName ?? '—'} meta={TYPE_LABEL(row.leaveType)} />
                    ),
                  },
                  {
                    title: 'Dates',
                    key: 'dates',
                    width: 210,
                    render: (_: unknown, row) => (
                      <span>
                        {dayjs(row.startDate).format('ddd D MMM')} – {dayjs(row.endDate).format('ddd D MMM YYYY')}
                        <span className="kw-cellMeta">
                          {dayjs(row.endDate).diff(dayjs(row.startDate), 'day') + 1} day(s)
                        </span>
                      </span>
                    ),
                  },
                  {
                    title: 'Reason',
                    dataIndex: 'reason',
                    key: 'reason',
                    render: (value: string | null) => value ?? <span className="kw-muted">—</span>,
                  },
                  {
                    title: '',
                    key: 'decide',
                    width: 160,
                    noExport: true,
                    render: (_: unknown, row) => (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          disabled={!canApprove}
                          title={canApprove ? '' : permissionHint('approve leave')}
                          loading={approveLeaveRequest.isPending}
                          onClick={() => approve(row)}
                        >
                          Approve
                        </Button>
                        <Button size="small" danger disabled={!canApprove} onClick={() => setRejecting(row)}>
                          Reject
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </AdminSection>
          ) : null}

          <AdminSection title={status === 'ALL' ? 'All requests' : `${humanise(status)} requests`} padded={false}>
            <DataTable
              rows={filtered}
              loading={isLoading}
              rowKey="id"
              exportName="leave"
              searchFields={['reason' as never]}
              emptyText="No leave has been requested"
              emptyHint="Staff request leave from My Kuwick; you can also record one here."
              columns={[
                {
                  title: 'Employee',
                  key: 'staff',
                  width: 220,
                  render: (_: unknown, row) => (
                    <PersonCell name={row.staff?.fullName ?? '—'} meta={TYPE_LABEL(row.leaveType)} />
                  ),
                },
                {
                  title: 'Dates',
                  key: 'dates',
                  width: 200,
                  render: (_: unknown, row) =>
                    `${dayjs(row.startDate).format('D MMM')} – ${dayjs(row.endDate).format('D MMM YYYY')}`,
                },
                {
                  title: 'Status',
                  key: 'status',
                  width: 130,
                  render: (_: unknown, row) => (
                    <StatusChip tone={STATUS_TONE[row.status]} dot>
                      {humanise(row.status)}
                    </StatusChip>
                  ),
                },
                {
                  title: 'Decided by',
                  key: 'decidedBy',
                  width: 180,
                  render: (_: unknown, row) =>
                    row.status === 'PENDING' ? (
                      <span className="kw-muted">—</span>
                    ) : (
                      <span>
                        {row.approvedBy?.fullName ?? '—'}
                        {row.approvedAt ? <span className="kw-cellMeta">{dayjs(row.approvedAt).format('D MMM')}</span> : null}
                      </span>
                    ),
                },
                {
                  title: 'Why refused',
                  dataIndex: 'rejectReason',
                  key: 'rejectReason',
                  render: (value: string | null) => value ?? <span className="kw-muted">—</span>,
                },
                {
                  title: '',
                  key: 'act',
                  width: 150,
                  noExport: true,
                  render: (_: unknown, row) =>
                    row.status === 'PENDING' ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button size="small" type="primary" disabled={!canApprove} onClick={() => approve(row)}>
                          Approve
                        </Button>
                        <Button size="small" danger disabled={!canApprove} onClick={() => setRejecting(row)}>
                          Reject
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
          </AdminSection>
        </>
      ) : null}

      {view === 'calendar' ? <LeaveCalendar month={month} requests={rows} /> : null}

      {view === 'balances' ? (
        <AdminSection
          title={`Balances — ${balances.data?.year ?? dayjs().year()}`}
          description="Taken is computed from approved requests, so a cancelled leave returns its days by itself."
          padded={false}
        >
          <DataTable
            rows={balances.data?.employees}
            loading={balances.isLoading}
            rowKey="staffId"
            exportName="leave-balances"
            searchFields={['name' as never]}
            emptyText="Nobody has a leave policy yet"
            emptyHint="Assign a leave policy on an employee's record, or create one in Settings."
            columns={[
              {
                title: 'Employee',
                dataIndex: 'name',
                key: 'name',
                width: 230,
                render: (value: string, row) => (
                  <PersonCell name={value} meta={row.policyName ?? 'No leave policy assigned'} />
                ),
              },
              ...LEAVE_TYPE_OPTIONS.map((option) => ({
                title: option.label,
                key: option.value,
                width: 130,
                align: 'right' as const,
                render: (_: unknown, row: NonNullable<typeof balances.data>['employees'][number]) => {
                  const balance = row.balances.find((entry) => entry.leaveType === option.value);
                  if (!balance) return <span className="kw-muted">—</span>;
                  /*
                   * UNPAID LEAVE HAS NO BALANCE TO BE OVERDRAWN ON.
                   *
                   * Its entitlement is zero by design, so the ordinary
                   * arithmetic made one day off read as "−1" in red — a
                   * warning about a rule nobody broke. What a manager wants
                   * from an unpaid row is how many days were taken, because
                   * that is what reduces the month's wages.
                   */
                  if (!balance.paid) {
                    return balance.taken === 0 ? (
                      <span className="kw-muted">none</span>
                    ) : (
                      <span className="kw-balanceCell">
                        <strong>{balance.taken}</strong>
                        <span className="kw-cellMeta">days taken · reduces pay</span>
                      </span>
                    );
                  }
                  return (
                    <span className="kw-balanceCell">
                      <strong className={balance.overdrawn ? 'kw-bad' : undefined}>{balance.remaining}</strong>
                      <span className="kw-cellMeta">
                        {balance.taken} taken of {balance.available}
                        {balance.pending > 0 ? ` · ${balance.pending} pending` : ''}
                      </span>
                    </span>
                  );
                },
              })),
            ]}
          />
        </AdminSection>
      ) : null}

      <Drawer title="Record leave" open={open} onClose={() => setOpen(false)} destroyOnHidden width={420}>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="staffId" label="Employee" rules={[{ required: true, message: 'Choose who this is for' }]}>
            <Select
              showSearch
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={staff?.map((person) => ({ value: person.id, label: person.fullName }))}
            />
          </Form.Item>
          <Form.Item name="leaveType" label="Type" rules={[{ required: true, message: 'Choose a leave type' }]}>
            <Select options={LEAVE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="dateRange" label="Dates" rules={[{ required: true, message: 'Choose the dates' }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createLeaveRequest.isPending}>
            Submit
          </Button>
        </Form>
      </Drawer>

      {/* A refusal carries its reason. Somebody reading it later needs to know
          why, and the employee is told. */}
      <Drawer
        title={`Reject ${rejecting?.staff?.fullName ?? 'this request'}`}
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        destroyOnHidden
        width={420}
      >
        <Form form={rejectForm} layout="vertical" onFinish={reject}>
          <Form.Item
            name="rejectReason"
            label="Why"
            extra="The employee sees this."
            rules={[{ required: true, min: 3, message: 'A short reason is required' }]}
          >
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Button danger type="primary" htmlType="submit" loading={rejectLeaveRequest.isPending}>
            Reject
          </Button>
        </Form>
      </Drawer>
    </AdminShell>
  );
}

/**
 * WHO IS AWAY WHEN — people down, days across.
 *
 * The same shape as the roster deliberately: a manager comparing "who is off
 * next week" against "who is rostered next week" is reading two grids, and two
 * grids with different geometry are two things to learn.
 *
 * Approved leave is solid; a pending request is hatched, because a request
 * nobody has decided is not yet an absence — drawing them the same way is how
 * a manager rosters around leave that never happens.
 */
function LeaveCalendar({ month, requests }: { month: Dayjs; requests: LeaveRequest[] }) {
  const days = useMemo(() => {
    const count = month.daysInMonth();
    return Array.from({ length: count }, (_, index) => month.add(index, 'day'));
  }, [month]);

  const people = useMemo(() => {
    const from = month.format('YYYY-MM-DD');
    const to = month.endOf('month').format('YYYY-MM-DD');
    const map = new Map<string, { name: string; spans: LeaveRequest[] }>();
    for (const row of requests) {
      if (row.status === 'REJECTED') continue;
      if (row.endDate.slice(0, 10) < from || row.startDate.slice(0, 10) > to) continue;
      const key = row.staffId;
      const bucket = map.get(key) ?? { name: row.staff?.fullName ?? '—', spans: [] };
      bucket.spans.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()]
      .map(([staffId, value]) => ({ staffId, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, month]);

  if (people.length === 0) {
    return (
      <AdminSection padded={false}>
        <EmptyState title={`Nobody is on leave in ${month.format('MMMM YYYY')}`} />
      </AdminSection>
    );
  }

  return (
    <AdminSection padded={false}>
      <div className="kw-leaveCal">
        <table className="kw-leaveCal__grid">
          <thead>
            <tr>
              <th className="kw-leaveCal__nameHead">Employee</th>
              {days.map((day) => (
                <th
                  key={day.format('YYYY-MM-DD')}
                  className={day.day() === 0 || day.day() === 6 ? 'kw-leaveCal__day kw-leaveCal__day--weekend' : 'kw-leaveCal__day'}
                >
                  <span className="kw-leaveCal__dayNum">{day.format('D')}</span>
                  <span className="kw-leaveCal__dayName">{day.format('dd')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.staffId}>
                <th className="kw-leaveCal__name">
                  <PersonCell name={person.name} size={24} />
                </th>
                {days.map((day) => {
                  const key = day.format('YYYY-MM-DD');
                  const span = person.spans.find(
                    (row) => row.startDate.slice(0, 10) <= key && row.endDate.slice(0, 10) >= key,
                  );
                  return (
                    <td
                      key={key}
                      className={[
                        'kw-leaveCal__cell',
                        day.day() === 0 || day.day() === 6 ? 'kw-leaveCal__cell--weekend' : '',
                        span ? `kw-leaveCal__cell--${span.status === 'APPROVED' ? 'approved' : 'pending'}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={span ? `${TYPE_LABEL(span.leaveType)} · ${humanise(span.status)}` : undefined}
                    >
                      {span ? <span className="kw-leaveCal__mark">{TYPE_LABEL(span.leaveType)[0]}</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kw-leaveCal__key">
        <StatusChip tone="info" dot>
          Approved
        </StatusChip>
        <StatusChip tone="attention" dot>
          Waiting for a decision
        </StatusChip>
        <span className="kw-muted">A · annual · M · medical · E · emergency · U · unpaid</span>
      </div>
    </AdminSection>
  );
}
