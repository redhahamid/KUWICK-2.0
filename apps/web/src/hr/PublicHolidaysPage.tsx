import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, Popconfirm, Space, Table, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useCreatePublicHoliday, useDeletePublicHoliday, usePublicHolidays } from './hooks/usePublicHolidays';
import { CreatePublicHolidayDto, PublicHoliday } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

interface HolidayFormValues {
  date: Dayjs;
  name: string;
}

// HR, Phase 1c. Tenant-wide calendar — feeds the future holiday/after-hours
// surcharge engine once that's scoped (D-030); unblocked today on its own.
export function PublicHolidaysPage() {
  const { data: holidays, isLoading } = usePublicHolidays();
  const createHoliday = useCreatePublicHoliday();
  const deleteHoliday = useDeletePublicHoliday();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<HolidayFormValues>();

  const handleSubmit = async (values: HolidayFormValues) => {
    const dto: CreatePublicHolidayDto = { date: values.date.format('YYYY-MM-DD'), name: values.name };
    try {
      await createHoliday.mutateAsync(dto);
      message.success('Public holiday added');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add holiday');
    }
  };

  return (
    <div style={{ paddingTop: 24, paddingBottom: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Public Holidays
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Holiday
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={holidays}
        columns={[
          { title: 'Date', dataIndex: 'date', render: (v: string) => dayjs(v).format('YYYY-MM-DD (dddd)') },
          { title: 'Name', dataIndex: 'name' },
          {
            title: '',
            width: 40,
            render: (_: unknown, r: PublicHoliday) => (
              <Popconfirm title="Remove this holiday?" onConfirm={() => deleteHoliday.mutate(r.id)}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
      <Drawer title="Add Public Holiday" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="name" label="Holiday Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Merdeka Day" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createHoliday.isPending} block>
            Add Holiday
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
