import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { App, Button, DatePicker, Drawer, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AdminNotice } from '../components/AdminShell';
import { ringgit } from '../components/DataTable';
import {
  useCalculatePayroll,
  useDeletePayrollInput,
  usePayComponents,
  usePayrollInputs,
  useUpsertPayrollInput,
} from '../hooks/useAdmin';
import type { PayrollInputRow } from '../types';

/**
 * THE MONTH'S ITEMS FOR ONE PERSON — the single place extra pay is entered.
 *
 * The payroll grid's "Other income" cell used to be a text box. Whatever was
 * typed became ONE hand-keyed Allowance line, so a month with overtime, a
 * procedure incentive, an allowance, last month's locum and a director's fee
 * went onto the payslip as one figure with one statutory treatment. This
 * drawer is what the cell opens instead: every line the run pays this person
 * beyond basic pay, grouped by the register cell that counts it, with add,
 * edit and remove on the hand-keyed ones and the origin on everything else.
 *
 * THE ITEMS ARE THE CLINIC'S. The picker offers whatever is active under
 * Payroll items, each with its own EPF, SOCSO, EIS and PCB treatment — a
 * clinic that pays a BOD fee adds a BOD fee item once and it is here after.
 *
 * ONE HAND-KEYED LINE PER ITEM PER MONTH. The run keys its rows on the item,
 * so a second amount of the same kind is an edit of the amount, not a second
 * line. A derived line — overtime, unpaid leave, a claim, an incentive, a
 * recurring item — is read-only here on purpose: retyping it in payroll
 * would leave the record it came from and the payslip disagreeing, with
 * nothing to say which is right.
 *
 * AFTER EVERY CHANGE THE MONTH IS WORKED OUT AGAIN, so the cell on the grid
 * and the lines on the payslip are the engine's answer to what was entered,
 * never a figure this screen added up.
 */

type Bucket = PayrollInputRow['bucket'];

const GROUPS: { bucket: Bucket; title: string; hint: string; subtotal: boolean }[] = [
  {
    bucket: 'OTHER_INCOME',
    title: 'Counted in Other income',
    hint: 'Allowances, incentives, bonuses, fees — everything that reaches gross other than basic pay, overtime and claims.',
    subtotal: true,
  },
  {
    bucket: 'OWN_COLUMN',
    title: 'In their own columns',
    hint: 'Overtime, unpaid leave, claims and PCB have their own columns on the register and are not part of Other income.',
    subtotal: false,
  },
  {
    bucket: 'DEDUCTION',
    title: 'Deductions',
    hint: 'What comes off net pay besides the statutory schemes — the register’s “Other” deductions cell.',
    subtotal: true,
  },
  {
    bucket: 'UNKNOWN',
    title: 'Not a payroll item Kuwick knows',
    hint: 'These rows name an item that is not in Payroll items. The run will not pay them until the item exists.',
    subtotal: false,
  },
];

const toCents = (value: string) => Math.round(Number(value) * 100);
const fromCents = (cents: number) => (cents / 100).toFixed(2);

type Form = {
  componentCode?: string;
  amount?: number;
  kind: 'RECURRING' | 'ADDITIONAL';
  reason: string;
  earnedIn: Dayjs | null;
  /** Filled in from the item's arrears setting rather than picked, so changing the item can take it back. */
  earnedAuto?: boolean;
};

const BLANK: Form = { componentCode: undefined, amount: undefined, kind: 'ADDITIONAL', reason: '', earnedIn: null };

const said = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message)
    : 'The server refused the change and did not say why.';

export function PayrollInputsDrawer({
  open,
  onClose,
  period,
  staffId,
  staffName,
  clinicId,
  canEdit,
  runId,
  cell,
}: {
  open: boolean;
  onClose: () => void;
  period: string;
  staffId?: string;
  staffName?: string;
  clinicId?: string;
  canEdit: boolean;
  /** The run to work out again after each change. Without one, nothing is recalculated here. */
  runId?: string;
  /** The register's own figures for this person, to say when they are behind the lines below. */
  cell?: { otherIncome: string; otherDeductions: string } | null;
}) {
  const { message } = App.useApp();
  const inputs = usePayrollInputs({ period, staffId, clinicId });
  const components = usePayComponents();
  const upsert = useUpsertPayrollInput();
  const remove = useDeletePayrollInput();
  const calculate = useCalculatePayroll();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<PayrollInputRow | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recalc, setRecalc] = useState<{ state: 'idle' | 'working' | 'done' | 'failed'; text?: string }>({ state: 'idle' });
  // A "worked out again" said for one person must not be read for the next.
  useEffect(() => {
    setRecalc({ state: 'idle' });
  }, [staffId, open]);

  const month = dayjs(period).format('MMMM YYYY');
  const rows = useMemo(() => (inputs.data ?? []).filter((row) => !staffId || row.staffId === staffId), [inputs.data, staffId]);
  const nameOf = (row: PayrollInputRow) => row.label ?? row.itemName;

  /*
   * THE CLINIC'S OWN LIST, grouped the way the register reads it. Basic pay
   * is the salary record, never a line keyed here.
   */
  const options = useMemo(() => {
    // An item for named people is offered to them alone; the server refuses it for anybody else.
    const forThisPerson = (item: { appliesTo: string; appliesToStaffIds: string[] }) =>
      !staffId || item.appliesTo !== 'SELECTED' || item.appliesToStaffIds.includes(staffId);
    const active = (components.data?.components ?? []).filter((item) => item.active && item.code !== 'BASIC' && forThisPerson(item));
    const additions = active.filter((item) => item.type !== 'DEDUCTION');
    const deductions = active.filter((item) => item.type === 'DEDUCTION');
    const toOption = (item: { code: string; name: string }) => ({ value: item.code, label: `${item.name} (${item.code})` });
    return [
      { label: 'Additions', options: additions.map(toOption) },
      { label: 'Deductions', options: deductions.map(toOption) },
    ];
  }, [components.data, staffId]);

  const subtotal = (bucket: Bucket) => fromCents(rows.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + toCents(row.amount), 0));

  /** The register figure this group should equal, and whether it does. */
  const behind = (bucket: Bucket): string | null => {
    if (!cell || recalc.state === 'working') return null;
    const shown = bucket === 'OTHER_INCOME' ? cell.otherIncome : bucket === 'DEDUCTION' ? cell.otherDeductions : null;
    if (shown === null || toCents(shown) === toCents(subtotal(bucket))) return null;
    return `The register shows ${ringgit(shown)} for this cell. The month has not been worked out since the lines changed.`;
  };

  async function workOutAgain() {
    if (!runId) return;
    setRecalc({ state: 'working' });
    try {
      await calculate.mutateAsync(runId);
      // "Done" only once the register has caught up: the mutation invalidates
      // the queries but does not wait for them, and until the journey
      // refetch lands the old cell sits beside the new subtotal, so "worked
      // out again" and "not worked out since the lines changed" showed at the
      // same time. Wait for both reads, then say so.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['admin-hr', 'payroll-journey', runId] }),
        queryClient.refetchQueries({ queryKey: ['admin-hr', 'payroll-inputs'] }),
      ]);
      setRecalc({ state: 'done' });
    } catch (error) {
      setRecalc({ state: 'failed', text: said(error) });
    }
  }

  const startAdd = () => {
    setEditing(null);
    setForm({ ...BLANK });
    setSaveError(null);
  };
  const startEdit = (row: PayrollInputRow) => {
    setEditing(row);
    setForm({
      componentCode: row.componentCode,
      amount: Number(row.amount),
      kind: row.kind,
      reason: row.reason ?? '',
      earnedIn: row.earnedPeriod ? dayjs(row.earnedPeriod) : null,
    });
    setSaveError(null);
  };
  const closeForm = () => {
    setForm(null);
    setEditing(null);
    setSaveError(null);
  };

  async function save() {
    // EVERY REJECTED SAVE PRODUCES A VISIBLE MESSAGE, in the form, above the
    // button that was pressed.
    if (!form || !staffId) return;
    setSaveError(null);
    const componentCode = editing ? editing.componentCode : form.componentCode;
    if (!componentCode) {
      setSaveError('Choose which item this is.');
      return;
    }
    if (form.amount === undefined || form.amount === null || Number.isNaN(form.amount)) {
      setSaveError('Enter an amount.');
      return;
    }
    if (!editing) {
      const twin = rows.find((row) => row.componentCode === componentCode);
      if (twin) {
        setSaveError(
          twin.editable
            ? `There is already a ${nameOf(twin)} line this month. Edit that line instead of adding a second one.`
            : `${nameOf(twin)} already has a line this month from ${twin.origin.toLowerCase()}. Correct it there.`,
        );
        return;
      }
    }
    try {
      // The server patches a line: a field left out keeps its value, so a
      // cleared reason or earned-in month is sent as null, not left out.
      await upsert.mutateAsync({
        staffId,
        period,
        componentCode,
        amount: form.amount.toFixed(2),
        kind: form.kind,
        reason: form.reason.trim() || null,
        earnedPeriod: form.earnedIn ? form.earnedIn.startOf('month').format('YYYY-MM-DD') : null,
      });
      message.success(editing ? 'Line updated.' : 'Line added.');
      closeForm();
      await workOutAgain();
    } catch (error) {
      setSaveError(said(error));
    }
  }

  async function removeRow(row: PayrollInputRow) {
    try {
      await remove.mutateAsync(row.id);
      message.success(`${nameOf(row)} removed.`);
      await workOutAgain();
    } catch (error) {
      message.error(said(error));
    }
  }

  const columns = [
    {
      title: 'Item',
      key: 'item',
      render: (_: unknown, row: PayrollInputRow) => (
        <span>
          <span className="hr-strong">{nameOf(row)}</span>
          <br />
          <Tag>{row.componentCode}</Tag>
          {row.kind === 'RECURRING' ? <Tag color="blue">Recurring</Tag> : null}
          {row.carriedFromMonth ? (
            <Tag color="gold" title="Copied from last month when this month was started. Edit or remove it if it should not repeat.">
              Carried from {dayjs(`${row.carriedFromMonth}-01`).format('MMM YYYY')}
            </Tag>
          ) : null}
          {row.earnedPeriod ? <span className="hr-small hr-muted">Earned {dayjs(row.earnedPeriod).format('MMM YYYY')}</span> : null}
        </span>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'amount',
      align: 'right' as const,
      width: 110,
      render: (value: string) => <span className="kw-num">{ringgit(value)}</span>,
    },
    {
      title: 'Where it comes from',
      key: 'origin',
      render: (_: unknown, row: PayrollInputRow) => (
        <span className="hr-small">
          <span>{row.origin}</span>
          {row.sourceLink ? (
            <>
              {' · '}
              <Link className="hr-link" to={row.sourceLink}>
                Correct at source
              </Link>
            </>
          ) : null}
          <br />
          <span className="hr-muted">
            {row.enteredBy}, {new Date(row.enteredAt).toLocaleString()}
            {row.reason ? ` · ${row.reason}` : ''}
          </span>
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            key: 'actions',
            width: 150,
            render: (_: unknown, row: PayrollInputRow) =>
              row.editable ? (
                <span className="hr-actions">
                  <Button size="small" onClick={() => startEdit(row)} disabled={recalc.state === 'working'}>
                    Edit
                  </Button>{' '}
                  <Button size="small" danger onClick={() => void removeRow(row)} disabled={remove.isPending || recalc.state === 'working'}>
                    Remove
                  </Button>
                </span>
              ) : (
                <span className="hr-small hr-muted">Read-only here</span>
              ),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      // antd 6 deprecated `width`; `styles.wrapper` sets it without warning.
      styles={{ wrapper: { width: 'min(900px, 100vw)' } }}
      title={staffName ? `${staffName} — items for ${month}` : `Items for ${month}`}
      extra={
        canEdit && staffId ? (
          <Button type="primary" size="small" onClick={startAdd} disabled={recalc.state === 'working'}>
            Add a line
          </Button>
        ) : null
      }
    >
      <AdminNotice>
        Everything this person is paid or has deducted for {month} beyond basic pay, one line per item, and one line per item on
        the payslip. Items that came from attendance, leave, claims, incentives or the employee record are corrected where they
        were recorded. Need another kind of pay, with its own EPF, SOCSO, EIS and PCB treatment?{' '}
        <Link className="hr-link" to="/admin/hr/settings/payroll-items">
          Add it under Payroll items
        </Link>
        .
      </AdminNotice>

      {!canEdit ? (
        <AdminNotice tone="warn">
          Read-only: this month is approved or paid, or your account may not run payroll. An approved month is corrected with an
          adjustment against the run.
        </AdminNotice>
      ) : null}

      {recalc.state === 'working' ? (
        <AdminNotice tone="info">Working the month out again…</AdminNotice>
      ) : recalc.state === 'failed' ? (
        <AdminNotice tone="warn">The lines were saved, but the month could not be worked out again: {recalc.text}</AdminNotice>
      ) : recalc.state === 'done' ? (
        <AdminNotice tone="info">Worked out again. The register and the payslip lines are up to date.</AdminNotice>
      ) : null}

      {GROUPS.map((group) => {
        const members = rows.filter((row) => row.bucket === group.bucket);
        if (members.length === 0 && group.bucket !== 'OTHER_INCOME') return null;
        const lag = behind(group.bucket);
        return (
          <section key={group.bucket} className="hr-mt" aria-label={group.title}>
            <div className="hr-kv">
              <span className="hr-strong">{group.title}</span>
              {group.subtotal ? (
                <span className="kw-num hr-strong" data-testid={`subtotal-${group.bucket}`}>
                  {ringgit(subtotal(group.bucket))}
                </span>
              ) : null}
            </div>
            <div className="hr-small hr-muted">{group.hint}</div>
            {lag ? <div className="hr-small hr-warn">{lag}</div> : null}
            <Table<PayrollInputRow>
              rowKey="id"
              size="small"
              style={{ marginTop: 8 }}
              dataSource={members}
              loading={inputs.isLoading}
              pagination={false}
              locale={{ emptyText: 'Nothing here yet.' }}
              columns={columns}
            />
          </section>
        );
      })}

      <Modal
        open={form !== null}
        onCancel={closeForm}
        onOk={() => void save()}
        okText={editing ? 'Save changes' : 'Add line'}
        confirmLoading={upsert.isPending}
        title={editing ? `Edit ${nameOf(editing)} — ${month}` : `Add a line — ${month}`}
      >
        {saveError ? <AdminNotice tone="warn">{saveError}</AdminNotice> : null}
        {form ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label>
              <div>Item</div>
              {editing ? (
                <div>
                  <span className="hr-strong">{nameOf(editing)}</span> <Tag>{editing.componentCode}</Tag>
                  <div className="hr-small hr-muted">To pay a different kind of item, remove this line and add another.</div>
                </div>
              ) : (
                <>
                  <Select
                    style={{ width: '100%' }}
                    placeholder="Allowance, incentive, fee, PCB…"
                    options={options}
                    value={form.componentCode}
                    onChange={(value) => {
                      // An item paid a month in arrears was earned the month
                      // before this run (UAT, 10 October 2026), so the line
                      // reads "earned September" before it is saved.
                      const arrears = (components.data?.components ?? []).find((item) => item.code === value)?.paidInArrears ?? false;
                      const lastMonth = dayjs(period).subtract(1, 'month').startOf('month');
                      if (arrears && !form.earnedIn) setForm({ ...form, componentCode: value, earnedIn: lastMonth, earnedAuto: true });
                      else if (!arrears && form.earnedAuto) setForm({ ...form, componentCode: value, earnedIn: null, earnedAuto: false });
                      else setForm({ ...form, componentCode: value });
                    }}
                    showSearch
                    optionFilterProp="label"
                    aria-label="Item"
                  />
                  <div className="hr-small hr-muted">
                    The list is Payroll items settings.{' '}
                    <Link className="hr-link" to="/admin/hr/settings/payroll-items">
                      Add a kind that is missing
                    </Link>
                    .
                  </div>
                </>
              )}
            </label>
            <label>
              <div>Amount</div>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                precision={2}
                value={form.amount}
                onChange={(value) => setForm({ ...form, amount: value ?? undefined })}
                aria-label="Amount"
              />
              <div className="hr-small hr-muted">Always positive. Whether it adds to or comes off pay is decided by the item.</div>
            </label>
            <label>
              <div>Recurring or additional</div>
              <Select
                style={{ width: '100%' }}
                value={form.kind}
                onChange={(value) => setForm({ ...form, kind: value })}
                options={[
                  { value: 'ADDITIONAL', label: 'Additional — this month only' },
                  { value: 'RECURRING', label: 'Recurring — a standing item' },
                ]}
                aria-label="Recurring or additional"
              />
              <div className="hr-small hr-muted">Monthly tax treats the two differently, so it is recorded rather than inferred.</div>
            </label>
            <label>
              <div>Earned in (optional)</div>
              <DatePicker
                picker="month"
                style={{ width: '100%' }}
                value={form.earnedIn}
                onChange={(value) => setForm({ ...form, earnedIn: value, earnedAuto: false })}
                aria-label="Earned in"
              />
              <div className="hr-small hr-muted">For work done in an earlier month and paid in this one, such as last month’s locum sessions.</div>
            </label>
            <label>
              <div>Reason (optional)</div>
              <Input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Why this was added" aria-label="Reason" />
            </label>
          </div>
        ) : null}
      </Modal>
    </Drawer>
  );
}
