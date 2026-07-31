import { useState } from 'react';
import { Button, Card, DatePicker, Drawer, Form, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useStaff } from './hooks/useStaff';
import {
  useApproveLeaveRequest,
  useCreateLeaveRequest,
  useLeaveRequests,
  useRejectLeaveRequest,
} from './hooks/useLeaveRequests';
import { CreateLeaveRequestDto, LeaveRequest, LeaveStatus, LeaveType } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
  { value: 'ANNUAL', label: 'Annual Leave' },
  { value: 'MEDICAL', label: 'Medical Leave' },
  { value: 'EMERGENCY', label: 'Emergency Leave' },
  { value: 'UNPAID', label: 'Unpaid Leave' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_COLOR: Record<LeaveStatus, string> = {
  PENDING: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
};

interface LeaveRequestFormValues {
  staffId: string;
  leaveType: LeaveType;
  dateRange: [Dayjs, Dayjs];
  reason?: string;
}

// HR, Phase 1c. Request → approve/reject only — no accrual balances or
// leave-type quotas yet (matches PRODUCT_REQUIREMENTS.md §14's MVP wording).
// approvedByStaffId is a real staff picker at decision time, same
// no-real-auth convention used throughout (D-017).
export function LeaveRequestsPage() {
  const { data: staff } = useStaff();
  const { data: requests, isLoading } = useLeaveRequests();
  const createLeaveRequest = useCreateLeaveRequest();
  const approveLeaveRequest = useApproveLeaveRequest();
  const rejectLeaveRequest = useRejectLeaveRequest();
  const [open, setOpen] = useState(false);
  const [decidingStaffId, setDecidingStaffId] = useState<string>();
  const [form] = Form.useForm<LeaveRequestFormValues>();

  const handleSubmit = async (values: LeaveRequestFormValues) => {
    const dto: CreateLeaveRequestDto = {
      staffId: values.staffId,
      leaveType: values.leaveType,
      startDate: values.dateRange[0].format('YYYY-MM-DD'),
      endDate: values.dateRange[1].format('YYYY-MM-DD'),
      reason: values.reason,
    };
    try {
      await createLeaveRequest.mutateAsync(dto);
      message.success('Leave request submitted');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to submit leave request');
    }
  };

  const handleApprove = async (id: string) => {
    if (!decidingStaffId) {
      message.warning('Select who is approving/rejecting first');
      return;
    }
    try {
      await approveLeaveRequest.mutateAsync({ id, dto: { approvedByStaffId: decidingStaffId } });
      message.success('Leave request approved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    if (!decidingStaffId) {
      message.warning('Select who is approving/rejecting first');
      return;
    }
    try {
      await rejectLeaveRequest.mutateAsync({ id, dto: { approvedByStaffId: decidingStaffId } });
      message.success('Leave request rejected');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to reject');
    }
  };

  return (
    <div style={{ paddingTop: 24, paddingBottom: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Leave Requests
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Request Leave
        </Button>
      </Space>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space>
          <span>Approving/Rejecting as:</span>
          <Select
            showSearch
            style={{ width: 220 }}
            placeholder="Select staff"
            value={decidingStaffId}
            onChange={setDecidingStaffId}
            filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
            options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
          />
        </Space>
      </Card>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={requests}
        columns={[
          { title: 'Staff', render: (_: unknown, r: LeaveRequest) => r.staff?.fullName },
          { title: 'Type', render: (_: unknown, r: LeaveRequest) => LEAVE_TYPE_OPTIONS.find((o) => o.value === r.leaveType)?.label },
          {
            title: 'Dates',
            render: (_: unknown, r: LeaveRequest) => `${dayjs(r.startDate).format('YYYY-MM-DD')} → ${dayjs(r.endDate).format('YYYY-MM-DD')}`,
          },
          { title: 'Reason', dataIndex: 'reason', render: (v: string | null) => v ?? '—' },
          { title: 'Status', render: (_: unknown, r: LeaveRequest) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag> },
          {
            title: 'Actions',
            render: (_: unknown, r: LeaveRequest) =>
              r.status === 'PENDING' ? (
                <Space>
                  <Popconfirm title="Approve this leave request?" onConfirm={() => handleApprove(r.id)}>
                    <Button size="small" icon={<CheckOutlined />} loading={approveLeaveRequest.isPending}>
                      Approve
                    </Button>
                  </Popconfirm>
                  <Popconfirm title="Reject this leave request?" onConfirm={() => handleReject(r.id)}>
                    <Button size="small" danger icon={<CloseOutlined />} loading={rejectLeaveRequest.isPending}>
                      Reject
                    </Button>
                  </Popconfirm>
                </Space>
              ) : (
                <span>
                  by {r.approvedBy?.fullName ?? '—'} {r.approvedAt && `· ${dayjs(r.approvedAt).format('YYYY-MM-DD')}`}
                </span>
              ),
          },
        ]}
      />
      <Drawer title="Request Leave" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="staffId" label="Staff" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />
          </Form.Item>
          <Form.Item name="leaveType" label="Leave Type" rules={[{ required: true }]}>
            <Select options={LEAVE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="dateRange" label="Dates" rules={[{ required: true }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createLeaveRequest.isPending} block>
            Submit Request
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
