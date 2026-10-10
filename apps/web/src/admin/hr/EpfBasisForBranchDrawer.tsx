import { useEffect, useState } from 'react';
import { App, DatePicker, Input, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEpfBasisForBranch } from '../hooks/useAdmin';
import { Drawer, ProblemNotice, StatusChip } from './ui';
import type { EpfBasisForBranchResult } from '../types';

const MODE_LABEL: Record<string, string> = {
  BASIC_ONLY: 'Basic salary only',
  BASIC_PLUS_SELECTED: 'Basic plus selected items',
  ALL_APPLICABLE: 'All EPF-liable pay',
};

/**
 * SET EPF BASIS FOR ALL STAFF IN THIS BRANCH (UAT, 10 October 2026).
 *
 * One basis from one date for everybody employed at the branch from then,
 * leavers included up to their last day. Each person gets their own dated
 * record, the same as setting it on their page, and the batch is logged.
 * Check first: who changes, who already has it, and anybody whose approved
 * months the date reaches, which stops the whole batch.
 */
export function EpfBasisForBranchDrawer({
  open,
  clinicId,
  branchName,
  onClose,
}: {
  open: boolean;
  clinicId: string;
  branchName: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const action = useEpfBasisForBranch();
  const [mode, setMode] = useState<'BASIC_ONLY' | 'ALL_APPLICABLE'>('BASIC_ONLY');
  const [from, setFrom] = useState<Dayjs>(dayjs().startOf('month'));
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<EpfBasisForBranchResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A changed choice makes the last check stale.
  useEffect(() => setPreview(null), [mode, from, reason, clinicId]);

  const body = () => ({ clinicId, mode, effectiveFrom: from.format('YYYY-MM-DD'), reason: reason.trim() });
  const check = async () => {
    setProblem(null);
    if (reason.trim().length < 3) {
      setProblem('Say why: it is kept on every person’s record.');
      return;
    }
    try {
      setPreview(await action.mutateAsync(body()));
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const apply = async () => {
    setProblem(null);
    try {
      const done = await action.mutateAsync({ ...body(), commit: true });
      message.success(`EPF basis set to ${MODE_LABEL[mode].toLowerCase()} from ${from.format('D MMM YYYY')} for ${done.changing} staff in ${branchName}.`);
      setPreview(null);
      setReason('');
      onClose();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <Drawer
      open={open}
      title="Set EPF basis for all staff in this branch"
      sub={branchName}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="hr-btn" onClick={onClose}>
            Cancel
          </button>
          {preview && preview.blocked === 0 && preview.changing > 0 ? (
            <button type="button" className="hr-btn hr-btn--primary" onClick={() => void apply()} disabled={action.isPending}>
              Set for {preview.changing} staff
            </button>
          ) : (
            <button type="button" className="hr-btn hr-btn--primary" onClick={() => void check()} disabled={action.isPending}>
              Check who changes
            </button>
          )}
        </>
      }
    >
      <ProblemNotice problem={problem} />
      <div className="hr-form">
        <div>
          <label htmlFor="branch-epf-mode">EPF is worked out on</label>
          <Select
            id="branch-epf-mode"
            value={mode}
            onChange={setMode}
            style={{ width: '100%' }}
            options={[
              { value: 'BASIC_ONLY', label: 'Basic salary only' },
              { value: 'ALL_APPLICABLE', label: 'All EPF-liable pay (Kuwick’s default)' },
            ]}
          />
        </div>
        <div>
          <label htmlFor="branch-epf-from">From</label>
          <DatePicker
            id="branch-epf-from"
            value={from}
            allowClear={false}
            format="D MMM YYYY"
            style={{ width: '100%' }}
            onChange={(value) => value && setFrom(value)}
          />
          <div className="hr-form__help">Everybody employed here on or after this date, including anybody who has since left.</div>
        </div>
        <div>
          <label htmlFor="branch-epf-reason">Why</label>
          <Input
            id="branch-epf-reason"
            value={reason}
            maxLength={500}
            placeholder="e.g. Clinic pays EPF on basic salary only"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      {preview ? (
        <div className="hr-mt" data-testid="branch-epf-preview">
          <div className={`hr-notice ${preview.blocked > 0 ? 'hr-notice--block' : 'hr-notice--info'}`}>
            <strong>
              {preview.changing} of {preview.people} staff change
            </strong>
            {preview.unchanged > 0 ? `, ${preview.unchanged} already have it` : ''}.
            {preview.blocked > 0
              ? ` ${preview.blocked} ${preview.blocked === 1 ? 'person has' : 'people have'} approved payroll from this date, so nothing can be set: choose a later date.`
              : ''}
          </div>
          <ul className="hr-plainList">
            {preview.rows.map((row) => (
              <li key={row.staffId}>
                <span>
                  {row.name}
                  {row.employeeNo ? <span className="hr-faint"> · {row.employeeNo}</span> : null}
                </span>
                <StatusChip tone={row.action === 'BLOCKED' ? 'block' : row.action === 'CHANGE' ? 'attn' : 'muted'}>
                  {row.action === 'BLOCKED' ? 'Approved months' : row.action === 'CHANGE' ? `From ${MODE_LABEL[row.current] ?? row.current}` : 'Already set'}
                </StatusChip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Drawer>
  );
}
