import { useState } from 'react';
import { App, Button, Input, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { FieldProblem, Panel, PanelHead, StatusChip, type FormProblem } from './ui';
import { useLeavePolicies, useSaveLeavePolicy, type LeavePolicyRow } from '../hooks/useAdmin';
import { permissionHint, useCan } from '../../core/hooks/useCan';

/**
 * WHAT HAPPENS TO UNTAKEN ANNUAL LEAVE WHEN SOMEBODY LEAVES.
 *
 * This page used to say, in a comment and to nobody's face, that the product
 * had leave policies on the server and no screen that set them. The part that
 * needed a screen first is the part that is money: section 60E(3) of the
 * Employment Act owes the ordinary rate of pay for every day of paid annual
 * leave the employee was entitled to and had not taken when the contract of
 * service ended.
 *
 * ENDED BY EITHER PARTY. That is the half clinics miss — a resignation is
 * covered exactly as a dismissal, so "our staff all resign" is not an exit from
 * the section. Kuwick therefore defaults to paying it.
 *
 * A clinic may still decide not to, and Kuwick stores that decision rather than
 * refusing it — the same posture, and deliberately the same shape, as a
 * below-Act overtime multiplier: the warning names the section before Save, the
 * off position needs a tick and a written reason together, the answer is kept
 * against a name and a date, and the policy is marked on this screen from then
 * on so the next person to open it learns it here rather than from a leaver
 * asking where their money is.
 */
export function LeavePolicyPanel() {
  const { message } = App.useApp();
  const { data, isLoading } = useLeavePolicies();
  const save = useSaveLeavePolicy();
  const canManage = useCan('settings.manage');

  /** The policy whose payout is being switched off, and the answers so far. */
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [why, setWhy] = useState('');
  const [problem, setProblem] = useState<FormProblem>(null);

  const close = () => {
    setEditing(null);
    setConfirmed(false);
    setWhy('');
    setProblem(null);
  };

  const pay = async (policy: LeavePolicyRow) => {
    try {
      await save.mutateAsync({ id: policy.id, name: policy.name, payUntakenLeaveOnExit: true });
      close();
      message.success('Untaken annual leave is paid out when somebody leaves.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save the leave policy.');
    }
  };

  const withhold = async (policy: LeavePolicyRow) => {
    if (!confirmed) {
      setProblem({ field: 'leave-payout-confirm', message: 'Confirm that this is deliberate before it is saved.' });
      return;
    }
    if (why.trim().length < 4) {
      setProblem({ field: 'leave-payout-why', message: 'Say why. A decision nobody can explain is one nobody can defend.' });
      return;
    }
    try {
      await save.mutateAsync({
        id: policy.id,
        name: policy.name,
        payUntakenLeaveOnExit: false,
        notPayingAcknowledged: true,
        notPayingReason: why.trim(),
      });
      close();
      message.success('Recorded. Every payroll month will name the leaver and the amount that was not paid.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save the leave policy.');
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Untaken annual leave when somebody leaves"
        sub="Section 60E(3) of the Employment Act owes it at the ordinary rate of pay, whichever party ends the contract."
      />
      <div style={{ padding: '4px 22px 18px' }}>
        {isLoading ? (
          <div className="hr-faint">Loading the leave policies.</div>
        ) : (data ?? []).length === 0 ? (
          <div className="hr-faint">
            No leave policies yet. One is created the first time an employee is given annual leave entitlement.
          </div>
        ) : (
          (data ?? []).map((policy) => (
            <div key={policy.id} style={{ borderTop: '1px solid var(--hr-line)', padding: '14px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong>{policy.name}</strong>
                {/* THE PERMANENT MARK. Gold, on the row, for as long as the
                    decision stands — the same chip a rule set below the Act
                    carries. */}
                {policy.payUntakenLeaveOnExit ? (
                  <StatusChip tone="done">Paid out on exit</StatusChip>
                ) : (
                  <StatusChip tone="attn">Below the Act: not paid out</StatusChip>
                )}
                <span className="hr-faint">
                  {policy.employees} {policy.employees === 1 ? 'employee' : 'employees'}
                </span>
              </div>

              {policy.notPaying ? (
                <div className="hr-faint" style={{ marginTop: 6 }}>
                  Chosen by {policy.notPaying.by ?? 'somebody no longer on the staff list'}
                  {policy.notPaying.at ? ` on ${dayjs(policy.notPaying.at).format('D MMM YYYY')}` : ''}: “
                  {policy.notPaying.reason}”
                </div>
              ) : null}

              {editing === policy.id ? (
                <div className="hr-notice hr-notice--attn" id="leave-payout-confirm" style={{ marginTop: 12 }}>
                  <div className="hr-strong">This clinic would be choosing not to meet section 60E(3)</div>
                  <ul className="hr-notice__list">
                    <li>
                      The Act requires untaken paid annual leave to be paid at the ordinary rate of pay when the contract of
                      service ends, and says so of a contract ended by either party.
                    </li>
                    <li>
                      A resignation is covered as much as a dismissal, so staff who leave of their own accord are owed it
                      too. This is a statutory obligation, not a company benefit.
                    </li>
                  </ul>
                  <div>
                    The policy will be marked on this screen for as long as the decision stands, and every payroll month will
                    name each leaver and the amount that was not paid them.
                  </div>
                  <label className="hr-check">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    <span>I am choosing not to pay untaken annual leave out, and this clinic carries that decision.</span>
                  </label>
                  <FieldProblem problem={problem} field="leave-payout-confirm" />
                  <div>
                    <label htmlFor="leave-payout-why" className="hr-form__sub">
                      Why
                    </label>
                    <Input
                      id="leave-payout-why"
                      value={why}
                      onChange={(e) => setWhy(e.target.value)}
                      placeholder="Clinic practice since…, staff are told at hire"
                      maxLength={500}
                    />
                    <FieldProblem problem={problem} field="leave-payout-why" />
                  </div>
                  <div className="hr-form__help">Recorded against your name and today’s date.</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <Button danger type="primary" loading={save.isPending} onClick={() => withhold(policy)}>
                      Save this decision
                    </Button>
                    <Button onClick={close}>Keep paying it</Button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <Tooltip title={canManage ? '' : permissionHint('change the leave policy')}>
                    {policy.payUntakenLeaveOnExit ? (
                      <Button disabled={!canManage} onClick={() => setEditing(policy.id)}>
                        Do not pay it out
                      </Button>
                    ) : (
                      <Button type="primary" disabled={!canManage} loading={save.isPending} onClick={() => pay(policy)}>
                        Pay it out, as the Act requires
                      </Button>
                    )}
                  </Tooltip>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
