import { Avatar, Button, Space, Tag, Typography } from 'antd';
import { HistoryOutlined, UserOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';

const { Text } = Typography;

interface CanvasPatientHeaderProps {
  patient: Patient;
  visit: Visit;
  onReviewHistory?: () => void;
  /** The Canvas/Flow switch, folded into the band rather than given its own row. */
  layoutControl?: React.ReactNode;
}

/**
 * G4.5a (D-071) — ONE context band, not a second header.
 *
 * The band carries what the doctor needs to know about *who* and *which
 * visit* before touching anything: identity, allergies, complaint, attending
 * doctor, branch, visit state, and — only for panel patients — the panel.
 * A "Cash" chip on every self-pay visit would be noise on the majority of
 * records, so it is not shown; the absence of a panel chip is the signal.
 *
 * Deliberately a single row that wraps, never two stacked toolbars: the
 * reference CMS used two bars and it cost the note ~90px of height at the
 * viewport where height is scarcest.
 */
export function CanvasPatientHeader({ patient, visit, onReviewHistory, layoutControl }: CanvasPatientHeaderProps) {
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const allergies = patient.allergies ?? [];
  const hasAllergies = allergies.length > 0;
  // The panel lives on the VISIT (D-065). Shown only when there is one.
  const panelName = visit.panelClinic?.name ?? (visit.panelClinicId ? visit.billingType : null);

  return (
    <div className="kw-context-band">
      <Space align="center" size={10} className="kw-context-identity">
        <Avatar size={36} icon={<UserOutlined />} />
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 14 }}>
            {patient.name}
          </Text>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {age !== null ? `${age}y` : '—'} · {patient.gender ?? '—'} · {patient.identifierType}{' '}
              {patient.identifierValue}
            </Text>
          </div>
        </div>
      </Space>

      {/* Allergies lead the chips: it is the one item that changes what the
          doctor may safely prescribe, so it is never a quiet grey label. */}
      {hasAllergies ? (
        <Tag color="red" icon={<WarningFilled />} className="kw-context-allergy">
          {allergies.join(', ')}
        </Tag>
      ) : (
        <Tag className="kw-context-allergy">No known allergy</Tag>
      )}

      {visit.presentingComplaint && (
        <span className="kw-context-item">
          <Text type="secondary" style={{ fontSize: 11 }}>
            COMPLAINT{' '}
          </Text>
          <Text strong style={{ fontSize: 12 }}>
            {visit.presentingComplaint}
          </Text>
        </span>
      )}

      <span className="kw-context-item">
        <Text type="secondary" style={{ fontSize: 11 }}>
          DR{' '}
        </Text>
        <Text strong style={{ fontSize: 12 }}>
          {visit.staff?.fullName ?? 'Not assigned'}
        </Text>
      </span>

      {visit.clinic?.name && (
        <Text className="kw-context-item" type="secondary" style={{ fontSize: 12 }}>
          {visit.clinic.name}
        </Text>
      )}

      {panelName && <Tag color="purple">Panel · {panelName}</Tag>}

      <Tag color={visit.checkOutAt ? 'default' : 'gold'}>{visit.checkOutAt ? 'Completed' : 'In Progress'}</Tag>

      <Text className="kw-context-item" type="secondary" style={{ fontSize: 11 }}>
        {visit.visitNumber} · {dayjs(visit.checkInAt).format('D MMM, HH:mm')}
      </Text>

      <Space size={6} className="kw-context-action">
        {layoutControl}
        {onReviewHistory && (
          <Button size="small" icon={<HistoryOutlined />} onClick={onReviewHistory}>
            Previous Visits
          </Button>
        )}
      </Space>
    </div>
  );
}
