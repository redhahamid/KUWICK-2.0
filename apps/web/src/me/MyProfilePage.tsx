import { useState } from 'react';
import dayjs from 'dayjs';
import { App, Input } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../core/api-client';
import { useAuthStore } from '../core/auth-store';
import { Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { useMyProfile, useRenameSelf } from './hooks/useMe';
import { PortalEmpty } from './portal';

/**
 * PROFILE — what the clinic holds about the person. The display name is the
 * person's own to change (logged); everything else is HR's to correct. The bank account is deliberately not editable here (there
 * is no self-service endpoint for it): a payslip must never be paid to a
 * number nobody checked.
 */
export function MyProfilePage() {
  const { data } = useMyProfile();
  const navigate = useNavigate();
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const { message } = App.useApp();
  // YOUR DISPLAY NAME is yours to correct (owner, 12 October 2026); every
  // other fact here stays HR's.
  const renameSelf = useRenameSelf();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const saveName = async () => {
    if (name.trim().length < 2) return setNameProblem('Type your name, at least two letters.');
    try {
      const saved = await renameSelf.mutateAsync({ fullName: name });
      const session = useAuthStore.getState();
      if (session.staff) useAuthStore.setState({ staff: { ...session.staff, fullName: saved.fullName } });
      setEditingName(false);
      message.success('Name saved. Payslips already approved keep the name they were approved with.');
    } catch (error) {
      setNameProblem(error instanceof ApiError ? error.message : 'Your name could not be saved.');
    }
  };

  const kv = (label: string, value: string | null | undefined) => (
    <span key={label} style={{ display: 'contents' }}>
      <span className="hr-kv__k">{label}</span>
      <span className="hr-kv__v">{value || '—'}</span>
    </span>
  );

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Profile</h1>
          <div className="hr-sub">You can change your display name here. Anything else that is wrong is corrected by HR.</div>
        </div>
        <div className="hr-pageHead__actions">
          <button
            type="button"
            className="hr-btn"
            onClick={() => {
              clearAuth();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="hr-grid2">
        <Panel>
          <PanelHead title="You" />
          {editingName ? (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <label>
                <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>Display name</div>
                <Input aria-label="Display name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
              </label>
              {nameProblem ? <div className="hr-small" style={{ color: '#c2362e' }}>{nameProblem}</div> : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="hr-btn hr-btn--primary" disabled={renameSelf.isPending} onClick={saveName}>
                  Save
                </button>
                <button type="button" className="hr-btn" onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <div className="hr-kv">
            <span className="hr-kv__k">Name</span>
            <span className="hr-kv__v">
              {data?.fullName || '—'}{' '}
              {!editingName ? (
                <button
                  type="button"
                  className="hr-linkButton"
                  onClick={() => {
                    setName(data?.fullName ?? '');
                    setNameProblem(null);
                    setEditingName(true);
                  }}
                >
                  Change
                </button>
              ) : null}
            </span>
            {kv('Branch', data?.branch?.name)}
            {kv('Kind of work', data?.category?.toLowerCase())}
          </div>
          <div className="hr-panelHead--top">
            <PanelHead title="Contact" />
          </div>
          <div className="hr-kv">
            {kv('Phone', data?.employment?.phone)}
            {kv('Email', data?.employment?.email)}
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Employment" />
          {data?.hasEmploymentProfile ? (
            <div className="hr-kv">
              {kv('Employee number', data.employment?.employeeNo)}
              {kv('Position', data.employment?.position)}
              {kv('Department', data.employment?.department)}
              {kv('Type', data.employment?.employmentType?.toLowerCase())}
              {kv('Started', data.employment?.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : null)}
              <span className="hr-kv__k">Status</span>
              <span className="hr-kv__v">
                <StatusChip tone={data.employment?.employmentStatus === 'ACTIVE' ? 'done' : 'muted'}>
                  {data.employment?.employmentStatus?.toLowerCase() ?? '—'}
                </StatusChip>
              </span>
            </div>
          ) : (
            <PortalEmpty title="Your employment record is not finished yet">
              You can sign in and see your roster, but payroll cannot include you until HR completes your employment
              profile. Ask them to finish it.
            </PortalEmpty>
          )}
          <div className="hr-panelHead--top">
            <PanelHead title="Bank account" />
          </div>
          <PortalEmpty title="Changed through HR">
            Tell your manager or HR the new account, with proof it is yours. Payroll is paid only to an account HR has
            checked, so it cannot be changed from here.
          </PortalEmpty>
        </Panel>
      </div>
    </>
  );
}
