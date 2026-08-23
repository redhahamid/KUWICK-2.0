import { useState } from 'react';
import {
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { formatClinicDate } from '../../clinical/clinicTime';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useUpdatePatient } from '../../core/hooks/usePatients';
import { describeIdentityImpact } from '../../core/patient-identity-access';
import { ApiError, apiClient } from '../../core/api-client';
import { sentence } from '../appointment-presentation';

const { Text } = Typography;

/** The patient copy the appointment detail carries — see useAppointmentDetail. */
export interface DetailPatient {
  id: string;
  name: string;
  phone: string | null;
  identifierType: string;
  identifierValue: string;
  dob: string | null;
  gender: string | null;
  address: string | null;
  race?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

interface PatientFormValues {
  name: string;
  identifierType: string;
  identifierValue: string;
  dob?: Dayjs;
  gender?: string;
  race?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

/**
 * FINAL-UAT — the check-in drawer's Patient block, now the CANONICAL record
 * with an edit mode, not a read-only mirror.
 *
 * Registration is exactly the moment a stale phone number or a misspelt name
 * is noticed — the patient is standing at the counter. Editing here updates
 * the ONE patient record through the same PATCH /patients/:id every other
 * surface uses; no copy, no second store. Two permission tiers, matching the
 * server's own:
 *
 * - ordinary demographics need `patient.demographics.write` (everyone who
 *   sees patients);
 * - the IC and the date of birth stay behind `patient.identity.write`, keep
 *   the identity-impact confirmation, and land in the identity-change record
 *   — the same guarantees the profile screen gives.
 */
export function PatientDetailsSection({ patient }: { patient: DetailPatient }) {
  const [editing, setEditing] = useState(false);
  const canDemographics = useCan('patient.demographics.write');
  const canIdentity = useCan('patient.identity.write');
  const updatePatient = useUpdatePatient();
  const [form] = Form.useForm<PatientFormValues>();

  const save = async (values: PatientFormValues) => {
    const dto = {
      name: values.name,
      // The form's Select only offers the two real identifier types; the
      // detail payload types the field as a plain string.
      identifierType: values.identifierType as 'NRIC' | 'PASSPORT',
      identifierValue: values.identifierValue,
      dob: values.dob ? values.dob.format('YYYY-MM-DD') : undefined,
      gender: values.gender,
      race: values.race,
      phone: values.phone,
      address: values.address,
      emergencyContactName: values.emergencyContactName,
      emergencyContactPhone: values.emergencyContactPhone,
    };

    const identityMoved =
      values.identifierType !== patient.identifierType ||
      values.identifierValue !== patient.identifierValue ||
      (values.dob ? values.dob.format('YYYY-MM-DD') : null) !==
        (patient.dob ? dayjs(patient.dob).format('YYYY-MM-DD') : null);

    const commit = async () => {
      try {
        await updatePatient.mutateAsync({ id: patient.id, dto });
        message.success('Patient record updated — one file, corrected in place.');
        setEditing(false);
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : 'Could not update the patient.');
      }
    };

    if (!identityMoved) {
      await commit();
      return;
    }

    // The identity confirmation names what is attached, exactly as the
    // profile screen does — a registration typo and a records decision are
    // different acts and the person saving should know which this is.
    try {
      const impact = await apiClient.get<{ visits: number; invoices: number; documents: number }>(
        `/patients/${patient.id}/identity-impact`,
      );
      Modal.confirm({
        title: 'Change this patient’s identity details?',
        content: describeIdentityImpact(impact),
        okText: 'Save correction',
        onOk: commit,
      });
    } catch {
      // The impact read failing must not strand the correction — the server
      // still enforces permission and duplicates on save.
      await commit();
    }
  };

  return (
    <>
      <div className="kw-apt-section kw-apt-section--actionable">
        <span>Patient</span>
        {!editing ? (
          <Tooltip
            title={canDemographics ? undefined : permissionHint('edit patient details')}
          >
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              disabled={!canDemographics}
              onClick={() => {
                form.setFieldsValue({
                  name: patient.name,
                  identifierType: patient.identifierType,
                  identifierValue: patient.identifierValue,
                  dob: patient.dob ? dayjs(patient.dob) : undefined,
                  gender: patient.gender ?? undefined,
                  race: patient.race ?? undefined,
                  phone: patient.phone ?? undefined,
                  address: patient.address ?? undefined,
                  emergencyContactName: patient.emergencyContactName ?? undefined,
                  emergencyContactPhone: patient.emergencyContactPhone ?? undefined,
                });
                setEditing(true);
              }}
              data-testid="edit-patient-details"
            >
              Edit details
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {/* TWO COLUMNS (approved mockup 5): the record reads as a compact
          registration form rather than a tall list with the drawer's right
          half empty. Address and emergency contact keep the full width
          because their values are long. */}
      {!editing ? (
        <Descriptions
          className="kw-checkin-record"
          column={2}
          size="small"
          colon={false}
          styles={{ label: { width: 96 } }}
        >
          <Descriptions.Item label="Name">
            {patient.name} <KuwickStatusTag tone="success" label="On file" />
          </Descriptions.Item>
          <Descriptions.Item label={sentence(patient.identifierType ?? 'ID')}>
            {/* One token, tabular, never broken across two lines: half an
                identity number on each line cannot be checked against a card. */}
            {patient.identifierValue ? (
              <span className="kw-nric-value" title={patient.identifierValue}>
                {patient.identifierValue}
              </span>
            ) : (
              <Text type="secondary">—</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Mobile">
            {patient.phone ?? <Text type="secondary">—</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Date of birth">
            {patient.dob ? formatClinicDate(patient.dob) : <Text type="secondary">—</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Sex">
            {patient.gender ? sentence(patient.gender) : <Text type="secondary">—</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Address" span={2}>
            {patient.address ?? <Text type="secondary">—</Text>}
          </Descriptions.Item>
          {patient.emergencyContactName || patient.emergencyContactPhone ? (
            <Descriptions.Item label="Emergency" span={2}>
              {[patient.emergencyContactName, patient.emergencyContactPhone]
                .filter(Boolean)
                .join(' · ')}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      ) : (
        <Form
          form={form}
          layout="vertical"
          size="small"
          onFinish={save}
          className="kw-checkin-patient-form"
          data-testid="patient-edit-form"
        >
          <Form.Item name="name" label="Full name" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="identifierType" label="ID type" style={{ width: 130 }}>
              <Select
                disabled={!canIdentity}
                options={[
                  { value: 'NRIC', label: 'NRIC' },
                  { value: 'PASSPORT', label: 'Passport' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="identifierValue"
              label="ID number"
              style={{ flex: 1 }}
              tooltip={canIdentity ? undefined : 'Correcting an IC needs the identity permission.'}
            >
              <Input disabled={!canIdentity} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="dob" label="Date of birth">
            <DatePicker
              style={{ width: '100%' }}
              disabled={!canIdentity}
              disabledDate={(value) => value.isAfter(dayjs(), 'day')}
            />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="gender" label="Sex" style={{ flex: 1 }}>
              <Input placeholder="e.g. Female" />
            </Form.Item>
            <Form.Item name="race" label="Race" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="phone" label="Mobile">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="emergencyContactName" label="Emergency contact" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="emergencyContactPhone" label="Contact phone" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space>
            <Button
              type="primary"
              size="small"
              htmlType="submit"
              loading={updatePatient.isPending}
              data-testid="save-patient-details"
            >
              Save details
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Space>
        </Form>
      )}
    </>
  );
}
