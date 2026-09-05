import { useState } from 'react';
import { App, Button, Checkbox, DatePicker, Input, Modal, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import { apiClient } from '../../core/api-client';
import { useCan } from '../../core/hooks/useCan';
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
 * statutory assessment it is judged against.
 *
 * Two different statements share this panel and are never allowed to blur:
 * the CATALOGUE says which components ARE EPF wages (that is the assessment,
 * edited on the pay-components screen with a source and a verification
 * status); this panel records which of those wages the employer has CHOSEN
 * to contribute on. A choice that leaves assessed wages out is stored
 * faithfully, shown as a discrepancy, and blocks the month at approval — the
 * form says so before the save, not after the surprise.
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
      .catch((e) =>
        setError(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed'),
      )
      .finally(() => setSaving(false));
  };

  return (
    <AdminSection
      title="EPF contribution basis"
      description="Which of this employee's wages EPF is contributed on. Kuwick's statutory assessment stays separate: choosing to leave assessed wages out is recorded as the employer's selection, shows as a discrepancy, and blocks the month's approval."
      actions={
        mayManage ? (
          <Button size="small" onClick={openForm}>
            Change the basis
          </Button>
        ) : undefined
      }
    >
      {current ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 650 }}>{MODE_WORDS[current.mode]}</div>
          {current.mode === 'BASIC_PLUS_SELECTED' ? (
            <div style={{ marginTop: 4 }}>
              <Tag>Basic salary</Tag>
              {current.includedComponentCodes.map((code) => (
                <Tag key={code}>{labelOf(code)}</Tag>
              ))}
            </div>
          ) : null}
          <div className="kw-provenance" style={{ marginTop: 4 }}>
            Since {dayjs(current.effectiveFrom).format('D MMM YYYY')}
            {current.recordedBy ? ` · selected by ${current.recordedBy}` : ''}
            {current.reason ? ` — ${current.reason}` : ''}
          </div>
        </div>
      ) : (
        <AdminNotice tone="info">
          No selection is recorded. EPF is contributed on everything Kuwick's assessment marks as EPF wages — which
          is the lawful default, and most clinics never need anything else.
        </AdminNotice>
      )}

      {versions.length > 0 ? (
        <DataTable<BasisVersion>
          rowKey="id"
          rows={versions}
          columns={[
            {
              title: 'Basis',
              render: (_: unknown, row: BasisVersion) => (
                <div>
                  {MODE_WORDS[row.mode]}
                  {row.mode === 'BASIC_PLUS_SELECTED' ? (
                    <div className="kw-provenance">
                      Basic + {row.includedComponentCodes.map(labelOf).join(', ') || 'nothing else'}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: 'In force',
              width: 210,
              render: (_: unknown, row: BasisVersion) =>
                row.superseded ? (
                  <Tooltip title="Re-recorded from the same day before any payroll used it. Kept because the decision was still made.">
                    <span className="kw-muted">Superseded, never in force</span>
                  </Tooltip>
                ) : (
                  `${dayjs(row.effectiveFrom).format('D MMM YYYY')} — ${
                    row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : 'now'
                  }`
                ),
            },
            { title: 'Reason', dataIndex: 'reason', render: (value: string | null) => value ?? '' },
            { title: 'Recorded by', dataIndex: 'recordedBy', width: 160, render: (value: string | null) => value ?? '' },
          ]}
        />
      ) : null}

      <Modal
        open={open}
        title="Select the EPF contribution basis"
        okText="Record it"
        confirmLoading={saving}
        onCancel={() => setOpen(false)}
        onOk={save}
        width={560}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Basis</div>
            <Select
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
              <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
                Included in the EPF basis
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                <Checkbox checked disabled>
                  Basic salary <span className="kw-provenance">always included</span>
                </Checkbox>
                {components
                  .filter((component) => component.code !== 'BASIC')
                  .map((component) => (
                    <Checkbox
                      key={component.code}
                      checked={ticked.includes(component.code)}
                      onChange={(e) =>
                        setTicked((prev) =>
                          e.target.checked ? [...prev, component.code] : prev.filter((code) => code !== component.code),
                        )
                      }
                    >
                      {component.label}{' '}
                      {component.epfLiable ? (
                        <Tag color="blue">EPF wages</Tag>
                      ) : (
                        <Tooltip title="Outside EPF wages by the pay-component catalogue's statutory treatment. Ticking it adds nothing to the basis.">
                          <Tag>outside EPF wages</Tag>
                        </Tooltip>
                      )}
                    </Checkbox>
                  ))}
              </div>
            </div>
          ) : null}

          {preview.excludedLiable.length > 0 ? (
            <AdminNotice tone="warn">
              <strong>This selection leaves out {preview.excludedLiable.map((c) => c.label).join(', ')}</strong> —
              wages Kuwick assesses as EPF-liable. Any month that pays {preview.excludedLiable.length === 1 ? 'it' : 'them'}{' '}
              will show a statutory discrepancy and cannot be approved while it stands. The selection is still recorded,
              as yours.
            </AdminNotice>
          ) : null}
          {preview.ineffective.length > 0 ? (
            <AdminNotice tone="info">
              {preview.ineffective.map((c) => c.label).join(', ')} {preview.ineffective.length === 1 ? 'is' : 'are'}{' '}
              outside EPF wages by the statutory assessment, so the tick adds nothing to the basis.
            </AdminNotice>
          ) : null}

          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Takes effect from</div>
            <DatePicker
              value={from}
              onChange={(value) => value && setFrom(value)}
              picker="date"
              style={{ width: '100%' }}
            />
            <div className="kw-provenance" style={{ marginTop: 4 }}>
              The first day of a month. A basis that changes mid-month blocks that month's payroll rather than letting
              Kuwick pick which half applies; a month that is already approved refuses the change outright. What you
              record from a day replaces anything recorded from that day on, so a wrong turn is fixed by recording the
              intended selection from the intended day.
            </div>
          </div>

          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Reason</div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Contract states EPF on basic and procedure incentive"
            />
          </div>
        </div>
      </Modal>
    </AdminSection>
  );
}
