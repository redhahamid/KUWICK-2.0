import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Skeleton, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  MedicineBoxOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { ApiError } from '../core/api-client';
import { useStaff } from '../hr/hooks/useStaff';
import { attendingClinician } from './attendingClinician';
import { formatClinicDateTime } from './clinicTime';
import { useCompleteDoctorPhase, useDoctorPhaseStatus } from './hooks/useDoctorPhase';
import {
  CanvasAnchor,
  DOCUMENTATION_PENDING_ACTION,
  DOCUMENTATION_PENDING_BODY,
  DOCUMENTATION_PENDING_TITLE,
  completedStation,
  completionConfirm,
  footerView,
  orderBlockers,
  queueStatusText,
  reviewActions,
  visitStandingText,
} from './doctorPhasePresentation';
import { DoctorPhaseBlockerCode, Visit } from './types';

const { Text } = Typography;

interface ConsultationFooterProps {
  visit: Visit;
  /** Moves the viewport to an existing Canvas section. Never opens a form. */
  onReview: (anchor: CanvasAnchor) => void;
}

/**
 * G4.5d3c-3a (D-089) — the Consultation Footer.
 *
 * The doctor's end of the consultation, and ONLY the doctor's end. There is
 * no "Complete Visit" here and there deliberately never will be: closing the
 * visit asserts that dispensing and billing are finished, which is counter
 * work under a different permission (D-087). A doctor pressing one button and
 * closing both phases is precisely the collapse D-086 refused.
 *
 * Every judgement on this bar is the SERVER'S. The footer does not count
 * prescriptions, read invoices, inspect order statuses or decide eligibility;
 * it renders `GET /visits/:id/doctor-phase-status` and calls the mutation,
 * which re-evaluates everything again inside its own transaction. A preview
 * that has gone stale produces a refusal with fresh blockers, not a wrong
 * write.
 *
 * It owns no clinical content. The note, the diagnoses, the prescriptions and
 * the orders all live above it and are never remounted, reseeded or refetched
 * by anything here — which is what keeps C1's unsaved-draft protection intact
 * through a completion.
 */
export function ConsultationFooter({ visit, onReview }: ConsultationFooterProps) {
  const status = useDoctorPhaseStatus(visit.id);
  const complete = useCompleteDoctorPhase(visit.id);
  const { data: staff } = useStaff();

  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lateBlockers, setLateBlockers] = useState<DoctorPhaseBlockerCode[] | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);
  // Focus goes back where the doctor left it; antd restores to the trigger
  // only while that trigger is still mounted, and this one disappears the
  // moment completion succeeds.
  const triggerRef = useRef<HTMLElement | null>(null);
  // The checkpoint's "Back to review" button, so focus can be put on it.
  const backRef = useRef<HTMLButtonElement | null>(null);

  const view = footerView({
    status: status.data,
    loading: status.isPending,
    failed: status.isError,
  });

  // A completed phase has nothing left to confirm. Closing the modal here
  // rather than leaving it to the click handler covers the case where another
  // station completed the phase while this dialog was open.
  useEffect(() => {
    if (view.mode === 'COMPLETED') setConfirming(false);
  }, [view.mode]);

  const submit = async () => {
    setFailure(null);
    setLateBlockers(null);
    try {
      const result = await complete.mutateAsync({});
      setConfirming(false);
      // D-086's idempotent branch: somebody already finished it. Said plainly,
      // then the stored state renders — no second mutation, no error styling
      // for something that is not an error.
      if (result.alreadyCompleted) setAlreadyDone(true);
    } catch (error) {
      setConfirming(false);
      const body = error instanceof ApiError ? (error.body as { blockers?: Array<{ code: string }> }) : null;
      if (body?.blockers?.length) {
        // The state moved between the preview and the write. The server's
        // fresh blockers replace the stale enabled button; nothing in the
        // Canvas is touched, so no unsaved word is lost to this.
        setLateBlockers(orderBlockers(body.blockers).map((b) => b.code));
        status.refetch();
        return;
      }
      // 400s carry the service's own staff-facing wording (D-086/D-088) and
      // are safe to show. Anything else — a 500, a network failure — may be a
      // driver or framework string, and no doctor reads those off this bar.
      setFailure(
        error instanceof ApiError && error.status === 400
          ? error.message
          : 'The consultation could not be completed.',
      );
    }
  };

  // ---- 1. LOADING --------------------------------------------------------
  // No action is rendered until eligibility is known. A button that appears
  // and then withdraws teaches a doctor to click before reading.
  if (view.mode === 'LOADING') {
    return (
      <section className="kw-consult-footer" aria-label="Consultation completion">
        <div className="kw-consult-status" role="status" aria-live="polite">
          <Text type="secondary" style={{ fontSize: 12 }}>
            Checking consultation status…
          </Text>
          <Skeleton.Button active size="small" style={{ width: 180 }} />
        </div>
      </section>
    );
  }

  // ---- 6. ERROR (the status read itself) ---------------------------------
  if (view.mode === 'UNAVAILABLE') {
    return (
      <section className="kw-consult-footer" aria-label="Consultation completion">
        <Alert
          type="warning"
          showIcon
          role="alert"
          message="Consultation status unavailable"
          description="The record is unaffected and nothing you have typed has been lost. Try again in a moment."
          action={
            <Button size="small" onClick={() => status.refetch()}>
              Retry
            </Button>
          }
        />
      </section>
    );
  }

  // ---- 5. DOCTOR PHASE COMPLETED -----------------------------------------
  if (view.mode === 'COMPLETED' && status.data) {
    const stored = status.data;
    const person = staff?.find((s) => s.id === stored.doctorCompletedByStaffId);
    const completedBy = person
      ? attendingClinician(person.fullName, person.role, person.id).text
      : 'Not recorded';
    const queueText = queueStatusText(stored.queueStatus);

    return (
      <section className="kw-consult-footer kw-consult-done" aria-label="Consultation completion">
        {alreadyDone && (
          <Alert
            type="info"
            showIcon
            role="status"
            style={{ marginBottom: 'var(--kw-s2)' }}
            message="Consultation was already completed."
          />
        )}
        <div className="kw-consult-summary" role="status">
          <div className="kw-consult-done-head">
            <CheckCircleOutlined aria-hidden style={{ color: 'var(--kw-teal)' }} />
            <Text strong>Doctor phase completed</Text>
          </div>
          <dl className="kw-consult-facts">
            <div>
              <dt>Completed by</dt>
              <dd>{completedBy}</dd>
            </div>
            <div>
              <dt>Completed at</dt>
              <dd>{formatClinicDateTime(stored.doctorCompletedAt) || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Next station</dt>
              <dd>
                {completedStation({
                  destination: stored.destination,
                  routingReason: stored.routingReason,
                })}
              </dd>
            </div>
            {queueText && (
              <div>
                <dt>Status</dt>
                <dd>
                  <Tag className="kw-chip-progress">{queueText}</Tag>
                </dd>
              </div>
            )}
            <div>
              <dt>Operational Visit status</dt>
              {/* checkOutAt is the ONLY thing that makes a visit complete, and
                  nothing on this bar can set it. Until it exists the visit is
                  open, whatever the doctor phase says. */}
              <dd>{visitStandingText(visit.checkOutAt)}</dd>
            </div>
          </dl>

          {/* Case D — the patient was sent on with documentation pending and
              the note is STILL unsigned. Amber, not red: nothing went wrong,
              and something is outstanding. It names the doctor and the time
              from the recorded workflow event rather than re-deriving them. */}
          {/* G4.5d6 — a QUIET line, not a banner.
              The note is no longer something the doctor must go back and
              sign: it autosaves while the visit is open and is finalized
              automatically when the visit is completed. So this stopped being
              an outstanding task and became a status, and it is sized like
              one. The full-width amber Alert that used to sit here dominated
              the Canvas for a condition nobody had to act on. */}
          {view.documentationPending && (
            <Text
              type="secondary"
              role="status"
              style={{ fontSize: 12, marginTop: 'var(--kw-s2)', display: 'block' }}
              data-documentation-pending="true"
            >
              Clinical note in progress — saved automatically, finalized when the visit is completed
              {stored.documentationPendingActorName && stored.documentationPendingAt
                ? ` · sent on by ${stored.documentationPendingActorName}`
                : ''}
            </Text>
          )}
        </div>
      </section>
    );
  }

  // ---- 3. ACTIVE BUT BLOCKED ---------------------------------------------
  // Including the case where the write refused after a stale preview: the
  // server's fresh codes take over the panel.
  const shownBlockers = lateBlockers
    ? orderBlockers(lateBlockers.map((code) => ({ code })))
    : view.blockers;

  if (view.mode === 'BLOCKED' || lateBlockers) {
    const reviews = reviewActions(shownBlockers);
    return (
      <section className="kw-consult-footer" aria-label="Consultation completion">
        <div className="kw-consult-blocked" role="alert" aria-live="assertive">
          <div className="kw-consult-blocked-head">
            <ExclamationCircleOutlined aria-hidden />
            <Text strong>
              {shownBlockers.length === 1
                ? 'Consultation cannot be completed yet'
                : `Consultation cannot be completed yet — ${shownBlockers.length} items outstanding`}
            </Text>
          </div>
          {/* All of them, together. Fixing four problems one refresh at a time
              is how a consultation room backs up. */}
          <ul className="kw-consult-blocker-list">
            {shownBlockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
          {reviews.length > 0 && (
            <Space size={6} wrap className="kw-consult-reviews">
              {reviews.map((action) => (
                <Button key={action.anchor} size="small" onClick={() => onReview(action.anchor)}>
                  {action.label}
                </Button>
              ))}
            </Space>
          )}
        </div>
      </section>
    );
  }

  // ---- 2. ACTIVE AND ELIGIBLE (Cases A and B) / 4. SUBMITTING -------------
  const primary = view.primary;
  if (!primary) return null;

  // Case B differs from Case A in exactly three places: an amber panel, an
  // amber chip in place of the green one, and a different confirmation
  // question. The ACTION is identical and is never withheld — that is the
  // whole point of the state.
  const pending = view.documentationPending;
  const confirm = completionConfirm({
    primary,
    documentationPending: pending,
    unreviewedCopies: view.unreviewedCopies,
    allergyCheckpoint: view.allergyCheckpoint,
  });

  return (
    <section
      className="kw-consult-footer"
      aria-label="Consultation completion"
      data-documentation-pending={pending ? 'true' : 'false'}
    >
      {failure && (
        <Alert
          type="error"
          showIcon
          role="alert"
          closable
          style={{ marginBottom: 'var(--kw-s2)' }}
          message="Consultation not completed"
          description={`${failure} Nothing on this record has been changed.`}
          onClose={() => setFailure(null)}
        />
      )}

      {/* Case B — AMBER, and worded as a consequence rather than a refusal.
          It sits above the bar so it is read before the button, and it offers
          the way to resolve it without taking the way past it away. */}
      {pending && (
        <Alert
          type="warning"
          showIcon
          role="status"
          style={{ marginBottom: 'var(--kw-s2)' }}
          message={DOCUMENTATION_PENDING_TITLE}
          description={DOCUMENTATION_PENDING_BODY}
          action={
            <Button size="small" onClick={() => onReview(DOCUMENTATION_PENDING_ACTION.anchor)}>
              {DOCUMENTATION_PENDING_ACTION.label}
            </Button>
          }
        />
      )}

      <div className="kw-consult-bar">
        <div className="kw-consult-summary">
          <Space size={6} wrap>
            {/* Status only. Signing happens in the Clinical Note section and
                nowhere else — the footer never grows a second signing path. */}
            {pending ? (
              <Tag className="kw-chip-pending">Clinical note not signed</Tag>
            ) : (
              <Tag className="kw-chip-success">Clinical note signed</Tag>
            )}
            <Tag className="kw-chip-neutral" icon={iconFor(primary.reason)}>
              {primary.station}
            </Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {primary.supporting}
          </Text>
        </div>
        <div className="kw-consult-primary">
          <Button
            type="primary"
            size="large"
            loading={complete.isPending}
            disabled={complete.isPending}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setConfirming(true);
            }}
          >
            {primary.label}
          </Button>
        </div>
      </div>

      {/* One compact confirmation. The doctor confirms the ACT, never chooses
          the destination — that is derived and is not offered as a choice.
          With documentation pending it asks a different question, because it
          is asking them to assert something more. */}
      <Modal
        open={confirming}
        // The modal portals outside .kw-canvas-shell, so the navy primary is
        // scoped to it by this class — the confirm button must not fall back
        // to antd's default blue in a workspace that uses navy everywhere.
        rootClassName="kw-consult-confirm"
        title={confirm.title}
        // KW2-C2 — "Complete anyway" where copied medications are unreviewed.
        // The same button, relabelled to say what is being accepted: the
        // owner's requirement is a conscious click, not a withheld action.
        okText={confirm.okText}
        cancelText={confirm.cancelText}
        // KW2-C2 — on a SAFETY CHECKPOINT the default focus goes to the
        // button that does NOTHING. antd focuses the dialog and then the
        // primary; a reflex Enter on a dialog the doctor has not read yet
        // would complete the visit past the warning it exists to show.
        //
        // `autoFocus` on the button is not enough — the Modal's own focus
        // management runs after mount and takes it back. This runs after
        // that, which is the whole point of afterOpenChange.
        afterOpenChange={(isOpen) => {
          if (isOpen && confirm.checkpoint) backRef.current?.focus();
        }}
        footer={
          <Space>
            <Button ref={backRef} onClick={() => setConfirming(false)}>
              {confirm.cancelText}
            </Button>
            <Button type="primary" loading={complete.isPending} onClick={submit}>
              {confirm.okText}
            </Button>
          </Space>
        }
        confirmLoading={complete.isPending}
        // Cancelling performs no write of any kind.
        onCancel={() => setConfirming(false)}
        onOk={submit}
        afterClose={() => triggerRef.current?.focus()}
        destroyOnHidden
      >
        {/* KW2-C2 — the ALLERGY section, first because it is the one that
            can hurt somebody. Amber, and it names BOTH lists: the doctor is
            being asked to confirm a comparison, and a dialog that names
            neither side is a box to tick rather than a thing to read.

            It states plainly what Kuwick did NOT do. Silence there would let
            the dialog imply a check ran and passed. */}
        {confirm.allergy && (
          <Alert
            type="warning"
            showIcon
            role="status"
            style={{ marginBottom: 'var(--kw-s2)' }}
            data-allergy-checkpoint="true"
            message={confirm.allergy.heading}
            description={
              <div>
                <div className="kw-checkpoint-line">
                  <span className="kw-checkpoint-label">Allergies</span>
                  <strong>{confirm.allergy.allergies.join(', ')}</strong>
                </div>
                <div className="kw-checkpoint-line">
                  <span className="kw-checkpoint-label">Prescribed</span>
                  <strong>{confirm.allergy.prescribedMedications.join(', ')}</strong>
                </div>
                <div style={{ marginTop: 6 }}>{confirm.allergy.confirm}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {confirm.allergy.limitation}
                </Text>
              </div>
            }
          />
        )}

        {/* Amber, and above the summary so it is read first. Never red and
            never blocking: this is not an interaction check and nothing here
            knows whether the medicine is wrong — only that nobody looked. */}
        {confirm.warning && (
          <Alert
            type="warning"
            showIcon
            role="status"
            style={{ marginBottom: 'var(--kw-s2)' }}
            data-unreviewed-copies="true"
            message={confirm.warning.line}
            description={confirm.warning.explanation}
          />
        )}
        <Text>{confirm.summary}</Text>
      </Modal>
    </section>
  );
}

function iconFor(reason: string) {
  if (reason === 'DISPENSARY_REQUIRED') return <MedicineBoxOutlined aria-hidden />;
  if (reason === 'NO_DOWNSTREAM_WORK') return <CheckCircleOutlined aria-hidden />;
  return <WalletOutlined aria-hidden />;
}
