import { useState } from 'react';
import { App, Button, Input, Modal, Table, Tag } from 'antd';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { useOverrideException, usePayrollExceptions } from '../hooks/useAdmin';
import type { PayrollExceptionRow } from '../types';

const TONE: Record<string, string> = { BLOCKING: 'red', WARNING: 'orange', INFO: 'blue' };

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
 */
export function PayrollExceptionCentre({ runId, canOverride }: { runId: string; canOverride: boolean }) {
  const { message } = App.useApp();
  const query = usePayrollExceptions(runId);
  const override = useOverrideException();
  const [target, setTarget] = useState<PayrollExceptionRow | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = query.data;
  if (!data) return null;

  const { gate, exceptions } = data;

  return (
    <AdminSection
      title="Exceptions"
      description="Blocking items must be resolved before approval. Warnings do not stop a run, but they are on the record."
      padded={false}
    >
      <AdminNotice tone={gate.canApprove ? 'info' : 'warn'}>
        {gate.reason}
        {gate.overridden > 0 ? ` ${gate.overridden} passed deliberately, with a reason recorded.` : ''}
      </AdminNotice>

      <Table<PayrollExceptionRow>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={exceptions}
        locale={{ emptyText: 'No exceptions. Every employee in this run could be calculated.' }}
        columns={[
          {
            title: 'Severity',
            dataIndex: 'severity',
            width: 110,
            render: (s: string) => <Tag color={TONE[s]}>{s}</Tag>,
          },
          { title: 'Employee', dataIndex: 'staffName', width: 150, render: (n: string | null) => n ?? '—' },
          {
            title: 'What is wrong, and what it would do',
            key: 'detail',
            render: (_: unknown, row) => (
              <div>
                <div>{row.cause}</div>
                {/* The consequence, which is the part that makes it actionable. */}
                <div style={{ color: '#a8071a', marginTop: 2 }}>{row.consequence}</div>
                <div style={{ color: '#888', marginTop: 2 }}>{row.remediation}</div>
                {row.overriddenBy ? (
                  <div style={{ color: '#888', marginTop: 4 }}>
                    Passed by {row.overriddenBy} — “{row.overrideReason}”
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            title: '',
            key: 'actions',
            width: 130,
            render: (_: unknown, row) =>
              row.overridable && !row.overriddenBy && canOverride ? (
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
              ) : row.deepLink ? (
                <a href={row.deepLink}>Go and fix it</a>
              ) : null,
          },
        ]}
      />

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
