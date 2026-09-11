import { AdminShell, firstError } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import { StatusChip } from '../components/Chip';
import { usePayComponents } from '../hooks/useAdmin';
import type { PayComponentRow } from '../types';

/**
 * PAYROLL ITEMS — what a clinic can pay or deduct, and what each one counts
 * towards.
 *
 * These seventeen components have existed since the engine was built and have
 * never had a screen: Payroll rules printed the SENTENCE "17 pay components
 * are configured" and stopped there. A clinic could not see which of its
 * allowances were EPF-liable without reading the seed file.
 *
 * Each scheme is its own flag, deliberately. An allowance may be EPF-liable
 * and PCB-exempt, and a single `taxable` boolean cannot say that — so this
 * table shows them as separate columns rather than one "taxable" tick.
 *
 * PIECE 1 SCOPE: this is the list, in its own place, from the existing
 * `GET /workforce/pay-components`. The per-row switches §5 asks for — EPF ·
 * SOCSO · EIS · PCB · HRD · Prorate · OT base · Unpaid-leave base · Recurring
 * · Reimbursement, editable without opening a drawer — are Piece 2.
 */
export function PayrollItemsPage() {
  const components = usePayComponents();
  const rows = components.data?.components ?? [];

  const yesNo = (on: boolean) =>
    on ? (
      <StatusChip tone="ok">Yes</StatusChip>
    ) : (
      <span className="kw-muted">—</span>
    );

  return (
    <AdminShell
      error={firstError(components)}
      title="Payroll items"
      subtitle="What the clinic can pay or deduct, and what each one counts towards."
    >
      <DataTable<PayComponentRow>
        rows={rows}
        loading={components.isLoading}
        rowKey="code"
        searchFields={['code', 'name']}
        searchPlaceholder="Search pay items…"
        emptyText="No pay items are set up yet."
        emptyHint="Payroll rules can seed the standard Malaysian set."
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
