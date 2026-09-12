import { useState } from 'react';
import { App, Checkbox, DatePicker, Input, Modal, Select, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';
import { PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconEdit } from './ui/icons';
import { BasisComponentOption, BasisMode, MODE_WORDS, basisPreview } from './epf-basis';

interface BasisVersion {
  id: string;
  mode: BasisMode;
  includedComponentCodes: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
  current: boolean;
  superseded: boolean;
}

interface BasisHistory {
  scheme: 'EPF';
  versions: BasisVersion[];
  components: BasisComponentOption[];
}

/**
 * WHICH WAGES EPF IS CONTRIBUTED ON — the employer's selection, beside the
 * statutory assessment it is compared against.
 *
 * Two different statements share this section and are never allowed to blur:
 * the CATALOGUE says which components ARE EPF wages (that is the assessment,
 * edited on Payroll items with a source and a verification status); this
 * section records which of those wages the employer has CHOSEN to contribute
 * on.
 *
 * A choice that leaves assessed wages out is the employer's to make: it is
 * computed faithfully and the month can be approved. What it is never
 * allowed to be is silent or flattering — the difference is shown here
 * before the save, raised as an advisory on every month it touches, and
 * frozen into the approved record with the name of whoever chose it. Kuwick
 * does not call it compliant, and does not stand in the way.
 */
export function EpfBasisPanel({ staffId, canSeePay }: { staffId: string; canSeePay: boolean }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const mayManage = useCan('hr.employee.manage');
  const query = useQuery({
    queryKey: ['admin-hr', 'contribution-basis', staffId],
    queryFn: () => apiClient.get<BasisHistory>(`/workforce/employees/${staffId}/contribution-basis`),
    enabled: canSeePay,
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<BasisMode>('ALL_APPLICABLE');
  const [ticked, setTicked] = useState<string[]>([]);
  const [from, setFrom] = useState(dayjs().startOf('month'));
  const [reason, setReason] = useState('');

  if (!canSeePay) return null;
  const data = query.data;
  const versions = data?.versions ?? [];
  const current = versions.find((row) => row.current) ?? null;
  const components = data?.components ?? [];
  const labelOf = (code: string) => components.find((c) => c.code === code)?.label ?? code;

  const openForm = () => {
    setMode(current?.mode ?? 'ALL_APPLICABLE');
    setTicked(current?.includedComponentCodes ?? []);
    setFrom(dayjs().startOf('month'));
    setReason('');
    setError(null);
    setOpen(true);
  };

  const preview = basisPreview(components, mode, ticked);

  const save = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError('A basis is a decision about statutory money. Say why it is being selected — the reason stays on the record.');
      return;
    }
    setSaving(true);
    apiClient
      .post(`/workforce/employees/${staffId}/contribution-basis`, {
        scheme: 'EPF',
        mode,
        ...(mode === 'BASIC_PLUS_SELECTED' ? { includedComponentCodes: ticked } : {}),
        effectiveFrom: from.format('YYYY-MM-DD'),
        reason: reason.trim(),
      })
      .then(() => {
        message.success('EPF basis recorded.');
        setOpen(false);
        void queryClient.invalidateQueries({ queryKey: ['admin-hr', 'contribution-basis', staffId] });
      })
      .catch((e) => setError(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed'))
      .finally(() => setSaving(false));
  };

  return (
    <>
      <PanelHead
        rule
        title="EPF contribution basis"
        sub="Which of this employee's wages EPF is contributed on. Leaving assessed wages out is the employer's recorded selection and raises an advisory; Kuwick does not treat it as statutory compliance."
        actions={
          mayManage ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={openForm}>
              <IconEdit />
              Change the basis
            </button>
          ) : null
        }
      />
      <div className="hr-kv hr-kv--pairs">
        <span className="hr-kv__k">Basis in force</span>
        <span className="hr-kv__v">
          {current ? MODE_WORDS[current.mode] : 'Everything assessed as EPF wages'}
          {current?.mode === 'BASIC_PLUS_SELECTED' ? (
            <span className="hr-faint hr-small"> · Basic + {current.includedComponentCodes.map(labelOf).join(', ') || 'nothing else'}</span>
          ) : null}
        </span>
        <span className="hr-kv__k">Since</span>
        <span className="hr-kv__v">
          {current ? (
            <>
              {dayjs(current.effectiveFrom).format('D MMM YYYY')}
              {current.recordedBy ? <span className="hr-faint hr-small"> · selected by {current.recordedBy}</span> : null}
            </>
          ) : (
            <span className="hr-faint">No selection recorded — the lawful default applies</span>
          )}
        </span>
      </div>

      {versions.length > 0 ? (
        <Table<BasisVersion>
          rowKey="id"
          rows={versions}
          columns={[
            {
              title: 'Basis',
              key: 'basis',
              render: (_: unknown, row) => (
                <span>
                  {MODE_WORDS[row.mode]}
                  {row.mode === 'BASIC_PLUS_SELECTED' ? <span className="hr-faint hr-small"> · Basic + {row.includedComponentCodes.map(labelOf).join(', ') || 'nothing else'}</span> : null}
                </span>
              ),
            },
            {
              title: 'In force',
              key: 'range',
              width: 220,
              render: (_: unknown, row) =>
                row.superseded ? (
                  <Tooltip title="Re-recorded from the same day before any payroll used it. Kept because the decision was still made.">
                    <span>
                      <StatusChip tone="muted">Superseded</StatusChip>
                    </span>
                  </Tooltip>
                ) : (
                  `${dayjs(row.effectiveFrom).format('D MMM YYYY')} — ${row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : 'now'}`
                ),
            },
            { title: 'Reason', dataIndex: 'reason', render: (value: string | null) => value ?? <span className="hr-faint">No reason given</span> },
            { title: 'Recorded by', dataIndex: 'recordedBy', width: 180, render: (value: string | null, row) => `${value ?? 'Unknown'} · ${dayjs(row.recordedAt).format('D MMM YYYY')}` },
          ]}
        />
      ) : null}

      <Modal open={open} title="Select the EPF contribution basis" okText="Record it" confirmLoading={saving} onCancel={() => setOpen(false)} onOk={save} width={560}>
        {error ? <div className="hr-notice hr-notice--attn">{error}</div> : null}
        <div className="hr-form" style={{ marginTop: 8 }}>
          <div>
            <label htmlFor="basis-mode">Basis</label>
            <Select
              id="basis-mode"
              value={mode}
              onChange={(value) => setMode(value as BasisMode)}
              style={{ width: '100%' }}
              options={[
                { value: 'ALL_APPLICABLE', label: MODE_WORDS.ALL_APPLICABLE },
                { value: 'BASIC_ONLY', label: MODE_WORDS.BASIC_ONLY },
                { value: 'BASIC_PLUS_SELECTED', label: MODE_WORDS.BASIC_PLUS_SELECTED },
              ]}
            />
          </div>

          {mode === 'BASIC_PLUS_SELECTED' ? (
            <div>
              <label>Included in the EPF basis</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <Checkbox checked disabled>
                  Basic salary <span className="hr-faint hr-small">always included</span>
                </Checkbox>
                {components
                  .filter((component) => component.code !== 'BASIC')
                  .map((component) => (
                    <Checkbox
                      key={component.code}
                      checked={ticked.includes(component.code)}
                      onChange={(e) => setTicked((prev) => (e.target.checked ? [...prev, component.code] : prev.filter((code) => code !== component.code)))}
                    >
                      {component.label}{' '}
                      {component.epfLiable ? (
                        <StatusChip tone="info">EPF wages</StatusChip>
                      ) : (
                        <Tooltip title="Outside EPF wages by the pay-component catalogue's statutory treatment. Ticking it adds nothing to the basis.">
                          <span>
                            <StatusChip tone="muted">outside EPF wages</StatusChip>
                          </span>
                        </Tooltip>
                      )}
                    </Checkbox>
                  ))}
              </div>
            </div>
          ) : null}

          {preview.excludedLiable.length > 0 ? (
            <div className="hr-notice hr-notice--attn">
              <strong>This selection leaves out {preview.excludedLiable.map((c) => c.label).join(', ')}</strong> — wages Kuwick assesses as EPF-liable. Any month that pays{' '}
              {preview.excludedLiable.length === 1 ? 'it' : 'them'} will contribute EPF on the lower figure and show an advisory naming the difference. Payroll can still be approved: this is
              your decision, recorded as yours, with your name and reason on it. Kuwick does not treat it as meeting the Act, and any shortfall against the Act stays the employer's to make
              good.
            </div>
          ) : null}
          {preview.ineffective.length > 0 ? (
            <div className="hr-notice hr-notice--info">
              {preview.ineffective.map((c) => c.label).join(', ')} {preview.ineffective.length === 1 ? 'is' : 'are'} outside EPF wages by the statutory assessment, so the tick adds nothing
              to the basis.
            </div>
          ) : null}

          <div>
            <label htmlFor="basis-from">Takes effect from</label>
            <DatePicker id="basis-from" value={from} onChange={(value) => value && setFrom(value)} picker="date" style={{ width: '100%' }} />
            <div className="hr-form__help">
              The first day of a month. A basis that changes mid-month blocks that month's payroll rather than letting Kuwick pick which half applies; a month that is already approved
              refuses the change outright. What you record from a day replaces anything recorded from that day on.
            </div>
          </div>

          <div>
            <label htmlFor="basis-reason">Reason</label>
            <Input id="basis-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Contract states EPF on basic and procedure incentive" />
          </div>
        </div>
      </Modal>
    </>
  );
}
