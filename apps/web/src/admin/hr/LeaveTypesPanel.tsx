import { useState } from 'react';
import { Alert, App, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { ApiError } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';
import { useGlobalSetting, useSetGlobalSetting } from '../../core/hooks/useGlobalSetting';
import { useLeaveTypes, useSaveLeaveType, type LeaveTypeRow } from '../hooks/useAdmin';
import { Panel, PanelHead, StatusChip } from './ui';

type Draft = Partial<LeaveTypeRow> & { name: string };

/**
 * PART-YEAR LEAVE (new-clinic UAT #2 re-check, item 80): what a pro-rated
 * figure is rounded to, and which types a joiner gets in full. The clinic's
 * setting `hr.leaveEntitlements`; Kuwick's default rounds to half days and
 * gives compassionate leave in full.
 */
export interface LeaveRules {
  rounding: 'HALF' | 'WHOLE';
  notProRated: string[];
}
export const KUWICK_LEAVE_RULES: LeaveRules = { rounding: 'HALF', notProRated: ['COMPASSIONATE'] };

/** Whether a type is pro-rated for somebody joining mid-year: the Act fixes the statutory ones other than annual. */
export function proRatedForJoiners(type: Pick<LeaveTypeRow, 'code' | 'statutory'>, rules: LeaveRules): boolean | 'FIXED' {
  if (type.statutory && type.statutory !== 'ANNUAL') return 'FIXED';
  return !rules.notProRated.includes(type.code);
}

const STATUTORY_WORD: Record<string, string> = {
  ANNUAL: 'Act: annual',
  SICK: 'Act: sick',
  HOSPITALISATION: 'Act: hospitalisation',
  MATERNITY: 'Act: maternity',
  PATERNITY: 'Act: paternity',
};

/**
 * LEAVE TYPES (Section D, 14 October 2026). The clinic's own list: paid or
 * unpaid, days a year, whether a document is needed, and how many days may
 * carry into next year. A statutory type cannot go below the Act; the Act's
 * minimum rises with years of service and Kuwick applies it per person.
 */
export function LeaveTypesPanel() {
  const { message } = App.useApp();
  const types = useLeaveTypes();
  const save = useSaveLeaveType();
  const canManage = useCan('hr.employee.manage');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useGlobalSetting<Partial<LeaveRules>>('hr.leaveEntitlements').data;
  const rules: LeaveRules = { ...KUWICK_LEAVE_RULES, ...(saved ?? {}) };
  const saveRules = useSetGlobalSetting<LeaveRules>('hr.leaveEntitlements');
  const setRules = (next: LeaveRules) =>
    saveRules.mutate(next, { onSuccess: () => message.success('Saved.'), onError: (e: Error) => message.error(e.message) });

  const submit = async () => {
    if (!draft) return;
    setError(null);
    try {
      await save.mutateAsync({
        id: draft.id,
        ...(draft.id ? {} : { code: (draft.code ?? '').toUpperCase() }),
        name: draft.name,
        paid: draft.paid ?? true,
        daysPerYear: draft.daysPerYear ?? null,
        documentRequired: draft.documentRequired ?? false,
        carryForwardCap: draft.carryForwardCap ?? null,
        active: draft.active ?? true,
      });
      message.success(`${draft.name} saved`);
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The leave type could not be saved.');
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Leave types"
        sub="What staff can ask for in My Kuwick. Unpaid types come off pay in the payroll month."
        actions={
          canManage ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => setDraft({ name: '', paid: true, active: true })}>
              + Add type
            </button>
          ) : null
        }
      />
      <table className="hr-table" style={{ width: '100%' }} data-testid="leave-types">
        <thead>
          <tr>
            <th>Type</th>
            <th>Pay</th>
            <th>Days a year</th>
            <th>Document</th>
            <th>Carry forward</th>
            <th>Joining mid-year</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(types.data ?? []).map((type) => (
            <tr key={type.id} className={type.active ? undefined : 'hr-faint'}>
              <td>
                <span className="hr-strong">{type.name}</span>
                {type.statutory ? (
                  <>
                    {' '}
                    <StatusChip tone="info">{STATUTORY_WORD[type.statutory] ?? 'Act'}</StatusChip>
                  </>
                ) : null}
              </td>
              <td>{type.paid ? 'Paid' : 'Unpaid'}</td>
              <td>
                {type.daysPerYear ?? 'No limit'}
                {type.actMinimum ? <span className="hr-faint"> (Act at least {type.actMinimum}, more with service)</span> : null}
              </td>
              <td>{type.documentRequired ? 'Needed' : '—'}</td>
              <td>{type.carryForwardCap === null ? 'None' : `Up to ${type.carryForwardCap} days`}</td>
              <td>
                {(() => {
                  const proRated = proRatedForJoiners(type, rules);
                  if (proRated === 'FIXED') return <span className="hr-faint">In full (the Act)</span>;
                  return canManage ? (
                    <Select
                      size="small"
                      aria-label={`${type.name} when joining mid-year`}
                      value={proRated ? 'PRO_RATED' : 'FULL'}
                      disabled={saveRules.isPending}
                      onChange={(value: string) =>
                        setRules({
                          ...rules,
                          notProRated: value === 'FULL' ? [...new Set([...rules.notProRated, type.code])] : rules.notProRated.filter((code) => code !== type.code),
                        })
                      }
                      options={[
                        { value: 'PRO_RATED', label: 'Pro-rated' },
                        { value: 'FULL', label: 'In full' },
                      ]}
                      style={{ width: 120 }}
                    />
                  ) : proRated ? (
                    'Pro-rated'
                  ) : (
                    'In full'
                  );
                })()}
              </td>
              <td>
                {canManage ? (
                  <button type="button" className="hr-btn hr-btn--sm hr-btn--ghost" onClick={() => setDraft({ ...type })}>
                    Edit
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hr-kv hr-mt">
        <span className="hr-kv__k">Round part-year leave to</span>
        <span className="hr-kv__v">
          <Select
            size="small"
            aria-label="Round part-year leave to"
            disabled={!canManage || saveRules.isPending}
            value={rules.rounding}
            onChange={(value: 'HALF' | 'WHOLE') => setRules({ ...rules, rounding: value })}
            options={[
              { value: 'HALF', label: 'Half days' },
              { value: 'WHOLE', label: 'Whole days' },
            ]}
            style={{ width: 130 }}
          />{' '}
          <span className="hr-small hr-muted">Somebody who joins mid-year gets their share of the year, rounded to this.</span>
        </span>
      </div>

      <Modal
        open={draft !== null}
        title={draft?.id ? `Edit ${draft.name}` : 'Add a leave type'}
        okText="Save"
        onOk={submit}
        onCancel={() => setDraft(null)}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        {error ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} /> : null}
        {draft ? (
          <div className="hr-form" style={{ display: 'grid', gap: 12 }}>
            {!draft.id ? (
              <div>
                <label htmlFor="lt-code">Code</label>
                <Input
                  id="lt-code"
                  value={draft.code ?? ''}
                  placeholder="STUDY"
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                />
                <div className="hr-form__help">Set once. Requests and balances keep it.</div>
              </div>
            ) : null}
            <div>
              <label htmlFor="lt-name">Name</label>
              <Input id="lt-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="lt-days">Days a year</label>
                <InputNumber
                  id="lt-days"
                  min={0}
                  max={365}
                  placeholder="No limit"
                  value={draft.daysPerYear ?? null}
                  onChange={(value) => setDraft({ ...draft, daysPerYear: value ?? null })}
                />
              </div>
              <div>
                <label htmlFor="lt-carry">Carry into next year, at most</label>
                <InputNumber
                  id="lt-carry"
                  min={0}
                  max={365}
                  placeholder="None"
                  value={draft.carryForwardCap ?? null}
                  onChange={(value) => setDraft({ ...draft, carryForwardCap: value ?? null })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <label>
                <Switch checked={draft.paid ?? true} disabled={Boolean(draft.statutory)} onChange={(paid) => setDraft({ ...draft, paid })} /> Paid
              </label>
              <label>
                <Switch checked={draft.documentRequired ?? false} onChange={(documentRequired) => setDraft({ ...draft, documentRequired })} />{' '}
                Document needed
              </label>
              <label>
                <Switch checked={draft.active ?? true} onChange={(active) => setDraft({ ...draft, active })} /> In use
              </label>
            </div>
            {draft.actMinimum ? (
              <div className="hr-form__help">
                The Employment Act gives at least {draft.actMinimum} days to a new starter, more with years of service. Kuwick gives each person the higher of this and the Act.
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}
