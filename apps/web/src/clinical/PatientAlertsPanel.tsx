import { useState } from 'react';
import { Button, Col, Empty, Form, Input, Row, Select, Space, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { KuwickFormSection } from '../design-system/kuwick';
import { ApiError } from '../core/api-client';
import { Patient } from '../core/types';
import {
  PatientAlert,
  PatientAlertType,
  activeAlerts,
  useCreatePatientAlert,
  useDeactivatePatientAlert,
} from './hooks/usePatientAlerts';

const { Text, Paragraph } = Typography;

/**
 * b1.5 — the patient's standing facts, and the two things that can be done to
 * them.
 *
 * Its own module because it now has TWO homes: the lightweight alerts view a
 * doctor reaches from the header chip mid-consult, and the full profile. One
 * panel, so the rules — nothing is deleted, resolving stamps a second author,
 * a retired row stays visible — cannot drift between the two.
 */

const ALERT_TYPES: Array<{ value: PatientAlertType; label: string; hint: string }> = [
  {
    value: 'ALLERGY',
    label: 'Allergy',
    hint: 'Do not prescribe. Shows on the allergy chip and the prescribing banner.',
  },
  {
    value: 'MEDICAL',
    label: 'Medical (chronic)',
    hint: 'Take into account — diabetes, hypertension, pregnancy. NOT an allergy.',
  },
  { value: 'ACCESSIBILITY', label: 'Accessibility', hint: 'Wheelchair, hearing, mobility.' },
  { value: 'COMMUNICATION', label: 'Communication', hint: 'Language, next of kin speaks for them.' },
  { value: 'ADMINISTRATIVE', label: 'Administrative', hint: 'Outstanding balance, frequent no-show.' },
];

/**
 * The alert list, and the two things that can be done to it.
 *
 * NOTHING IS DELETED. Retiring stamps who and when, and the retired row stays
 * visible — "penicillin allergy, retired by Dr X on the 3rd" is the record of
 * a clinical decision, and hiding it leaves the profile unable to say why an
 * alert stopped showing. The table has no DELETE policy at all, so this is not
 * a convention the UI is choosing to keep.
 */
export function AlertsPanel({
  patient,
  alerts,
  loading,
  canRecordMedical,
  canEdit,
}: {
  patient: Patient;
  alerts: PatientAlert[] | undefined;
  loading: boolean;
  canRecordMedical: boolean;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm<{ type: PatientAlertType; label: string; note?: string }>();
  const createAlert = useCreatePatientAlert(patient.id);
  const deactivateAlert = useDeactivatePatientAlert(patient.id);

  const live = activeAlerts(alerts);
  const retired = (alerts ?? []).filter((alert) => !alert.active);

  const add = async (values: { type: PatientAlertType; label: string; note?: string }) => {
    try {
      await createAlert.mutateAsync(values);
      message.success('Alert recorded');
      form.resetFields();
      setAdding(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record the alert');
    }
  };

  const retire = async (alert: PatientAlert) => {
    try {
      await deactivateAlert.mutateAsync(alert.id);
      message.success('Alert resolved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not resolve the alert');
    }
  };

  return (
    <KuwickFormSection
      title="Alerts"
      hint="Standing facts about this patient — allergies, chronic conditions, access needs"
    >
      <div data-testid="patient-alerts">
        {loading && <Text type="secondary">Loading alerts…</Text>}

        {!loading && live.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No active alerts for this patient."
            style={{ margin: '8px 0' }}
          />
        )}

        {live.map((alert) => (
          <div key={alert.id} className="kw-alert-row" data-alert-id={alert.id}>
            <Space size={6} wrap>
              <Tag color={alert.type === 'MEDICAL' ? 'red' : 'blue'}>{alert.type}</Tag>
              <Text strong>{alert.label}</Text>
              {alert.note && <Text type="secondary">— {alert.note}</Text>}
            </Space>
            <div>
              {/* Author and time, on the row. An alert nobody can attribute is
                  one nobody can question. */}
              <Text type="secondary" style={{ fontSize: 12 }}>
                Recorded by {alert.createdByName ?? 'unknown'} · {formatStamp(alert.createdAt)}
              </Text>
            </div>
            {canEdit && (
              <Button size="small" onClick={() => void retire(alert)} loading={deactivateAlert.isPending}>
                Resolve
              </Button>
            )}
          </div>
        ))}

        {retired.length > 0 && (
          <>
            <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
              Resolved
            </Text>
            {retired.map((alert) => (
              <div key={alert.id} className="kw-alert-row kw-alert-row-retired" data-alert-id={alert.id}>
                <Space size={6} wrap>
                  <Tag>{alert.type}</Tag>
                  <Text delete>{alert.label}</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Resolved by {alert.deactivatedByName ?? 'unknown'} ·{' '}
                  {alert.deactivatedAt ? formatStamp(alert.deactivatedAt) : '—'}
                </Text>
              </div>
            ))}
          </>
        )}

        {canEdit && !adding && (
          <Button size="small" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
            Add alert
          </Button>
        )}

        {adding && (
          <Form
            form={form}
            layout="vertical"
            initialValues={{ type: canRecordMedical ? 'ALLERGY' : 'ADMINISTRATIVE' }}
            onFinish={add}
            style={{ marginTop: 10 }}
          >
            <Row gutter={12}>
              <Col xs={24} md={7}>
                <Form.Item name="type" label="Type" rules={[{ required: true }]}>
                  <Select
                    options={ALERT_TYPES.map((type) => ({
                      value: type.value,
                      label: type.label,
                      // Honest-disabled: the option stays visible with the
                      // reason, rather than vanishing and leaving the account
                      // wondering where allergies are recorded.
                      disabled: (type.value === 'MEDICAL' || type.value === 'ALLERGY') && !canRecordMedical,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={17}>
                <Form.Item
                  name="label"
                  label="Alert"
                  rules={[{ required: true, message: 'An alert needs a short label' }]}
                  extra="Short — it renders as a chip. Detail goes in the note."
                >
                  <Input maxLength={60} placeholder="e.g. Penicillin allergy, Type 2 diabetes" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="note" label="Note (optional)">
              <Input.TextArea rows={2} maxLength={300} />
            </Form.Item>
            {!canRecordMedical && (
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Your account cannot record an Allergy or Medical alert — those change what may safely be
                prescribed. Ask a clinician to add it.
              </Paragraph>
            )}
            <Space>
              <Button type="primary" htmlType="submit" loading={createAlert.isPending}>
                Record alert
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setAdding(false);
                }}
              >
                Cancel
              </Button>
            </Space>
          </Form>
        )}
      </div>
    </KuwickFormSection>
  );
}

/** What happened today, so the profile is not a dead end back to the consult. */

/** The audit line's stamp. An alert nobody can date is one nobody can question. */
function formatStamp(iso: string): string {
  const when = dayjs(iso);
  return when.isValid() ? when.format('DD/MM/YYYY HH:mm') : '—';
}
