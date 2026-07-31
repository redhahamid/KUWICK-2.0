import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';

const { Text } = Typography;

interface PatientSummarySidebarProps {
  patient: Patient;
  visits: Visit[] | undefined;
  selectedVisitId: string | undefined;
  onSelectVisit: (visitId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

// Right-hand sidebar for Canvas layout, replacing the separate "Visits
// History" column the Flow layout uses — folds patient summary + recent
// visits into one place, matching the reference mockup's sidebar. Only
// fields we actually track are shown (no Blood Group/Panel — not in the
// data model yet).
export function PatientSummarySidebar({
  patient,
  visits,
  selectedVisitId,
  onSelectVisit,
  expanded,
  onToggleExpand,
}: PatientSummarySidebarProps) {
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const lastVisit = visits?.[0];
  const hasAllergies = patient.allergies && patient.allergies.length > 0;

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Card size="small" title="Patient Summary">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Age / Gender">
            {age ?? '—'}y / {patient.gender ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Contact">{patient.phone ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Last Visit">
            {lastVisit ? dayjs(lastVisit.checkInAt).format('D MMM YYYY') : '—'}
          </Descriptions.Item>
          {expanded && (
            <>
              <Descriptions.Item label="Race">{patient.race ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Address">{patient.address ?? 'No address provided.'}</Descriptions.Item>
              <Descriptions.Item label="Emergency Contact">
                {patient.emergencyContactName
                  ? `${patient.emergencyContactName} ${patient.emergencyContactPhone ?? ''}`
                  : 'No emergency contact provided.'}
              </Descriptions.Item>
            </>
          )}
        </Descriptions>
        <Button size="small" block style={{ marginTop: 8 }} onClick={onToggleExpand}>
          {expanded ? 'Collapse Profile' : 'View Full Profile'}
        </Button>
      </Card>

      <Card size="small" title="Allergies">
        {hasAllergies ? (
          <Space wrap>
            {patient.allergies!.map((allergy) => (
              <Tag color="red" key={allergy}>
                {allergy}
              </Tag>
            ))}
          </Space>
        ) : (
          <Tag color="green">None recorded</Tag>
        )}
      </Card>

      <Card size="small" title={<Space>Recent Visits <Tag>{visits?.length ?? 0}</Tag></Space>}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {visits && visits.length > 0 ? (
            visits.map((visit) => (
              <div
                key={visit.id}
                onClick={() => onSelectVisit(visit.id)}
                style={{
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: visit.id === selectedVisitId ? '#4338ca' : '#fafafa',
                  color: visit.id === selectedVisitId ? '#fff' : undefined,
                }}
              >
                <Text strong style={{ color: 'inherit', fontSize: 12 }}>
                  {dayjs(visit.checkInAt).format('D MMM YYYY, HH:mm')}
                </Text>
                <div>
                  <Tag style={{ marginTop: 2 }}>{visit.visitNumber}</Tag>
                </div>
              </div>
            ))
          ) : (
            <Text type="secondary">No visits yet</Text>
          )}
        </Space>
      </Card>
    </Space>
  );
}
