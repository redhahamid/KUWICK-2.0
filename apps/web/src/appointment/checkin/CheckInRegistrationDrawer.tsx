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
import { EditOutlined } from '@ant-design/icons';
import { KuwickStatusTag } from '../../design-system/kuwick';
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

  return (
    <Drawer
      open={Boolean(appointmentId)}
      onClose={onClose}
      width={470}
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
        <div data-testid="checkin-registration-drawer">
          {/* THE APPOINTMENT — what was booked, read-only. */}
          <div className="kw-apt-section">Appointment</div>
          <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 110 } }}>
            <Descriptions.Item label="Service">{appointment.service.name}</Descriptions.Item>
            <Descriptions.Item label="Booked for">
              {formatClinicDate(appointment.scheduledStart)} ·{' '}
              {formatClinicTime(appointment.scheduledStart)} –{' '}
              {formatClinicTime(appointment.scheduledEnd)}
            </Descriptions.Item>
            <Descriptions.Item label="Booked with">{appointment.staff.fullName}</Descriptions.Item>
            <Descriptions.Item label="Source">
              {SOURCE_LABELS[appointment.source as AppointmentSource] ?? sentence(appointment.source)}
            </Descriptions.Item>
            <Descriptions.Item label="Reference">
              {bookingReference(appointment.id)}
            </Descriptions.Item>
          </Descriptions>

          {/* THE PATIENT — matched to the record on file; nothing re-typed. */}
          <div className="kw-apt-section">Patient</div>
          <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 110 } }}>
            <Descriptions.Item label="Name">
              {appointment.patient.name}{' '}
              <KuwickStatusTag tone="success" label="On file" />
            </Descriptions.Item>
            <Descriptions.Item label={sentence(appointment.patient.identifierType ?? 'ID')}>
              {appointment.patient.identifierValue || <Text type="secondary">—</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Mobile">
              {appointment.patient.phone ?? <Text type="secondary">—</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Date of birth">
              {appointment.patient.dob ? (
                formatClinicDate(appointment.patient.dob)
              ) : (
                <Text type="secondary">—</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Sex">
              {appointment.patient.gender ? (
                sentence(appointment.patient.gender)
              ) : (
                <Text type="secondary">—</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Address">
              {appointment.patient.address ?? <Text type="secondary">—</Text>}
            </Descriptions.Item>
          </Descriptions>

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
      ) : null}
    </Drawer>
  );
}
