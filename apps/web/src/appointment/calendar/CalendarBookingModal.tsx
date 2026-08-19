import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Select, Typography, message } from 'antd';
import { Dayjs } from 'dayjs';
import {
  KuwickModal,
  KuwickModalActionBar,
  KuwickSearchSelect,
  KuwickSearchOption,
} from '../../design-system/kuwick';
import { apiClient, ApiError } from '../../core/api-client';
import { usePatients } from '../../core/hooks/usePatients';
import { useServices } from '../../clinical/hooks/useServices';
import { useDoctorServiceQualifications } from '../hooks/useDoctorServiceQualifications';
import { useCreateAppointment } from '../hooks/useAppointments';
import { formatClinicDateTime } from '../../clinical/clinicTime';

/**
 * Book into an open slot, from the slot itself.
 *
 * The doctor and the time are NOT fields — they are the slot that was clicked,
 * shown as a statement. A modal that reopened those two as pickers would be a
 * second booking form beside the drawer, and the two would drift.
 *
 * SERVICE HONOURS THE MAPPING. Only services this doctor is qualified for are
 * offered, so the engine's `NOT_QUALIFIED` refusal is something a person has
 * to work at rather than the ordinary result of using the form.
 */
export function CalendarBookingModal({
  open,
  clinicId,
  staffId,
  staffName,
  slotStart,
  slotEnd,
  onClose,
  onBooked,
}: {
  open: boolean;
  clinicId?: string;
  staffId?: string;
  staffName: string;
  slotStart: Dayjs | null;
  slotEnd: Dayjs | null;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [form] = Form.useForm<{ patientId: string; serviceId: string; notes?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [registering, setRegistering] = useState(false);

  const { data: patients } = usePatients();
  const { data: services } = useServices();
  const { data: qualifications } = useDoctorServiceQualifications();
  const createAppointment = useCreateAppointment();

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setQuickName('');
      setQuickPhone('');
      setError(null);
    }
  }, [open, form]);

  // The MAPPING is the source of who can be booked for what. Offering a
  // service this doctor cannot perform would produce a server refusal from a
  // form that presented it as a choice.
  const bookableServices = useMemo(() => {
    const allowed = new Set(
      (qualifications ?? []).filter((q) => q.staffId === staffId).map((q) => q.serviceId),
    );
    return (services ?? []).filter((service) => allowed.has(service.id) && service.active);
  }, [qualifications, services, staffId]);

  const searchPatients = (term: string): KuwickSearchOption[] => {
    const needle = term.trim().toLowerCase();
    return (patients ?? [])
      .filter(
        (patient) =>
          !needle ||
          patient.name.toLowerCase().includes(needle) ||
          (patient.phone ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 20)
      .map((patient) => ({
        value: patient.id,
        label: patient.name,
        detail: patient.phone ?? undefined,
      }));
  };

  const quickRegister = async () => {
    if (!quickName.trim()) {
      message.warning('A name is needed to register.');
      return;
    }
    setRegistering(true);
    try {
      const patient = await apiClient.post<{ id: string; name: string }>('/patients', {
        name: quickName.trim(),
        phone: quickPhone.trim() || undefined,
      });
      form.setFieldValue('patientId', patient.id);
      setQuickName('');
      setQuickPhone('');
      message.success(`${patient.name} registered.`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not register that patient.');
    } finally {
      setRegistering(false);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (!clinicId || !staffId || !slotStart || !slotEnd) return;
    try {
      await createAppointment.mutateAsync({
        clinicId,
        staffId,
        patientId: values.patientId,
        serviceId: values.serviceId,
        scheduledStart: slotStart.toISOString(),
        scheduledEnd: slotEnd.toISOString(),
        notes: values.notes,
        // FRONT_DESK books confirmed on the spot; the online portal is what
        // produces a request awaiting approval.
        source: 'FRONT_DESK',
      } as never);
      message.success('Booked.');
      onBooked();
    } catch (caught) {
      // The engine's own words — "the clinic is closed on that date", "that is
      // too soon" — shown INSIDE the modal, above the form they refer to,
      // rather than as a toast that vanishes while the user is still reading.
      setError(caught instanceof ApiError ? caught.message : 'Could not book that slot.');
    }
  };

  return (
    <KuwickModal
      open={open}
      title="Book this slot"
      onClose={onClose}
      loading={createAppointment.isPending}
      error={error}
      dataTestId="calendar-booking-modal"
      footer={
        <KuwickModalActionBar
          cancel={<Button onClick={onClose}>Cancel</Button>}
          primary={
            <Button type="primary" onClick={submit} loading={createAppointment.isPending}>
              Book
            </Button>
          }
        />
      }
    >
      <div className="kw-cal-slot-statement">
        <Typography.Text strong>{staffName}</Typography.Text>
        <Typography.Text type="secondary">
          {slotStart ? formatClinicDateTime(slotStart.toDate()) : ''}
          {slotEnd ? ` – ${slotEnd.format('HH:mm')}` : ''}
        </Typography.Text>
      </div>

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="patientId"
          label="Patient"
          rules={[{ required: true, message: 'Choose a patient, or register one below.' }]}
        >
          <KuwickSearchSelect
            ariaLabel="Patient"
            placeholder="Search by name or phone"
            value={form.getFieldValue('patientId')}
            onSearch={async (term) => searchPatients(term)}
            onSelect={(value) => form.setFieldValue('patientId', value)}
            onClear={() => form.setFieldValue('patientId', undefined)}
            emptyHint="Type a name or phone number"
          />
        </Form.Item>

        <div className="kw-cal-quick-register">
          <Typography.Text type="secondary">Not registered yet?</Typography.Text>
          <Input
            value={quickName}
            onChange={(event) => setQuickName(event.target.value)}
            placeholder="Full name"
            maxLength={120}
          />
          <Input
            value={quickPhone}
            onChange={(event) => setQuickPhone(event.target.value)}
            placeholder="Phone (optional)"
            maxLength={40}
            onPressEnter={quickRegister}
          />
          <button type="button" className="kw-cal-quick-btn" onClick={quickRegister} disabled={registering}>
            {registering ? 'Registering…' : 'Register & select'}
          </button>
        </div>

        <Form.Item
          name="serviceId"
          label="Service"
          rules={[{ required: true, message: 'Choose a service.' }]}
        >
          <Select
            placeholder={bookableServices.length ? 'Choose a service' : 'No services mapped to this doctor'}
            disabled={bookableServices.length === 0}
            showSearch
            optionFilterProp="label"
            options={bookableServices.map((service) => ({ value: service.id, label: service.name }))}
          />
        </Form.Item>

        {bookableServices.length === 0 && (
          <Alert
            type="warning"
            showIcon
            message="This doctor has no services mapped"
            description="Nothing can be booked for them until a mapping exists — Settings → Appointments & Scheduling → Doctor-Service Mapping."
          />
        )}

        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} maxLength={500} placeholder="Reason for the visit (optional)" />
        </Form.Item>
      </Form>
    </KuwickModal>
  );
}
