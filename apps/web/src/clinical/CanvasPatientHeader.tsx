import { ReactNode } from 'react';
import { Avatar, Button, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';
import { AllergyQuickRecord } from './canvas/AllergyQuickRecord';
import { activeAlerts, usePatientAlerts } from './hooks/usePatientAlerts';

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
  /** KW2-C2 — pause the consultation and send the patient back to wait. */
  onHold?: () => void;
  /** Take a held patient back. Rendered in place of Hold while held. */
  onResume?: () => void;
  /** The doctor currently holding this patient, or null when not on hold. */
  heldByName?: string | null;
  /** True while either transition is in flight. */
  holdPending?: boolean;
  /** b1.5 PHASE D — open the patient profile slide-over. */
  onOpenProfile?: () => void;
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
  onHold,
  onResume,
  heldByName,
  holdPending,
  onOpenProfile,
}: CanvasPatientHeaderProps) {
  const onHoldNow = Boolean(heldByName);
  const { data: alerts } = usePatientAlerts(patient.id);
  const liveAlerts = activeAlerts(alerts);
  const age = patient.dob ? dayjs().diff(dayjs(patient.dob), 'year') : null;
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

      {/* b1.5 PHASE D — the identity block OPENS THE PROFILE.
          Everything about the person beyond a name, an age and an identifier
          had no home in the consult, so answering "what is their number?"
          meant leaving the record. A button rather than a click handler on a
          div: this is a real control and it must be reachable by keyboard. */}
      <button
        type="button"
        className="kw2-identity kw2-identity-button"
        onClick={onOpenProfile}
        disabled={!onOpenProfile}
        aria-label={`Open ${patient.name}'s profile`}
      >
        <div className="kw2-identity-name">
          <span className="kw2-name">{patient.name}</span>
          {/* KW2-C2 — a held patient is not "In Consult", and the pill is the
              one place a doctor glances to know where this visit stands. The
              mockup had no hold state to draw; leaving the pill claiming a
              consultation is in progress would be the deviation. */}
          <span
            className={`kw2-state-pill${
              visit.checkOutAt ? ' kw2-state-done' : onHoldNow ? ' kw2-state-held' : ''
            }`}
          >
            {visit.checkOutAt ? 'Completed' : onHoldNow ? `On hold · ${heldByName}` : 'In Consult'}
          </span>
        </div>
        <div className="kw2-identity-meta">
          {age !== null ? `${age}y` : '—'} · {patient.gender ?? '—'} · {patient.identifierValue}
        </div>
        {visit.presentingComplaint && (
          <div className="kw2-complaint">{visit.presentingComplaint}</div>
        )}
      </button>

      <div className="kw2-header-chips">
        {/* Allergies lead: the one item that changes what may safely be
            prescribed. "Not asked" is its own state and is amber, because an
            unasked question is not the same as a negative answer. A2: the
            chip is also where the answer gets RECORDED — see
            AllergyQuickRecord for the rules it keeps. */}
        <AllergyQuickRecord patient={patient} />

        {/* b1.5 PHASE D — the alert indicator.
            Present whether or not there are any, because "no alerts" is an
            answer a doctor needs as much as a list is — an indicator that only
            appears when something is wrong leaves its absence ambiguous
            between "nothing recorded" and "nobody looked". */}
        <button
          type="button"
          className={`kw2-chip kw2-chip-alerts${liveAlerts.length > 0 ? ' kw2-chip-alerts-active' : ''}`}
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
          aria-label={
            liveAlerts.length > 0
              ? `${liveAlerts.length} active patient ${liveAlerts.length === 1 ? 'alert' : 'alerts'}`
              : 'No active patient alerts'
          }
          data-alert-count={liveAlerts.length}
        >
          <WarningOutlined /> {liveAlerts.length > 0 ? `${liveAlerts.length} alert${liveAlerts.length === 1 ? '' : 's'}` : 'No alerts'}
        </button>

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
          KW2-C2 — HOLD, and the way back from it.

          One button in two states, never both at once. A "Hold" that stays
          live beside a held patient invites a second pause on a consultation
          that is already paused, and the way back is the thing a doctor
          actually needs from this position.

          Disabled with a reason where the page cannot offer it — a role that
          may not hold, or a visit with no queue ticket. A control the clinic
          has been shown says why it is unavailable rather than vanishing.
        */}
        {onHoldNow ? (
          <Tooltip title={`Paused by ${heldByName}. The record is exactly as it was left.`}>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={onResume}
              disabled={!onResume || holdPending}
              loading={holdPending}
              className="kw2-hold kw2-resume"
            >
              Resume
            </Button>
          </Tooltip>
        ) : (
          <Tooltip
            title={
              onHold
                ? 'Sends the patient back to the waiting queue. Nothing on this record changes.'
                : 'This visit is not in the queue, so there is nothing to send back.'
            }
          >
            <Button
              icon={<PauseCircleOutlined />}
              onClick={onHold}
              disabled={!onHold || holdPending}
              loading={holdPending}
              className="kw2-hold"
            >
              Hold
            </Button>
          </Tooltip>
        )}

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
