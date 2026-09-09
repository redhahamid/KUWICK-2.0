import { useMemo, useState } from 'react';
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { usePayrollInputs } from '../hooks/useAdmin';
import type { PayrollInputRow, PayrollRunDetail } from '../types';

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
 * Rows are people, columns are money, and the answer to "what is this person
 * being paid, and why" is one row and one click.
 *
 * A BLANK IS NOT A ZERO. Statutory figures are nullable on purpose: null means
 * "not worked out" — no rates configured, or a fact missing — and rendering it
 * as 0.00 tells a clinic it owes nothing, which is the one wrong answer that
 * gets acted on. Nulls render as "—" and the run's own statutory notice says
 * why.
 */
export function PayrollGrid({ run, period }: { run: PayrollRunDetail; period: string }) {
  const [expanded, setExpanded] = useState<string[]>([]);

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
      width: 210,
      render: (value: string, row) => (
        <div className="kw-payrollGrid__who">
          <span className="kw-payrollGrid__name">{value}</span>
          {row.snapshot?.position ? <span className="kw-muted">{row.snapshot.position}</span> : null}
        </div>
      ),
    },
    { title: 'Basic', dataIndex: 'basicSalary', key: 'basicSalary', align: 'right', width: 110, render: money },
    { title: 'Allowances', dataIndex: 'allowances', key: 'allowances', align: 'right', width: 115, render: money },
    { title: 'Overtime', dataIndex: 'overtimePay', key: 'overtimePay', align: 'right', width: 110, render: money },
    { title: 'Incentives', dataIndex: 'incentives', key: 'incentives', align: 'right', width: 110, render: money },
    { title: 'Bonus', dataIndex: 'bonus', key: 'bonus', align: 'right', width: 105, render: money },
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
        expandable={{
          expandedRowKeys: expanded,
          onExpandedRowsChange: (keys) => setExpanded(keys as string[]),
          expandedRowRender: (row) => <LineLineage staffId={row.staffId} period={period} line={row} />,
          rowExpandable: () => true,
        }}
        summary={() => (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row className="kw-payrollGrid__totals">
              {/*
                * THE EXPANDER IS A COLUMN, and the summary has to say so.
                * Without this cell every total slid one place left: the figure
                * under NET PAY was PCB's, and the month's net — the number the
                * whole screen exists for — was off the end of the row. It
                * looked plausible, which is the dangerous kind of wrong.
                */}
              <Table.Summary.Cell index={0} />
              <Table.Summary.Cell index={1}>
                <strong>{run.lines.length} employees</strong>
              </Table.Summary.Cell>
              {(
                [
                  'basicSalary',
                  'allowances',
                  'overtimePay',
                  'incentives',
                  'bonus',
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
                <Table.Summary.Cell key={key} index={index + 2} align="right">
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

/**
 * WHERE EACH FIGURE ON THIS ROW CAME FROM.
 *
 * Every amount in the run traces to a `PayrollInputEntry` carrying its source
 * — ATTENDANCE, CLAIM, INCENTIVE, LEAVE, SALARY — and the provenance sentence
 * written when it was materialised. That has always been in the API and never
 * on a screen, so "why is this RM320?" meant asking somebody who knew the
 * system rather than reading the answer.
 */
function LineLineage({ staffId, period, line }: { staffId: string; period: string; line: Line }) {
  const { data, isLoading } = usePayrollInputs({ period, staffId });

  const SOURCE_LABEL: Record<string, string> = {
    ATTENDANCE: 'Attendance',
    CLAIM: 'Approved claim',
    INCENTIVE: 'Doctor incentives',
    LEAVE: 'Leave',
    SALARY: 'Employee salary',
    MANUAL: 'Entered by hand',
    RECURRING: 'Recurring item',
  };

  return (
    <div className="kw-lineage">
      <div className="kw-lineage__fixed">
        <div className="kw-lineage__row">
          <span className="kw-lineage__label">Basic salary</span>
          <span className="kw-num">{line.basicSalary.toFixed(2)}</span>
          <span className="kw-muted">Source: the salary in force this month</span>
        </div>
        {line.workedDays !== null || line.overtimeHours !== null || line.unpaidDays !== null ? (
          <div className="kw-lineage__row kw-lineage__row--facts">
            <span className="kw-lineage__label">This month</span>
            <span className="kw-muted">
              {line.workedDays !== null ? `${line.workedDays} days worked` : null}
              {line.overtimeHours ? ` · ${line.overtimeHours}h overtime` : ''}
              {line.unpaidDays ? ` · ${line.unpaidDays} unpaid days` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <p className="kw-muted">Reading where these figures came from…</p>
      ) : (data?.length ?? 0) === 0 ? (
        <p className="kw-muted">
          Nothing was added this month beyond the salary in force — no overtime, claims or incentives.
        </p>
      ) : (
        <div className="kw-lineage__inputs">
          {data?.map((input: PayrollInputRow) => (
            <div className="kw-lineage__row" key={input.id}>
              <span className="kw-lineage__label">{input.label ?? input.componentCode}</span>
              <span className="kw-num">{Number(input.amount).toFixed(2)}</span>
              <span className="kw-muted">
                <Tag>{SOURCE_LABEL[input.source] ?? input.source}</Tag>
                {input.reason ?? ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* The employer's own cost is not a deduction and never appears in the
          columns above; it is stated here so nobody looks for it there. */}
      <div className="kw-lineage__row kw-lineage__row--cost">
        <span className="kw-lineage__label">Cost to the clinic</span>
        <span className="kw-num">{line.employerCost.toFixed(2)}</span>
        <span className="kw-muted">Pay plus the employer's share of EPF, SOCSO, EIS and the HRD levy.</span>
      </div>
    </div>
  );
}
