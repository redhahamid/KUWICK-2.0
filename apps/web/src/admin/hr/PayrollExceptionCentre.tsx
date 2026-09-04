import { useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import { Link } from 'react-router-dom';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { useOverrideException, usePayrollExceptions } from '../hooks/useAdmin';
import type { PayrollExceptionRow } from '../types';
import { SeverityTag } from './ExceptionSeverity';

/**
 * THE EXCEPTION CENTRE.
 *
 * The audited competitor has none: defects surface late and one at a time —
 * missing bank details only when a file is downloaded, a missing email only at
 * payslip send, a zero salary never at all. The clinic manager needs one screen
 * that says "you cannot pay these three people, and here is why", BEFORE
 * approving.
 *
 * Each row names the CONSEQUENCE as well as the cause, which is the shape of
 * the one genuinely excellent warning in that product: condition, consequence,
 * remedy.
 *
 * One component serves the run journey's Review step and the dense payroll
 * page, so "what is wrong with this run" cannot read differently in two
 * places. It fetches the same `payroll_exceptions` rows every other surface
 * uses — the gate banner, the stepper's markers, the approve button.
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
  // Blocking first, then warnings, then the informational rows — the reading
  // order of somebody deciding whether this month can be finished.
  const ordered = [...exceptions].sort((a, b) => {
    const rank = { BLOCKING: 0, WARNING: 1, INFO: 2 } as const;
    return rank[a.severity] - rank[b.severity];
  });

  const action = (row: PayrollExceptionRow) => {
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
          Pass with reason
        </Button>
      );
    }
    // THE REMEDY, IN PLACE. `deepLink` pointed at
    // /admin/hr/payroll/:runId/inputs, a route nobody ever mounted:
    // the one blocking exception a person could actually clear sent
    // them to a blank page instead. The inputs drawer is on this
    // screen, so it opens here, for this employee.
    if (row.code === 'PCB_MISSING' && row.staffId && onFixInputs) {
      return (
        <Button size="small" type="primary" ghost onClick={() => onFixInputs(row.staffId!, row.staffName)}>
          Enter it now
        </Button>
      );
    }
    if (!row.deepLink) return null;
    return (
      <Link to={row.deepLink}>
        <Button size="small" type={row.severity === 'BLOCKING' ? 'primary' : 'default'}>
          Go and fix it
        </Button>
      </Link>
    );
  };

  return (
    <AdminSection
      title="Exceptions"
      description="Blocking items must be resolved before approval. Warnings do not stop a run, but they are on the record."
    >
      <AdminNotice tone={gate.canApprove ? 'info' : 'warn'}>
        {gate.reason}
        {gate.overridden > 0 ? ` ${gate.overridden} passed deliberately, with a reason recorded.` : ''}
      </AdminNotice>

      <div className="kw-exceptionCentre">
        {ordered.length === 0 ? (
          <p className="kw-muted" style={{ margin: 0 }}>
            No exceptions. Every employee in this run could be calculated.
          </p>
        ) : (
          ordered.map((row) => (
            <div
              key={row.id}
              className={`kw-attention${row.severity === 'BLOCKING' && !row.overriddenBy ? ' kw-attention--blocking' : ''}`}
            >
              <div className="kw-attention__severity">
                <SeverityTag severity={row.severity} overridden={Boolean(row.overriddenBy)} />
              </div>
              <div className="kw-attention__body">
                <div className="kw-attention__what">
                  {row.staffName ? `${row.staffName} — ` : ''}
                  {row.cause}
                </div>
                <div className="kw-attention__why">{row.consequence}</div>
                <div className="kw-attention__todo">
                  <strong>What to do:</strong> {row.remediation}
                </div>
                {row.overriddenBy ? (
                  <div className="kw-attention__overridden">
                    Passed by {row.overriddenBy} — “{row.overrideReason}”
                  </div>
                ) : null}
              </div>
              <div className="kw-attention__action">{action(row)}</div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={Boolean(target)}
        title="Pass this warning"
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
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      </Modal>
    </AdminSection>
  );
}
