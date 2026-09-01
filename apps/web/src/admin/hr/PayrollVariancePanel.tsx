import { Table, Tag } from 'antd';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { usePayrollVariance } from '../hooks/useAdmin';
import type { PayrollVarianceRow } from '../types';

const TONE: Record<string, string> = {
  MATERIAL: 'red',
  MOVED: 'blue',
  NEW: 'green',
  LEFT: 'orange',
  UNCHANGED: 'default',
};

function rm(cents: number | null): string {
  if (cents === null) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * VARIANCE AGAINST THE PREVIOUS PERIOD.
 *
 * The single highest-value payroll control, and neither Kuwick nor the audited
 * competitor had it. Payroll errors are rarely subtle in size — a salary typed
 * with an extra zero, a bonus keyed twice, unpaid leave entered as days worked
 * — and they are invisible in a grid of forty rows that all look plausible.
 *
 * This says which people MOVED, before anybody approves.
 */
export function PayrollVariancePanel({ runId }: { runId: string }) {
  const query = usePayrollVariance(runId);
  const report = query.data;
  if (!report) return null;

  const interesting = report.rows.filter((r) => r.status !== 'UNCHANGED');

  return (
    <AdminSection
      title="Change against last period"
      description="What moved, and by how much. A large unexplained movement is more often a data error than a real change."
      padded={false}
    >
      <AdminNotice tone={report.material.length > 0 ? 'warn' : 'info'}>{report.note}</AdminNotice>

      {report.hasPrevious ? (
        <div style={{ display: 'flex', gap: 24, padding: '8px 16px', flexWrap: 'wrap' }}>
          <span>
            Headcount <strong>{report.headcountPrevious} → {report.headcountCurrent}</strong>
          </span>
          <span>Joiners <strong>{report.joiners}</strong></span>
          <span>Leavers <strong>{report.leavers}</strong></span>
          {report.totals.map((t) => (
            <span key={t.field}>
              {t.field.replace('Cents', '')}{' '}
              <strong>
                {rm(t.deltaCents)}
                {t.percent !== null ? ` (${t.percent > 0 ? '+' : ''}${t.percent}%)` : ''}
              </strong>
            </span>
          ))}
        </div>
      ) : null}

      <Table<PayrollVarianceRow>
        rowKey="staffId"
        size="small"
        pagination={false}
        dataSource={interesting}
        locale={{ emptyText: 'Nobody’s net pay changed against last period.' }}
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 120,
            render: (s: string) => <Tag color={TONE[s]}>{s}</Tag>,
          },
          {
            title: 'Last period',
            dataIndex: 'previousNetCents',
            align: 'right',
            width: 120,
            render: rm,
          },
          { title: 'This period', dataIndex: 'currentNetCents', align: 'right', width: 120, render: rm },
          { title: 'Change', dataIndex: 'deltaCents', align: 'right', width: 120, render: rm },
          {
            title: '%',
            dataIndex: 'percent',
            align: 'right',
            width: 90,
            render: (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p}%`),
          },
        ]}
      />
    </AdminSection>
  );
}
