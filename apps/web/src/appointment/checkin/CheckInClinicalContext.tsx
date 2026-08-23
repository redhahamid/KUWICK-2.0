import { Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  allergyAlerts,
  nonAllergyAlerts,
  noKnownAllergyAlerts,
  usePatientAlerts,
} from '../../clinical/hooks/usePatientAlerts';
import { usePatientVisits } from '../../clinical/hooks/useVisits';
import { formatClinicDate } from '../../clinical/clinicTime';

const { Text } = Typography;

/**
 * FINAL CONVERGENCE — the check-in drawer's CLINICAL CONTEXT, read-only.
 *
 * The approved mockup draws "Allergies", "Important information", a
 * "Returning patient" chip and "Last visit" on the registration screen. The
 * audit that preceded this component answered the only question that
 * mattered: can those four be READ from canonical data that already exists,
 * without duplicating clinical facts into the demographic model? They can —
 *
 *   allergies / important information  GET /patients/:id/alerts, the b1.5
 *      alert store, split by its STORED type (never by reading labels) with
 *      the same helpers the clinical header uses;
 *   returning patient / last visit     GET /visits?patientId=, already
 *      ordered check-in descending.
 *
 * So this component READS. It writes nothing, copies nothing into the patient
 * record, and offers no editing: allergies are recorded by clinicians in the
 * clinical surfaces that own them, and a front desk registration screen is
 * not the place to acquire that authority. Where a fact is absent it says so
 * in words rather than rendering a confident blank — "nobody has recorded an
 * allergy" and "no known allergies, asked and answered" are different states
 * and the difference is the whole reason the alert store has both.
 */
export function useCheckInContext(patientId: string | undefined) {
  const { data: alerts } = usePatientAlerts(patientId);
  const { data: visits } = usePatientVisits(patientId);

  const allergies = allergyAlerts(alerts);
  const confirmedNone = noKnownAllergyAlerts(alerts);
  const important = nonAllergyAlerts(alerts);
  // Prior visits only — the appointment being registered has no visit yet, so
  // anything already on file happened before today's counter.
  // Array.isArray, not `?? []` — for the same reason the alert helpers guard:
  // the screen a patient is registered on is the LAST one that should blank
  // because a read came back in an unexpected shape.
  const previous = Array.isArray(visits) ? visits.filter((visit) => Boolean(visit?.checkInAt)) : [];
  const lastVisit = previous[0]?.checkInAt ?? null;

  return {
    allergies,
    confirmedNone,
    important,
    returning: previous.length > 0,
    visitCount: previous.length,
    lastVisit,
  };
}

export type CheckInContext = ReturnType<typeof useCheckInContext>;

/** The always-visible safety line in the identity rail. */
export function AllergyBadge({ context }: { context: CheckInContext }) {
  if (context.allergies.length > 0) {
    return (
      <Tooltip title={context.allergies.map((alert) => alert.label).join(', ')}>
        <span className="kw-checkin-allergy" data-tone="danger" data-testid="checkin-allergy">
          Allergy · {context.allergies.map((alert) => alert.label).join(', ')}
        </span>
      </Tooltip>
    );
  }
  if (context.confirmedNone.length > 0) {
    return (
      <span className="kw-checkin-allergy" data-tone="clear">
        No known allergies
      </span>
    );
  }
  // The honest third state: silence is not a negative.
  return (
    <span className="kw-checkin-allergy" data-tone="unknown">
      No allergy recorded
    </span>
  );
}

/** Returning / new, and when they were last here — recorded visits only. */
export function VisitHistoryLine({ context }: { context: CheckInContext }) {
  if (!context.returning) {
    return (
      <span className="kw-checkin-chip" data-tone="new" data-testid="checkin-visit-history">
        First recorded visit
      </span>
    );
  }
  return (
    <span className="kw-checkin-chip" data-tone="returning" data-testid="checkin-visit-history">
      Returning · {context.visitCount} visit{context.visitCount === 1 ? '' : 's'}
      {context.lastVisit ? ` · last ${formatClinicDate(context.lastVisit)}` : ''}
    </span>
  );
}

/** The Patient Details tab's read-only clinical band. */
export function ClinicalContextPanel({ context }: { context: CheckInContext }) {
  return (
    <div className="kw-checkin-clinical" data-testid="checkin-clinical-context">
      <div className="kw-checkin-clinical-row">
        <span className="kw-apt3-eyebrow">Allergies</span>
        {context.allergies.length > 0 ? (
          <div className="kw-checkin-clinical-values">
            {context.allergies.map((alert) => (
              <span key={alert.id} className="kw-checkin-allergy" data-tone="danger">
                {alert.label}
                {alert.note ? ` — ${alert.note}` : ''}
              </span>
            ))}
          </div>
        ) : context.confirmedNone.length > 0 ? (
          <Text type="secondary">No known allergies — asked and recorded.</Text>
        ) : (
          <Text type="secondary">Nothing recorded. Nobody has asked, or the answer is not on file.</Text>
        )}
      </div>

      <div className="kw-checkin-clinical-row">
        <span className="kw-apt3-eyebrow">Important information</span>
        {context.important.length > 0 ? (
          <div className="kw-checkin-clinical-values">
            {context.important.map((alert) => (
              <span key={alert.id} className="kw-checkin-chip" data-tone="info">
                {alert.label}
                {alert.note ? ` — ${alert.note}` : ''}
              </span>
            ))}
          </div>
        ) : (
          <Text type="secondary">Nothing on file.</Text>
        )}
      </div>

      {/* Said out loud so nobody mistakes a registration screen for the place
          clinical facts are recorded. */}
      <Text type="secondary" className="kw-checkin-clinical-note">
        Read-only — allergies and alerts are recorded by clinical staff on the patient&apos;s record.
      </Text>
    </div>
  );
}

/** Exported for the drawer's "how long ago" wording; clinic clock, not the laptop's. */
export function monthsSince(iso: string | null): number | null {
  return iso ? dayjs().diff(dayjs(iso), 'month') : null;
}
