import { Button, Skeleton, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useVisitHistory } from '../history/useVisitHistory';
import { Visit, VisitHistorySummary } from '../types';

const { Text } = Typography;

/**
 * Kuwick 2.0 Canvas — the visits rail (spec p.2, principle "history is always
 * on screen").
 *
 * Previous visits used to live behind a drawer, which meant the answer to
 * "what did we do last time?" cost a click, a read and a dismissal — during a
 * consultation, with the patient waiting. Here they sit beside the note for
 * the whole visit.
 *
 * IT READS AND ONLY READS. It reuses `useVisitHistory`, the query layer built
 * for the read-only history (D-067), which has no mutation hook in it and
 * whose cache keys are namespaced away from the live visit's. Nothing in this
 * column can alter the consultation in progress, switch the record under an
 * open editor, or refresh the doctor's draft out from under them.
 */
export interface CanvasVisitsRailProps {
  patientId: string;
  currentVisit: Visit;
  /** Opens the full read-only history surface. */
  onOpenHistory: () => void;
}

/** Past visits shown before the rail starts scrolling (spec: 4 visible). */
export const VISIBLE_PAST_VISITS = 4;

/** "4 Aug · 02:18" — enough to place a visit without a full date. */
export function visitStamp(iso: string, today = dayjs()): string {
  const at = dayjs(iso);
  const day = at.isSame(today, 'day') ? 'Today' : at.format('D MMM');
  return `${day} · ${at.format('HH:mm')}`;
}

/** The one-line Rx summary the spec puts on each past card. */
export function medicationSummary(visit: VisitHistorySummary, max = 2): string {
  const names = visit.medications.map((m) => m.name).filter(Boolean);
  if (names.length === 0) return '—';
  const shown = names.slice(0, max).join(' · ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** "Acute tonsillitis (J03.9)", or the honest absence. */
export function diagnosisSummary(visit: VisitHistorySummary): string {
  const primary = visit.primaryDiagnosis;
  if (!primary) return '— not recorded';
  const code = primary.icd10Code ? ` (${primary.icd10Code})` : '';
  const more = visit.diagnosisCount > 1 ? ` +${visit.diagnosisCount - 1}` : '';
  return `${primary.name}${code}${more}`;
}

export function CanvasVisitsRail({ patientId, currentVisit, onOpenHistory }: CanvasVisitsRailProps) {
  const { data, isLoading } = useVisitHistory(patientId);

  const past = (data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((visit) => visit.id !== currentVisit.id);
  const total = past.length + 1;

  return (
    <div className="kw2-visits">
      <div className="kw2-visits-head">
        <span className="kw2-micro">Visits</span>
        <Text className="kw2-muted" style={{ fontSize: 12 }}>
          {isLoading ? '' : `${total} total`}
        </Text>
      </div>

      {/* TODAY — the visit being documented. Navy, and not a link: this is
          where the doctor already is. */}
      <div className="kw2-visit-today" data-testid="canvas-visit-today">
        <div className="kw2-visit-row">
          <span>{visitStamp(currentVisit.checkInAt)}</span>
          <span className="kw2-visit-no">{currentVisit.visitNumber}</span>
        </div>
        <Tag className="kw2-visit-state">{currentVisit.checkOutAt ? 'COMPLETED' : 'IN CONSULT'}</Tag>
        {currentVisit.presentingComplaint && (
          <div className="kw2-visit-line">{currentVisit.presentingComplaint}</div>
        )}
      </div>

      {isLoading && <Skeleton active paragraph={{ rows: 4 }} title={false} />}

      {!isLoading && past.length === 0 && (
        // Spec p.3 — a first visit is a state, not an error, and it says what
        // happens next rather than leaving a blank column.
        <div className="kw2-empty" data-testid="canvas-visits-empty">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>First visit</div>
          No previous records. History builds automatically after this consultation.
        </div>
      )}

      {past.slice(0, VISIBLE_PAST_VISITS).map((visit) => (
        <div className="kw2-visit-past" key={visit.id} data-testid="canvas-visit-past">
          <div className="kw2-visit-row">
            <span>{visitStamp(visit.checkInAt)}</span>
            <span className="kw2-visit-no">{visit.visitNumber}</span>
          </div>
          <div className="kw2-visit-line">
            <span className="kw2-micro">Dx</span> {diagnosisSummary(visit)}
          </div>
          <div className="kw2-visit-line">
            <span className="kw2-micro">Rx</span> {medicationSummary(visit)}
          </div>
        </div>
      ))}

      {past.length > 0 && (
        <Button size="small" type="link" onClick={onOpenHistory} style={{ padding: 0 }}>
          {past.length > VISIBLE_PAST_VISITS
            ? `View all ${past.length} previous visits`
            : 'Open full history'}
        </Button>
      )}
    </div>
  );
}
