import { Skeleton } from 'antd';
import { ClockCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { IconTile } from '../../design-system/components/IconTile';
import dayjs from 'dayjs';
import { useVisitHistory } from '../history/useVisitHistory';
import { useDiagnoses } from '../hooks/useDiagnoses';
import { usePrescriptions } from '../hooks/usePrescriptions';
import { useOrderServices } from '../hooks/useOrderServices';
import { Visit, VisitHistorySummary } from '../types';
import { CanvasVisitPreview } from './CanvasVisitPreview';
import { useHoverIntent } from './useHoverIntent';

/**
 * Kuwick 2.0 Canvas — the visits rail (spec p.2, "history is always on
 * screen").
 *
 * Previous visits used to live behind a drawer, so the answer to "what did we
 * do last time?" cost a click, a read and a dismissal — mid-consultation,
 * with the patient waiting. Here they sit beside the note for the whole
 * visit.
 *
 * IT READS AND ONLY READS. It reuses `useVisitHistory`, the query layer built
 * for the read-only history (D-067), which contains no mutation hook and
 * whose cache keys are namespaced away from the live visit's. Nothing in this
 * column can alter the consultation in progress, switch the record under an
 * open editor, or refresh the doctor's draft out from under them.
 */
export interface CanvasVisitsRailProps {
  patientId: string;
  currentVisit: Visit;
  /** Opens the full read-only history surface. */
  onOpenHistory: () => void;
  /** Opens one past visit, read-only. */
  onOpenVisit?: (visitId: string) => void;
  /** Starts a new visit for this patient. */
  onNewVisit?: () => void;
  /** Opens the Copy Rx review modal for one past visit. */
  onCopyRx?: (visit: { id: string; label: string }) => void;
}

/** Past visits shown before the rail scrolls (spec: 4 visible). */
export const VISIBLE_PAST_VISITS = 4;

/** "4 Aug · 02:18" — enough to place a visit without a full date. */
export function visitStamp(iso: string, today = dayjs()): string {
  const at = dayjs(iso);
  const day = at.isSame(today, 'day') ? 'Today' : at.format('D MMM');
  return `${day} · ${at.format('HH:mm')}`;
}

/** The one-line Rx summary the spec puts on each card. */
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

/**
 * "Dr UAT · Cash · W-012" — who, how they pay, which queue number.
 *
 * Every part is omitted rather than guessed when the visit does not carry it:
 * an unattended visit is a real state (D-082) and must not be filled in with
 * the registrar's name.
 */
export function attributionLine(parts: {
  clinician?: string | null;
  billingType?: string | null;
  queueType?: string | null;
  queueNumber?: string | number | null;
}): string {
  const out: string[] = [];
  if (parts.clinician) out.push(parts.clinician);
  if (parts.billingType) out.push(parts.billingType === 'SELF_PAY' ? 'Cash' : 'Panel');
  const letter = queueLetter(parts.queueType);
  if (letter && parts.queueNumber != null && parts.queueNumber !== '') {
    out.push(`${letter}-${parts.queueNumber}`);
  }
  return out.join(' · ');
}

/** "FBC ✓ completed", or nothing when the visit ordered none. */
export function orderSummary(orders: { procedureName?: string | null; status?: string | null }[] | undefined): string {
  if (!orders?.length) return '';
  const names = orders.map((o) => o.procedureName).filter(Boolean) as string[];
  if (names.length === 0) return '';
  const done = orders.every((o) => o.status === 'COMPLETED');
  const shown = names.slice(0, 2).join(' · ');
  const more = names.length > 2 ? ` +${names.length - 2}` : '';
  return `${shown}${more}${done ? ' ✓ completed' : ''}`;
}

/** Today's prescriptions as one line, same shape as a past visit's Rx. */
export function liveMedicationSummary(
  prescriptions: { item?: { name: string } | null }[] | undefined,
  max = 2,
): string {
  const names = (prescriptions ?? []).map((p) => p.item?.name).filter(Boolean) as string[];
  if (names.length === 0) return '—';
  const shown = names.slice(0, max).join(' · ');
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** Today's diagnoses as one line. */
export function liveDiagnosisSummary(
  diagnoses: { name: string; icd10Code: string | null; priority?: string | null }[] | undefined,
): string {
  if (!diagnoses?.length) return '— not set';
  const primary = diagnoses.find((d) => d.priority === 'PRIMARY') ?? diagnoses[0];
  const code = primary.icd10Code ? ` (${primary.icd10Code})` : '';
  const more = diagnoses.length > 1 ? ` +${diagnoses.length - 1}` : '';
  return `${primary.name}${code}${more}`;
}

/** The clinic's four-number system: OTC C, Emergency E, Walk-in W, Appt A. */
export function queueLetter(queueType: string | null | undefined): string | null {
  switch (queueType) {
    case 'OTC':
      return 'C';
    case 'EMERGENCY':
      return 'E';
    case 'WALK_IN':
      return 'W';
    case 'APPOINTMENT':
      return 'A';
    default:
      return null;
  }
}

export function CanvasVisitsRail({
  patientId,
  currentVisit,
  onOpenHistory,
  onOpenVisit,
  onNewVisit,
  onCopyRx,
}: CanvasVisitsRailProps) {
  const { data, isLoading } = useVisitHistory(patientId);
  // Today's card carries the same three facts the past cards do. These are the
  // LIVE visit's caches — already populated by the middle and right columns,
  // so no extra request — and every one of them is a read. Clinical notes are
  // deliberately not among them (C1/D-091).
  const { data: diagnoses } = useDiagnoses(currentVisit.id);
  const { data: prescriptions } = usePrescriptions(currentVisit.id);
  const { data: orders } = useOrderServices(currentVisit.id);
  // Spec p.2 — "hover any visit = note preview", after a deliberate pause.
  const hover = useHoverIntent();

  const past = (data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((visit) => visit.id !== currentVisit.id);
  const total = past.length + 1;

  return (
    <section className="kw2-card kw2-visits" aria-label="Visits">
      <header className="kw2-visits-head">
        <IconTile tone="indigo" size="sm">
          <ClockCircleOutlined />
        </IconTile>
        <h2 className="kw2-card-title">Visits</h2>
        {!isLoading && <span className="kw2-count-chip">{total} total</span>}
        <button
          type="button"
          className="kw2-icon-btn"
          onClick={onNewVisit}
          disabled={!onNewVisit}
          aria-label="New visit"
        >
          <PlusOutlined />
        </button>
      </header>

      {/* TODAY — the visit being documented. Navy, and not a link: this is
          where the doctor already is. */}
      <article className="kw2-visit-today" data-testid="canvas-visit-today">
        <div className="kw2-visit-row">
          <span className="kw2-visit-when">{visitStamp(currentVisit.checkInAt)}</span>
          <span className="kw2-visit-no">{currentVisit.visitNumber}</span>
        </div>
        <div className="kw2-visit-state">{currentVisit.checkOutAt ? 'COMPLETED' : 'IN CONSULT'}</div>
        <div className="kw2-visit-line">
          <span className="kw2-visit-key">Dx</span> {liveDiagnosisSummary(diagnoses)}
        </div>
        <div className="kw2-visit-line">
          <span className="kw2-visit-key">Rx</span> {liveMedicationSummary(prescriptions)}
        </div>
        {orderSummary(orders) && (
          <div className="kw2-visit-line">
            <span className="kw2-visit-key">Or</span> {orderSummary(orders)}
          </div>
        )}
        <div className="kw2-visit-attrib">
          {attributionLine({
            clinician: currentVisit.staff?.fullName ?? null,
            billingType: currentVisit.billingType,
            queueType: currentVisit.queueTicket?.queueType,
            queueNumber: currentVisit.queueTicket?.displayNumber,
          })}
        </div>
      </article>

      {isLoading && <Skeleton active paragraph={{ rows: 4 }} title={false} />}

      {!isLoading && past.length === 0 && (
        // Spec p.3 — a first visit is a state, not an error, and it says what
        // happens next rather than leaving a blank column.
        <div className="kw2-empty" data-testid="canvas-visits-empty">
          <strong>First visit</strong>
          <div>No previous records. History builds automatically after this consultation.</div>
        </div>
      )}

      {past.slice(0, VISIBLE_PAST_VISITS).map((visit) => (
        <article
          className="kw2-visit-past"
          key={visit.id}
          data-testid="canvas-visit-past"
          // Mouse and keyboard reach the same preview. `onFocus`/`onBlur`
          // bubble from the card's own buttons, so tabbing to "Open ▸" keeps
          // the panel that the card opened rather than closing it underneath
          // the doctor's hand.
          onMouseEnter={() => hover.open(visit.id)}
          onMouseLeave={hover.close}
          onFocus={() => hover.open(visit.id)}
          onBlur={hover.close}
        >
          {hover.activeId === visit.id && (
            <CanvasVisitPreview
              patientId={patientId}
              visitId={visit.id}
              label={visitStamp(visit.checkInAt)}
            />
          )}
          <div className="kw2-visit-row">
            <span className="kw2-visit-when">{visitStamp(visit.checkInAt)}</span>
            <span className="kw2-visit-no">{visit.visitNumber}</span>
          </div>
          <div className="kw2-visit-line">
            <span className="kw2-visit-key">Dx</span> {diagnosisSummary(visit)}
          </div>
          <div className="kw2-visit-line">
            <span className="kw2-visit-key">Rx</span> {medicationSummary(visit)}
          </div>
          <div className="kw2-visit-actions">
            <button type="button" className="kw2-link-btn" onClick={() => onOpenVisit?.(visit.id)}>
              Open ▸
            </button>
            {/* Copy Rx opens a REVIEW, never a copy. The spec is explicit
                that a prescription is never blind-copied, so this control and
                the modal that curates it shipped together. */}
            {onCopyRx && visit.medicationCount > 0 && (
              <button
                type="button"
                className="kw2-link-btn"
                onClick={() => onCopyRx({ id: visit.id, label: visitStamp(visit.checkInAt) })}
              >
                ⎘ Copy Rx
              </button>
            )}
          </div>
        </article>
      ))}

      {past.length > VISIBLE_PAST_VISITS && (
        <button type="button" className="kw2-link-btn" onClick={onOpenHistory}>
          View all {past.length} previous visits
        </button>
      )}

      <p className="kw2-visits-hint">hover any visit = note preview</p>
    </section>
  );
}
