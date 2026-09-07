import { useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, Tag, TimePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { clinicDayjs, formatClinicTime } from '../clinical/clinicTime';
import { ApiError } from '../core/api-client';
import { MyEmpty } from './MyKuwickLayout';
import { MyAttendanceDay, useMyAttendance, useRequestCorrection } from './hooks/useMe';

/**
 * MY ATTENDANCE — what the clock recorded, and how to ask for a fix.
 *
 * An employee never edits this. The person whose pay depends on the number
 * must not be the person who sets it, so the only write on this screen is a
 * REQUEST, which a manager decides and which is applied through the same
 * correction path a manager's own edit uses — original punch kept, approver
 * named.
 */
export function MyAttendancePage() {
  const { message } = App.useApp();
  const [month, setMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const from = month.format('YYYY-MM-DD');
  const to = month.endOf('month').format('YYYY-MM-DD');
  const { data, isLoading } = useMyAttendance(from, to);

  const [asking, setAsking] = useState<MyAttendanceDay | null>(null);
  const [form] = Form.useForm();
  const request = useRequestCorrection();

  // The clinic's zone, for the same reason MyHomePage gives.
  const time = (value: string | null) => (value ? formatClinicTime(value) : '—');
  const hours = (minutes: number | null) => (minutes === null ? '—' : `${(minutes / 60).toFixed(2)} h`);

  const submit = async () => {
    if (!asking) return;
    const values = await form.validateFields();
    const on = (t: Dayjs | undefined) =>
      t ? dayjs(`${asking.workDate}T00:00:00`).hour(t.hour()).minute(t.minute()).second(0).toISOString() : undefined;
    try {
      await request.mutateAsync({
        attendanceRecordId: asking.id,
        requestedClockInAt: on(values.clockIn),
        requestedClockOutAt: on(values.clockOut),
        reason: values.reason,
      });
      message.success('Sent to your manager.');
      setAsking(null);
      form.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    }
  };

  return (
    <>
      <div>
        <h1 className="kw-my__title">My attendance</h1>
        <p className="kw-my__subtitle">
          What the clock recorded against the shift you were rostered for. If a punch is missing or wrong, ask
          for a correction — your manager decides it and the original stays on the record.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={() => setMonth((current) => current.add(-1, 'month'))}>Previous</Button>
        <DatePicker picker="month" value={month} allowClear={false} onChange={(value) => value && setMonth(value.startOf('month'))} />
        <Button onClick={() => setMonth((current) => current.add(1, 'month'))}>Next</Button>
      </div>

      <div className="kw-my-card kw-my-card--flush">
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <MyEmpty title="Nothing recorded this month">
            Attendance starts the first time you clock in. There is nothing wrong here.
          </MyEmpty>
        ) : (
          data?.map((day) => (
            <div className="kw-my-row" key={day.id}>
              <div className="kw-my-row__main">
                <span className="kw-my-row__title">{clinicDayjs(`${day.workDate}T00:00:00`).format('ddd D MMM')}</span>
                <span className="kw-my-row__detail">
                  In {time(day.clockInAt)} · Out {time(day.clockOutAt)} · {hours(day.workedMinutes)}
                </span>
                {day.scheduledStart ? (
                  <span className="kw-my-row__detail">
                    Rostered {time(day.scheduledStart)} – {time(day.scheduledEnd)}
                  </span>
                ) : (
                  <span className="kw-my-row__detail">No shift was rostered for this day</span>
                )}
                {/* EXTRA TIME IS NOT OVERTIME. Saying "overtime" on the
                    employee's own screen creates an expectation payroll then
                    has to disappoint. */}
                {day.extraMinutesRecorded > 0 ? (
                  <span className="kw-my-row__detail">
                    {(day.extraMinutesRecorded / 60).toFixed(2)} h extra recorded —{' '}
                    {day.overtimeApproved ? 'approved as overtime' : 'not yet approved as overtime'}
                  </span>
                ) : null}
                {day.correctionRequest ? (
                  <span className="kw-my-row__detail">
                    Correction {day.correctionRequest.status.toLowerCase()}
                    {day.correctionRequest.decisionNote ? `: ${day.correctionRequest.decisionNote}` : ''}
                  </span>
                ) : null}
              </div>
              <div className="kw-my-row__side">
                {day.status === 'LATE' ? <Tag color="orange">Late {day.lateMinutes}m</Tag> : null}
                {day.status === 'MISSING_PUNCH' ? <Tag color="red">Missing punch</Tag> : null}
                {day.status === 'ABSENT' ? <Tag>Absent</Tag> : null}
                {day.corrected ? <Tag color="blue">Corrected</Tag> : null}
                {!day.correctionRequest || day.correctionRequest.status !== 'PENDING' ? (
                  <Button size="small" onClick={() => setAsking(day)}>
                    Ask for a fix
                  </Button>
                ) : (
                  <Tag color="blue">Waiting</Tag>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Drawer
        open={Boolean(asking)}
        onClose={() => setAsking(null)}
        title={asking ? `Correction for ${clinicDayjs(`${asking.workDate}T00:00:00`).format('ddd D MMM')}` : ''}
        placement="bottom"
        height="auto"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="kw-my-form">
          <p className="kw-my__subtitle" style={{ marginTop: 0 }}>
            Say what the times should have been. Leave a box empty if that end of the day is already right.
            Your manager decides this; nothing changes until they do.
          </p>
          <Form.Item name="clockIn" label="Clock in should have been">
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} size="large" />
          </Form.Item>
          <Form.Item name="clockOut" label="Clock out should have been">
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} size="large" />
          </Form.Item>
          <Form.Item
            name="reason"
            label="What happened"
            rules={[{ required: true, min: 5, message: 'A manager has to be able to decide on this.' }]}
          >
            <Input.TextArea rows={3} placeholder="The tablet was offline when I arrived at 8." />
          </Form.Item>
          <div className="kw-my-form__footer">
            <Button onClick={() => setAsking(null)}>Cancel</Button>
            <Button type="primary" loading={request.isPending} onClick={submit}>
              Send to my manager
            </Button>
          </div>
        </Form>
      </Drawer>
    </>
  );
}
