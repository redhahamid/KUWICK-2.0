import { App, Button } from 'antd';
import { Link } from 'react-router-dom';
import { AdminNotice, AdminShell, firstError } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import { StatusChip } from '../components/Chip';
import { usePayComponents, useSeedPayComponents } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import type { PayComponentRow } from '../types';

/**
 * PAYROLL ITEMS — what a clinic can pay or deduct, and what each one counts
 * towards.
 *
 * These seventeen components have existed since the engine was built and had
 * no screen of their own: Payroll rules printed the SENTENCE "17 pay
 * components are configured" and stopped there, while the full table sat on
 * the LEGAL EMPLOYERS page, under the company's EPF and SOCSO numbers, where
 * nobody looking for an allowance would think to look. A clinic could not see
 * which of its allowances were EPF-liable without reading a seed file or
 * finding that table by accident.
 *
 * One table now, on the card named after it, carrying everything the employer
 * page carried: the scheme flags, the two bases, and whether a human has
 * checked the flag against the authority's own schedule.
 *
 * Each scheme is its own column, deliberately. An allowance may be EPF-liable
 * and PCB-exempt, and a single `taxable` boolean cannot say that.
 *
 * The per-row switches — EPF · SOCSO · EIS · PCB · HRD · Prorate · OT base ·
 * Unpaid-leave base · Recurring · Reimbursement, editable without opening a
 * drawer — are their own piece of work, after the design kit lands.
 */
export function PayrollItemsPage() {
  const { message } = App.useApp();
  const components = usePayComponents();
  const seed = useSeedPayComponents();
  const mayManage = useCan('hr.statutory.manage');
  const rows = components.data?.components ?? [];

  const yesNo = (on: boolean) =>
    on ? <StatusChip tone="ok">Yes</StatusChip> : <span className="kw-muted">—</span>;

  return (
    <AdminShell
      error={firstError(components)}
      title="Payroll items"
      subtitle="What the clinic can pay or deduct, and what each one counts towards."
      actions={
        mayManage && rows.length === 0 ? (
          <Button
            size="small"
            loading={seed.isPending}
            onClick={() =>
              seed.mutate(undefined, {
                onSuccess: () => message.success('Catalogue seeded — every flag UNVERIFIED'),
                onError: (e: Error) => message.error(e.message),
              })
            }
          >
            Seed the catalogue
          </Button>
        ) : (
          <Link to="/admin/hr/settings">
            <Button size="small">← Settings</Button>
          </Link>
        )
      }
    >
      {/* A seeded flag is Kuwick's reading of the schedules, not the clinic's.
          The notice says so, and it moved here with the table it is about. */}
      {components.data ? <AdminNotice tone="warn">{components.data.verificationNotice.statement}</AdminNotice> : null}

      <DataTable<PayComponentRow>
        rows={rows}
        loading={components.isLoading}
        rowKey="code"
        searchFields={['code', 'name']}
        searchPlaceholder="Search pay items…"
        emptyText="No pay items are set up yet."
        emptyHint="Payroll policies can seed the standard Malaysian set."
        columns={[
          {
            title: 'Item',
            dataIndex: 'name',
            render: (value: string, row) => (
              <div>
                <div style={{ fontWeight: 600 }}>{value}</div>
                <span className="kw-muted" style={{ fontSize: 12 }}>
                  {row.code}
                </span>
              </div>
            ),
          },
          {
            title: 'Adds or deducts',
            dataIndex: 'type',
            width: 140,
            render: (value: string) => (
              <StatusChip tone={value === 'DEDUCTION' ? 'attention' : 'info'}>
                {value === 'DEDUCTION' ? 'Deducts' : value === 'OVERTIME' ? 'Overtime' : 'Adds'}
              </StatusChip>
            ),
          },
          { title: 'EPF', dataIndex: 'epfLiable', width: 90, render: yesNo },
          { title: 'SOCSO', dataIndex: 'socsoLiable', width: 96, render: yesNo },
          { title: 'EIS', dataIndex: 'eisLiable', width: 90, render: yesNo },
          { title: 'PCB', dataIndex: 'pcbLiable', width: 90, render: yesNo },
          { title: 'HRD', dataIndex: 'hrdLiable', width: 90, render: yesNo },
          { title: 'Pro-rated', dataIndex: 'prorated', width: 110, render: yesNo },
          // The two bases the employer page carried and nothing else showed:
          // whether this item enlarges an overtime hour, and whether it shrinks
          // when somebody takes unpaid leave.
          { title: 'OT base', dataIndex: 'includeInOrpBase', width: 100, render: yesNo },
          { title: 'Unpaid-leave base', dataIndex: 'includeInUnpaidLeaveBase', width: 150, render: yesNo },
          {
            title: 'Checked',
            dataIndex: 'verificationStatus',
            width: 120,
            render: (status: string) =>
              status === 'VERIFIED' ? (
                <StatusChip tone="ok">Checked</StatusChip>
              ) : (
                <StatusChip tone="attention">Unchecked</StatusChip>
              ),
          },
          {
            title: 'Status',
            dataIndex: 'active',
            width: 110,
            render: (active: boolean) =>
              active ? <StatusChip tone="ok" dot>In use</StatusChip> : <StatusChip tone="neutral">Off</StatusChip>,
          },
        ]}
      />
    </AdminShell>
  );
}
