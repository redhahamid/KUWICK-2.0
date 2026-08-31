import { useState } from 'react';
import { App, Button, DatePicker, Modal, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money, moneyOrDash } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useAuthStore } from '../../core/auth-store';
import { isDraftRun, payslipTotals, printPayslip } from './payslip';
import type { PayslipLine } from './payslip';
import { useCan } from '../../core/hooks/useCan';
import {
  useApprovePayroll,
  useCalculatePayroll,
  useCreatePayrollRun,
  usePayrollRun,
  usePayrollRuns,
  useStatutoryRuleSets,
} from '../hooks/useAdmin';

const RUN_STATUS: Record<string, string> = {
  DRAFT: 'default',
  CALCULATED: 'blue',
  APPROVED: 'green',
  PAID: 'green',
  CANCELLED: 'default',
};

/**
 * PAYROLL.
 *
 * The screen exists to make three things impossible to miss:
 *
 *  1. WHETHER THE STATUTORY FIGURES ARE REAL. A run computed with no configured
 *     rates shows blanks, not zeros, and a banner saying which.
 *  2. WHAT COULD NOT BE COMPUTED. Exceptions are listed by name above the
 *     payslips, and the approve button is unavailable while any remain.
 *  3. THAT AN APPROVED RUN IS FINISHED. Once locked it cannot be recalculated —
 *     the database refuses it — and a correction is an adjustment row.
 */
export function PayrollPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const runs = usePayrollRuns({ clinicId });
  const statutory = useStatutoryRuleSets();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const detail = usePayrollRun(selectedId);
  // The employer's registered name and the person pressing print — a payslip
  // names both, and neither is invented: they come from the session the server
  // issued.
  const tenantName = useAuthStore((state) => state.tenant?.name ?? null);
  const me = useAuthStore((state) => state.staff);

  const create = useCreatePayrollRun();
  const calculate = useCalculatePayroll();
  const approve = useApprovePayroll();
  const mayApprove = useCan('hr.payroll.approve');
  const mayRun = useCan('hr.payroll.run');

  const [createOpen, setCreateOpen] = useState(false);
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'));

  const run = detail.data;
  const locked = run?.status === 'APPROVED' || run?.status === 'PAID';
  const hasExceptions = (run?.exceptions.length ?? 0) > 0;
  const statutoryGap = run?.statutoryStatus !== 'CONFIGURED';

  /**
   * IS THIS PAYROLL FIT TO PAY MALAYSIAN STAFF WITH? Currently: no.
   *
   * The engine computes gross, allowances, unpaid-leave proration, deductions
   * it was given, and net. It does NOT contain EPF/KWSP, SOCSO/PERKESO, EIS or
   * PCB schedules — nobody has entered them, and this system will not guess a
   * statutory table. Guessing is the one failure here with a legal consequence
   * attached: an under-deducted PCB is the employer's liability, not a bug
   * report.
   *
   * So the answer is READY only when a rate set exists AND somebody has marked
   * it checked against the authority's published tables. Anything else is the
   * banner below, in the brief's own words, above everything on the page.
   */
  const verifiedRates = statutory.data?.filter((set) => set.verified) ?? [];
  const payrollReady = verifiedRates.length > 0;

  return (
    <AdminShell
      error={firstError(runs, statutory, detail)}
      title="Payroll"
      subtitle="Monthly runs, the exceptions that must be resolved before approval, and the lock that makes an approved run final."
      actions={
        mayRun ? (
          <Button size="small" type="primary" onClick={() => setCreateOpen(true)}>
            New payroll run
          </Button>
        ) : null
      }
    >
      {/* THE FIRST THING ON THIS PAGE, and deliberately not dismissible.
          An owner who scrolls past a quiet grey band and approves a run has
          been told nothing. */}
      {payrollReady ? null : (
        <div className="kw-payrollBlock" role="alert">
          <p className="kw-payrollBlock__headline">NOT READY FOR LIVE MALAYSIAN PAYROLL</p>
          <p className="kw-payrollBlock__body">
            <strong>EPF, SOCSO and EIS are calculated</strong> here, from dated band tables, with the age-60 rules and
            the different wage bases each scheme uses. What is missing is the part nobody can do for you:{' '}
            <strong>nobody has checked those tables against KWSP’s and PERKESO’s own published schedules.</strong> Until
            somebody does, every figure below is provisional.
          </p>
          <p className="kw-payrollBlock__body">
            <strong>PCB is not calculated at all.</strong> Monthly tax deduction requires LHDN’s Computerised
            Calculation method, which is not implemented, and no approximation has been put in its place. An employee
            with no PCB entered blocks the run.
          </p>
          <p className="kw-payrollBlock__body">
            Runs may be produced and reviewed for internal costing. They must not be used to pay staff, to file a
            statutory return, or as the basis of a payslip, until the rate tables are verified and PCB is entered or
            implemented. There is also <strong>no payslip and no bank payment file</strong> in this system yet.
          </p>
        </div>
      )}

      {(statutory.data?.length ?? 0) === 0 ? (
        <AdminNotice tone="warn">
          No statutory rate tables are configured for this clinic. Rates are configuration a clinic owns and dates, not
          something built into the product. Until a table exists, payroll computes gross and net without statutory
          deductions and says so on every line, rather than presenting a plausible wrong figure.
        </AdminNotice>
      ) : statutory.data?.every((set) => !set.verified) ? (
        <AdminNotice tone="warn">
          The configured EPF, SOCSO and EIS tables have not been checked against KWSP’s and PERKESO’s published
          schedules by anybody. They are computed and internally consistent, but until somebody opens the official
          schedule and compares them, runs using them stay provisional and cannot be approved as final.
        </AdminNotice>
      ) : null}

      <AdminSection title="Payroll runs" padded={false}>
        <DataTable
          rows={runs.data}
          loading={runs.isLoading}
          rowKey="id"
          emptyText="No payroll runs"
          onRow={(row) => ({ onClick: () => setSelectedId(row.id) })}
          columns={[
            { title: 'Period', dataIndex: 'period', key: 'period', sorter: (a, b) => a.period.localeCompare(b.period), defaultSortOrder: 'descend' },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => <Tag color={RUN_STATUS[value]}>{value}</Tag>,
            },
            {
              title: 'Statutory',
              dataIndex: 'statutoryStatus',
              key: 'statutoryStatus',
              render: (value: string) => (
                <Tag color={value === 'CONFIGURED' ? 'green' : value === 'PROVISIONAL' ? 'gold' : 'red'}>
                  {value === 'CONFIGURED' ? 'Applied' : value === 'PROVISIONAL' ? 'Unverified rates' : 'Not calculated'}
                </Tag>
              ),
            },
            { title: 'Employees', dataIndex: 'employeeCount', key: 'employeeCount', className: 'kw-num' },
            {
              title: 'Exceptions',
              dataIndex: 'exceptions',
              key: 'exceptions',
              className: 'kw-num',
              render: (count: number) => (count > 0 ? <span className="kw-bad">{count}</span> : '0'),
            },
            { title: 'Gross', dataIndex: 'grossTotal', key: 'grossTotal', className: 'kw-num', render: (v: number) => money(v) },
            { title: 'Deductions', dataIndex: 'deductionTotal', key: 'deductionTotal', className: 'kw-num', render: (v: number) => money(v) },
            { title: 'Net', dataIndex: 'netTotal', key: 'netTotal', className: 'kw-num', render: (v: number) => <strong>{money(v)}</strong> },
            {
              title: 'Employer cost',
              dataIndex: 'employerCostTotal',
              key: 'employerCostTotal',
              className: 'kw-num',
              optional: true,
              render: (v: number) => money(v),
            },
            { title: 'Approved by', dataIndex: 'approvedBy', key: 'approvedBy' },
            { title: 'Adjustments', dataIndex: 'adjustments', key: 'adjustments', className: 'kw-num', optional: true },
          ]}
        />
      </AdminSection>

      {run ? (
        <AdminSection
          title={`${run.period} · ${run.clinicName}`}
          description={locked ? `Approved by ${run.approvedBy} on ${dayjs(run.approvedAt).format('D MMM YYYY')}. This run is locked — a correction is an adjustment, not an edit.` : undefined}
          actions={
            <>
              {!locked && mayRun ? (
                <Button
                  size="small"
                  loading={calculate.isPending}
                  onClick={() =>
                    calculate.mutate(run.id, {
                      onSuccess: () => message.success('Recalculated'),
                      onError: (error: Error) => message.error(error.message),
                    })
                  }
                >
                  Recalculate
                </Button>
              ) : null}
              {run.status === 'CALCULATED' && mayApprove ? (
                <Button
                  size="small"
                  type="primary"
                  disabled={hasExceptions}
                  loading={approve.isPending}
                  onClick={() =>
                    approve.mutate(
                      { id: run.id, acknowledgeStatutoryGap: statutoryGap },
                      {
                        onSuccess: () => message.success('Approved and locked'),
                        onError: (error: Error) => message.error(error.message),
                      },
                    )
                  }
                >
                  {statutoryGap ? 'Approve without statutory figures' : 'Approve and lock'}
                </Button>
              ) : null}
            </>
          }
          padded={false}
        >
          <div style={{ padding: '12px 16px 0' }}>
            {run.statutoryNotice ? <AdminNotice tone="warn">{run.statutoryNotice}</AdminNotice> : null}
            {hasExceptions ? (
              <AdminNotice tone="warn">
                <strong>{run.exceptions.length} exception(s) must be resolved before this run can be approved.</strong>
                <ul style={{ margin: '6px 0 0 18px' }}>
                  {run.exceptions.map((exception) => (
                    <li key={`${exception.staffId}-${exception.issue}`}>
                      <strong>{exception.name}</strong> — {exception.issue}
                    </li>
                  ))}
                </ul>
              </AdminNotice>
            ) : null}
          </div>

          <StatStrip
            stats={[
              { label: 'Employees paid', value: run.employeeCount },
              { label: 'Gross', value: money(run.grossTotal) },
              { label: 'Deductions', value: money(run.deductionTotal) },
              { label: 'Net paid', value: money(run.netTotal), tone: 'good' },
              { label: 'Total cost to clinic', value: money(run.employerCostTotal), explain: 'Gross plus employer statutory contributions.' },
            ]}
          />

          <DataTable
            rows={run.lines}
            rowKey="id"
            exportName={`payroll-${run.period}`}
            searchFields={['name' as never]}
            searchPlaceholder="Search employee…"
            emptyText="No payslips in this run"
            scrollY={460}
            columns={[
              { title: 'Employee', dataIndex: 'name', key: 'name' },
              { title: 'Basic', dataIndex: 'basicSalary', key: 'basicSalary', className: 'kw-num', render: (v: number) => money(v) },
              { title: 'Overtime', dataIndex: 'overtimePay', key: 'overtimePay', className: 'kw-num', render: (v: number) => money(v) },
              { title: 'Incentives', dataIndex: 'incentives', key: 'incentives', className: 'kw-num', render: (v: number) => money(v) },
              {
                title: 'Unpaid leave',
                dataIndex: 'unpaidLeaveDeduction',
                key: 'unpaidLeaveDeduction',
                className: 'kw-num',
                render: (v: number) => (v === 0 ? <span className="kw-muted">—</span> : <span className="kw-bad">-{money(v)}</span>),
              },
              { title: 'Gross', dataIndex: 'grossPay', key: 'grossPay', className: 'kw-num', render: (v: number) => <strong>{money(v)}</strong> },
              {
                title: 'EPF (emp)',
                dataIndex: 'epfEmployee',
                key: 'epfEmployee',
                className: 'kw-num',
                render: (v: number | null) => moneyOrDash(v),
              },
              { title: 'EPF (er)', dataIndex: 'epfEmployer', key: 'epfEmployer', className: 'kw-num', optional: true, render: (v: number | null) => moneyOrDash(v) },
              { title: 'SOCSO', dataIndex: 'socsoEmployee', key: 'socsoEmployee', className: 'kw-num', render: (v: number | null) => moneyOrDash(v) },
              { title: 'EIS', dataIndex: 'eisEmployee', key: 'eisEmployee', className: 'kw-num', render: (v: number | null) => moneyOrDash(v) },
              { title: 'PCB', dataIndex: 'pcb', key: 'pcb', className: 'kw-num', render: (v: number | null) => moneyOrDash(v) },
              { title: 'Net', dataIndex: 'netPay', key: 'netPay', className: 'kw-num', render: (v: number) => <strong>{money(v)}</strong> },
              { title: 'Worked days', dataIndex: 'workedDays', key: 'workedDays', className: 'kw-num', optional: true },
              { title: 'OT hours', dataIndex: 'overtimeHours', key: 'overtimeHours', className: 'kw-num', optional: true },
              {
                title: '',
                key: 'payslip',
                render: (_: unknown, row: PayslipLine) => {
                  // A payslip that does not add up must not be printable as
                  // one — the button still works, because seeing the refusal
                  // on the page is how somebody finds out, but it says what it
                  // will produce.
                  const totals = payslipTotals(row);
                  return (
                    <Button
                      size="small"
                      type="link"
                      danger={!totals.adds}
                      onClick={() =>
                        printPayslip(run, row, {
                          employerName: tenantName ?? run.clinicName,
                          branchName: run.clinicName,
                          printedBy: me?.fullName ?? null,
                        })
                      }
                    >
                      {totals.adds ? (isDraftRun(run.status) ? 'Print draft' : 'Print payslip') : 'Does not add up'}
                    </Button>
                  );
                },
              },
            ]}
          />

          {/*
            A payslip is a statutory record under the Employment Act 1955 s.19,
            and the failure mode is not an ugly document — it is one that looks
            official and is not. So the page says, before anybody prints, what
            the print will carry.
          */}
          <AdminNotice tone={isDraftRun(run.status) ? 'warn' : 'info'}>
            {isDraftRun(run.status) ? (
              <>
                <strong>This run is {RUN_STATUS[run.status] ?? run.status}.</strong> Payslips printed
                from it carry a DRAFT watermark and say they are not payslips. Approve the run first
                if you intend to hand these out.
              </>
            ) : (
              <>
                Payslips print through your browser — choose <strong>Save as PDF</strong> in the
                print dialog to keep a copy. A statutory figure that was not calculated prints as
                blank with the reason, never as 0.00.
              </>
            )}
          </AdminNotice>

          {run.adjustments.length > 0 ? (
            <AdminSection title="Adjustments to this locked run" padded={false}>
              <DataTable
                rows={run.adjustments}
                rowKey="id"
                emptyText="None"
                columns={[
                  { title: 'Employee', dataIndex: 'staffName', key: 'staffName' },
                  { title: 'Description', dataIndex: 'description', key: 'description' },
                  {
                    title: 'Amount',
                    dataIndex: 'amount',
                    key: 'amount',
                    className: 'kw-num',
                    render: (v: number) => <span className={v < 0 ? 'kw-bad' : 'kw-good'}>{money(v)}</span>,
                  },
                  { title: 'Reason', dataIndex: 'reason', key: 'reason' },
                  { title: 'By', dataIndex: 'by', key: 'by' },
                  { title: 'When', dataIndex: 'at', key: 'at', render: (v: string) => dayjs(v).format('D MMM YY') },
                ]}
              />
            </AdminSection>
          ) : null}
        </AdminSection>
      ) : null}

      <Modal
        open={createOpen}
        title="New payroll run"
        okText="Create"
        confirmLoading={create.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          create.mutate(
            { period, clinicId },
            {
              onSuccess: (result) => {
                message.success('Run created — calculate it next');
                setCreateOpen(false);
                setSelectedId((result as { id: string }).id);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <DatePicker
          picker="month"
          style={{ width: '100%' }}
          value={dayjs(period)}
          onChange={(value) => value && setPeriod(value.format('YYYY-MM'))}
        />
      </Modal>
    </AdminShell>
  );
}
