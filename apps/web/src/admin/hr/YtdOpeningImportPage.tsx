import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Input, InputNumber, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ringgit } from '../components/DataTable';
import { useEmployees, useImportYtdOpening, useLegalEmployers } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import type { YtdOpeningMonthBody } from '../types';

/**
 * OPENING BALANCES — the screen the readiness advisory has been pointing at.
 *
 * Monthly tax is cumulative over the year, so a clinic that moves to Kuwick in
 * July and starts from zero taxes everybody as though January onwards paid
 * nothing — the reliefs are spent twice and the year ends wrong. The API for
 * importing the earlier months shipped with the YTD substrate; this screen is
 * what makes it usable by the person the advisory talks to.
 *
 * THREE RULES THE FORM KEEPS IN VIEW, because each guards a double-count:
 *
 *   - months, not running totals. A figure that cannot be checked against the
 *     payslip it came from cannot be corrected later;
 *   - THIS employer's months only. Pay from a previous employer is declared on
 *     Form TP3 on the employee's record, and the server refuses months dated
 *     before their employment here began;
 *   - a month an approved run already wrote is refused — the run is the record.
 *
 * The SOURCE is required and stored on every row: a year-to-date somebody
 * typed in is only as trustworthy as the thing they typed it from.
 */

type StagedMonth = YtdOpeningMonthBody & { key: string; name: string };

const rm = (cents: number) => ringgit((cents / 100).toFixed(2));

export function YtdOpeningImportPage() {
  const { message } = App.useApp();
  const mayImport = useCan('hr.payroll.approve');
  const employers = useLegalEmployers();
  const employees = useEmployees({ status: 'ACTIVE' });
  const importMutation = useImportYtdOpening();

  const [legalEmployerId, setLegalEmployerId] = useState<string | undefined>();
  const [source, setSource] = useState('');
  const [staged, setStaged] = useState<StagedMonth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The row being composed.
  const [staffId, setStaffId] = useState<string | undefined>();
  const [taxYear, setTaxYear] = useState(dayjs().year());
  const [month, setMonth] = useState<number | undefined>();
  const [figures, setFigures] = useState<Record<string, number | null>>({});

  const employeeOptions = useMemo(
    () =>
      (employees.data ?? [])
        .filter((row) => row.hasProfile)
        .map((row) => ({ value: row.staffId, label: row.fullName })),
    [employees.data],
  );
  const nameOf = useMemo(() => new Map(employeeOptions.map((o) => [o.value, o.label])), [employeeOptions]);

  /**
   * EVERY FIGURE IS TYPED, NONE ASSUMED. `?? 0` here used to turn a box the
   * operator never touched into "this month deducted RM0.00 tax" — written
   * straight into the cumulative MTD ledger, where a fake zero under-states
   * X and over-deducts every later month. A blank now refuses by name, and
   * the button below fills genuine zeros deliberately, in one visible act.
   */
  const MONEY_FIELDS: [string, string][] = [
    ['gross', 'Gross'],
    ['additional', 'Additional remuneration'],
    ['pcb', 'PCB'],
    ['cp38', 'CP38'],
    ['zakat', 'Zakat'],
    ['epfEmployee', 'EPF (employee)'],
    ['epfEmployer', 'EPF (employer)'],
    ['socsoEmployee', 'SOCSO (employee)'],
    ['socsoEmployer', 'SOCSO (employer)'],
    ['eisEmployee', 'EIS (employee)'],
    ['eisEmployer', 'EIS (employer)'],
    ['lindung', 'LINDUNG'],
    ['deductions', 'TP1 deductions applied'],
  ];
  const blankFields = MONEY_FIELDS.filter(([key]) => figures[key] === null || figures[key] === undefined);
  const cents = (key: string) => Math.round((figures[key] ?? 0) * 100);

  const fillBlanksWithZero = () => {
    setFigures((prev) => {
      const next = { ...prev };
      for (const [key] of MONEY_FIELDS) if (next[key] === null || next[key] === undefined) next[key] = 0;
      return next;
    });
    setError(null);
  };

  const addMonth = () => {
    setError(null);
    if (!staffId || !month) {
      setError('Choose the employee and the month.');
      return;
    }
    if (blankFields.length > 0) {
      setError(
        `Every figure is typed, none assumed — a blank box is not RM0.00. Still blank: ${blankFields
          .map(([, label]) => label)
          .join(', ')}. Type each figure off the old payslip, or use “Fill the blanks with RM0.00” if they are genuinely nil.`,
      );
      return;
    }
    if ((figures.gross ?? 0) <= 0) {
      setError('The month needs a gross figure. A zero-pay month has nothing to import.');
      return;
    }
    if (staged.some((row) => row.staffId === staffId && row.taxYear === taxYear && row.month === month)) {
      setError('That month is already on the list below.');
      return;
    }
    setStaged([
      ...staged,
      {
        key: `${staffId}:${taxYear}:${month}`,
        name: nameOf.get(staffId) ?? 'Employee',
        staffId,
        taxYear,
        month,
        grossCents: cents('gross'),
        additionalRemunerationCents: cents('additional'),
        pcbCents: cents('pcb'),
        cp38Cents: cents('cp38'),
        zakatCents: cents('zakat'),
        epfEmployeeCents: cents('epfEmployee'),
        epfEmployerCents: cents('epfEmployer'),
        socsoEmployeeCents: cents('socsoEmployee'),
        socsoEmployerCents: cents('socsoEmployer'),
        eisEmployeeCents: cents('eisEmployee'),
        eisEmployerCents: cents('eisEmployer'),
        lindungEmployeeCents: cents('lindung'),
        deductionsCents: cents('deductions'),
      },
    ]);
    // Keep employee and year for the next month — the common case is typing
    // one person's January-to-June in a row.
    setMonth(month === 12 ? undefined : month + 1);
    setFigures({});
  };

  const submit = async () => {
    setError(null);
    setDone(null);
    if (!legalEmployerId) {
      setError('Choose the employing company these figures were paid under.');
      return;
    }
    if (source.trim().length < 5) {
      setError('Say where the figures came from — the previous system, the payslips, the EA form. It is stored on every row.');
      return;
    }
    try {
      const result = await importMutation.mutateAsync({
        legalEmployerId,
        source: source.trim(),
        months: staged.map(({ key: _key, name: _name, ...row }) => row),
      });
      setDone(
        `Imported ${result.months} month${result.months === 1 ? '' : 's'} for ${result.employees} employee${result.employees === 1 ? '' : 's'}. Monthly tax now computes on top of them.`,
      );
      setStaged([]);
      message.success('Opening balances imported.');
    } catch (e) {
      // The server's refusals are the guards, verbatim: a month before the
      // employment started ("that money belongs on Form TP3"), a month an
      // approved run already wrote.
      setError(e instanceof Error ? e.message : 'The server refused the import and did not say why.');
    }
  };

  const numberField = (key: string, label: string) => (
    <label key={key}>
      <div className="kw-fieldLabel">{label}</div>
      <InputNumber
        min={0}
        precision={2}
        prefix="RM"
        value={figures[key] ?? null}
        onChange={(value) => setFigures((prev) => ({ ...prev, [key]: value }))}
        style={{ width: '100%' }}
      />
    </label>
  );

  return (
    <AdminShell
      error={firstError(employers, employees)}
      title="Opening balances"
      subtitle="The months this employer paid before Kuwick ran payroll — so a mid-year start does not tax everybody as though January paid nothing."
    >
      {!mayImport ? (
        <AdminNotice tone="info">
          Importing opening balances changes what monthly tax computes for the rest of the year, so it needs the
          payroll approval permission. You can read this screen but not import.
        </AdminNotice>
      ) : null}
      <AdminNotice tone="info">
        <strong>This employer&apos;s months only, as months.</strong> Pay from a previous employer is declared on Form
        TP3 on the employee&apos;s record — the server refuses months from before the employment here began. A month an
        approved Kuwick run already wrote is refused too: the run is the record.
      </AdminNotice>

      <AdminSection title="Where these figures come from">
        <div className="kw-formGrid2">
          <label>
            <div className="kw-fieldLabel">Employing company</div>
            <Select
              value={legalEmployerId}
              onChange={setLegalEmployerId}
              style={{ width: '100%' }}
              placeholder="Choose the legal employer"
              options={(employers.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
            />
          </label>
          <label>
            <div className="kw-fieldLabel">Source of the figures</div>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Payslips from the previous system, Jan–Jun 2026"
            />
          </label>
        </div>
      </AdminSection>

      <AdminSection
        title="Add a month"
        description="One row per employee per month, exactly as the old payslip states it. Running totals are refused by design — a total cannot be checked or corrected month by month."
      >
        <div className="kw-formGrid2" style={{ marginBottom: 10 }}>
          <label>
            <div className="kw-fieldLabel">Employee</div>
            <Select
              showSearch
              optionFilterProp="label"
              value={staffId}
              onChange={setStaffId}
              style={{ width: '100%' }}
              placeholder="Choose an employee"
              options={employeeOptions}
            />
          </label>
          <div className="kw-formGrid2">
            <label>
              <div className="kw-fieldLabel">Tax year</div>
              <Select
                value={taxYear}
                onChange={setTaxYear}
                style={{ width: '100%' }}
                options={[dayjs().year(), dayjs().year() - 1].map((y) => ({ value: y, label: String(y) }))}
              />
            </label>
            <label>
              <div className="kw-fieldLabel">Month</div>
              <Select
                value={month}
                onChange={setMonth}
                style={{ width: '100%' }}
                placeholder="Month"
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: i + 1,
                  label: dayjs().month(i).format('MMMM'),
                }))}
              />
            </label>
          </div>
        </div>
        <div className="kw-formGrid2">
          {numberField('gross', 'Gross for the month')}
          {numberField('additional', 'Of which bonus / additional remuneration')}
          {numberField('pcb', 'PCB deducted')}
          {numberField('cp38', 'CP38 deducted')}
          {numberField('zakat', 'Zakat via payroll')}
          {numberField('deductions', 'TP1 deductions the month applied')}
          {numberField('epfEmployee', 'EPF — employee')}
          {numberField('epfEmployer', 'EPF — employer')}
          {numberField('socsoEmployee', 'SOCSO — employee')}
          {numberField('socsoEmployer', 'SOCSO — employer')}
          {numberField('eisEmployee', 'EIS — employee')}
          {numberField('eisEmployer', 'EIS — employer')}
          {numberField('lindung', 'LINDUNG 24 JAM withheld')}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={addMonth}>Add to the import</Button>
          {blankFields.length > 0 && blankFields.length < MONEY_FIELDS.length ? (
            <Button onClick={fillBlanksWithZero}>
              Fill the {blankFields.length} blank figure{blankFields.length === 1 ? '' : 's'} with RM0.00
            </Button>
          ) : null}
        </div>
      </AdminSection>

      <AdminSection
        title={`To import — ${staged.length} month${staged.length === 1 ? '' : 's'}`}
        description="Nothing below is saved yet. Importing writes every row, stamped with the source above."
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        {done ? <AdminNotice tone="info">{done}</AdminNotice> : null}
        <Table<StagedMonth>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={staged}
          locale={{ emptyText: 'No months added yet.' }}
          columns={[
            { title: 'Employee', dataIndex: 'name' },
            {
              title: 'Month',
              key: 'month',
              width: 140,
              render: (_: unknown, row) => dayjs(new Date(Date.UTC(row.taxYear, row.month - 1, 1))).format('MMM YYYY'),
            },
            { title: 'Gross', key: 'gross', align: 'right', width: 110, render: (_: unknown, row) => rm(row.grossCents) },
            { title: 'PCB', key: 'pcb', align: 'right', width: 100, render: (_: unknown, row) => rm(row.pcbCents ?? 0) },
            {
              title: 'EPF (staff)',
              key: 'epf',
              align: 'right',
              width: 110,
              render: (_: unknown, row) => rm(row.epfEmployeeCents ?? 0),
            },
            {
              title: '',
              key: 'remove',
              width: 90,
              render: (_: unknown, row) => (
                <Button size="small" type="text" danger onClick={() => setStaged(staged.filter((r) => r.key !== row.key))}>
                  Remove
                </Button>
              ),
            },
          ]}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button
            type="primary"
            disabled={!mayImport || staged.length === 0}
            loading={importMutation.isPending}
            onClick={submit}
          >
            Import {staged.length > 0 ? `${staged.length} month${staged.length === 1 ? '' : 's'}` : ''}
          </Button>
          <Link to="/admin/hr/payroll/readiness" className="kw-muted">
            Back to payroll readiness
          </Link>
        </div>
      </AdminSection>
    </AdminShell>
  );
}
