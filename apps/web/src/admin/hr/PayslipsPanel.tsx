import { useState } from 'react';
import { App, Button, Select, Tag, Tooltip } from 'antd';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { DataTable, money } from '../components/DataTable';
import { apiClient, downloadFile } from '../../core/api-client';
import { payslipPdfPath, usePayslips } from '../hooks/useAdmin';
import { printApprovedPayslip } from './payslip';
import { PayslipPreviewButton } from './PayslipPreview';
import type { PayslipDoc, PayslipListEntry } from '../types';
import { useAuthStore } from '../../core/auth-store';

/**
 * PAYSLIPS FOR AN APPROVED RUN — issued from the frozen snapshot, never from
 * the run's live lines. The server refuses this surface for a run nobody has
 * approved, and that refusal is rendered as the explanation it is: the
 * watermarked DRAFT preview lives on the dense run page, and it says what it
 * is.
 *
 * Print opens the same composed dataset the PDF route renders; the PDF comes
 * from the server and is audited there — who took whose slip, for which
 * revision.
 */
export function PayslipsPanel({ runId }: { runId: string }) {
  const { message } = App.useApp();
  const query = usePayslips(runId);
  const printedBy = useAuthStore((state) => state.staff?.fullName ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  // AN EARLIER REVISION STAYS VIEWABLE (UAT, 14 October 2026): null is the latest.
  const [revision, setRevision] = useState<number | null>(null);

  if (query.isError) {
    const detail =
      query.error && typeof query.error === 'object' && 'message' in query.error
        ? String((query.error as { message?: unknown }).message)
        : 'The payslip list could not be loaded.';
    return (
      <AdminSection title="Payslips">
        <AdminNotice tone="info">{detail}</AdminNotice>
      </AdminSection>
    );
  }
  const data = query.data;
  if (!data) return null;

  const print = async (staffId: string) => {
    setBusy(`print-${staffId}`);
    try {
      const slip = await apiClient.get<PayslipDoc>(`/workforce/payroll/runs/${runId}/payslips/${staffId}${revision ? `?version=${revision}` : ''}`);
      printApprovedPayslip(slip, printedBy);
    } catch (e) {
      message.error(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const pdf = async (rowData: PayslipListEntry) => {
    setBusy(`pdf-${rowData.staffId}`);
    try {
      await downloadFile(
        payslipPdfPath(runId, rowData.staffId, revision ?? undefined),
        `payslip-${data.period}-${rowData.name.replace(/[^A-Za-z0-9-]+/g, '-')}${revision ? `-r${revision}` : ''}.pdf`,
      );
    } catch (e) {
      message.error(e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminSection
      title="Payslips"
      description="Issued from the approved figures, never from figures that can still change. Downloads are on the audit trail."
      actions={
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <PayslipPreviewButton runId={runId} />
          <span className="kw-muted" style={{ fontSize: 12.5, display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {data.versions > 1 ? (
              <Select
                size="small"
                aria-label="Revision"
                value={revision ?? data.snapshotVersion}
                onChange={(value: number) => setRevision(value === data.snapshotVersion ? null : value)}
                options={Array.from({ length: data.versions }, (_, index) => index + 1)
                  .reverse()
                  .map((version) => ({
                    value: version,
                    label: `Revision ${version} of ${data.versions}${version < data.versions ? ' (superseded)' : ''}`,
                  }))}
                style={{ minWidth: 210 }}
              />
            ) : (
              <>Revision {data.snapshotVersion} of {data.versions}</>
            )}
            · verification {data.verdict}
          </span>
        </span>
      }
    >
      {data.reopenedSinceApproval ? (
        <AdminNotice tone="warn">
          This month has been <strong>reopened</strong> since approval. These payslips remain the record of what was
          approved; a corrected revision may follow.
        </AdminNotice>
      ) : null}
      <DataTable<PayslipListEntry>
        rowKey="staffId"
        rows={data.payslips}
        emptyText="The approved record paid nobody."
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          {
            title: 'Net pay',
            width: 140,
            align: 'right' as const,
            render: (_: unknown, row: PayslipListEntry) => <strong>{money(row.netCents / 100)}</strong>,
          },
          {
            title: '',
            key: 'itemised',
            width: 120,
            render: (_: unknown, row: PayslipListEntry) =>
              row.itemised ? null : (
                <Tooltip title="Approved before itemised payslips existed; the slip states totals only, and says so.">
                  <Tag>Totals only</Tag>
                </Tooltip>
              ),
          },
          {
            title: '',
            key: 'actions',
            width: 190,
            align: 'right' as const,
            render: (_: unknown, row: PayslipListEntry) => (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button size="small" loading={busy === `print-${row.staffId}`} onClick={() => void print(row.staffId)}>
                  Print
                </Button>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  loading={busy === `pdf-${row.staffId}`}
                  onClick={() => void pdf(row)}
                >
                  PDF
                </Button>
              </div>
            ),
          },
        ]}
      />
    </AdminSection>
  );
}
