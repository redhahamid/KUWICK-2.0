import { useState } from 'react';
import { Button, Drawer, Form, InputNumber, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProcurementRequestStatus, PROCUREMENT_REQUEST_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from '../design-system/components/StatusBadge';
import { useClinics } from '../core/hooks/useClinics';
import { useItems } from './hooks/useItems';
import {
  useApproveProcurementRequest,
  useCreateProcurementRequest,
  useProcurementRequests,
  useRejectProcurementRequest,
} from './hooks/useProcurementRequests';
import { CreateProcurementRequestDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

export function ProcurementRequestsPage() {
  const [clinicId, setClinicId] = useState<string>();
  const [status, setStatus] = useState<ProcurementRequestStatus>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateProcurementRequestDto>();

  const { data: clinics } = useClinics();
  const { data: items } = useItems();
  const { data: requests, isLoading } = useProcurementRequests({ clinicId, status });
  const createRequest = useCreateProcurementRequest();
  const approveRequest = useApproveProcurementRequest();
  const rejectRequest = useRejectProcurementRequest();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleSubmit = async (values: CreateProcurementRequestDto) => {
    try {
      await createRequest.mutateAsync(values);
      message.success('Procurement request created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      reportFailure(error, 'Failed to create request');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveRequest.mutateAsync(id);
    } catch (error) {
      reportFailure(error, 'Failed to approve');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectRequest.mutateAsync(id);
    } catch (error) {
      reportFailure(error, 'Failed to reject');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Procurement Requests
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          New Request
        </Button>
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by clinic"
          style={{ width: 200 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
        <Select
          allowClear
          placeholder="Filter by status"
          style={{ width: 200 }}
          value={status}
          onChange={setStatus}
          options={Object.values(ProcurementRequestStatus).map((value) => ({ value, label: value }))}
        />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={requests}
        columns={[
          { title: 'Item', render: (_, record) => record.item.name },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          { title: 'Requested Qty', dataIndex: 'requestedQuantity' },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (value: ProcurementRequestStatus) => (
              <StatusBadge label={value} tone={PROCUREMENT_REQUEST_STATUS_TONE[value]} />
            ),
          },
          {
            title: 'Actions',
            render: (_, record) =>
              record.status === ProcurementRequestStatus.PENDING && (
                <Space>
                  <Button size="small" onClick={() => handleApprove(record.id)}>
                    Approve
                  </Button>
                  <Button size="small" danger onClick={() => handleReject(record.id)}>
                    Reject
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Drawer title="New Procurement Request" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
            <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
          </Form.Item>
          <Form.Item name="itemId" label="Item" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={items?.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="requestedQuantity" label="Requested Quantity" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createRequest.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
