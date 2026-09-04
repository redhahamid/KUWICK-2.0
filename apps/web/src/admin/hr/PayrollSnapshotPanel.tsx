import { Table } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection } from '../components/AdminShell';
import { money } from '../components/DataTable';
import { useCandidateDiff, usePayrollSnapshots } from '../hooks/useAdmin';
import type { PayrollCandidateDiff, PayrollSnapshotRow } from '../types';

/**
 * WHAT WAS APPROVED, AND WHAT WOULD CHANGE IF IT WERE RUN AGAIN.
 *
 * Approving a payroll run writes an immutable snapshot of everything the
 * calculation used, hashed, versioned and attributed. Reopening it never
 * erases the previous one — the next approval writes version 2 beside version
 * 1 — so the record reads as a sequence of things that were true rather than
 * one mutable present.
 *
 * All of that shipped in Stage 2 with no screen, which meant the guarantee
 * existed and nobody could see it. A guarantee nobody can inspect is
 * indistinguishable from one nobody implemented.
 *
 * THE HASH IS SHOWN, short. Not because anybody reads a hash, but because two
 * versions with the same hash are provably the same calculation and two with
 * different hashes are provably not, and that is the question a person asks
 * when they reopen a run and want to know whether anything actually moved.
 */
export function PayrollSnapshotPanel({ runId }: { runId: string }) {
  const snapshots = usePayrollSnapshots(runId);
  const diff = useCandidateDiff(runId);

  const rows = snapshots.data ?? [];
  if (rows.length === 0) {
    return (
      <AdminSection
        title="Approved snapshots"
        description="Approval freezes what was calculated, so an approved run stays answerable after master data moves."
      >
        <p className="kw-muted" style={{ margin: 0 }}>
          This run has never been approved, so nothing has been frozen yet.
        </p>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title="Approved snapshots"
      description="Each approval freezes the whole calculation and hashes it. Reopening keeps the previous version; it never overwrites it."
      padded={false}
    >
      <Table<PayrollSnapshotRow>
        rowKey="id"
        size="small"
        pagination={false}
        loading={snapshots.isLoading}
        dataSource={rows}
        columns={[
          {
            title: 'Version',
            dataIndex: 'version',
            width: 90,
            render: (v: number, row) => (
              <span>
                <strong>v{v}</strong>
                {row === rows[0] ? <span className="kw-muted"> · latest</span> : null}
              </span>
            ),
          },
          {
            title: 'Approved',
            key: 'when',
            render: (_: unknown, row) => (
              <div>
                <div>{dayjs(row.createdAt).format('D MMM YYYY, HH:mm')}</div>
                {/*
                  `payroll_snapshots.reason` is in the schema and nothing ever
                  writes it — approve() does not set it and reopen() records
                  its reason on the audit trail instead. Rendering it here drew
                  a permanently empty field, so the row says who and when, and
                  the reason for a reopen is read where it is actually kept.
                */}
                <div className="kw-muted" style={{ fontSize: 11.5 }}>{row.createdBy}</div>
              </div>
            ),
          },
          {
            title: 'Employees',
            key: 'employees',
            align: 'right',
            width: 100,
            render: (_: unknown, row) => row.totals.employeeCount,
          },
          {
            title: 'Net',
            key: 'net',
            align: 'right',
            width: 130,
            render: (_: unknown, row) => <strong>{money(row.totals.netCents / 100)}</strong>,
          },
          {
            title: 'Employer cost',
            key: 'cost',
            align: 'right',
            width: 140,
            render: (_: unknown, row) => money(row.totals.employerCostCents / 100),
          },
          {
            title: 'Hash',
            dataIndex: 'hash',
            width: 110,
            // Twelve characters is enough to tell two versions apart by eye and
            // short enough not to dominate the row.
            render: (h: string) => <code className="kw-hash">{h.slice(0, 12)}</code>,
          },
          {
            /*
             * A HASH IS NOT A PROOF UNTIL SOMEBODY CHECKS IT.
             *
             * The panel showed a stored hash and left the reader to assume it
             * still matched. It is re-computed on every read now, and the
             * frozen figures are re-run through the same invariants the
             * calculation uses, so this column reports a check rather than a
             * claim.
             */
            title: 'Checks out',
            key: 'verdict',
            width: 130,
            render: (_: unknown, row) => <SnapshotVerdict row={row} />,
          },
        ]}
      />

      <CandidateDiff data={diff.data} />
    </AdminSection>
  );
}

const VERDICT_LABEL: Record<PayrollSnapshotRow['verdict'], { text: string; tone: string }> = {
  VERIFIED: { text: 'Verified', tone: 'kw-verdict--ok' },
  TAMPERED: { text: 'Does not match', tone: 'kw-verdict--bad' },
  INCONSISTENT: { text: 'Does not add up', tone: 'kw-verdict--bad' },
  UNVERIFIABLE_SCHEMA: { text: 'Older format', tone: 'kw-verdict--warn' },
};

function SnapshotVerdict({ row }: { row: PayrollSnapshotRow }) {
  const label = VERDICT_LABEL[row.verdict] ?? { text: row.verdict, tone: 'kw-verdict--warn' };
  return (
    <span className={`kw-verdict ${label.tone}`} title={row.verificationNote}>
      {label.text}
    </span>
  );
}

/**
 * The comparison a person needs before RE-approving a run they reopened: does
 * the recalculation still produce what was approved, and if not, for whom.
 */
function CandidateDiff({ data }: { data: PayrollCandidateDiff | undefined }) {
  if (!data?.hasSnapshot || !data.diff) return null;

  if (data.diff.identical) {
    return (
      <div style={{ padding: '10px 16px 14px' }}>
        <AdminNotice tone="info">
          {data.note} Snapshot v{data.snapshotVersion} and a fresh calculation hash identically.
        </AdminNotice>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 16px 14px' }}>
      <AdminNotice tone="warn">
        <strong>{data.note}</strong> Approving again would replace snapshot v{data.snapshotVersion} with these figures.
      </AdminNotice>

      <Table
        rowKey={(row) => `${row.staffId}-${row.field}`}
        size="small"
        pagination={false}
        style={{ marginTop: 10 }}
        dataSource={data.diff.changed}
        locale={{ emptyText: 'No per-employee figure moved.' }}
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          { title: 'Figure', dataIndex: 'field', width: 170, render: (f: string) => FIELD_LABEL[f] ?? f },
          {
            title: 'Approved',
            dataIndex: 'before',
            align: 'right',
            width: 120,
            render: (v: number | null) => (v === null ? '—' : money(v / 100)),
          },
          {
            title: 'Now',
            dataIndex: 'after',
            align: 'right',
            width: 120,
            render: (v: number | null) => (v === null ? '—' : money(v / 100)),
          },
          {
            title: 'Movement',
            dataIndex: 'deltaCents',
            align: 'right',
            width: 120,
            // Direction is the fact somebody scans for, so the sign is kept.
            render: (v: number | null) =>
              v === null ? '—' : <span className={v < 0 ? 'kw-bad' : 'kw-good'}>{v > 0 ? '+' : ''}{money(v / 100)}</span>,
          },
        ]}
      />

      {data.diff.added.length > 0 || data.diff.removed.length > 0 ? (
        <p className="kw-muted" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
          {data.diff.added.length > 0 ? `Added: ${data.diff.added.map((a) => a.name).join(', ')}. ` : ''}
          {data.diff.removed.length > 0 ? `No longer in the run: ${data.diff.removed.map((r) => r.name).join(', ')}.` : ''}
        </p>
      ) : null}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  netCents: 'Net pay',
  employerCostCents: 'Employer cost',
  epfEmployeeCents: 'EPF (employee)',
  epfEmployerCents: 'EPF (employer)',
  socsoEmployeeCents: 'SOCSO (employee)',
  socsoEmployerCents: 'SOCSO (employer)',
  eisEmployeeCents: 'EIS (employee)',
  eisEmployerCents: 'EIS (employer)',
  pcbCents: 'PCB',
  grossCents: 'Gross',
};
