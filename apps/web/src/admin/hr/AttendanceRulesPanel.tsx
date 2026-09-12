import { useEffect, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Select, Switch, Tooltip } from 'antd';
import { Panel, PanelHead, StatusChip } from './ui';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useAttendancePolicy, useSaveAttendancePolicy } from '../hooks/useAdmin';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import type { AttendancePolicy } from '../types';

/**
 * WHAT "LATE" MEANS HERE.
 *
 * A twenty-four-hour clinic and a nine-to-five practice do not agree about
 * when 09:06 is late, and neither is wrong. These numbers used to be constants
 * in the attendance calculation, which made one of those two clinics' entire
 * timesheet a fiction. They are the clinic's to set.
 *
 * A GROUP DEFAULT AND PER-BRANCH OVERRIDES, resolved field by field: a branch
 * that changes only its grace period still inherits the group's overtime
 * rounding rather than falling back to the built-in for everything it did not
 * mention. The panel says which of the three answers is in force, because
 * "why is this branch different" is the first question anybody asks.
 */
const FIELDS: { name: keyof AttendancePolicy; label: string; help: string; min: number; max: number; unit: string }[] = [
  {
    name: 'lateGraceMinutes',
    label: 'Late after',
    help: 'Minutes past the shift start before an arrival is recorded as late.',
    min: 0,
    max: 180,
    unit: 'min',
  },
  {
    name: 'earlyOutGraceMinutes',
    label: 'Short after',
    help: 'Minutes before the shift end that leaving is not counted as short.',
    min: 0,
    max: 180,
    unit: 'min',
  },
  {
    name: 'overtimeMinimumMinutes',
    label: 'Overtime minimum',
    help: 'Extra time below this is not an overtime candidate at all.',
    min: 0,
    max: 480,
    unit: 'min',
  },
  {
    name: 'overtimeRoundingMinutes',
    label: 'Overtime rounds down to',
    help: 'Candidate overtime rounds DOWN to a multiple of this. 0 turns rounding off.',
    min: 0,
    max: 120,
    unit: 'min',
  },
  {
    name: 'unpaidBreakMinutes',
    label: 'Unpaid break',
    help: 'Deducted from a shift at least as long as the next field.',
    min: 0,
    max: 240,
    unit: 'min',
  },
  {
    name: 'breakAfterMinutes',
    label: 'Break applies to shifts over',
    help: 'Shorter shifts have no break deducted.',
    min: 0,
    max: 1440,
    unit: 'min',
  },
  {
    name: 'maximumShiftHours',
    label: 'Longest believable shift',
    help: 'A punch pair spanning longer than this is flagged rather than believed.',
    min: 4,
    max: 24,
    unit: 'h',
  },
];

const SOURCE_LABEL: Record<string, string> = {
  CLINIC: 'this branch',
  GROUP_DEFAULT: 'the group default',
  KUWICK_DEFAULT: "Kuwick's built-in default",
};

export function AttendanceRulesPanel() {
  const { message } = App.useApp();
  const { clinics } = useClinicFilter();
  // WHICH POLICY IS BEING EDITED is a separate question from which branch the
  // hub is filtered to: an owner sets the group default first and then departs
  // from it for one branch, and both are done from here.
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const { data, isLoading } = useAttendancePolicy(editing);
  const save = useSaveAttendancePolicy();
  // The policy, plus a note about THIS change that is not part of the policy.
  type PolicyForm = AttendancePolicy & { reason?: string };
  const [form] = Form.useForm<PolicyForm>();
  // Writing this is `hr.attendance.manage` — the same permission that corrects
  // a punch, because moving the grace period changes what tomorrow judges
  // today's punches by. READING stays open to anybody who may open HR: every
  // screen showing a late arrival has to be able to say what late means here.
  // The form is legible either way; what changes is whether it can be saved,
  // and it says so BEFORE the click rather than failing after it.
  const canManage = useCan('hr.attendance.manage');
  const [locating, setLocating] = useState(false);

  // Where the clinic is, read off the phone or laptop of whoever is standing
  // in it: the one way these six-decimal numbers get typed correctly.
  const useMyPosition = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      message.info('This browser will not say where it is. Type the point from a map instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setFieldsValue({
          geofenceLat: Number(position.coords.latitude.toFixed(6)),
          geofenceLng: Number(position.coords.longitude.toFixed(6)),
        });
        setLocating(false);
      },
      () => {
        message.info('No position from this device. Type the point from a map instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  useEffect(() => {
    if (data) form.setFieldsValue(data.policy);
  }, [data, form]);

  const onSave = async (values: PolicyForm) => {
    // The fence is a point and a radius. Half a point is nothing, and the
    // server says so too; this just says it before the round trip.
    const lat = values.geofenceLat ?? null;
    const lng = values.geofenceLng ?? null;
    if ((lat === null) !== (lng === null)) {
      message.error('A geofence needs both a latitude and a longitude, or neither.');
      return;
    }
    try {
      await save.mutateAsync({ ...values, geofenceLat: lat, geofenceLng: lng, clinicId: editing });
      // The reason belongs to THIS change, not to the policy, so it does not
      // linger in the box to be attached to the next one by accident.
      form.setFieldValue('reason', undefined);
      message.success(
        editing ? 'Saved for this branch. Other branches are unchanged.' : 'Saved as the group default.',
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save the attendance rules.');
    }
  };

  /*
   * ONE PANEL, TWO HOMES. This is drawn on Attendance & leave policies and on
   * the employee record, and it is restyled once rather than forked: a fork
   * is two save buttons for one set of facts, which is the defect Settings
   * has just finished removing.
   */
  return (
    <Panel>
      <PanelHead
        title="Attendance rules"
        sub="How this clinic measures lateness, overtime and breaks. These decide what every timesheet and every payroll month says."
      />
      <div className="hr-fld">
        <span className="hr-fld__k">Rules for</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Select
          style={{ minWidth: 240 }}
          value={editing ?? ''}
          onChange={(value) => setEditing(value === '' ? undefined : value)}
          options={[
            { value: '', label: 'The whole group (default)' },
            ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name })),
          ]}
        />
          {data ? (
            <StatusChip tone={data.source === 'CLINIC' ? 'info' : data.source === 'GROUP_DEFAULT' ? 'attn' : 'muted'}>
              In force: {SOURCE_LABEL[data.source]}
            </StatusChip>
          ) : null}
        </span>
      </div>

      {data && editing && !data.hasOwnPolicy ? (
        <div className="hr-notice hr-notice--info">
          This branch has no rules of its own and follows {SOURCE_LABEL[data.source]}. Saving here creates an
          override for this branch alone — every field you leave as it is stays inherited in meaning, but is
          written as this branch's own answer.
        </div>
      ) : null}

      {/*
        * THE ORDER MATTERS AND IS STATED, because it is the difference nobody
        * notices for a year and then notices for every month of that year.
        */}
      <div className="hr-notice hr-notice--attn">
        <strong>The minimum is applied before the rounding.</strong> Twelve minutes over a fifteen-minute minimum is not overtime. Extra time is never overtime until a manager other than the claimant approves it.
      </div>

      <Form form={form} layout="vertical" onFinish={onSave} disabled={isLoading || !canManage} style={{ padding: '4px 22px 18px' }}>
        <div className="hr-grid3">
          {FIELDS.map((field) => (
            <Form.Item
              key={field.name}
              name={field.name}
              label={field.label}
              extra={field.help}
              rules={[{ required: true, message: 'A number is required' }]}
            >
              <InputNumber min={field.min} max={field.max} addonAfter={field.unit} style={{ width: '100%' }} />
            </Form.Item>
          ))}
          <Form.Item
            name="overtimeRequiresApproval"
            label="Overtime must be approved"
            valuePropName="checked"
            extra="Off means extra time reaches payroll without anybody agreeing to it."
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="countEarlyClockIn"
            label="Early arrival counts as extra time"
            valuePropName="checked"
            extra="Off means turning up early is not paid as overtime."
          >
            <Switch />
          </Form.Item>
        </div>
        {/*
          * WHERE THE CLINIC IS. A punch from the portal carries the phone's
          * position; further than the radius from this point it is kept and
          * marked "outside clinic" on the timesheet for the manager to judge.
          * Nothing is refused: a phone with no position clocks in unmarked.
          */}
        <div className="hr-notice hr-notice--info">
          <strong>Clock-in from the portal.</strong> A punch further than the radius from this point is recorded and
          marked <em>outside clinic</em> on the timesheet; it is never refused. Leave the point empty and no punch is
          judged.
        </div>
        <div className="hr-grid3">
          <Form.Item name="geofenceLat" label="Clinic latitude" extra="Six decimals, like 3.139003. Empty means no geofence.">
            <InputNumber min={-90} max={90} precision={6} step={0.000001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="geofenceLng" label="Clinic longitude" extra="Six decimals, like 101.686855.">
            <InputNumber min={-180} max={180} precision={6} step={0.000001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="geofenceRadiusMetres"
            label="Counts as at the clinic within"
            extra="Phones are rarely more exact than 30 m indoors; 150 m suits most shoplots."
            rules={[{ required: true, message: 'A number is required' }]}
          >
            <InputNumber min={20} max={5000} addonAfter="m" style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Button size="small" onClick={useMyPosition} loading={locating} disabled={!canManage} style={{ marginBottom: 18 }}>
          Use where this device is now
        </Button>
        {/* Changing what "late" means changes how tomorrow judges today's
            punches. The audit trail records who and when on its own; this is
            the half only the person making the change can supply. */}
        <Form.Item
          name="reason"
          label="Why (optional)"
          extra="Recorded with the change, so next year somebody can find out why the grace period is what it is."
          rules={[{ min: 3, message: 'A few words, or leave it blank' }]}
        >
          <Input placeholder="e.g. Night shift handover runs to 07:10" maxLength={500} />
        </Form.Item>
        <Tooltip title={canManage ? '' : permissionHint('change the attendance rules')}>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={!canManage}>
            Save attendance rules
          </Button>
        </Tooltip>
      </Form>
    </Panel>
  );
}
