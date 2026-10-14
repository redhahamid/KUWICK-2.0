import { useState } from 'react';
import { Alert, App, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { ApiError } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';
import { useClaimTypes, useSaveClaimType } from '../hooks/useAdmin';
import type { ClaimTypeRow } from '../types';
import { Panel, PanelHead } from './ui';

type Draft = Partial<ClaimTypeRow> & { name: string };

/**
 * CLAIM TYPES (Section E, 14 October 2026). The clinic's own list: a type
 * claimed by the km is priced by Kuwick at its rate and paid up to its daily
 * cap; any other type is a claim of an amount. Each says whether a receipt
 * is needed. Approved claims are paid through payroll on the claim pay date.
 */
export function ClaimTypesPanel() {
  const { message } = App.useApp();
  const types = useClaimTypes();
  const save = useSaveClaimType();
  const canManage = useCan('settings.manage');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!draft) return;
    setError(null);
    try {
      await save.mutateAsync({
        id: draft.id,
        ...(draft.id ? {} : { code: (draft.code ?? '').toUpperCase() }),
        name: draft.name,
        unit: draft.unit ?? null,
        ratePerUnit: draft.unit ? (draft.ratePerUnit ?? null) : null,
        dailyUnitCap: draft.unit ? (draft.dailyUnitCap ?? null) : null,
        receiptRequired: draft.receiptRequired ?? true,
        active: draft.active ?? true,
      });
      message.success(`${draft.name} saved`);
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The claim type could not be saved.');
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Claim types"
        sub="What staff can claim in My Kuwick. Tax treatment of claims: to confirm with your tax adviser."
        actions={
          canManage ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => setDraft({ name: '', receiptRequired: true, active: true, unit: null })}>
              + Add type
            </button>
          ) : null
        }
      />
      <table className="hr-table" style={{ width: '100%' }} data-testid="claim-types">
        <thead>
          <tr>
            <th>Type</th>
            <th>Priced</th>
            <th>Daily cap</th>
            <th>Receipt</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(types.data ?? []).map((type) => (
            <tr key={type.id} className={type.active ? undefined : 'hr-faint'}>
              <td>
                <span className="hr-strong">{type.name}</span> <span className="hr-faint">{type.code}</span>
              </td>
              <td>{type.unit ? `RM ${Number(type.ratePerUnit ?? 0).toFixed(2)} per km` : 'Amount claimed'}</td>
              <td>{type.unit && type.dailyUnitCap !== null ? `${type.dailyUnitCap} km a day` : '—'}</td>
              <td>{type.receiptRequired ? 'Needed' : '—'}</td>
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

      <Modal
        open={draft !== null}
        title={draft?.id ? `Edit ${draft.name}` : 'Add a claim type'}
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
                <label htmlFor="ct-code">Code</label>
                <Input
                  id="ct-code"
                  value={draft.code ?? ''}
                  placeholder="PARKING"
                  onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor="ct-name">Name</label>
              <Input id="ct-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </div>
            <div>
              <label htmlFor="ct-unit">Claimed as</label>
              <Select
                id="ct-unit"
                value={draft.unit ?? ''}
                onChange={(value) => setDraft({ ...draft, unit: value === 'KM' ? 'KM' : null })}
                style={{ width: '100%' }}
                options={[
                  { value: '', label: 'An amount, from the receipt' },
                  { value: 'KM', label: 'Kilometres, priced per km' },
                ]}
              />
            </div>
            {draft.unit ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <label htmlFor="ct-rate">RM per km</label>
                  <InputNumber id="ct-rate" min={0} step={0.05} value={draft.ratePerUnit ?? null} onChange={(value) => setDraft({ ...draft, ratePerUnit: value ?? null })} />
                </div>
                <div>
                  <label htmlFor="ct-cap">Most km paid a day</label>
                  <InputNumber
                    id="ct-cap"
                    min={0}
                    placeholder="No cap"
                    value={draft.dailyUnitCap ?? null}
                    onChange={(value) => setDraft({ ...draft, dailyUnitCap: value ?? null })}
                  />
                </div>
                <div className="hr-form__help" style={{ flexBasis: '100%' }}>
                  Kilometres over the cap are not paid, and the claim says how many and why.
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 24 }}>
              <label>
                <Switch checked={draft.receiptRequired ?? true} onChange={(receiptRequired) => setDraft({ ...draft, receiptRequired })} /> Receipt needed
              </label>
              <label>
                <Switch checked={draft.active ?? true} onChange={(active) => setDraft({ ...draft, active })} /> In use
              </label>
            </div>
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}
