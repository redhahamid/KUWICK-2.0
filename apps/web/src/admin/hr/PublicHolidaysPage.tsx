import { useState } from 'react';
import { App, DatePicker, Form, Input, Popconfirm } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { Drawer, HrPage, IconButton, Panel } from './ui';
import { Table } from './ui/Table';
import { IconClose } from './ui/icons';
import {
  useCreatePublicHoliday,
  useDeletePublicHoliday,
  usePublicHolidays,
} from '../../hr/hooks/usePublicHolidays';
import type { CreatePublicHolidayDto, PublicHoliday } from '../../hr/types';
import { ApiError } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';

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
  // One calendar for every branch, so writing it is the owner's: the server refuses anybody else.
  const mayWrite = useCan('settings.manage');
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

  const thisYear = dayjs().year();
  const count = (holidays ?? []).filter((row) => dayjs(row.date).year() === thisYear).length;

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Public holidays
        </>
      }
      title="Public holidays"
      sub="The days the clinic is closed, which attendance and leave both read."
      actions={
        mayWrite ? (
          <button type="button" className="hr-btn hr-btn--primary" onClick={() => setOpen(true)}>
            + Add holiday
          </button>
        ) : undefined
      }
    >

      {count === 0 ? (
        <div className="hr-notice hr-notice--attn" style={{ margin: '0 0 14px' }}>
          No holidays are recorded for {thisYear}. Until they are, no day this year is treated as a closure — a public
          holiday worked will be paid as an ordinary day.
        </div>
      ) : null}

      <Panel>
        <Table<PublicHoliday>
          rowKey="id"
          loading={isLoading}
          rows={holidays ?? []}
          searchFields={['name']}
          searchPlaceholder="Search holidays…"
          searchLabel="Search holidays"
          emptyText="No public holidays are recorded."
          emptyHint="Attendance and leave both read this calendar, so an empty one means no day is treated as a closure."
          columns={[
            {
              title: 'Date',
              dataIndex: 'date',
              width: 260,
              render: (value: string) => dayjs(value).format('D MMM YYYY (dddd)'),
            },
            { title: 'Name', dataIndex: 'name', render: (value: string) => <span className="hr-strong">{value}</span> },
            {
              title: '',
              width: 60,
              render: (_: unknown, row: PublicHoliday) =>
                mayWrite ? (
                  <Popconfirm title="Remove this holiday?" onConfirm={() => deleteHoliday.mutate(row.id)}>
                    <span>
                      <IconButton label={`Remove ${row.name}`}>
                        <IconClose />
                      </IconButton>
                    </span>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      </Panel>

      <Drawer
        open={open}
        title="Add public holiday"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={() => form.submit()} disabled={createHoliday.isPending}>
              Add holiday
            </button>
          </>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="name" label="Holiday name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Merdeka Day" />
          </Form.Item>
        </Form>
      </Drawer>
    </HrPage>
  );
}
