import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  TimePicker,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { PageHeader } from '../design-system/components/PageHeader';
import { permissionHint, useCan } from '../core/hooks/useCan';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { ApiError } from '../core/api-client';
import {
  CalendarDisplayMode,
  useAddClosedDate,
  useBookingSettings,
  useClosedDates,
  useRemoveClosedDate,
  useSaveBookingSettings,
} from './hooks/useBookingSettings';

// The window times are a WALL CLOCK, not an instant: "09:00" means nine in the
// morning at the clinic. Read without .utc() they shift by the reader's offset.
dayjs.extend(utc);

const TIME_FORMAT = 'HH:mm';

const toPicker = (value?: string) => (value ? dayjs.utc(`1970-01-01T${value}:00Z`) : undefined);
const fromPicker = (value: Dayjs) => value.format(TIME_FORMAT);

interface WindowFormValues {
  firstSessionTime: Dayjs;
  lastSessionTime: Dayjs;
  minimumNoticeMinutes: number;
}

/**
 * SETTINGS → APPOINTMENTS & SCHEDULING → BOOKING RULES
 *
 * The CLINIC's own constraints, as opposed to any one doctor's. Three facts,
 * and each of them narrows what the availability engine will offer:
 *
 *   - the hours the clinic books inside, which a doctor's roster cannot widen
 *   - how much warning it needs before a booking
 *   - the days the building is shut
 *
 * Deliberately one screen. They are read together — "we book 9 to 5, need an
 * hour's notice, and we're closed for Deepavali" is one sentence — and putting
 * the holidays somewhere else is how a clinic ends up with a holiday list
 * nobody remembers exists.
 */
export function BookingRulesPage() {
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const { data: settings, isLoading } = useBookingSettings(clinicId);
  const { data: closedDates, isLoading: loadingDates } = useClosedDates(clinicId);
  const saveSettings = useSaveBookingSettings(clinicId);
  const canConfigure = useCan('appointment.configure');
  const addClosedDate = useAddClosedDate(clinicId);
  const removeClosedDate = useRemoveClosedDate(clinicId);

  const [form] = Form.useForm<WindowFormValues>();
  const [holidayDate, setHolidayDate] = useState<Dayjs | null>(null);
  const [holidayReason, setHolidayReason] = useState('');

  // PHASE 3 — the diary axis card's own state. Not part of the booking-window
  // form: display hours and booking hours are two different decisions, and a
  // clinic changing how its diary LOOKS must not be forced to re-assert when
  // it BOOKS.
  const [displayMode, setDisplayMode] = useState<CalendarDisplayMode>('STANDARD_HOURS');
  const [displayOpen, setDisplayOpen] = useState<Dayjs | undefined>();
  const [displayClose, setDisplayClose] = useState<Dayjs | undefined>();
  const [displayPadding, setDisplayPadding] = useState<number>(60);
  // Synced once per CLINIC, not on every refetch: a background refetch that
  // re-runs this while somebody is mid-edit silently reverts their choice
  // just before they press Save.
  const [syncedClinicId, setSyncedClinicId] = useState<string>();

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      firstSessionTime: toPicker(settings.firstSessionTime ?? undefined),
      lastSessionTime: toPicker(settings.lastSessionTime ?? undefined),
      minimumNoticeMinutes: settings.minimumNoticeMinutes,
    });
    if (settings.clinicId === syncedClinicId) return;
    setSyncedClinicId(settings.clinicId);
    setDisplayMode(settings.calendarDisplayMode);
    setDisplayOpen(toPicker(settings.displayOpenTime ?? undefined));
    setDisplayClose(toPicker(settings.displayCloseTime ?? undefined));
    setDisplayPadding(settings.displayPaddingMinutes);
  }, [settings, form, syncedClinicId]);

  const saveDisplay = async () => {
    if (!settings) return;
    if (displayMode === 'STANDARD_HOURS' && displayOpen && displayClose && !displayClose.isAfter(displayOpen)) {
      message.error('The closing time must be after the opening time. A branch working through midnight should choose 24 hours.');
      return;
    }
    try {
      // The FULL document: the server treats absent session times as "clear",
      // so the card re-sends the stored booking window untouched.
      await saveSettings.mutateAsync({
        firstSessionTime: settings.firstSessionTime ?? '',
        lastSessionTime: settings.lastSessionTime ?? '',
        minimumNoticeMinutes: settings.minimumNoticeMinutes,
        maxAdvanceDays: settings.maxAdvanceDays ?? undefined,
        observePublicHolidays: settings.observePublicHolidays,
        calendarDisplayMode: displayMode,
        displayOpenTime: displayOpen ? fromPicker(displayOpen) : '',
        displayCloseTime: displayClose ? fromPicker(displayClose) : '',
        displayPaddingMinutes: displayPadding,
      });
      message.success('Calendar display saved. The diary keeps this shape whoever is rostered.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the calendar display.');
    }
  };

  const saveWindow = async (values: WindowFormValues) => {
    try {
      await saveSettings.mutateAsync({
        firstSessionTime: fromPicker(values.firstSessionTime),
        lastSessionTime: fromPicker(values.lastSessionTime),
        minimumNoticeMinutes: values.minimumNoticeMinutes ?? 0,
        // Not on this form, but overwrite-semantics fields: re-send what is
        // stored so saving the window cannot silently reset them.
        maxAdvanceDays: settings?.maxAdvanceDays ?? undefined,
        observePublicHolidays: settings?.observePublicHolidays ?? false,
      });
      message.success('Booking rules saved.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the booking rules.');
    }
  };

  const addHoliday = async () => {
    if (!holidayDate) return;
    try {
      await addClosedDate.mutateAsync({
        date: holidayDate.format('YYYY-MM-DD'),
        reason: holidayReason.trim() || undefined,
      });
      setHolidayDate(null);
      setHolidayReason('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add that closed date.');
    }
  };

  return (
    <div className="kw-settings-page">
      <PageHeader
        title="Booking rules"
        subtitle="When this clinic accepts bookings, and the days it does not."
      />

      {showSelector && (
        <Select
          className="kw-settings-clinic"
          placeholder="Choose a branch"
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
      )}

      {settings && !settings.configured && (
        <Alert
          type="info"
          showIcon
          className="kw-settings-alert"
          message="These are the defaults"
          description="Nobody has set this clinic's booking rules yet: the booking window narrows nothing, there is no minimum notice, and the calendar draws a standard 07:00–21:00 day. Save to make them the clinic's own."
        />
      )}

      <div className="kw-settings-grid">
        <Card
          title="Booking window"
          className="kw-settings-card"
          loading={isLoading}
          extra={<Typography.Text type="secondary">Clinic time</Typography.Text>}
        >
          <Typography.Paragraph type="secondary" className="kw-settings-note">
            A doctor rostered outside these hours is not offered inside them. The window narrows a
            roster; it never widens one.
          </Typography.Paragraph>

          <Form form={form} layout="vertical" onFinish={saveWindow} requiredMark={false}>
            <Space size={16} wrap>
              <Form.Item
                name="firstSessionTime"
                label="First session"
                rules={[{ required: true, message: 'Say when booking opens.' }]}
              >
                <TimePicker format={TIME_FORMAT} minuteStep={5} needConfirm={false} />
              </Form.Item>
              <Form.Item
                name="lastSessionTime"
                label="Last session"
                dependencies={['firstSessionTime']}
                rules={[
                  { required: true, message: 'Say when booking closes.' },
                  ({ getFieldValue }) => ({
                    validator(_rule, value: Dayjs) {
                      const first = getFieldValue('firstSessionTime') as Dayjs | undefined;
                      if (!value || !first || value.isAfter(first)) return Promise.resolve();
                      // Refused here as well as by the database, because being
                      // refused by a CHECK constraint is not an explanation.
                      return Promise.reject(
                        new Error('The last session must be after the first.'),
                      );
                    },
                  }),
                ]}
              >
                <TimePicker format={TIME_FORMAT} minuteStep={5} needConfirm={false} />
              </Form.Item>
            </Space>

            <Form.Item
              name="minimumNoticeMinutes"
              label="Minimum notice"
              tooltip="How far ahead a booking must be made. Zero means a patient can book for right now."
            >
              <InputNumber min={0} max={60 * 24 * 90} step={15} addonAfter="minutes" />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={saveSettings.isPending}
              disabled={!canConfigure}
              title={
                canConfigure
                  ? undefined
                  : permissionHint('change how appointments and services are configured')
              }
            >
              Save booking rules
            </Button>
          </Form>
        </Card>

        <Card
          title="Calendar display"
          className="kw-settings-card"
          loading={isLoading}
          data-testid="calendar-display-card"
          extra={<Typography.Text type="secondary">Display only</Typography.Text>}
        >
          <Typography.Paragraph type="secondary" className="kw-settings-note">
            The hours the staff diary draws. Availability comes from the roster and the booking
            window — this only decides the calendar&apos;s shape, so it holds still whoever is
            rostered.
          </Typography.Paragraph>

          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Radio.Group
              value={displayMode}
              onChange={(event) => setDisplayMode(event.target.value as CalendarDisplayMode)}
            >
              <Space direction="vertical" size={6}>
                <Radio value="STANDARD_HOURS">
                  Standard hours — the diary shows the branch&apos;s hours with breathing room
                </Radio>
                <Radio value="TWENTY_FOUR_HOURS">
                  24 hours — the diary always runs 00:00 to 24:00
                </Radio>
              </Space>
            </Radio.Group>

            {displayMode === 'STANDARD_HOURS' ? (
              <Space size={16} wrap>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    Opens
                  </Typography.Text>
                  <TimePicker
                    format={TIME_FORMAT}
                    minuteStep={15}
                    needConfirm={false}
                    value={displayOpen}
                    onChange={(value) => setDisplayOpen(value ?? undefined)}
                    placeholder="08:00"
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    Closes
                  </Typography.Text>
                  <TimePicker
                    format={TIME_FORMAT}
                    minuteStep={15}
                    needConfirm={false}
                    value={displayClose}
                    onChange={(value) => setDisplayClose(value ?? undefined)}
                    placeholder="20:00"
                  />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    Padding
                  </Typography.Text>
                  <InputNumber
                    min={0}
                    max={240}
                    step={30}
                    value={displayPadding}
                    onChange={(value) => setDisplayPadding(value ?? 60)}
                    addonAfter="min"
                    style={{ width: 130 }}
                  />
                </div>
              </Space>
            ) : null}

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {displayMode === 'TWENTY_FOUR_HOURS'
                ? 'The whole day stays scrollable; the diary opens near the work.'
                : 'Bookings outside these hours stay visible through a notice on the calendar, with a one-tap full-day view.'}
            </Typography.Text>

            <Button
              type="primary"
              onClick={saveDisplay}
              loading={saveSettings.isPending}
              disabled={!canConfigure}
              title={
                canConfigure
                  ? undefined
                  : permissionHint('change how appointments and services are configured')
              }
            >
              Save calendar display
            </Button>
          </Space>
        </Card>

        <Card title="Closed dates" className="kw-settings-card" loading={loadingDates}>
          <Typography.Paragraph type="secondary" className="kw-settings-note">
            Public holidays and shutdowns. Patients cannot book these days, whoever is rostered.
          </Typography.Paragraph>

          <Space.Compact className="kw-holiday-add">
            <DatePicker
              value={holidayDate}
              onChange={setHolidayDate}
              placeholder="Date"
              // A closed date in the past changes nothing — the bookings it
              // would have refused were never made.
              minDate={dayjs()}
            />
            <Input
              value={holidayReason}
              onChange={(event) => setHolidayReason(event.target.value)}
              placeholder="Reason (shown to patients)"
              maxLength={120}
              onPressEnter={addHoliday}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={addHoliday}
              disabled={!holidayDate}
              loading={addClosedDate.isPending}
            >
              Add
            </Button>
          </Space.Compact>

          {closedDates?.length ? (
            <ul className="kw-holiday-list">
              {closedDates.map((closed) => (
                <li key={closed.id} className="kw-holiday-row">
                  <div className="kw-holiday-when">
                    <span className="kw-holiday-date">{dayjs(closed.date).format('D MMM YYYY')}</span>
                    <span className="kw-holiday-day">{dayjs(closed.date).format('dddd')}</span>
                  </div>
                  <span className="kw-holiday-reason">{closed.reason ?? 'Closed'}</span>
                  <Button
                    type="text"
                    size="small"
                    aria-label={`Remove ${dayjs(closed.date).format('D MMM YYYY')}`}
                    icon={<DeleteOutlined />}
                    onClick={() => removeClosedDate.mutate(closed.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No closed dates coming up"
              className="kw-holiday-empty"
            />
          )}
        </Card>
      </div>
    </div>
  );
}
