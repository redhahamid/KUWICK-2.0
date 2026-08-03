import { Avatar, Button, Space, Tag, Typography } from 'antd';
import { UserOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';
import { attendingClinician } from './attendingClinician';
import { formatClinicDateTime } from './clinicTime';

const { Text } = Typography;

interface CanvasPatientHeaderProps {
  patient: Patient;
  visit: Visit;
  onPatientSummary?: () => void;
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
export function CanvasPatientHeader({ patient, visit, onPatientSummary, layoutControl }: CanvasPatientHeaderProps) {
  const attending = attendingClinician(visit.staff?.fullName, visit.staff?.role);
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

      {/* D-077 — the visit's STORED attending relationship, labelled by the
          stored role. "DR Dr. Amira Rahman" doubled a title the clinic had
          already typed, and worse, it printed "DR" over a nurse. */}
      <span className="kw-context-item">
        {attending.prefix && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {attending.prefix}{' '}
          </Text>
        )}
        <Text strong={Boolean(attending.name)} italic={!attending.name} style={{ fontSize: 13 }}>
          {attending.name ?? 'Attending clinician not recorded'}
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
        {visit.visitNumber} · {formatClinicDateTime(visit.checkInAt)}
      </Text>

      {/* D-077 — Previous Visits is GONE from here. The Last Visit Snapshot
          immediately below carries "View History", and two controls opening
          the same drawer is two places to look for one thing. The freed space
          goes to Patient Summary, which nothing else offered on desktop. */}
      <Space size={6} className="kw-context-action">
        {layoutControl}
        {onPatientSummary && (
          <Button size="small" icon={<UserOutlined />} onClick={onPatientSummary}>
            Patient Summary
          </Button>
        )}
      </Space>
    </div>
  );
}
