import { useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { AdminNotice } from '../components/AdminShell';
import { Panel, EmptyState } from '../components/Panel';
import { StatusChip } from '../components/Chip';
import { useAcknowledgeExceptions, useOverrideException, usePayrollExceptions } from '../hooks/useAdmin';
import type { PayrollExceptionRow } from '../types';

/**
 * THE REVIEW, IN THREE PARTS (UAT, 6 October 2026: "cluttered").
 *
 *   Needs action      — blockers, and warnings nobody has acknowledged.
 *   For information   — notes that ask nothing: lines carried from last
 *                       month, a part month, a rest day that varies.
 *   Done (collapsed)  — what somebody acknowledged, with who, when and why.
 *
 * Each card is one KIND of thing — "EPF on the employer-selected basis",
 * "Missing clock-in or clock-out" — with the people it applies to, not one
 * card per person: five staff on basic-salary EPF is one decision, and a
 * policy decision is acknowledged once, "for 2026", with one button. The
 * card says a few words; the cause, the consequence and the remedy for each
 * person are behind Details.
 *
 * ONE COUNT. The header, the footer and the grid's "to check" count the same
 * rows: what needs action. An acknowledged warning is done, wherever it was
 * acknowledged and however often the month was worked out since — the server
 * keeps the acknowledgement on a recalculated row that says the same thing.
 */

export type ReviewSection = 'action' | 'info' | 'done';

/** Which part of the review a row belongs to. */
export function sectionOf(row: Pick<PayrollExceptionRow, 'severity' | 'overriddenBy' | 'code'>): ReviewSection {
  // EPF_BASIS_ACKNOWLEDGED: rows written before acknowledgements were kept on
  // the warning itself; they say "acknowledged for the year" in their words.
  if (row.overriddenBy || row.code === 'EPF_BASIS_ACKNOWLEDGED') return 'done';
  if (row.severity === 'INFO') return 'info';
  return 'action';
}

export interface ReviewGroup {
  /** The section and the kind: one card. */
  key: string;
  code: string;
  title: string;
  section: ReviewSection;
  blocking: boolean;
  policy: boolean;
  rows: PayrollExceptionRow[];
}

/** The rows as cards: one per section and kind, in the order the server listed them (blockers first). */
export function groupReview(rows: PayrollExceptionRow[]): {
  action: ReviewGroup[];
  info: ReviewGroup[];
  done: ReviewGroup[];
  /** Rows needing action — the one count every surface states. */
  needAction: number;
  /** Of those, the ones that block approval. */
  blocking: number;
} {
  const groups = new Map<string, ReviewGroup>();
  for (const row of rows) {
    const section = sectionOf(row);
    const title = row.title || row.code;
    const blocking = section === 'action' && row.severity === 'BLOCKING';
    const key = `${section}|${title}|${blocking ? 'b' : ''}`;
    const group = groups.get(key) ?? { key, code: row.code, title, section, blocking, policy: Boolean(row.policy), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const all = [...groups.values()];
  const action = all.filter((g) => g.section === 'action');
  return {
    action,
    info: all.filter((g) => g.section === 'info'),
    done: all.filter((g) => g.section === 'done'),
    needAction: action.reduce((n, g) => n + g.rows.length, 0),
    blocking: action.filter((g) => g.blocking).reduce((n, g) => n + g.rows.length, 0),
  };
}

/** "Puteri Balqis", or "3 staff: A, B, C", or "5 staff: A, B, C and 2 more". */
function whoOf(rows: PayrollExceptionRow[]): string | null {
  const names = rows.map((row) => row.staffName).filter((name): name is string => Boolean(name));
  if (names.length === 0) return null;
  if (rows.length === 1) return names[0];
  const shown = names.slice(0, 3).join(', ');
  return `${rows.length} staff: ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
}

const day = (iso: string | null) => (iso ? dayjs(iso).format('D MMM YYYY') : null);

/** Who acknowledged it, when and why — the same words however it was acknowledged. */
function acknowledgement(row: PayrollExceptionRow, year: string | null): string | null {
  if (!row.overriddenBy) return null;
  const when = day(row.overriddenAt);
  return `Acknowledged${row.policy && year ? ` for ${year}` : ''} by ${row.overriddenBy}${when ? ` on ${when}` : ''}${
    row.overrideReason ? `: “${row.overrideReason}”` : ''
  }`;
}

export interface CarriedLines {
  /** "September 2026". */
  from: string;
  lines: { name: string; label: string; amount: string }[];
}

export function PayrollExceptionCentre({
  runId,
  canOverride,
  onFixInputs,
  carried,
}: {
  runId: string;
  canOverride: boolean;
  /**
   * Open this run's payroll inputs FOR ONE PERSON. The remedy for a missing
   * PCB is a keystroke on the screen the reader is already on.
   */
  onFixInputs?: (staffId: string, staffName: string | null) => void;
  /**
   * Lines still carrying last month's amount, read live from the month's
   * items: the For information card for them, in place of a row per person.
   */
  carried?: CarriedLines;
}) {
  const { message } = App.useApp();
  const query = usePayrollExceptions(runId);
  const override = useOverrideException();
  const acknowledgeAll = useAcknowledgeExceptions();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showDone, setShowDone] = useState(false);
  /** A single row, or a policy group acknowledged for the year. */
  const [target, setTarget] = useState<{ row?: PayrollExceptionRow; group?: ReviewGroup } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = query.data;
  if (!data) return null;
  const year = data.period ? data.period.slice(0, 4) : null;
  // The carried lines come from the month's items; their per-person rows would say it twice.
  const rows = carried ? data.exceptions.filter((row) => row.code !== 'CARRIED_FORWARD_UNCHECKED') : data.exceptions;
  const review = groupReview(rows);
  const toggle = (key: string) => setOpen((was) => ({ ...was, [key]: !was[key] }));

  /** What a person can do about ONE row: enter it, acknowledge it, fix it, or look at it. */
  const rowAction = (row: PayrollExceptionRow) => {
    if (row.code === 'PCB_MISSING' && row.staffId && onFixInputs) {
      return (
        <Button size="small" type="primary" ghost onClick={() => onFixInputs(row.staffId!, row.staffName)}>
          Enter it now
        </Button>
      );
    }
    if (row.overridable && !row.overriddenBy && canOverride && !row.policy) {
      return (
        <Button size="small" onClick={() => openModal({ row })}>
          Acknowledge
        </Button>
      );
    }
    if (!row.deepLink) return null;
    const blocking = row.severity === 'BLOCKING' && !row.overriddenBy;
    return (
      <Link to={row.deepLink}>
        <Button size="small" type={blocking ? 'primary' : 'default'}>
          {blocking ? 'Fix' : 'View'}
        </Button>
      </Link>
    );
  };

  /** The card's own action: one button for a policy decision, or the single row's. */
  const groupAction = (group: ReviewGroup) => {
    const pending = group.rows.filter((row) => row.overridable && !row.overriddenBy);
    if (group.policy && pending.length > 0 && canOverride) {
      return (
        <Button size="small" type="primary" onClick={() => openModal({ group })}>
          Acknowledge for {year ?? 'the year'}
        </Button>
      );
    }
    return group.rows.length === 1 ? rowAction(group.rows[0]) : null;
  };

  const openModal = (next: { row?: PayrollExceptionRow; group?: ReviewGroup }) => {
    setTarget(next);
    setReason('');
    setError(null);
  };

  const card = (group: ReviewGroup) => {
    const isOpen = Boolean(open[group.key]);
    const who = whoOf(group.rows);
    // One acknowledgement line on the card when everybody's says the same.
    const lines = [...new Set(group.rows.map((row) => acknowledgement(row, year)).filter((line): line is string => Boolean(line)))];
    return (
      <div
        key={group.key}
        className={`kw-attention kw-reviewCard${group.blocking ? ' kw-attention--blocking' : ''}${group.section !== 'action' ? ' kw-attention--info' : ''}`}
        data-testid={`review-card-${group.code}`}
      >
        <div className="kw-attention__body">
          <div className="kw-attention__what">
            {group.title}
            {who ? <span className="kw-reviewCard__who"> · {who}</span> : null}
          </div>
          {lines.length === 1 ? <div className="kw-attention__overridden">{lines[0]}</div> : null}
          <button type="button" className="kw-reviewCard__toggle" aria-expanded={isOpen} onClick={() => toggle(group.key)}>
            {isOpen ? 'Hide details' : 'Details'}
          </button>
          {isOpen ? (
            <div className="kw-reviewCard__details">
              {group.rows.map((row) => (
                <div key={row.id} className="kw-reviewCard__row">
                  <div className="kw-reviewCard__rowText">
                    <div className="kw-attention__what">
                      {row.staffName ? `${row.staffName} — ` : ''}
                      {row.cause}
                    </div>
                    <div className="kw-attention__why">{row.consequence}</div>
                    <div className="kw-attention__todo">
                      <strong>What to do:</strong> {row.remediation}
                    </div>
                    {lines.length > 1 && acknowledgement(row, year) ? <div className="kw-attention__overridden">{acknowledgement(row, year)}</div> : null}
                  </div>
                  {group.rows.length > 1 ? <div className="kw-attention__action">{rowAction(row)}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="kw-attention__action">{groupAction(group)}</div>
      </div>
    );
  };

  const carriedCard =
    carried && carried.lines.length > 0 ? (
      <div className="kw-attention kw-reviewCard kw-attention--info" data-testid="carried-unchecked">
        <div className="kw-attention__body">
          <div className="kw-attention__what">
            {carried.lines.length} {carried.lines.length === 1 ? 'line' : 'lines'} carried from {carried.from}{' '}
            {carried.lines.length === 1 ? 'has' : 'have'} not been edited or cleared.
          </div>
          <button
            type="button"
            className="kw-reviewCard__toggle"
            aria-expanded={Boolean(open.carried)}
            onClick={() => toggle('carried')}
          >
            {open.carried ? 'Hide details' : 'Details'}
          </button>
          {open.carried ? (
            <div className="kw-reviewCard__details">
              <div className="kw-attention__why">
                {carried.lines.length === 1 ? 'It' : 'They'} will be paid at last month’s amount:{' '}
                {carried.lines.map((line) => `${line.name}, ${line.label} ${line.amount}`).join('; ')}.
              </div>
              <div className="kw-attention__todo">
                <strong>What to do:</strong> change or clear any that should not repeat on the grid, or leave them as they are.
              </div>
            </div>
          ) : null}
        </div>
        <div className="kw-attention__action" />
      </div>
    ) : null;
  const infoCount = review.info.reduce((n, g) => n + g.rows.length, 0) + (carriedCard ? carried!.lines.length : 0);
  const doneCount = review.done.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <Panel
        title={review.needAction > 0 ? `${review.needAction} need${review.needAction === 1 ? 's' : ''} action` : 'Needs action'}
        tone={review.blocking > 0 ? 'blocked' : review.needAction > 0 ? 'attention' : 'ok'}
        action={
          review.needAction === 0 ? (
            <StatusChip tone="ok" dot>
              Nothing needs action
            </StatusChip>
          ) : null
        }
      >
        {review.action.length === 0 ? (
          <EmptyState title="Nothing needs action" />
        ) : (
          <div className="kw-exceptionCentre">{review.action.map(card)}</div>
        )}
      </Panel>

      {infoCount > 0 ? (
        <Panel title={`For information · ${infoCount}`}>
          <div className="kw-exceptionCentre">
            {carriedCard}
            {review.info.map(card)}
          </div>
        </Panel>
      ) : null}

      {doneCount > 0 ? (
        <Panel
          title={`Done · ${doneCount}`}
          action={
            <button type="button" className="kw-reviewCard__toggle" aria-expanded={showDone} onClick={() => setShowDone((was) => !was)}>
              {showDone ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showDone ? (
            <div className="kw-exceptionCentre">{review.done.map(card)}</div>
          ) : (
            <div className="kw-reviewCard__collapsed">Acknowledged with a reason on the record.</div>
          )}
        </Panel>
      ) : null}

      {/* The same count as the header, from the same rows. */}
      <AdminNotice tone={review.blocking > 0 ? 'warn' : 'info'}>
        <span data-testid="review-count">
          {review.needAction === 0
            ? 'Nothing needs action.'
            : `${review.needAction} need${review.needAction === 1 ? 's' : ''} action. ${
                review.blocking > 0
                  ? `${review.blocking} of them ${review.blocking === 1 ? 'blocks' : 'block'} approval.`
                  : 'None of them blocks approval.'
              }`}
        </span>
      </AdminNotice>

      <Modal
        open={Boolean(target)}
        title={target?.group ? `Acknowledge for ${year ?? 'the year'}` : 'Acknowledge this warning'}
        okText={target?.group ? 'Acknowledge' : 'Record and pass'}
        confirmLoading={override.isPending || acknowledgeAll.isPending}
        onCancel={() => setTarget(null)}
        onOk={async () => {
          setError(null);
          if (reason.trim().length < 5) {
            setError('Say why this is being passed. It becomes part of the payroll record.');
            return;
          }
          try {
            if (target?.group) {
              await acknowledgeAll.mutateAsync({ runId, code: target.group.code, reason: reason.trim() });
            } else if (target?.row) {
              await override.mutateAsync({ id: target.row.id, reason: reason.trim() });
            }
            message.success('Recorded.');
            setTarget(null);
          } catch (e) {
            setError(
              e && typeof e === 'object' && 'message' in e
                ? String((e as { message?: unknown }).message)
                : 'The server refused the change and did not say why.',
            );
          }
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        {target?.group ? (
          <>
            <p style={{ marginTop: 12 }}>
              {target.group.title} for {whoOf(target.group.rows.filter((row) => !row.overriddenBy))}.
            </p>
            <p>
              One reason for all of them. It covers each person’s selection for the rest of {year ?? 'the year'}: the months after show
              it as done, until a selection changes or the year turns.
            </p>
          </>
        ) : (
          <p style={{ marginTop: 12 }}>{target?.row?.consequence}</p>
        )}
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
      </Modal>
    </>
  );
}
