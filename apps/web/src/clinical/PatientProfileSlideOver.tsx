import { useMemo, useState } from 'react';
import { Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { KuwickFormSection, KuwickModal, KuwickModalActionBar } from '../design-system/kuwick';
import { ApiError, apiClient } from '../core/api-client';
import { Patient, UpdatePatientDto } from '../core/types';
import { useUpdatePatient } from '../core/hooks/usePatients';
import { describeIdentityImpact } from '../core/patient-identity-access';
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
  /**
   * Whether this account may correct the IC / passport number and the date of
   * birth. Every staff role that sees patients holds it; it stays a separate
   * flag because the act is separate — a correction is confirmed and recorded,
   * where a phone-number edit is neither.
   */
  canCorrectIdentity?: boolean;
}

interface ProfileForm {
  name: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /**
   * Editable now, and deliberately.
   *
   * They were read-only on the reasoning that an identifier ties a person's
   * history together and must not move. True — but the consequence was that a
   * transposed digit taken at registration could not be fixed, so the counter's
   * only remaining move was to open a SECOND patient, which splits exactly the
   * history the lock was protecting. Staging has an 11-digit IC and a date of
   * birth of 05/05/2026 to prove it.
   *
   * Safe because of what surrounds the field, not because of who is trusted —
   * which is also why the permission is open to every staff role that sees
   * patients. A server-side check that no other patient holds the identifier, a
   * confirmation naming what is attached, and an append-only record of old
   * value → new value with the author's name and role: those are the
   * safeguards. The grant list never was one.
   */
  identifierValue?: string;
  dob?: Dayjs | null;
}

export function PatientProfileSlideOver({
  open,
  patient,
  visit,
  onClose,
  canEdit = true,
  canRecordMedical = true,
  canCorrectIdentity = false,
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
      identifierValue: patient.identifierValue,
      dob: patient.dob ? dayjs(patient.dob) : null,
    }),
    [patient],
  );

  const identityLabel = patient.identifierType === 'PASSPORT' ? 'Passport' : 'IC';

  /**
   * A NEW identifier must be well-formed. An UNCHANGED one is left alone.
   *
   * The server takes exactly 12 digits for an NRIC, so anything typed here has
   * to clear that bar or the save fails with a validation error nobody asked
   * for. What is deliberately NOT enforced is the value already on the record:
   * a legacy IC stored with dashes is not this save's business unless somebody
   * is actually changing it.
   */
  const validateIdentifier = async (_rule: unknown, value?: string) => {
    const next = value?.trim() ?? '';
    if (next === patient.identifierValue) return;
    if (!next) throw new Error(`A ${identityLabel} is required`);
    if (patient.identifierType === 'NRIC' && !/^\d{12}$/.test(next)) {
      throw new Error('An IC is exactly 12 digits, no dashes');
    }
  };

  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const payer = visit?.panelClinic?.name ? `Panel · ${visit.panelClinic.name}` : 'Cash';

  const commit = async (dto: UpdatePatientDto) => {
    try {
      await updatePatient.mutateAsync({ id: patient.id, dto });
      message.success('Patient details updated');
      setDirty(false);
      onClose();
    } catch (error) {
      // The server's sentence, not a generic one. A duplicate-IC refusal names
      // the other patient, and that name is the whole content of the warning.
      message.error(error instanceof ApiError ? error.message : 'Could not save the patient details');
    }
  };

  const save = async (values: ProfileForm) => {
    const nextDob = values.dob ? values.dob.format('YYYY-MM-DD') : undefined;
    const dto: UpdatePatientDto = {
      name: values.name,
      phone: values.phone ?? '',
      address: values.address ?? '',
      emergencyContactName: values.emergencyContactName ?? '',
      emergencyContactPhone: values.emergencyContactPhone ?? '',
      // Only sent where this account may change them. A payload carrying the
      // unchanged value is harmless — the server compares by value — but
      // sending fields the account cannot edit invites the next reader to
      // assume the browser is the gate.
      ...(canCorrectIdentity
        ? { identifierValue: values.identifierValue?.trim(), dob: nextDob }
        : {}),
    };

    const identityMoved =
      canCorrectIdentity &&
      (dto.identifierValue !== patient.identifierValue ||
        nextDob !== (patient.dob ? dayjs(patient.dob).format('YYYY-MM-DD') : undefined));

    if (!identityMoved) {
      await commit(dto);
      return;
    }

    // WHAT IS ATTACHED, BEFORE THE CHANGE. Fetched at this moment rather than
    // loaded with the profile: three COUNT queries are not worth running every
    // time somebody opens a record to read a phone number.
    let impact = { visits: 0, invoices: 0, documents: 0 };
    try {
      impact = await apiClient.get<typeof impact>(`/patients/${patient.id}/identity-impact`);
    } catch {
      // A failed count must not block a correction — it only makes the
      // confirmation less specific, and the correction is the safer state.
    }

    Modal.confirm({
      title: `Change this patient's ${identityLabel} or date of birth?`,
      okText: 'Change it',
      cancelText: 'Keep as it is',
      content: (
        <>
          <Paragraph style={{ marginBottom: 8 }}>{describeIdentityImpact(impact)}</Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            The change is recorded against this patient with your name and the time.
          </Paragraph>
        </>
      ),
      onOk: () => commit(dto),
    });
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
              {/* CORRECTABLE, by every staff role that sees patients.
                  It used to be locked, and the lock is what produced the
                  duplicate patients: a transposed digit could not be fixed, so
                  a second file got opened for the same person and their history
                  split in two. It then shipped restricted to owner and counter,
                  which was the same mistake one step smaller — in a small clinic
                  whoever is holding the IC card is who needs to fix it, and
                  sending them to find another account is how the second file
                  gets created anyway. What keeps this safe is below and behind
                  it: the duplicate check, the confirmation naming what is
                  attached, and the append-only record of who changed what. */}
              <Form.Item
                name="identifierValue"
                label={identityLabel}
                // Validated only where it is editable, and only against what
                // the save would CHANGE. Older records hold ICs with dashes;
                // refusing to submit the form until a locked legacy value is
                // "fixed" would block a phone-number correction on the
                // strength of a field the account cannot even touch — the
                // same dead end this whole change is removing.
                rules={canCorrectIdentity ? [{ validator: validateIdentifier }] : []}
              >
                <Input disabled={!canEdit || !canCorrectIdentity} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="dob" label="Date of birth">
                <DatePicker
                  format="DD/MM/YYYY"
                  style={{ width: '100%' }}
                  disabled={!canEdit || !canCorrectIdentity}
                  // A date of birth in the future is always a typo, and
                  // 05/05/2026 on staging is the one this whole change exists
                  // to let somebody fix.
                  disabledDate={(current) => current && current.isAfter(dayjs(), 'day')}
                />
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
