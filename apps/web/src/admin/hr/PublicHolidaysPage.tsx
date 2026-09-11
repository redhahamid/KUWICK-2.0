import { useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, Popconfirm, Space } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { AdminShell } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import {
  useCreatePublicHoliday,
  useDeletePublicHoliday,
  usePublicHolidays,
} from '../../hr/hooks/usePublicHolidays';
import type { CreatePublicHolidayDto, PublicHoliday } from '../../hr/types';
import { ApiError } from '../../core/api-client';

interface HolidayFormValues {
  date: Dayjs;
  name: string;
}

/**
 * PUBLIC HOLIDAYS — the days the clinic is closed, which attendance and leave
 * both read.
 *
 * It was written for Clinic Settings, in that area's own frame, and it was the
 * only thing in a category called "HR & Attendance" there — so a manager
 * looking for HR settings could land on a page with one link on it, while the
 * other five HR settings sat somewhere else entirely. Its only address now is
 * under HR, so it wears HR's frame like the other five.
 */
export function PublicHolidaysPage() {
  const { message } = App.useApp();
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
    <AdminShell
      title="Public holidays"
      subtitle="The days the clinic is closed, which attendance and leave both read."
      actions={
        <Space>
          <Link to="/admin/hr/settings">
            <Button size="small">← Settings</Button>
          </Link>
          <Button type="primary" onClick={() => setOpen(true)}>
            + Add holiday
          </Button>
        </Space>
      }
    >
      <DataTable<PublicHoliday>
        rowKey="id"
        loading={isLoading}
        rows={holidays ?? []}
        searchFields={['name']}
        searchPlaceholder="Search holidays…"
        emptyText="No public holidays are recorded."
        emptyHint="Attendance and leave both read this calendar, so an empty one means no day is treated as a closure."
        columns={[
          {
            title: 'Date',
            dataIndex: 'date',
            width: 260,
            render: (value: string) => dayjs(value).format('YYYY-MM-DD (dddd)'),
          },
          { title: 'Name', dataIndex: 'name' },
          {
            title: '',
            width: 40,
            noExport: true,
            render: (_: unknown, row: PublicHoliday) => (
              <Popconfirm title="Remove this holiday?" onConfirm={() => deleteHoliday.mutate(row.id)}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />

      <Drawer title="Add public holiday" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="name" label="Holiday name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Merdeka Day" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createHoliday.isPending} block>
            Add holiday
          </Button>
        </Form>
      </Drawer>
    </AdminShell>
  );
}
