import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { allergyAlerts, noKnownAllergyAlerts, usePatientAlerts } from './hooks/usePatientAlerts';
import { Patient } from '../core/types';
import { Visit } from './types';

const { Text } = Typography;

interface PatientSummarySidebarProps {
  patient: Patient;
  visits: Visit[] | undefined;
  selectedVisitId: string | undefined;
  // G4 (D-067) — reviewing history, NOT switching to it. This used to be
  // `onSelectVisit`, which replaced the visit under the open editor.
  onReviewHistory: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onNewVisit: () => void;
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
  onReviewHistory,
  expanded,
  onToggleExpand,
  onNewVisit,
}: PatientSummarySidebarProps) {
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const lastVisit = visits?.[0];
  // Alerts, not the retired free-text column. Same card, same red tags — what
  // changed underneath is that every one of these words now has an author.
  const { data: alerts } = usePatientAlerts(patient.id);
  const allergies = allergyAlerts(alerts).map((alert) => alert.label);
  const askedAndNoneKnown = noKnownAllergyAlerts(alerts).length > 0;

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
        {allergies.length > 0 ? (
          <Space wrap>
            {allergies.map((allergy) => (
              <Tag color="red" key={allergy}>
                {allergy}
              </Tag>
            ))}
          </Space>
        ) : askedAndNoneKnown ? (
          // Green only for a CONFIRMED negative. "None recorded" used to cover
          // both this and nobody having asked, which reads as reassurance the
          // record cannot actually give.
          <Tag color="green">No known allergy</Tag>
        ) : (
          <Tag color="orange">Not asked</Tag>
        )}
      </Card>

      {/* G4 (D-067) — a timeline, not a switcher. These entries used to
          replace the current visit on click, which could swap the record
          under an open editor mid-consultation. They are now labels; the
          button below opens the read-only history. */}
      <Card
        size="small"
        title={<Space>Recent Visits <Tag>{visits?.length ?? 0}</Tag></Space>}
        extra={<Button size="small" icon={<PlusOutlined />} onClick={onNewVisit} />}
      >
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {visits && visits.length > 0 ? (
            visits.slice(0, 4).map((visit) => (
              <div
                key={visit.id}
                className="kw-visit-timeline-entry"
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: visit.id === selectedVisitId ? '#eef2ff' : '#fafafa',
                  borderLeft: visit.id === selectedVisitId ? '3px solid #4338ca' : '3px solid transparent',
                }}
              >
                <Text strong style={{ fontSize: 12 }}>
                  {dayjs(visit.checkInAt).format('D MMM YYYY, HH:mm')}
                </Text>
                <div>
                  <Space size={4} wrap>
                    <Tag style={{ marginTop: 2 }}>{visit.visitNumber}</Tag>
                    {visit.id === selectedVisitId && (
                      <Tag color="blue" style={{ marginTop: 2 }}>
                        Current visit
                      </Tag>
                    )}
                  </Space>
                </div>
              </div>
            ))
          ) : (
            <Text type="secondary">No visits yet</Text>
          )}
          <Button
            block
            icon={<HistoryOutlined />}
            onClick={onReviewHistory}
            style={{ minHeight: 44 }}
            disabled={!visits || visits.length === 0}
          >
            Previous Visits
          </Button>
        </Space>
      </Card>
    </Space>
  );
}
