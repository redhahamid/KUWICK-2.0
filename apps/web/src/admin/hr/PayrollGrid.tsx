import { useMemo } from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PersonCell } from '../components/Person';
import type { PayrollRunDetail } from '../types';

type Line = PayrollRunDetail['lines'][number];

/**
 * THE PAYROLL REGISTER, AS ONE TABLE.
 *
 * This is the whole point of the rebuild. The owner's question was "why is
 * payroll harder to understand than an Excel payroll sheet?", and the answer
 * was never that the figures were wrong — `PayrollLine` has carried basic,
 * allowances, overtime, incentives, bonus, gross, unpaid leave, other
 * deductions, EPF, SOCSO, EIS, LINDUNG, PCB and net since the engine was
 * built. The screens simply never put them beside each other. An owner
 * assembled the register in their head from six separate steps.
 *
 * People down, money across, totals below — and the person and their net pay
 * pinned, because those are the two columns you must not lose while reading
 * sideways.
 *
 * A ROW OPENS A DRAWER, NOT AN EXPANSION. The detail used to open UNDER the
 * row, which pushed every other row down the screen: the moment you opened
 * one, you lost the register you were reading it against. See
 * PayrollEmployeeDrawer.
 *
 * A BLANK IS NOT A ZERO. Statutory figures are nullable on purpose: null means
 * "not worked out" — no rates configured, or a fact missing — and rendering it
 * as 0.00 tells a clinic it owes nothing, which is the one wrong answer that
 * gets acted on. Nulls render as "—" and the run's own statutory notice says
 * why.
 */
export function PayrollGrid({
  run,
  onOpenEmployee,
  selectedStaffId,
  otherEarnings,
}: {
  run: PayrollRunDetail;
  onOpenEmployee: (line: Line) => void;
  selectedStaffId?: string;
  /**
   * THE RESIDUAL, PER PERSON, FROM THE SERVER.
   *
   * Basic + allowances + overtime + incentives + bonus does NOT always reach
   * gross: a reimbursed claim and a mileage payment are earnings that belong
   * to none of those five. Without this column the register is a money table
   * that visibly fails to add up across, which is the exact defect two earlier
   * versions of the earnings table had.
   *
   * It is `pay.rows[].otherEarnings` — a residual of the line's OWN gross,
   * worked out by the engine — and never a subtraction done here, because a
   * screen that does payroll arithmetic is a second payroll implementation.
   */
  otherEarnings?: Map<string, string>;
}) {
  const money = (value: number | null) =>
    value === null || value === undefined ? (
      <span className="kw-muted" title="Not worked out — see the statutory notice above">
        —
      </span>
    ) : (
      <span className="kw-num">{value.toFixed(2)}</span>
    );

  const columns: ColumnsType<Line> = [
    {
      title: 'Employee',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      width: 216,
      render: (value: string, row) => <PersonCell name={value} meta={row.snapshot?.position ?? undefined} size={26} />,
    },
    { title: 'Basic', dataIndex: 'basicSalary', key: 'basicSalary', align: 'right', width: 110, render: money },
    { title: 'Allowances', dataIndex: 'allowances', key: 'allowances', align: 'right', width: 115, render: money },
    { title: 'Overtime', dataIndex: 'overtimePay', key: 'overtimePay', align: 'right', width: 110, render: money },
    { title: 'Incentives', dataIndex: 'incentives', key: 'incentives', align: 'right', width: 110, render: money },
    { title: 'Bonus', dataIndex: 'bonus', key: 'bonus', align: 'right', width: 105, render: money },
    {
      title: 'Claims & other',
      key: 'otherEarnings',
      align: 'right',
      width: 130,
      render: (_: unknown, row) => {
        const value = otherEarnings?.get(row.staffId);
        if (value === undefined) return <span className="kw-muted">—</span>;
        return Number(value) === 0 ? (
          <span className="kw-num">0.00</span>
        ) : (
          <span className="kw-num">{value}</span>
        );
      },
    },
    {
      title: 'Gross',
      dataIndex: 'grossPay',
      key: 'grossPay',
      align: 'right',
      width: 120,
      render: (value: number) => <strong className="kw-num">{value.toFixed(2)}</strong>,
    },
    {
      title: 'Unpaid leave',
      dataIndex: 'unpaidLeaveDeduction',
      key: 'unpaidLeaveDeduction',
      align: 'right',
      width: 125,
      render: (value: number) => (value ? <span className="kw-num kw-bad">-{value.toFixed(2)}</span> : money(value)),
    },
    {
      title: 'Other deductions',
      dataIndex: 'otherDeductions',
      key: 'otherDeductions',
      align: 'right',
      width: 145,
      render: (value: number) => (value ? <span className="kw-num kw-bad">-{value.toFixed(2)}</span> : money(value)),
    },
    { title: 'EPF', dataIndex: 'epfEmployee', key: 'epfEmployee', align: 'right', width: 100, render: money },
    { title: 'SOCSO', dataIndex: 'socsoEmployee', key: 'socsoEmployee', align: 'right', width: 100, render: money },
    { title: 'EIS', dataIndex: 'eisEmployee', key: 'eisEmployee', align: 'right', width: 95, render: money },
    { title: 'LINDUNG', dataIndex: 'lindungEmployee', key: 'lindungEmployee', align: 'right', width: 110, render: money },
    { title: 'PCB', dataIndex: 'pcb', key: 'pcb', align: 'right', width: 100, render: money },
    {
      title: 'Net pay',
      dataIndex: 'netPay',
      key: 'netPay',
      align: 'right',
      fixed: 'right',
      width: 130,
      render: (value: number) => <strong className="kw-num kw-payrollGrid__net">{value.toFixed(2)}</strong>,
    },
  ];

  const totals = useMemo(() => {
    const sum = (pick: (line: Line) => number | null) =>
      run.lines.reduce((acc, line) => acc + (pick(line) ?? 0), 0);
    return {
      basicSalary: sum((l) => l.basicSalary),
      allowances: sum((l) => l.allowances),
      overtimePay: sum((l) => l.overtimePay),
      incentives: sum((l) => l.incentives),
      bonus: sum((l) => l.bonus),
      // The residual's total is the sum of the SERVER's per-person residuals,
      // not a second derivation of the same idea.
      otherEarnings: run.lines.reduce(
        (acc, line) => acc + Number(otherEarnings?.get(line.staffId) ?? 0),
        0,
      ),
      grossPay: sum((l) => l.grossPay),
      unpaidLeaveDeduction: sum((l) => l.unpaidLeaveDeduction),
      otherDeductions: sum((l) => l.otherDeductions),
      epfEmployee: sum((l) => l.epfEmployee),
      socsoEmployee: sum((l) => l.socsoEmployee),
      eisEmployee: sum((l) => l.eisEmployee),
      lindungEmployee: sum((l) => l.lindungEmployee),
      pcb: sum((l) => l.pcb),
      netPay: sum((l) => l.netPay),
    };
  }, [run.lines]);

  return (
    <div className="kw-payrollGrid">
      <Table<Line>
        rowKey="id"
        size="small"
        dataSource={run.lines}
        columns={columns}
        pagination={false}
        // The register is wide by nature. It scrolls sideways inside its own
        // box, with the person and their net pay pinned — the two columns you
        // never want to lose sight of while reading across.
        scroll={{ x: 'max-content', y: 560 }}
        sticky
        onRow={(row) => ({ onClick: () => onOpenEmployee(row) })}
        rowClassName={(row) =>
          row.staffId === selectedStaffId
            ? 'kw-dataTable__row--clickable kw-payrollGrid__row--selected'
            : 'kw-dataTable__row--clickable'
        }
        summary={() => (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row className="kw-payrollGrid__totals">
              {/*
                * POSITIONAL CELLS, and there is no expander column any more.
                * When there WAS one, its cell had to be counted here or every
                * total slid one place left: the figure under NET PAY was PCB's
                * and the month's net was off the end of the row. It looked
                * plausible, which is the dangerous kind of wrong — so the
                * count is stated rather than assumed.
                */}
              <Table.Summary.Cell index={0}>
                <strong>{run.lines.length} employees</strong>
              </Table.Summary.Cell>
              {(
                [
                  'basicSalary',
                  'allowances',
                  'overtimePay',
                  'incentives',
                  'bonus',
                  'otherEarnings',
                  'grossPay',
                  'unpaidLeaveDeduction',
                  'otherDeductions',
                  'epfEmployee',
                  'socsoEmployee',
                  'eisEmployee',
                  'lindungEmployee',
                  'pcb',
                  'netPay',
                ] as const
              ).map((key, index) => (
                <Table.Summary.Cell key={key} index={index + 1} align="right">
                  <strong className="kw-num">{totals[key].toFixed(2)}</strong>
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </div>
  );
}
