import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Input,
  InputNumber,
  Radio,
  Select,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  EditOutlined,
  MedicineBoxOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { PersonAvatar } from '../shared/PersonAvatar';
import { formatClinicDate, formatClinicDateTime, formatClinicTime } from '../../clinical/clinicTime';
import { usePanelClinics, useUpdatePanelClinic } from '../../clinical/hooks/usePanelClinics';
import { useStaff } from '../../hr/hooks/useStaff';
import { useClinics } from '../../core/hooks/useClinics';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { ApiError } from '../../core/api-client';
import { useAppointmentDetail } from '../hooks/useAppointmentDetail';
import { useCheckInAppointment } from '../hooks/useAppointments';
import { bookingReference, paymentChip, sentence } from '../appointment-presentation';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import { PatientDetailsSection } from './PatientDetailsSection';

const { Text } = Typography;

type PayerKind = 'cash' | 'panel';

interface CheckInRegistrationDrawerProps {
  appointmentId: string | null;
  onClose: () => void;
  /** Called after the queue ticket exists, with the fresh appointment id. */
  onCheckedIn?: (appointmentId: string) => void;
}

/**
 * PHASE 4 — CHECK-IN & REGISTRATION.
 *
 * "Check in" used to be one implicit click: visit created, queue joined,
 * payer guessed as self-pay, nobody reviewed anything. This drawer puts the
 * registration REVIEW in front of that act, reusing the walk-in flow's own
 * vocabulary (Cash/Panel with the PanelClinic catalogue, the presenting
 * complaint, the attending doctor) — and only CONFIRM & ADD TO QUEUE commits
 * anything. No second registration engine: the server call is the same
 * check-in endpoint, and VisitService/QueueTicketService do exactly what
 * they do for a walk-in.
 */
export function CheckInRegistrationDrawer({
  appointmentId,
  onClose,
  onCheckedIn,
}: CheckInRegistrationDrawerProps) {
  const { data: appointment, isLoading } = useAppointmentDetail(appointmentId ?? undefined);
  const { data: staff } = useStaff();
  const { data: clinics } = useClinics();
  const { data: allPanels } = usePanelClinics();
  const panels = allPanels?.filter((panel) => panel.active);
  const updatePanelClinic = useUpdatePanelClinic();
  const checkIn = useCheckInAppointment();
  const permCheckIn = useCan('appointment.check_in');

  const [attendingStaffId, setAttendingStaffId] = useState<string>();
  const [payerKind, setPayerKind] = useState<PayerKind>('cash');
  const [panelId, setPanelId] = useState<string>();
  const [remarks, setRemarks] = useState('');
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState<number | null>(null);
  // Which appointment the form state describes — a drawer reopened on a
  // different booking must not carry the previous patient's payer choice.
  const [seededFor, setSeededFor] = useState<string>();

  useEffect(() => {
    if (!appointment || appointment.id === seededFor) return;
    setSeededFor(appointment.id);
    setAttendingStaffId(appointment.staffId);
    setPayerKind('cash');
    setPanelId(undefined);
    setRemarks(appointment.patientNote ?? appointment.notes ?? '');
    setEditingLimit(false);
  }, [appointment, seededFor]);

  const selectedPanel = panels?.find((panel) => panel.id === panelId);
  const clinicName =
    clinics?.find((clinic) => clinic.id === appointment?.clinicId)?.name ?? '';
  const feeAmount = Number(appointment?.bookingFeeAmount ?? 0);

  const doctors = (staff ?? []).filter(
    (member) => member.role === 'DOCTOR_RESIDENT' || member.role === 'DOCTOR_LOCUM',
  );

  const startEditLimit = () => {
    setLimitDraft(selectedPanel?.limitAmount ? Number(selectedPanel.limitAmount) : null);
    setEditingLimit(true);
  };

  const saveLimit = async () => {
    if (!panelId) return;
    try {
      await updatePanelClinic.mutateAsync({ id: panelId, dto: { limitAmount: limitDraft ?? undefined } });
      message.success('Panel limit updated');
      setEditingLimit(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to update panel limit');
    }
  };

  const confirm = async () => {
    if (!appointment) return;
    try {
      const result = await checkIn.mutateAsync({
        id: appointment.id,
        input: {
          staffId: attendingStaffId,
          billingType: payerKind === 'panel' && selectedPanel ? selectedPanel.name : 'Self-pay',
          panelClinicId: payerKind === 'panel' ? panelId : undefined,
          presentingComplaint: remarks.trim() || undefined,
        },
      });
      const ticket = result.queueTicket?.displayNumber;
      message.success(
        ticket
          ? `${appointment.patient.name} is in the queue — ${ticket}`
          : `${appointment.patient.name} is in the queue`,
      );
      onCheckedIn?.(appointment.id);
      onClose();
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : 'Could not add the patient to the queue.',
      );
    }
  };

  // Real facts only on the identity header: the age comes from the recorded
  // date of birth; there is no last-visit/returning field on this payload, so
  // no "Returning patient" badge is invented (final-UAT honesty rule).
  const age = appointment?.patient.dob
    ? Math.max(0, dayjs().diff(dayjs(appointment.patient.dob), 'year'))
    : null;

  return (
    <Drawer
      open={Boolean(appointmentId)}
      onClose={onClose}
      width="min(780px, 100vw)"
      rootClassName="kw-apt3-drawer"
      destroyOnHidden
      title="Register / Check in"
      footer={
        appointment ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Tooltip title={permCheckIn ? undefined : permissionHint('check a patient in')}>
              <Button
                type="primary"
                loading={checkIn.isPending}
                disabled={!permCheckIn || (payerKind === 'panel' && !panelId)}
                onClick={confirm}
                data-testid="confirm-add-to-queue"
              >
                Confirm &amp; add to queue
              </Button>
            </Tooltip>
          </Space>
        ) : null
      }
    >
      {isLoading ? <Skeleton active paragraph={{ rows: 10 }} /> : null}

      {appointment ? (
        <div data-testid="checkin-registration-drawer" className="kw-checkin-grid">
          {/* THE IDENTITY RAIL (target mockup 5) — who is standing at the
              counter and what they came for, read at a glance: the avatar,
              the name, the recorded phone and age, then the appointment as
              icon rows. Same facts the old Appointment table carried;
              recomposed, not reinvented. */}
          <aside className="kw-checkin-identity">
            <PersonAvatar name={appointment.patient.name} size="xl" />
            <div className="kw-checkin-id-name">{appointment.patient.name}</div>
            <div className="kw-checkin-id-meta">
              {[appointment.patient.phone, age != null ? `${age} years old` : null]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>

            <div className="kw-apt3-eyebrow kw-checkin-id-head">Appointment</div>
            <div className="kw-checkin-id-rows">
              <span>
                <MedicineBoxOutlined /> {appointment.service.name}
              </span>
              <span>
                <UserOutlined /> {appointment.staff.fullName}
              </span>
              <span>
                <CalendarOutlined /> {formatClinicDate(appointment.scheduledStart)}
              </span>
              <span>
                <ClockCircleOutlined /> {formatClinicTime(appointment.scheduledStart)} –{' '}
                {formatClinicTime(appointment.scheduledEnd)}
              </span>
            </div>

            <div className="kw-checkin-id-foot">
              <Text type="secondary">
                {SOURCE_LABELS[appointment.source as AppointmentSource] ??
                  sentence(appointment.source)}
              </Text>
              <Text type="secondary">Ref {bookingReference(appointment.id)}</Text>
            </div>
          </aside>

          <div className="kw-checkin-content">
          {/* THE PATIENT — the record on file, editable in place for staff
              with the demographics permission (final-UAT). One canonical
              record: the save is the same PATCH every other surface uses. */}
          <PatientDetailsSection patient={appointment.patient} />

          {/* THE VISIT — the decisions the desk makes at the counter. */}
          <div className="kw-apt-section">Visit</div>
          <div className="kw-checkin-field">
            <Text type="secondary" className="kw-checkin-label">
              Attending doctor
            </Text>
            <Select
              style={{ width: '100%' }}
              value={attendingStaffId}
              onChange={setAttendingStaffId}
              showSearch
              optionFilterProp="label"
              options={doctors.map((member) => ({ value: member.id, label: member.fullName }))}
            />
            {attendingStaffId && attendingStaffId !== appointment.staffId ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Booked with {appointment.staff.fullName} — the visit records who actually sees the
                patient; the booking keeps its history.
              </Text>
            ) : null}
          </div>
          <div className="kw-checkin-field">
            <Text type="secondary" className="kw-checkin-label">
              Branch
            </Text>
            <Text>{clinicName}</Text>
          </div>
          <div className="kw-checkin-field">
            <Text type="secondary" className="kw-checkin-label">
              Reason / registration remarks
            </Text>
            <Input.TextArea
              rows={2}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Carried into the visit as the presenting complaint"
              maxLength={2000}
            />
          </div>

          {/* THE PAYER — the walk-in flow's own vocabulary, reused. */}
          <div className="kw-apt-section">Payer</div>
          <Radio.Group
            value={payerKind}
            onChange={(event) => setPayerKind(event.target.value as PayerKind)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: 'Self-pay', value: 'cash' },
              { label: 'Panel', value: 'panel' },
            ]}
          />
          {payerKind === 'panel' ? (
            <div className="kw-checkin-field" style={{ marginTop: 10 }}>
              <Select
                placeholder="Select panel…"
                style={{ width: '100%' }}
                value={panelId}
                onChange={setPanelId}
                showSearch
                optionFilterProp="label"
                options={panels?.map((panel) => ({ value: panel.id, label: panel.name }))}
              />
              {selectedPanel && !editingLimit ? (
                <Alert
                  style={{ marginTop: 8 }}
                  type="info"
                  showIcon
                  message={
                    <Space>
                      {selectedPanel.limitAmount
                        ? `Panel limit: RM ${selectedPanel.limitAmount} per visit`
                        : 'No limit configured for this panel'}
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={startEditLimit}>
                        Edit
                      </Button>
                    </Space>
                  }
                />
              ) : null}
              {selectedPanel && editingLimit ? (
                <Space style={{ marginTop: 8 }}>
                  <InputNumber
                    autoFocus
                    min={0}
                    prefix="RM"
                    placeholder="No limit"
                    value={limitDraft}
                    onChange={setLimitDraft}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={updatePanelClinic.isPending}
                    onClick={saveLimit}
                  >
                    Save
                  </Button>
                  <Button size="small" onClick={() => setEditingLimit(false)}>
                    Cancel
                  </Button>
                </Space>
              ) : null}
            </div>
          ) : null}

          {/* PAYMENT — what the booking already collected; the balance stays
              billing's job after the visit, exactly as for a walk-in. */}
          <div className="kw-apt-section">Payment</div>
          {feeAmount > 0 ? (
            <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 110 } }}>
              <Descriptions.Item label="Booking fee">
                <KuwickStatusTag {...paymentChip(appointment.paymentStatus)} /> RM{' '}
                {feeAmount.toFixed(2)}
              </Descriptions.Item>
              <Descriptions.Item label="Balance">
                <Text type="secondary">
                  Any remaining amount is settled at billing after the visit.
                </Text>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Text type="secondary">
              No booking fee was collected — the visit is billed as usual afterwards.
            </Text>
          )}

          {appointment.reminderSentAt ? (
            <Descriptions
              column={1}
              size="small"
              colon={false}
              styles={{ label: { width: 110 } }}
              style={{ marginTop: 8 }}
            >
              <Descriptions.Item label="Reminder">
                WhatsApp opened · {formatClinicDateTime(appointment.reminderSentAt)}
              </Descriptions.Item>
            </Descriptions>
          ) : null}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
