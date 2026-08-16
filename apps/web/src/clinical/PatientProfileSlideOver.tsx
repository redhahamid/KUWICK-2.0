import { useMemo, useState } from 'react';
import { Alert, Button, Col, Form, Input, Row, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { KuwickFormSection, KuwickModal, KuwickModalActionBar } from '../design-system/kuwick';
import { ApiError } from '../core/api-client';
import { Patient, UpdatePatientDto } from '../core/types';
import { useUpdatePatient } from '../core/hooks/usePatients';
import { Visit } from './types';
import { usePatientAlerts } from './hooks/usePatientAlerts';
import { AlertsPanel } from './PatientAlertsPanel';

const { Text, Paragraph } = Typography;

/**
 * b1.5 PHASE D — the patient behind the consultation.
 *
 * The canvas identity strip shows a name, an age and an identifier because
 * that is all that fits. Everything else about the person — how to reach them,
 * who pays, what they react to, what they live with — had no home in the
 * consult at all, so answering "what's their number?" meant leaving the record.
 *
 * A KuwickModal, so the dismissal guard from Phase B is inherited rather than
 * re-derived: a half-typed phone number is not lost to a stray backdrop click.
 *
 * CHRONIC CONDITIONS ARE ALERTS, not a new column. A standing fact about a
 * person with an author and a timestamp is exactly what `patient_alerts`
 * already is, and a second store for the same idea is a second thing to keep
 * in step. MEDICAL alerts are therefore what the allergy banner reads too.
 */

export interface PatientProfileSlideOverProps {
  open: boolean;
  patient: Patient;
  visit?: Visit;
  onClose: () => void;
  /**
   * False for roles that may read the record but not change it. The fields
   * render read-only rather than vanishing: a doctor covering a clinic should
   * see the emergency contact exists, not an empty space where it might.
   */
  canEdit?: boolean;
  /**
   * Whether this account may record a MEDICAL alert. The API enforces it; this
   * only decides whether the option is offered, and it is offered DISABLED
   * with the reason rather than removed.
   */
  canRecordMedical?: boolean;
}

interface ProfileForm {
  name: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export function PatientProfileSlideOver({
  open,
  patient,
  visit,
  onClose,
  canEdit = true,
  canRecordMedical = true,
}: PatientProfileSlideOverProps) {
  const [form] = Form.useForm<ProfileForm>();
  const [dirty, setDirty] = useState(false);
  const updatePatient = useUpdatePatient();
  const { data: alerts, isLoading: alertsLoading } = usePatientAlerts(patient.id);

  const initial = useMemo<ProfileForm>(
    () => ({
      name: patient.name,
      phone: patient.phone ?? undefined,
      address: patient.address ?? undefined,
      emergencyContactName: patient.emergencyContactName ?? undefined,
      emergencyContactPhone: patient.emergencyContactPhone ?? undefined,
    }),
    [patient],
  );

  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const payer = visit?.panelClinic?.name ? `Panel · ${visit.panelClinic.name}` : 'Cash';

  const save = async (values: ProfileForm) => {
    const dto: UpdatePatientDto = {
      name: values.name,
      phone: values.phone ?? '',
      address: values.address ?? '',
      emergencyContactName: values.emergencyContactName ?? '',
      emergencyContactPhone: values.emergencyContactPhone ?? '',
    };
    try {
      await updatePatient.mutateAsync({ id: patient.id, dto });
      message.success('Patient details updated');
      setDirty(false);
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the patient details');
    }
  };

  return (
    <KuwickModal
      open={open}
      title={patient.name}
      subtitle={`${age !== null ? `${age}y` : 'age unknown'} · ${patient.gender ?? '—'} · ${patient.identifierValue}`}
      size="large"
      dirty={dirty}
      loading={updatePatient.isPending}
      onClose={onClose}
      dataTestId="patient-profile"
      footer={
        <KuwickModalActionBar
          cancel={
            <Button onClick={onClose} disabled={updatePatient.isPending}>
              Close
            </Button>
          }
          primary={
            canEdit ? (
              <Button
                type="primary"
                loading={updatePatient.isPending}
                disabled={!dirty}
                onClick={() => void form.submit()}
              >
                Save changes
              </Button>
            ) : undefined
          }
        />
      }
    >
      {!canEdit && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="You can read this record but not change it. Ask the front desk to correct any detail."
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        disabled={!canEdit}
        onValuesChange={() => setDirty(true)}
        onFinish={save}
      >
        <KuwickFormSection title="Identity">
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="name" label="Full name" rules={[{ required: true, message: 'A name is required' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              {/* Read-only on purpose. An IC/passport number identifies the
                  person across every visit, invoice and claim already written;
                  correcting a typo in one is a records job, not a mid-consult
                  edit, and doing it here would silently orphan the history. */}
              <Form.Item label={patient.identifierType === 'PASSPORT' ? 'Passport' : 'IC'}>
                <Input value={patient.identifierValue} readOnly disabled />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item label="Date of birth">
                <Input value={patient.dob ? dayjs(patient.dob).format('DD/MM/YYYY') : '—'} readOnly disabled />
              </Form.Item>
            </Col>
          </Row>
        </KuwickFormSection>

        <KuwickFormSection title="Contact">
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="phone" label="Phone">
                <Input placeholder="01x-xxx xxxx" />
              </Form.Item>
            </Col>
            <Col xs={24} md={16}>
              <Form.Item name="address" label="Address">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="emergencyContactName" label="Emergency contact">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="emergencyContactPhone" label="Emergency contact phone">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </KuwickFormSection>
      </Form>

      <KuwickFormSection title="Payer">
        {/* Read from the VISIT, not the patient: the same person can attend on
            their employer's panel one week and pay cash the next, and the
            profile must not imply otherwise. */}
        <Text>{payer}</Text>
        {visit?.panelClinic?.name && (
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            For this visit. Set at registration.
          </Text>
        )}
      </KuwickFormSection>

      <AlertsPanel
        patient={patient}
        alerts={alerts}
        loading={alertsLoading}
        canRecordMedical={canRecordMedical}
        canEdit={canEdit}
      />

      <VisitSummary visit={visit} />
    </KuwickModal>
  );
}

function VisitSummary({ visit }: { visit?: Visit }) {
  if (!visit) return null;
  return (
    <KuwickFormSection title="This visit">
      <Text type="secondary" style={{ display: 'block' }}>
        {visit.checkInAt ? dayjs(visit.checkInAt).format('DD/MM/YYYY HH:mm') : '—'}
        {visit.visitNumber ? ` · ${visit.visitNumber}` : ''}
        {visit.checkOutAt ? ' · Completed' : ' · In progress'}
      </Text>
      {visit.presentingComplaint && <Paragraph style={{ marginTop: 6 }}>{visit.presentingComplaint}</Paragraph>}
    </KuwickFormSection>
  );
}
