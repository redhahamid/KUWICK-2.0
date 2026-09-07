import { useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { MyEmpty } from './MyKuwickLayout';
import { useMyLeave, useRequestLeave } from './hooks/useMe';

const LEAVE_TYPES = [
  { value: 'ANNUAL', label: 'Annual leave' },
  { value: 'MEDICAL', label: 'Medical leave' },
  { value: 'EMERGENCY', label: 'Emergency leave' },
  // UNPAID is on the list because it is the one an employee genuinely needs to
  // be able to ask for. It is also the one that reaches payroll as a
  // deduction, and the drawer says so before they send it.
  { value: 'UNPAID', label: 'Unpaid leave' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'blue', label: 'Waiting for a decision' },
  APPROVED: { color: 'green', label: 'Approved' },
  REJECTED: { color: 'red', label: 'Not approved' },
};

/**
 * MY LEAVE — ask, and see what happened to what you asked for.
 *
 * The request goes into the same `LeaveRequest` a manager approves from, which
 * the roster reads and payroll reads. There is no self-service leave table: a
 * second record of the same absence is how two screens come to disagree about
 * whether somebody was at work.
 */
export function MyLeavePage() {
  const { message } = App.useApp();
  const { data, isLoading } = useMyLeave();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const request = useRequestLeave();
  const type = Form.useWatch('leaveType', form);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      await request.mutateAsync({
        leaveType: values.leaveType,
        startDate: values.dates[0].format('YYYY-MM-DD'),
        endDate: values.dates[1].format('YYYY-MM-DD'),
        reason: values.reason,
        halfDay: values.halfDay,
      });
      message.success('Sent to your manager.');
      setOpen(false);
      form.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="kw-my__title">My leave</h1>
          <p className="kw-my__subtitle">Approved leave clears your roster automatically.</p>
        </div>
        <Button type="primary" size="large" onClick={() => setOpen(true)}>
          Request leave
        </Button>
      </div>

      <div className="kw-my-card kw-my-card--flush">
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <MyEmpty title="You have not asked for any leave">
            When you do, it appears here with its decision.
          </MyEmpty>
        ) : (
          data?.map((row) => {
            const tag = STATUS_TAG[row.status] ?? { color: 'default', label: row.status };
            const days = dayjs(row.endDate).diff(dayjs(row.startDate), 'day') + 1;
            return (
              <div className="kw-my-row" key={row.id}>
                <div className="kw-my-row__main">
                  <span className="kw-my-row__title">
                    {dayjs(row.startDate).format('D MMM')} – {dayjs(row.endDate).format('D MMM YYYY')}
                  </span>
                  <span className="kw-my-row__detail">
                    {row.leaveType.toLowerCase()} · {days} day{days === 1 ? '' : 's'}
                    {row.decidedBy ? ` · decided by ${row.decidedBy}` : ''}
                  </span>
                  {row.reason ? <span className="kw-my-row__detail">{row.reason}</span> : null}
                </div>
                <div className="kw-my-row__side">
                  <Tag color={tag.color}>{tag.label}</Tag>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Request leave"
        placement="bottom"
        height="auto"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="kw-my-form" initialValues={{ leaveType: 'ANNUAL' }}>
          <Form.Item name="leaveType" label="Kind of leave" rules={[{ required: true }]}>
            <Select options={LEAVE_TYPES} size="large" />
          </Form.Item>
          {type === 'UNPAID' ? (
            <p className="kw-my__subtitle" style={{ marginTop: -6 }}>
              Unpaid leave is deducted from your salary for the days approved. Your manager will see the same
              note.
            </p>
          ) : null}
          <Form.Item name="dates" label="Dates" rules={[{ required: true, message: 'Which days?' }]}>
            <DatePicker.RangePicker style={{ width: '100%' }} size="large" format="D MMM YYYY" />
          </Form.Item>
          <Form.Item name="reason" label="Reason (optional)">
            <Input.TextArea rows={3} placeholder="Family trip." />
          </Form.Item>
          <div className="kw-my-form__footer">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="primary" loading={request.isPending} onClick={submit}>
              Send request
            </Button>
          </div>
        </Form>
      </Drawer>
    </>
  );
}
