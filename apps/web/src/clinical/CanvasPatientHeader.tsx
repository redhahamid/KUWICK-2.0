import { ReactNode } from 'react';
import { Avatar, Button, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckOutlined,
  PauseCircleOutlined,
  UserOutlined,
  WarningFilled,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';

const { Text } = Typography;

export interface CanvasPatientHeaderProps {
  patient: Patient;
  visit: Visit;
  /** The Canvas/Flow switch, folded into the band rather than given its own row. */
  layoutControl?: ReactNode;
  /** "Saved 16:41", or nothing before the first save. */
  autosaveLabel?: string;
  onBack?: () => void;
  onBookAppointment?: () => void;
  onCompleteConsultation?: () => void;
}

/**
 * Kuwick 2.0 — the patient header (spec p.2 and p.4).
 *
 * ONE FUNCTION, ONE HOME. The approved header drops "Documents" and
 * "Investigations" and the spec says why: both were duplicates. Documents
 * lives in the canvas card; task orders in Orders & Services ARE the
 * investigations. What is left is three buttons that exist nowhere else —
 * book a follow-up, park the consult, close the visit.
 *
 * "Patient Summary" went with them. It opened a drawer of the same identity
 * and history this band and the visits rail now carry between them.
 *
 * The band stays a single wrapping row. Two stacked toolbars is what the
 * reference CMS did, and it cost the note ~90px of height at the viewport
 * where height is scarcest.
 */
export function CanvasPatientHeader({
  patient,
  visit,
  layoutControl,
  autosaveLabel,
  onBack,
  onBookAppointment,
  onCompleteConsultation,
}: CanvasPatientHeaderProps) {
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
  const allergies = patient.allergies ?? [];
  const hasAllergies = allergies.length > 0;
  const allergyRecorded = patient.allergies !== null && patient.allergies !== undefined;
  const panelName = visit.panelClinic?.name ?? null;
  const initials = patient.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="kw2-patient-header">
      {onBack && (
        <button type="button" className="kw2-back" onClick={onBack} aria-label="Back">
          <ArrowLeftOutlined />
        </button>
      )}

      <Avatar size={38} className="kw2-avatar">
        {initials || <UserOutlined />}
      </Avatar>

      <div className="kw2-identity">
        <div className="kw2-identity-name">
          <span className="kw2-name">{patient.name}</span>
          <span className={`kw2-state-pill${visit.checkOutAt ? ' kw2-state-done' : ''}`}>
            {visit.checkOutAt ? 'Completed' : 'In Consult'}
          </span>
        </div>
        <div className="kw2-identity-meta">
          {age !== null ? `${age}y` : '—'} · {patient.gender ?? '—'} · {patient.identifierValue}
        </div>
        {visit.presentingComplaint && (
          <div className="kw2-complaint">{visit.presentingComplaint}</div>
        )}
      </div>

      <div className="kw2-header-chips">
        {/* Allergies lead: the one item that changes what may safely be
            prescribed. "Not asked" is its own state and is amber, because an
            unasked question is not the same as a negative answer. */}
        {hasAllergies ? (
          <span className="kw2-chip kw2-chip-danger">
            <WarningFilled /> {allergies.join(', ')}
          </span>
        ) : allergyRecorded ? (
          <span className="kw2-chip">+ No known allergy</span>
        ) : (
          <span className="kw2-chip kw2-chip-warn">! Allergy not asked</span>
        )}

        <span className="kw2-chip kw2-chip-payer">{panelName ? `Panel · ${panelName}` : 'CASH'}</span>

        {autosaveLabel && (
          <span className="kw2-autosave" role="status">
            Autosave ✓ {autosaveLabel}
          </span>
        )}
      </div>

      <div className="kw2-header-actions">
        {layoutControl}

        <Button icon={<CalendarOutlined />} onClick={onBookAppointment} disabled={!onBookAppointment}>
          Appointment
        </Button>

        {/*
          HOLD IS DISABLED, AND SAYS SO.

          The approved header parks a consult: the patient returns to the
          queue and the visit's state is kept. Nothing behind this exists yet
          — there is no transition back from IN_CONSULTATION to WAITING, and
          no workflow event for it, so honouring the button would mean
          inventing a queue state change with no audit trail behind it.

          Rendered disabled with the reason rather than omitted: the clinic
          has been shown this control, and a button that silently does nothing
          is worse than one that says it is not ready.
        */}
        <Tooltip title="Parking a consult needs the queue transition that is not built yet.">
          <Button icon={<PauseCircleOutlined />} disabled className="kw2-hold">
            Hold
          </Button>
        </Tooltip>

        <Button
          type="primary"
          icon={<CheckOutlined />}
          onClick={onCompleteConsultation}
          disabled={!onCompleteConsultation}
          className="kw2-complete"
        >
          Complete Consultation
        </Button>
      </div>
    </div>
  );
}

/** Exported for the header's own tests. */
export function headerAllergyState(patient: Pick<Patient, 'allergies'>): 'NONE_RECORDED' | 'NONE_KNOWN' | 'PRESENT' {
  if (patient.allergies === null || patient.allergies === undefined) return 'NONE_RECORDED';
  return patient.allergies.length > 0 ? 'PRESENT' : 'NONE_KNOWN';
}

export { Text };
