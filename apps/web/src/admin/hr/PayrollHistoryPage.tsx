import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Select } from 'antd';
import dayjs from 'dayjs';
import { AdminShell, firstError } from '../components/AdminShell';
import { DataTable, ringgit } from '../components/DataTable';
import { StatusChip, humanise } from '../components/Chip';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { usePayrollRuns } from '../hooks/useAdmin';
import type { PayrollRunRow } from '../types';

/**
 * PAYROLL HISTORY — SECONDARY, ON PURPOSE.
 *
 * A table of previous runs used to be the bottom half of the payroll LANDING
 * page, which meant every owner opening payroll to pay people this month first
 * scrolled past what happened in the months they had already dealt with.
 *
 * Months you have finished are reference material. They get a small control
 * beside the month selector and their own screen, and that is the right
 * prominence for something opened when a question comes up rather than every
 * time payroll is run.
 *
 * A ROW OPENS THE FROZEN MONTH. An approved run is its snapshot — the workspace
 * renders it read-only, so history is the same register, not a second
 * rendering of the same figures that could disagree with it.
 */
export function PayrollHistoryPage() {
  const { clinicId } = useClinicFilter();
  const thisYear = dayjs().year();
  const [year, setYear] = useState(thisYear);
  const runs = usePayrollRuns({ clinicId, year });

  return (
    <AdminShell
      error={firstError(runs)}
      title="Payroll history"
      actions={
        <>
          <Select
            size="small"
            value={year}
            onChange={setYear}
            aria-label="Year"
            style={{ width: 96 }}
            options={[0, 1, 2, 3].map((back) => ({ value: thisYear - back, label: String(thisYear - back) }))}
          />
          <Link to="/admin/hr/payroll">
            <Button size="small" type="primary">
              This month
            </Button>
          </Link>
        </>
      }
    >
      <DataTable<PayrollRunRow>
        rows={runs.data}
        loading={runs.isLoading}
        rowKey="id"
        emptyText={`No payroll was run in ${year}.`}
        emptyHint="Months appear here once they have been started."
        columns={[
          {
            title: 'Month',
            dataIndex: 'period',
            render: (value: string, row) => (
              <Link to={`/admin/hr/payroll/${row.id}`} className="kw-linkStrong">
                {dayjs(value).format('MMMM YYYY')}
              </Link>
            ),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (value: string, row) =>
              row.statutoryStatus !== 'CONFIGURED' ? (
                <StatusChip tone="attention" dot>
                  {humanise(value)} · provisional
                </StatusChip>
              ) : (
                <StatusChip tone={value === 'PAID' || value === 'APPROVED' ? 'ok' : 'info'} dot>
                  {humanise(value)}
                </StatusChip>
              ),
          },
          { title: 'Employees', dataIndex: 'employeeCount', align: 'right' },
          {
            title: 'Gross',
            dataIndex: 'grossTotal',
            align: 'right',
            render: (value: number) => ringgit(value.toFixed(2)),
          },
          {
            title: 'Net pay',
            dataIndex: 'netTotal',
            align: 'right',
            render: (value: number) => <strong className="kw-num">{ringgit(value.toFixed(2))}</strong>,
          },
          {
            title: 'Cost to clinic',
            dataIndex: 'employerCostTotal',
            align: 'right',
            render: (value: number) => ringgit(value.toFixed(2)),
          },
          {
            title: 'Approved by',
            dataIndex: 'approvedBy',
            render: (value: string | null) => value ?? <span className="kw-muted">—</span>,
          },
          {
            title: 'Approved',
            dataIndex: 'approvedAt',
            render: (value: string | null) =>
              value ? dayjs(value).format('D MMM YYYY') : <span className="kw-muted">—</span>,
          },
        ]}
      />
    </AdminShell>
  );
}
