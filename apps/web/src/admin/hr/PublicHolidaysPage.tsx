import { useState } from 'react';
import { App, DatePicker, Form, Input, InputNumber, Popconfirm, Radio } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import { Drawer, HrPage, IconButton, Panel, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconClose } from './ui/icons';
import {
  useCreatePublicHoliday,
  useDeletePublicHoliday,
  usePublicHolidays,
  useUpdatePublicHoliday,
} from '../../hr/hooks/usePublicHolidays';
import type { CreatePublicHolidayDto, PublicHoliday, PublicHolidayKind } from '../../hr/types';
import { ApiError } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';

interface HolidayFormValues {
  date: Dayjs;
  name: string;
  kind: PublicHolidayKind;
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
  const updateHoliday = useUpdatePublicHoliday();
  const deleteHoliday = useDeletePublicHoliday();
  // One calendar for every branch, so writing it is the owner's: the server refuses anybody else.
  const mayWrite = useCan('settings.manage');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<HolidayFormValues>();

  const handleSubmit = async (values: HolidayFormValues) => {
    const dto: CreatePublicHolidayDto = { date: values.date.format('YYYY-MM-DD'), name: values.name, kind: values.kind ?? 'ORDINARY' };
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

  /** Festive or ordinary, after the fact: the payroll rule set may price a festive day apart. */
  const setKind = async (row: PublicHoliday, kind: PublicHolidayKind) => {
    try {
      await updateHoliday.mutateAsync({ id: row.id, kind });
      message.success(kind === 'FESTIVE' ? `${row.name} is a festive holiday.` : `${row.name} is an ordinary public holiday.`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to change the holiday');
    }
  };

  /**
   * THE HOLIDAY'S OWN MULTIPLIER (decision 2). Blank is the rule set's. Staff
   * the Employment Act covers are never paid below the Act's 3× for hours past
   * the normal day; doctors' locum hours can be 1×.
   */
  const setMultiplier = async (row: PublicHoliday, value: number | null) => {
    if ((row.multiplier === null || row.multiplier === undefined ? null : Number(row.multiplier)) === value) return;
    try {
      await updateHoliday.mutateAsync({ id: row.id, multiplier: value });
      message.success(value === null ? `${row.name} uses the pay rules’ rate.` : `${row.name} pays ${value}× for hours worked.`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to change the holiday');
    }
  };

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Public holidays
        </>
      }
      title="Public holidays"
      sub="The days the clinic is closed, which attendance, leave and payroll all read. A festive holiday is one the pay rules may price apart from an ordinary one. “Hours paid at” sets this day’s own multiplier; staff the Act covers never get less than the Act."
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
              title: 'Type',
              dataIndex: 'kind',
              width: 220,
              render: (kind: PublicHolidayKind, row: PublicHoliday) => (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {kind === 'FESTIVE' ? <StatusChip tone="info">Festive</StatusChip> : <span className="hr-faint">Ordinary</span>}
                  {mayWrite ? (
                    <button
                      type="button"
                      className="hr-linkButton"
                      disabled={updateHoliday.isPending}
                      aria-label={kind === 'FESTIVE' ? `Mark ${row.name} ordinary` : `Mark ${row.name} festive`}
                      onClick={() => setKind(row, kind === 'FESTIVE' ? 'ORDINARY' : 'FESTIVE')}
                    >
                      {kind === 'FESTIVE' ? 'Mark ordinary' : 'Mark festive'}
                    </button>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Hours paid at',
              dataIndex: 'multiplier',
              width: 150,
              render: (value: string | null | undefined, row: PublicHoliday) =>
                mayWrite ? (
                  <InputNumber
                    aria-label={`Multiplier for ${row.name}`}
                    min={1}
                    max={10}
                    step={0.5}
                    placeholder="Pay rules"
                    defaultValue={value === null || value === undefined ? undefined : Number(value)}
                    onBlur={(event) => {
                      const typed = event.target.value.trim();
                      void setMultiplier(row, typed === '' ? null : Number(typed));
                    }}
                    addonAfter="×"
                    style={{ width: 120 }}
                  />
                ) : value ? (
                  `${Number(value)}×`
                ) : (
                  <span className="hr-faint">Pay rules</span>
                ),
            },
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
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ kind: 'ORDINARY' }}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="name" label="Holiday name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Merdeka Day" />
          </Form.Item>
          <Form.Item
            name="kind"
            label="Type"
            extra="A festive holiday (Hari Raya, say) can carry its own figures in the pay rules, above an ordinary public holiday’s. Left as ordinary, nothing changes."
          >
            <Radio.Group
              options={[
                { value: 'ORDINARY', label: 'Ordinary public holiday' },
                { value: 'FESTIVE', label: 'Festive' },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </HrPage>
  );
}
