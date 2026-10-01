import { useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import { Link } from 'react-router-dom';
import { AdminNotice } from '../components/AdminShell';
import { Panel, EmptyState } from '../components/Panel';
import { StatusChip } from '../components/Chip';
import { useOverrideException, usePayrollExceptions } from '../hooks/useAdmin';
import type { PayrollExceptionRow } from '../types';

/**
 * THE EXCEPTION CENTRE — blockers first, then warnings, drawn differently.
 *
 * The reference sheet's Review & Approval screen separates BLOCKERS from
 * WARNINGS, and that separation is the correction this component most needed.
 * Everything used to be one list sorted by severity, every row the same
 * weight: a missing monthly-tax figure that stops the run and an unapproved
 * hour of overtime that does not, drawn identically. A warning is not a
 * blocker, and a screen that says otherwise teaches people to skim both.
 *
 * WHY IT EXISTS AT ALL. The audited competitor has no such screen: defects
 * surface late and one at a time — missing bank details only when a file is
 * downloaded, a missing email only at payslip send, a zero salary never at
 * all. A clinic manager needs one place that says "you cannot pay these three
 * people, and here is why", BEFORE approving. Each row names the CONSEQUENCE
 * as well as the cause, and then the remedy.
 *
 * ONE COMPONENT serves the run journey's Review stage and the dense payroll
 * page, so "what is wrong with this run" cannot read differently in two
 * places. It fetches the same `payroll_exceptions` rows every other surface
 * uses — the gate banner, the stage markers, the approve button.
 */
export function PayrollExceptionCentre({
  runId,
  canOverride,
  onFixInputs,
}: {
  runId: string;
  canOverride: boolean;
  /**
   * Open this run's payroll inputs FOR ONE PERSON. The remedy for a missing
   * PCB is a keystroke on the screen the reader is already on, and routing
   * them away to find it is how a blocker stays unresolved.
   */
  onFixInputs?: (staffId: string, staffName: string | null) => void;
}) {
  const { message } = App.useApp();
  const query = usePayrollExceptions(runId);
  const override = useOverrideException();
  const [target, setTarget] = useState<PayrollExceptionRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = query.data;
  if (!data) return null;

  const { gate, exceptions } = data;
  // A blocker somebody has deliberately passed is no longer blocking the run,
  // so it belongs with the warnings — where its recorded reason is on show.
  const blockers = exceptions.filter((row) => row.severity === 'BLOCKING' && !row.overriddenBy);
  const warnings = exceptions.filter((row) => row.severity !== 'BLOCKING' || row.overriddenBy);

  /**
   * THE ACTION, and its verb.
   *
   * Fix — go and change the thing that caused this.
   * Enter it now — the remedy is a keystroke on this screen.
   * Acknowledge — pass a warning with a reason that goes on the record.
   * View — nothing to do here, but here is what it refers to.
   */
  const action = (row: PayrollExceptionRow) => {
    // THE REMEDY, IN PLACE. `deepLink` pointed at
    // /admin/hr/payroll/:runId/inputs, a route nobody ever mounted: the one
    // blocking exception a person could actually clear sent them to a blank
    // page instead. The inputs drawer is on this screen, so it opens here.
    if (row.code === 'PCB_MISSING' && row.staffId && onFixInputs) {
      return (
        <Button size="small" type="primary" ghost onClick={() => onFixInputs(row.staffId!, row.staffName)}>
          Enter it now
        </Button>
      );
    }
    if (row.overridable && !row.overriddenBy && canOverride) {
      return (
        <Button
          size="small"
          onClick={() => {
            setTarget(row);
            setReason('');
            setError(null);
          }}
        >
          Acknowledge
        </Button>
      );
    }
    if (!row.deepLink) return null;
    return (
      <Link to={row.deepLink}>
        <Button size="small" type={row.severity === 'BLOCKING' ? 'primary' : 'default'}>
          {row.severity === 'BLOCKING' ? 'Fix' : 'View'}
        </Button>
      </Link>
    );
  };

  const row = (item: PayrollExceptionRow) => (
    <div
      key={item.id}
      className={`kw-attention${item.severity === 'BLOCKING' && !item.overriddenBy ? ' kw-attention--blocking' : ''}`}
    >
      <div className="kw-attention__body">
        <div className="kw-attention__what">
          {item.staffName ? `${item.staffName} — ` : ''}
          {item.cause}
        </div>
        <div className="kw-attention__why">{item.consequence}</div>
        <div className="kw-attention__todo">
          <strong>What to do:</strong> {item.remediation}
        </div>
        {item.overriddenBy ? (
          <div className="kw-attention__overridden">
            Acknowledged by {item.overriddenBy} — “{item.overrideReason}”
          </div>
        ) : null}
      </div>
      <div className="kw-attention__action">{action(item)}</div>
    </div>
  );

  return (
    <>
      <Panel
        title={blockers.length > 0 ? `Blockers · ${blockers.length}` : 'Blockers'}
        tone={blockers.length > 0 ? 'blocked' : 'ok'}
        hint={
          blockers.length > 0
            ? 'These stop the run. Kuwick will not finalise a month it cannot compute.'
            : undefined
        }
        action={
          blockers.length === 0 ? (
            <StatusChip tone="ok" dot>
              Nothing blocking
            </StatusChip>
          ) : null
        }
      >
        {blockers.length === 0 ? (
          <EmptyState title="Every employee in this run could be calculated" />
        ) : (
          <div className="kw-exceptionCentre">{blockers.map(row)}</div>
        )}
      </Panel>

      <Panel
        title={warnings.length > 0 ? `Warnings · ${warnings.length}` : 'Warnings'}
        tone={warnings.some((item) => !item.overriddenBy) ? 'attention' : undefined}
        hint={warnings.length > 0 ? 'These do not stop the run, but they are on the record.' : undefined}
      >
        {warnings.length === 0 ? (
          <EmptyState title="Nothing worth a second look" />
        ) : (
          <div className="kw-exceptionCentre">{warnings.map(row)}</div>
        )}
      </Panel>

      {/* The gate's own sentence, under the two lists it summarises — so the
          reason the run can or cannot be approved is never inferred. */}
      <AdminNotice tone={gate.canApprove ? 'info' : 'warn'}>
        {gate.reason}
        {gate.overridden > 0 ? ` ${gate.overridden} acknowledged deliberately, with a reason recorded.` : ''}
      </AdminNotice>

      <Modal
        open={Boolean(target)}
        title="Acknowledge this warning"
        okText="Record and pass"
        confirmLoading={override.isPending}
        onCancel={() => setTarget(null)}
        onOk={async () => {
          setError(null);
          if (reason.trim().length < 5) {
            setError('Say why this is being passed. It becomes part of the payroll record.');
            return;
          }
          try {
            await override.mutateAsync({ id: target!.id, reason: reason.trim() });
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
        <p style={{ marginTop: 12 }}>{target?.consequence}</p>
        {target?.code === 'EPF_BASIS_DISCREPANCY' ? (
          <p>
            This is a policy decision, so acknowledging it covers this selection for the rest of the year: the months after carry a
            one-line note instead of the warning, until the selection changes or the year turns.
          </p>
        ) : null}
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      </Modal>
    </>
  );
}
