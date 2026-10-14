import { useEffect } from 'react';
import { Alert, Form, Input, Modal, Select, Space, Switch, TimePicker, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../../core/api-client';
import {
  ProviderShiftType,
  RosterShift,
  ShiftGroup,
  useCreateShift,
  useShiftTemplates,
  useUpdateShift,
} from '../hooks/useRoster';

const { Text } = Typography;

const SHIFT_TYPES: { value: ProviderShiftType; label: string }[] = [
  { value: 'WORKING', label: 'Working' },
  { value: 'LOCUM', label: 'Locum' },
  { value: 'OFF', label: 'Off' },
  { value: 'BLOCKED', label: 'Blocked (in the building, not bookable)' },
  { value: 'LEAVE', label: 'Leave (ad-hoc — approved HR leave appears by itself)' },
];

interface ShiftEditorModalProps {
  open: boolean;
  clinicId: string;
  staffId: string;
  staffName: string;
  dates: string[];
  shift?: RosterShift;
  /** Whose shift templates to offer: a doctor's or staff (UAT, 14 October 2026). */
  group?: ShiftGroup;
  onClose: () => void;
}

/** "Custom times" in the template picker: the form as it always was. */
const CUSTOM = '';

/**
 * ADD OR EDIT A SHIFT.
 *
 * TWO THINGS THIS FORM DELIBERATELY ALLOWS that the old model could not:
 *
 *  1. AN END AT OR BEFORE THE START, which means the shift runs into the next
 *     day. 23:00 → 09:00 is a night shift, not a mistake, and refusing it made
 *     night doctors impossible to roster.
 *  2. A NARROWER BOOKABLE BAND. A doctor works 09:00–17:00 and takes
 *     appointments only until noon. They are still at work for the rest; it is
 *     simply not offered — and it does NOT require a second roster.
 */
export function ShiftEditorModal({
  open,
  clinicId,
  staffId,
  staffName,
  dates,
  shift,
  group = 'STAFF',
  onClose,
}: ShiftEditorModalProps) {
  const [form] = Form.useForm();
  const templates = useShiftTemplates({ group, clinicId });
  const templateId = (Form.useWatch('templateId', form) as string | undefined) ?? CUSTOM;
  const template = (templates.data ?? []).find((row) => row.id === templateId);
  const create = useCreateShift();
  const update = useUpdateShift();
  const shiftType = Form.useWatch('shiftType', form) as ProviderShiftType | undefined;
  const narrowed = Form.useWatch('narrowed', form) as boolean | undefined;
  const start = Form.useWatch('startTime', form);
  const end = Form.useWatch('endTime', form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      templateId: shift?.template?.id ?? CUSTOM,
      shiftType: shift?.shiftType ?? 'WORKING',
      startTime: dayjs(shift?.startTime ?? '09:00', 'HH:mm'),
      endTime: dayjs(shift?.endTime ?? '17:00', 'HH:mm'),
      narrowed: Boolean(shift?.bookableStartTime),
      bookableStartTime: shift?.bookableStartTime
        ? dayjs(shift.bookableStartTime, 'HH:mm')
        : undefined,
      bookableEndTime: shift?.bookableEndTime ? dayjs(shift.bookableEndTime, 'HH:mm') : undefined,
      note: shift?.note ?? undefined,
      replaceExisting: false,
    });
  }, [open, shift, form]);

  const crossesMidnight =
    start && end ? dayjs(end).format('HH:mm') <= dayjs(start).format('HH:mm') : false;
  const isAbsence = shiftType === 'OFF' || shiftType === 'LEAVE' || template?.kind === 'OFF';

  // A template's times are the shift's times: shown, not typed.
  const chooseTemplate = (id: string) => {
    const chosen = (templates.data ?? []).find((row) => row.id === id);
    if (!chosen) return;
    if (chosen.kind === 'OFF') {
      form.setFieldsValue({ shiftType: 'OFF', narrowed: false });
    } else {
      form.setFieldsValue({
        startTime: dayjs(chosen.startTime, 'HH:mm'),
        endTime: dayjs(chosen.endTime, 'HH:mm'),
        shiftType: shiftType === 'LOCUM' ? 'LOCUM' : 'WORKING',
      });
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const body = {
      startTime: dayjs(values.startTime).format('HH:mm'),
      endTime: dayjs(values.endTime).format('HH:mm'),
      shiftType: values.shiftType,
      ...(values.narrowed && values.bookableStartTime && values.bookableEndTime
        ? {
            bookableStartTime: dayjs(values.bookableStartTime).format('HH:mm'),
            bookableEndTime: dayjs(values.bookableEndTime).format('HH:mm'),
          }
        : {}),
      note: values.note?.trim() || undefined,
      // A template sent: the server takes its times, break and night flag.
      // "Custom times" on an edited shift drops the template it had.
      ...(values.templateId ? { templateId: values.templateId } : shift?.template ? { templateId: null } : {}),
    };
    try {
      if (shift) {
        await update.mutateAsync({ id: shift.id, ...body });
        message.success('Shift updated');
      } else {
        const result = await create.mutateAsync({
          clinicId,
          staffId,
          dates,
          ...body,
          replaceExisting: values.replaceExisting,
        });
        message.success(
          `${result.created} shift${result.created === 1 ? '' : 's'} added for ${staffName}`,
        );
      }
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That shift could not be saved.');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={shift ? 'Save shift' : 'Add shift'}
      rootClassName="kw-apt3-modal"
      confirmLoading={create.isPending || update.isPending}
      title={
        shift
          ? `Edit ${staffName}'s shift`
          : `Add a shift for ${staffName} — ${dates.length} date${dates.length === 1 ? '' : 's'}`
      }
      destroyOnHidden
    >
      <Form form={form} layout="vertical" data-testid="shift-editor">
        <Form.Item
          name="templateId"
          label="Shift"
          extra={
            template
              ? template.kind === 'OFF'
                ? 'A named day off.'
                : `${template.startTime}–${template.endTime}${template.crossesMidnight ? ' (next day)' : ''}` +
                  `${template.breakMinutes ? `, ${template.breakMinutes} min rest` : ''}${template.night ? ', night shift' : ''}.`
              : (templates.data ?? []).length === 0
                ? 'No shifts are set up for this group yet: HR Settings → Attendance & leave → Shifts.'
                : undefined
          }
        >
          <Select
            aria-label="Shift"
            onChange={(id: string) => chooseTemplate(id)}
            options={[
              { value: CUSTOM, label: 'Custom times' },
              ...(templates.data ?? []).map((row) => ({
                value: row.id,
                label: (
                  <span>
                    <span
                      aria-hidden="true"
                      style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: row.colour, marginRight: 8 }}
                    />
                    {row.name}
                    {row.kind === 'WORKING' ? ` · ${row.startTime}–${row.endTime}` : ''}
                  </span>
                ),
              })),
            ]}
          />
        </Form.Item>

        <Form.Item name="shiftType" label="What is this?" hidden={template?.kind === 'OFF'}>
          <Select options={template ? SHIFT_TYPES.filter((type) => type.value === 'WORKING' || type.value === 'LOCUM') : SHIFT_TYPES} />
        </Form.Item>

        <Space.Compact style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="startTime" label="Starts" rules={[{ required: true }]} style={{ flex: 1 }}>
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} needConfirm={false} disabled={Boolean(template)} />
          </Form.Item>
          <Form.Item name="endTime" label="Ends" rules={[{ required: true }]} style={{ flex: 1 }}>
            <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} needConfirm={false} disabled={Boolean(template)} />
          </Form.Item>
        </Space.Compact>

        {crossesMidnight ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="This shift runs into the next day"
            description="Ending at or before the start time means a night shift. It stays one shift, and it belongs to the date it starts on."
          />
        ) : null}

        {!isAbsence ? (
          <>
            <Form.Item
              name="narrowed"
              valuePropName="checked"
              label="Take appointments for only part of this shift"
            >
              <Switch />
            </Form.Item>
            {narrowed ? (
              <Space.Compact style={{ display: 'flex', gap: 12 }}>
                <Form.Item
                  name="bookableStartTime"
                  label="Bookable from"
                  rules={[{ required: true, message: 'Both ends, or neither.' }]}
                  style={{ flex: 1 }}
                >
                  <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} needConfirm={false} />
                </Form.Item>
                <Form.Item
                  name="bookableEndTime"
                  label="Bookable until"
                  rules={[{ required: true, message: 'Both ends, or neither.' }]}
                  style={{ flex: 1 }}
                >
                  <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} needConfirm={false} />
                </Form.Item>
              </Space.Compact>
            ) : null}
          </>
        ) : null}

        <Form.Item name="note" label="Note">
          <Input placeholder="Anything the roster should say — 'covering for Dr Lim'" />
        </Form.Item>

        {!shift ? (
          <Form.Item
            name="replaceExisting"
            valuePropName="checked"
            label="Replace whatever is already on those dates"
            extra="Off by default, so a second shift on the same day is added beside the first rather than replacing it."
          >
            <Switch />
          </Form.Item>
        ) : null}

        <Text type="secondary" style={{ fontSize: 12 }}>
          Removing a shift never cancels the appointments booked into it — you are told how many
          are affected and decide what happens to them.
        </Text>
      </Form>
    </Modal>
  );
}