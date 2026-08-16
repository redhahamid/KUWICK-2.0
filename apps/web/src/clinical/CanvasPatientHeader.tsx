import { ReactNode } from 'react';
import { Avatar, Button, Tooltip, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckOutlined,
  IdcardOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Patient } from '../core/types';
import { Visit } from './types';
import { AllergyQuickRecord } from './canvas/AllergyQuickRecord';
import { nonAllergyAlerts, usePatientAlerts } from './hooks/usePatientAlerts';

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
  /**
   * b1.5 FIX 2 — open the FULL patient profile. Its own clearly labelled
   * control, never a side effect of clicking an alert.
   */
  onOpenProfile?: () => void;
  /** b1.5 FIX 1 — open the alerts view, and nothing else. */
  onOpenAlerts?: () => void;
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
  onOpenAlerts,
}: CanvasPatientHeaderProps) {
  const onHoldNow = Boolean(heldByName);
  const { data: alerts } = usePatientAlerts(patient.id);
  // FIX 3 — the indicator counts NON-allergy alerts. Allergies have their own
  // chip beside it, and counting them twice would tell a doctor there are five
  // things to read when there are three.
  const otherAlerts = nonAllergyAlerts(alerts);
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

      {/* b1.5 FIX 2 — the identity block still opens the full profile, but it
          is no longer the ONLY way in and no longer shares a control with the
          alerts. The explicit "Patient details" button below is the labelled
          affordance; this stays because clicking a patient's name to see the
          patient is what everyone tries first. */}
      <button
        type="button"
        className="kw2-identity kw2-identity-button"
        onClick={onOpenProfile}
        disabled={!onOpenProfile}
        // Deliberately NOT "…patient details": the labelled button beside it
        // is called that, and two controls whose names end in the same two
        // words are two controls a screen-reader user cannot tell apart.
        aria-label={`Open ${patient.name}'s record`}
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
          className={`kw2-chip kw2-chip-alerts${otherAlerts.length > 0 ? ' kw2-chip-alerts-active' : ''}`}
          // FIX 1 — the ALERTS view, not the profile. Checking why a patient is
          // flagged must not land a doctor in an editable demographics form.
          onClick={onOpenAlerts}
          disabled={!onOpenAlerts}
          aria-label={
            otherAlerts.length > 0
              ? `${otherAlerts.length} active patient ${otherAlerts.length === 1 ? 'alert' : 'alerts'} — view`
              : 'No active patient alerts — view'
          }
          data-alert-count={otherAlerts.length}
        >
          <WarningOutlined />{' '}
          {otherAlerts.length > 0
            ? `${otherAlerts.length} alert${otherAlerts.length === 1 ? '' : 's'}`
            : 'No alerts'}
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

        {/* FIX 2 — an explicit, labelled way to the full record. The identity
            block opens the same thing, but a control a doctor has to guess at
            is one half of them never find. */}
        {/* An explicit label, so the accessible name is exactly "Patient
            details" — the icon would otherwise fold into it, and the identity
            block's own label ends in the same two words. */}
        <Button
          icon={<IdcardOutlined />}
          aria-label="Patient details"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
        >
          Patient details
        </Button>

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
