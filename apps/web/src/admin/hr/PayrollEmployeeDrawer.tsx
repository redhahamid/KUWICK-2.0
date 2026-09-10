import { Button, Tooltip } from 'antd';
import { DetailDrawer, DrawerSection, LineItem, LineTotal } from '../components/DetailDrawer';
import { StatusChip } from '../components/Chip';
import { ringgit } from '../components/DataTable';
import type { PayrollJourney, PayrollRunDetail } from '../types';

type Line = PayrollRunDetail['lines'][number];
type PayRow = PayrollJourney['pay']['rows'][number];

/**
 * ONE PERSON'S PAYSLIP, AS A RIGHT-HAND DRAWER.
 *
 * The reference sheet is explicit that this is a drawer and not an expanded
 * row, and it is right for a reason worth writing down: an expanded row pushes
 * every other row down the screen, so the moment you open one you lose the
 * register you were reading it against. A drawer keeps the register in place
 * behind it, which is exactly the comparison somebody checking one person's
 * net pay is trying to make.
 *
 * THREE SECTIONS, in the order a payslip is read: what they earned, what came
 * off, what the statutory schemes took. Net pay is pinned to the bottom
 * because it is the number the drawer was opened for.
 *
 * PROVENANCE IS NOT DECORATION. Every derived amount carries the sentence the
 * materialiser wrote when it pulled the upstream fact into this period.
 * "Overtime RM180.00" means one thing if somebody typed it and another if it
 * was computed from twelve approved hours; only one of those is worth arguing
 * with, and the reader cannot tell which without being told. A derived figure
 * is corrected where it was recorded — the timesheet, the leave record, the
 * claim — never here, because editing it would leave the payslip and its own
 * source disagreeing.
 *
 * A BLANK IS NOT A ZERO. Nullable statutory figures mean "not worked out" —
 * no rates configured, or a fact missing — and rendering one as 0.00 tells a
 * clinic it owes nothing, which is the one wrong answer that gets acted on.
 */

const EARNING_CODES = new Set([
  'BASIC',
  'ALLOWANCE',
  'ATTENDANCE_ALLOWANCE',
  'OVERTIME',
  'INCENTIVE',
  'COMMISSION',
  'BONUS',
  'MILEAGE',
  'CLAIM_REIMBURSEMENT',
]);

/** Statutory deductions are shown in their own section, not among "other". */
const STATUTORY_CODES = new Set(['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'PCB', 'SKBBK']);

function amountOrDash(value: number | null | undefined, hint: string) {
  if (value === null || value === undefined) {
    return (
      <Tooltip title={hint}>
        <span className="kw-muted">—</span>
      </Tooltip>
    );
  }
  return ringgit(value.toFixed(2));
}

export function PayrollEmployeeDrawer({
  line,
  payRow,
  open,
  onClose,
  onAddItem,
  canEdit,
}: {
  line: Line | null;
  /** The journey's row for the same person — where the itemised detail lives. */
  payRow: PayRow | undefined;
  open: boolean;
  onClose: () => void;
  /** Opens the payroll-inputs drawer for this person. Undefined = read-only. */
  onAddItem?: (staffId: string, staffName: string) => void;
  canEdit: boolean;
}) {
  if (!line) {
    return (
      <DetailDrawer open={open} onClose={onClose} name="" width={480}>
        <span />
      </DetailDrawer>
    );
  }

  const items = payRow?.items ?? [];
  const earnings = items.filter((item) => EARNING_CODES.has(item.componentCode));
  const otherDeductionItems = items.filter(
    (item) => !EARNING_CODES.has(item.componentCode) && !STATUTORY_CODES.has(item.componentCode),
  );
  // ZAKAT is an ordinary deduction component in this system rather than a
  // column on the payroll line, so it appears here only when somebody actually
  // has one. An empty "Zakat — 0.00" row on every payslip would be a claim
  // about a deduction nobody made.
  const zakat = otherDeductionItems.find((item) => item.componentCode === 'ZAKAT');

  const statutoryTotal =
    line.epfEmployee === null && line.socsoEmployee === null && line.eisEmployee === null
      ? null
      : (line.epfEmployee ?? 0) +
        (line.socsoEmployee ?? 0) +
        (line.eisEmployee ?? 0) +
        (line.lindungEmployee ?? 0) +
        (line.pcb ?? 0);

  const deductionTotal = line.unpaidLeaveDeduction + line.otherDeductions;

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      name={line.name}
      subtitle={line.snapshot?.position ?? undefined}
      width={480}
      tags={
        <>
          {line.workedDays !== null ? (
            <StatusChip tone="neutral" dot>
              {line.workedDays} days worked
            </StatusChip>
          ) : null}
          {line.overtimeHours ? (
            <StatusChip tone="info" dot>
              {line.overtimeHours}h overtime
            </StatusChip>
          ) : null}
          {line.unpaidDays ? (
            <StatusChip tone="attention" dot>
              {line.unpaidDays} unpaid days
            </StatusChip>
          ) : null}
          {line.pcb === null ? <StatusChip tone="blocked">Monthly tax not entered</StatusChip> : null}
        </>
      }
      footer={
        <>
          <span className="kw-netLabel">Net pay</span>
          <span className="kw-netValue">{ringgit(line.netPay.toFixed(2))}</span>
        </>
      }
    >
      <DrawerSection
        title="Earnings"
        action={
          onAddItem && canEdit ? (
            <Button size="small" type="text" className="kw-rowAction" onClick={() => onAddItem(line.staffId, line.name)}>
              + Add earning
            </Button>
          ) : null
        }
      >
        <LineItem
          label="Basic salary"
          value={ringgit(line.basicSalary.toFixed(2))}
          source="The salary in force this month"
        />
        <LineItem label="Fixed allowance" value={ringgit(line.allowances.toFixed(2))} tone={line.allowances ? undefined : 'muted'} />
        <LineItem
          label="Overtime"
          value={ringgit(line.overtimePay.toFixed(2))}
          tone={line.overtimePay ? undefined : 'muted'}
          source={line.overtimeHours ? `${line.overtimeHours} approved hours from the timesheet` : undefined}
        />
        <LineItem label="Incentives" value={ringgit(line.incentives.toFixed(2))} tone={line.incentives ? undefined : 'muted'} />
        <LineItem label="Bonus" value={ringgit(line.bonus.toFixed(2))} tone={line.bonus ? undefined : 'muted'} />

        {/* THE ITEMISED DETAIL, where the four columns above are a roll-up of
            several things. Only shown when there is more than one item behind
            them, so an ordinary salaried month is not a list of one. */}
        {earnings.length > 1
          ? earnings
              .filter((item) => item.componentCode !== 'BASIC')
              .map((item) => (
                <LineItem
                  key={item.id}
                  label={item.label}
                  value={ringgit(item.amount)}
                  source={
                    item.provenance ??
                    (item.editable ? undefined : 'Corrected where it was recorded, not here.')
                  }
                />
              ))
          : null}

        <LineTotal label="Gross pay" value={ringgit(line.grossPay.toFixed(2))} />
      </DrawerSection>

      <DrawerSection
        title="Deductions"
        action={
          onAddItem && canEdit ? (
            <Button size="small" type="text" className="kw-rowAction" onClick={() => onAddItem(line.staffId, line.name)}>
              + Add deduction
            </Button>
          ) : null
        }
      >
        <LineItem
          label="Unpaid leave"
          value={line.unpaidLeaveDeduction ? `−${ringgit(line.unpaidLeaveDeduction.toFixed(2))}` : ringgit('0.00')}
          tone={line.unpaidLeaveDeduction ? 'deduct' : 'muted'}
          source={
            line.unpaidDays
              ? `${line.unpaidDays} approved unpaid day${line.unpaidDays === 1 ? '' : 's'} — wages are smaller, not deducted twice`
              : undefined
          }
        />
        <LineItem
          label="Other deductions"
          value={line.otherDeductions ? `−${ringgit(line.otherDeductions.toFixed(2))}` : ringgit('0.00')}
          tone={line.otherDeductions ? 'deduct' : 'muted'}
        />
        {otherDeductionItems.map((item) => (
          <LineItem
            key={item.id}
            label={item.label}
            value={`−${ringgit(item.amount)}`}
            tone="deduct"
            source={item.provenance ?? undefined}
          />
        ))}
        <LineTotal
          label="Total deductions"
          value={deductionTotal ? `−${ringgit(deductionTotal.toFixed(2))}` : ringgit('0.00')}
          tone={deductionTotal ? 'deduct' : undefined}
        />
      </DrawerSection>

      <DrawerSection title="Statutory">
        <LineItem
          label="EPF (employee)"
          value={amountOrDash(line.epfEmployee, 'Not worked out — no rates configured, or a fact is missing.')}
          source={
            payRow?.epfBasis && payRow.epfBasis.mode !== 'ALL_APPLICABLE'
              ? `Employer-selected basis: EPF on ${ringgit(payRow.epfBasis.applied)} of ${ringgit(payRow.epfBasis.assessed)} assessed`
              : undefined
          }
        />
        <LineItem label="SOCSO" value={amountOrDash(line.socsoEmployee, 'Not worked out — SOCSO needs a date of birth and rates.')} />
        <LineItem label="EIS" value={amountOrDash(line.eisEmployee, 'Not worked out — EIS needs a date of birth and rates.')} />
        <LineItem
          label="LINDUNG 24 JAM"
          value={amountOrDash(line.lindungEmployee, 'Whether this employee joined has not been recorded, so nothing can be worked out.')}
        />
        <LineItem
          label="Monthly tax (PCB)"
          value={amountOrDash(line.pcb, 'Not entered. Record a tax residence and MTD category, or key this month’s figure by hand.')}
        />
        {zakat ? <LineItem label="Zakat" value={`−${ringgit(zakat.amount)}`} tone="deduct" source={zakat.provenance ?? undefined} /> : null}
        <LineTotal
          label="Employee statutory"
          value={
            statutoryTotal === null ? (
              <span className="kw-muted">Not worked out</span>
            ) : (
              `−${ringgit(statutoryTotal.toFixed(2))}`
            )
          }
          tone={statutoryTotal === null ? undefined : 'deduct'}
        />
      </DrawerSection>

      {/* THE EMPLOYER'S OWN COST is not a deduction and never appears in the
          register's columns; it is stated here so nobody looks for it there. */}
      <DrawerSection title="Cost to the clinic">
        <LineItem
          label="Employer cost"
          value={ringgit(line.employerCost.toFixed(2))}
          strong
          source="Pay plus the employer's share of EPF, SOCSO, EIS and the HRD levy"
        />
        <LineItem label="EPF (employer)" value={amountOrDash(line.epfEmployer, 'Not worked out.')} />
        <LineItem label="SOCSO (employer)" value={amountOrDash(line.socsoEmployer, 'Not worked out.')} />
        <LineItem label="EIS (employer)" value={amountOrDash(line.eisEmployer, 'Not worked out.')} />
        <LineItem label="HRD levy" value={amountOrDash(line.hrdLevy, 'Not worked out — the employer’s HRD registration is not recorded.')} />
      </DrawerSection>
    </DetailDrawer>
  );
}
