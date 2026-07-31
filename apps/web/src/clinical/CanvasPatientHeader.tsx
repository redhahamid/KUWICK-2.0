import { Avatar, Card, Space, Tag, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';

const { Title, Text } = Typography;

interface CanvasPatientHeaderProps {
  patient: Patient;
  visit: Visit;
}

// The compact single-row header from the "Recommended Web Consultation
// Workspace" reference mockup — replaces the full profile Card only in
// Canvas layout (Flow keeps the existing detailed header; this is a
// scoped redesign, not a shared change). Only shows fields we actually
// track: no fabricated Blood Group/Panel/MRN — those aren't in the data
// model yet, so a real value can never appear there.
export function CanvasPatientHeader({ patient, visit }: CanvasPatientHeaderProps) {
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const hasAllergies = patient.allergies && patient.allergies.length > 0;

  return (
    <Card size="small" style={{ marginBottom: 6 }} styles={{ body: { padding: '8px 16px' } }}>
      <Space size="large" align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space align="center">
          <Avatar size={48} icon={<UserOutlined />} />
          <div>
            <Title level={5} style={{ margin: 0 }}>
              {patient.name}
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {patient.identifierType} {patient.identifierValue} · {age ?? '—'}y · {patient.gender ?? '—'}
            </Text>
          </div>
        </Space>

        <Space size="middle" wrap>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              COMPLAINT
            </Text>
            <Text strong type={visit.presentingComplaint ? 'danger' : 'secondary'}>
              {visit.presentingComplaint ?? '—'}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              ALLERGY
            </Text>
            <Text strong type={hasAllergies ? 'danger' : 'secondary'}>
              {hasAllergies ? patient.allergies!.join(', ') : 'None'}
            </Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              ATTENDING
            </Text>
            <Text strong>{visit.staff?.fullName ?? '—'}</Text>
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              VISIT STATUS
            </Text>
            <Tag color={visit.checkOutAt ? 'default' : 'gold'}>{visit.checkOutAt ? 'Completed' : 'In Progress'}</Tag>
          </div>
        </Space>
      </Space>
    </Card>
  );
}
