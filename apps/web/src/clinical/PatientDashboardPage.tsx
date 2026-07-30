import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  List,
  Row,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePatient } from '../core/hooks/usePatients';
import { usePatientVisits } from './hooks/useVisits';
import { EditPatientDrawer } from './EditPatientDrawer';
import { ClinicalNotesTab } from './ClinicalNotesTab';
import { Visit } from './types';

const { Title, Text } = Typography;

// Six Record View tabs from the audited kuwick.com Patient Dashboard.
// Orders & Services/Diagnosis land in the rest of Phase 2, Medications in
// Phase 3, Documents in Phase 4, Invoices in Phase 5 — empty states here
// are placeholders for those phases, not a scope cut.
const RECORD_TABS = [
  { key: 'orders', label: 'Orders & Services', description: 'Orders & Services (Phase 2)' },
  { key: 'diagnosis', label: 'Diagnosis', description: 'No diagnoses added' },
  { key: 'medications', label: 'Medications', description: 'Medications (Phase 3)' },
  { key: 'documents', label: 'Documents', description: 'No generated documents yet' },
  { key: 'invoices', label: 'Invoices', description: 'Invoices (Phase 5)' },
];

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data: patient, isLoading } = usePatient(id);
  const { data: visits } = usePatientVisits(id);
  const [expandProfile, setExpandProfile] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string>();

  if (isLoading || !patient) {
    return <Spin />;
  }

  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const selectedVisit: Visit | undefined =
    visits?.find((visit) => visit.id === selectedVisitId) ?? visits?.[0];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Space align="start" size="large">
          <Avatar size={64} icon={<UserOutlined />} />
          <div>
            <Space>
              <Title level={4} style={{ margin: 0 }}>
                {patient.name}
              </Title>
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditOpen(true)} />
            </Space>
            <div>
              <Tag>ID {patient.id.slice(0, 8)}</Tag>
              <Text type="secondary">
                {patient.identifierType}: {patient.identifierValue}
              </Text>
            </div>
            <Space size="large" style={{ marginTop: 4 }} wrap>
              <Text>Phone: {patient.phone ?? '—'}</Text>
              <Text>DOB: {patient.dob ? dayjs(patient.dob).format('YYYY-MM-DD') : '—'}</Text>
              <Text>Age: {age ?? '—'}</Text>
              <Text>Known Allergies: {patient.allergies && patient.allergies.length > 0 ? patient.allergies.join(', ') : 'None known'}</Text>
            </Space>
          </div>
        </Space>
        <div style={{ marginTop: 12 }}>
          <Button size="small" onClick={() => setExpandProfile((prev) => !prev)}>
            {expandProfile ? 'Hide Profile' : 'Expand Profile'}
          </Button>
          {expandProfile && (
            <Descriptions column={2} size="small" style={{ marginTop: 12 }}>
              <Descriptions.Item label="Gender">{patient.gender ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Race">{patient.race ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Address">{patient.address ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Emergency Contact">
                {patient.emergencyContactName ?? '—'} {patient.emergencyContactPhone ?? ''}
              </Descriptions.Item>
            </Descriptions>
          )}
        </div>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="Attending Physician" size="small">
            {selectedVisit?.staff ? selectedVisit.staff.fullName : 'No active visit'}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Procedure Status" size="small">
            <Space size="large">
              <Statistic title="Pending" value={0} />
              <Statistic title="In Progress" value={0} />
              <Statistic title="Completed" value={0} />
              <Statistic title="Cancelled" value={0} />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title={`Visits History (${visits?.length ?? 0})`} style={{ marginBottom: 16 }}>
        <List
          dataSource={visits}
          locale={{ emptyText: 'No visits yet' }}
          renderItem={(visit: Visit) => (
            <List.Item
              onClick={() => setSelectedVisitId(visit.id)}
              style={{
                cursor: 'pointer',
                background: visit.id === selectedVisit?.id ? '#f0f5ff' : undefined,
                padding: 12,
              }}
            >
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text strong>
                  {visit.visitNumber} — {dayjs(visit.checkInAt).format('YYYY-MM-DD HH:mm')}
                </Text>
                <Text>
                  Billing: {visit.billingType} · Doctor: {visit.staff?.fullName ?? '—'}
                </Text>
                <Text type="secondary">Diagnosis: — · Meds: — · Procedure: —</Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      {selectedVisit && (
        <Card>
          <Tabs
            items={[
              {
                key: 'notes',
                label: 'Clinical Notes',
                children: <ClinicalNotesTab visitId={selectedVisit.id} />,
              },
              ...RECORD_TABS.map((tab) => ({
                key: tab.key,
                label: tab.label,
                children: <Empty description={tab.description} />,
              })),
            ]}
          />
        </Card>
      )}

      <EditPatientDrawer patient={patient} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}
