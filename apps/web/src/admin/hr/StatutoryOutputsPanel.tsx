import { useState } from 'react';
import { App, Button, DatePicker, Input, Modal, Tag, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { apiClient, downloadFile } from '../../core/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface OutputRow {
  staffId: string;
  name: string;
  identifier: string | null;
  membershipNo: string | null;
  wagesCents: number | null;
  employeeCents: number | null;
  employerCents: number | null;
  note: string | null;
  /** EPF only: the wages column is an employer selection, not the assessment. */
  basisNote: string | null;
}

export interface SchemeBlock {
  scheme: string;
  rows: OutputRow[];
  employeeTotalCents: number | null;
  employerTotalCents: number | null;
  totalCents: number | null;
  notComputed: number;
  schedule: { scheduleId: string | null; verification: string | null; document: string | null } | null;
  submission: {
    submittedDate: string;
    reference: string;
    recordedBy: string;
    recordedAt: string;
    note: string | null;
  } | null;
}

export interface StatutoryOutputs {
  runId: string;
  period: string;
  employerName: string | null;
  employerIdentity: {
    registrationNo: string | null;
    epfEmployerNo: string | null;
    socsoEmployerNo: string | null;
    lhdnEmployerNo: string | null;
    hrdRegistrationNo: string | null;
  };
  snapshotVersion: number;
  notASubmission: string;
  schemes: SchemeBlock[];
}

const SCHEME_LABEL: Record<string, string> = {
  EPF: 'EPF (KWSP)',
  SOCSO: 'SOCSO (PERKESO)',
  EIS: 'EIS / SIP (PERKESO)',
  LINDUNG: 'LINDUNG 24 JAM (PERKESO)',
  PCB: 'PCB / MTD (LHDN)',
  HRD: 'HRD Corp levy',
};

/**
 * WHAT THE MONTH OWES EACH AUTHORITY, as data. The run's own panel and the
 * reports shelf ask the same question, so they ask it through one hook and
 * share one cache entry — two queries would be two answers.
 */
export function useStatutoryOutputs(runId: string | undefined) {
  return useQuery({
    queryKey: ['admin-hr', 'statutory-outputs', runId],
    queryFn: () => apiClient.get<StatutoryOutputs>(`/workforce/payroll/runs/${runId}/statutory-outputs`),
    enabled: Boolean(runId),
    retry: false,
  });
}

/**
 * WHAT THE MONTH OWES EACH AUTHORITY — prepared from the approved snapshot,
 * reconciled, and never called submitted until a person records the filing
 * they actually made, with the portal's own reference.
 */
export function StatutoryOutputsPanel({ runId }: { runId: string }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const query = useStatutoryOutputs(runId);
  const [recordFor, setRecordFor] = useState<string | null>(null);
  const [submittedDate, setSubmittedDate] = useState<Dayjs | null>(dayjs());
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (query.isError) {
    // Most commonly: the caller lacks hr.payroll.export.statutory, or the run
    // is not approved. Either way the server said why.
    return (
      <AdminSection title="Statutory filings">
        <AdminNotice tone="info">
          {query.error && typeof query.error === 'object' && 'message' in query.error
            ? String((query.error as { message?: unknown }).message)
            : 'Statutory outputs are unavailable.'}
        </AdminNotice>
      </AdminSection>
    );
  }
  const data = query.data;
  if (!data) return null;

  const record = () => {
    if (!recordFor) return;
    setError(null);
    if (!submittedDate) {
      setError('When was it filed?');
      return;
    }
    if (reference.trim() === '') {
      setError('Please enter the portal reference.');
      return;
    }
    if (reference.trim().length < 3) {
      setError('That portal reference looks too short. Please check it against the portal.');
      return;
    }
    setSaving(true);
    apiClient
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/${recordFor.toLowerCase()}/record-submission`, {
        submittedDate: submittedDate.format('YYYY-MM-DD'),
        reference: reference.trim(),
      })
      .then(() => {
        message.success('Filing recorded.');
        setRecordFor(null);
        void queryClient.invalidateQueries({ queryKey: ['admin-hr', 'statutory-outputs', runId] });
      })
      .catch((e) =>
        setError(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed'),
      )
      .finally(() => setSaving(false));
  };

  return (
    <AdminSection
      title="Statutory filings"
      description={data.notASubmission}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {data.schemes.map((block) => (
          <div key={block.scheme} className="kw-outputScheme">
            <div className="kw-outputScheme__head">
              <div>
                <strong>{SCHEME_LABEL[block.scheme] ?? block.scheme}</strong>
                {block.schedule?.scheduleId ? (
                  <Tooltip title={block.schedule.document ?? undefined}>
                    <span className="kw-provenance" style={{ marginLeft: 8 }}>
                      {block.schedule.scheduleId} · {block.schedule.verification}
                    </span>
                  </Tooltip>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>
                  {block.totalCents === null
                    ? `Not calculable — ${block.notComputed} not calculated`
                    : money(block.totalCents / 100)}
                </span>
                {block.submission ? (
                  <Tooltip
                    title={`Recorded by ${block.submission.recordedBy} — reference ${block.submission.reference}`}
                  >
                    <Tag color="green">Filed {dayjs(block.submission.submittedDate).format('D MMM')}</Tag>
                  </Tooltip>
                ) : (
                  <Tag>Not filed — prepared only</Tag>
                )}
                <Button
                  size="small"
                  onClick={() =>
                    void downloadFile(
                      `/workforce/payroll/runs/${runId}/statutory-outputs/${block.scheme.toLowerCase()}/listing`,
                      `${block.scheme.toLowerCase()}-listing-${data.period}.csv`,
                    ).catch((e) => message.error(String((e as { message?: unknown }).message ?? 'Failed')))
                  }
                >
                  Listing
                </Button>
                {!block.submission ? (
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    onClick={() => {
                      setRecordFor(block.scheme);
                      setReference('');
                      setError(null);
                    }}
                  >
                    Record filing
                  </Button>
                ) : null}
              </div>
            </div>
            {block.notComputed > 0 ? (
              <AdminNotice tone="warn">
                {block.notComputed} employee{block.notComputed === 1 ? "'s" : "s'"} figure could not be worked out —
                see this month’s exceptions. This listing is not a complete filing.
              </AdminNotice>
            ) : null}
            <DataTable<OutputRow>
              rowKey="staffId"
              rows={block.rows}
              emptyText="Nobody in the approved record."
              columns={[
                {
                  title: 'Employee',
                  // The name carries the basis note beneath it: whoever keys
                  // this listing into KWSP has to be able to see which wages
                  // columns are a deliberate employer selection.
                  render: (_: unknown, row: OutputRow) => (
                    <div>
                      {row.name}
                      {row.basisNote ? (
                        <div className="kw-provenance" style={{ color: '#b45309' }}>{row.basisNote}</div>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: 'Membership no.',
                  dataIndex: 'membershipNo',
                  width: 160,
                  // HRD Corp has no per-employee number (new-clinic UAT, 15 October 2026).
                  render: (value: string | null) =>
                    block.scheme === 'HRD' ? '–' : (value ?? <span style={{ color: '#b45309' }}>Not on file</span>),
                },
                {
                  title: 'Employee',
                  width: 130,
                  align: 'right' as const,
                  render: (_: unknown, row: OutputRow) =>
                    row.employeeCents === null ? (
                      <span className="kw-muted">Not calculated</span>
                    ) : (
                      money(row.employeeCents / 100)
                    ),
                },
                {
                  title: 'Employer',
                  width: 130,
                  align: 'right' as const,
                  render: (_: unknown, row: OutputRow) =>
                    row.employerCents === null ? (
                      <span className="kw-muted">Not calculated</span>
                    ) : (
                      money(row.employerCents / 100)
                    ),
                },
              ]}
            />
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(recordFor)}
        title={`Record the ${recordFor ?? ''} filing`}
        okText="Record it"
        confirmLoading={saving}
        onCancel={() => setRecordFor(null)}
        onOk={record}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <p style={{ marginTop: 8 }}>
          This states that the filing was actually made at the authority's own portal. It is recorded once, with your
          name.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Date filed</div>
            <DatePicker value={submittedDate} onChange={setSubmittedDate} style={{ width: '100%' }} />
          </div>
          <div>
            <div className="kw-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>Portal reference</div>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. KWSP-ACK-991122" />
          </div>
        </div>
      </Modal>
    </AdminSection>
  );
}
