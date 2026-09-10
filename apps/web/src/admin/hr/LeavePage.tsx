import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, Select, Tag } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { TIME_VIEWS, WorkAreaTabs } from '../components/WorkAreaTabs';
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

const TYPE_LABEL = (value: LeaveType) => LEAVE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;

const STATUS_TONE: Record<LeaveStatus, string> = { PENDING: 'gold', APPROVED: 'green', REJECTED: 'red' };

interface LeaveRequestFormValues {
  staffId: string;
  leaveType: LeaveType;
  dateRange: [Dayjs, Dayjs];
  reason?: string;
}

/**
 * LEAVE — half of "what has somebody asked me to decide?".
 *
 * This replaces a Management-era page that predates the Admin shell, and with
 * it the control that best summed up what this pass is for: a dropdown headed
 * **"Approving/Rejecting as:"**, where a manager picked which colleague to
 * record as the approver before clicking Approve.
 *
 * It was not a convenience. The server took that id from the request body and
 * wrote it down as fact, with no permission check and no audit row — so the
 * screen was asking somebody to answer a question the session already knew,
 * and the answer was forgeable. The server now reads the approver from the
 * session (`hr.leave.approve`, audited, and never your own request), and the
 * question is gone from the screen because it was never the manager's to
 * answer.
 */
export function LeavePage() {
  const { message } = App.useApp();
  const { data: staff } = useStaff();
  const { data: requests, isLoading, isError, error } = useLeaveRequests();
  const createLeaveRequest = useCreateLeaveRequest();
  const approveLeaveRequest = useApproveLeaveRequest();
  const rejectLeaveRequest = useRejectLeaveRequest();
  const canApprove = useCan('hr.leave.approve');

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

      {pending.length > 0 ? (
        <AdminSection title="Waiting for a decision" padded={false}>
          <DataTable
            rows={pending}
            loading={isLoading}
            rowKey="id"
            emptyText="Nothing waiting"
            columns={[
              { title: 'Employee', key: 'staff', render: (_: unknown, row) => row.staff?.fullName ?? '—' },
              { title: 'Type', key: 'leaveType', render: (_: unknown, row) => <Tag>{TYPE_LABEL(row.leaveType)}</Tag> },
              {
                title: 'Dates',
                key: 'dates',
                render: (_: unknown, row) =>
                  `${dayjs(row.startDate).format('D MMM')} – ${dayjs(row.endDate).format('D MMM YYYY')}`,
              },
              { title: 'Reason', dataIndex: 'reason', key: 'reason', render: (value: string | null) => value ?? '—' },
              {
                title: '',
                key: 'decide',
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

      <AdminSection title="All requests" padded={false}>
        <DataTable
          rows={rows}
          loading={isLoading}
          rowKey="id"
          exportName="leave"
          searchFields={['reason' as never]}
          emptyText="No leave has been requested"
          emptyHint="Staff request leave from My Kuwick; you can also record one here."
          columns={[
            { title: 'Employee', key: 'staff', render: (_: unknown, row) => row.staff?.fullName ?? '—' },
            { title: 'Type', key: 'leaveType', render: (_: unknown, row) => <Tag>{TYPE_LABEL(row.leaveType)}</Tag> },
            {
              title: 'Dates',
              key: 'dates',
              render: (_: unknown, row) =>
                `${dayjs(row.startDate).format('D MMM')} – ${dayjs(row.endDate).format('D MMM YYYY')}`,
            },
            {
              title: 'Status',
              key: 'status',
              render: (_: unknown, row) => <Tag color={STATUS_TONE[row.status]}>{row.status}</Tag>,
            },
            {
              title: 'Decided by',
              key: 'decidedBy',
              render: (_: unknown, row) =>
                row.status === 'PENDING' ? (
                  <span className="kw-muted">—</span>
                ) : (
                  <span>
                    {row.approvedBy?.fullName ?? '—'}
                    {row.approvedAt ? ` · ${dayjs(row.approvedAt).format('D MMM')}` : ''}
                  </span>
                ),
            },
            {
              title: 'Why refused',
              dataIndex: 'rejectReason',
              key: 'rejectReason',
              optional: true,
              render: (value: string | null) => value ?? '—',
            },
          ]}
        />
      </AdminSection>

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
