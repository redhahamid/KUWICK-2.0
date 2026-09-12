import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, DatePicker, Input, Switch, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import { usePayComponents, useSeedPayComponents, useUpsertPayComponent } from '../hooks/useAdmin';
import { HrPage, Panel, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconLock } from './ui/icons';
import type { PayComponentRow } from '../types';

/**
 * PAYROLL ITEMS — what a clinic can pay or deduct, and what each one counts
 * towards. Now with the switches on the row.
 *
 * Eight of them, one per column, each backed by a real field on the
 * component: EPF · SOCSO · EIS · PCB · HRD · Prorate · OT base · Unpaid-leave
 * base. Flipping one is NOT an edit. The calculation resolves this catalogue
 * by period, so overwriting the row would reprice every month not yet
 * approved — the server refuses a treatment change without a date it takes
 * effect from, and this screen asks for that date in place rather than in a
 * drawer: which month, and why.
 *
 * TWO THINGS THE PROMPT ASKED FOR AS SWITCHES ARE NOT SWITCHES, because there
 * is nothing on the component for them to switch. "Recurring" is a fact about
 * an EMPLOYEE — a monthly allowance is set on their record — and "Reimbursement"
 * is what a component IS (paid to net, outside wages), not a flag on it. Both
 * are shown as read-only chips derived from the row.
 *
 * A system component (basic pay, overtime, the statutory deductions) may be
 * switched on or off, never re-treated. Its switches are drawn disabled, and
 * a lock beside its name says why.
 */
type Flag = 'epfLiable' | 'socsoLiable' | 'eisLiable' | 'pcbLiable' | 'hrdLiable' | 'prorated' | 'includeInOrpBase' | 'includeInUnpaidLeaveBase';

const FLAGS: { key: Flag; title: string; width: number }[] = [
  { key: 'epfLiable', title: 'EPF', width: 70 },
  { key: 'socsoLiable', title: 'SOCSO', width: 78 },
  { key: 'eisLiable', title: 'EIS', width: 70 },
  { key: 'pcbLiable', title: 'PCB', width: 70 },
  { key: 'hrdLiable', title: 'HRD', width: 70 },
  { key: 'prorated', title: 'Prorate', width: 84 },
  { key: 'includeInOrpBase', title: 'OT base', width: 84 },
  { key: 'includeInUnpaidLeaveBase', title: 'Unpaid-leave base', width: 130 },
];

/** Everything the server needs to save the row whole; a partial body resets the flags it does not name. */
const whole = (row: PayComponentRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  category: row.category,
  includeIn: row.includeIn,
  pcbLiable: row.pcbLiable,
  epfLiable: row.epfLiable,
  socsoLiable: row.socsoLiable,
  eisLiable: row.eisLiable,
  hrdLiable: row.hrdLiable,
  includeInOrpBase: row.includeInOrpBase,
  includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
  additionalRemuneration: row.additionalRemuneration,
  prorated: row.prorated,
  employerSide: row.employerSide,
  active: row.active,
});

export function PayrollItemsPage() {
  const { message } = App.useApp();
  const components = usePayComponents();
  const seed = useSeedPayComponents();
  const upsert = useUpsertPayComponent();
  const mayManage = useCan('hr.statutory.manage');
  const rows = components.data?.components ?? [];

  /** The one switch that is waiting for a date and a reason. */
  const [pending, setPending] = useState<{ row: PayComponentRow; flag: Flag; next: boolean } | null>(null);
  const [from, setFrom] = useState<Dayjs>(dayjs().add(1, 'month').startOf('month'));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const cancel = () => {
    setPending(null);
    setReason('');
    setProblem(null);
  };

  const save = () => {
    if (!pending) return;
    if (!reason.trim()) {
      setProblem('Say why — it is recorded with the change.');
      return;
    }
    upsert.mutate(
      { ...whole(pending.row), [pending.flag]: pending.next, effectiveFrom: from.format('YYYY-MM-DD'), reason: reason.trim() },
      {
        onSuccess: () => {
          message.success(`${pending.row.name}: ${FLAGS.find((f) => f.key === pending.flag)?.title} ${pending.next ? 'on' : 'off'} from ${from.format('MMM YYYY')}.`);
          cancel();
        },
        onError: (error: Error) => setProblem(error.message),
      },
    );
  };

  /** On/off is an edit, not a version — no date needed, for system rows too. */
  const toggleActive = (row: PayComponentRow, active: boolean) =>
    upsert.mutate(
      { ...whole(row), active },
      {
        onSuccess: () => message.success(`${row.name} ${active ? 'in use' : 'switched off'}.`),
        onError: (error: Error) => message.error(error.message),
      },
    );

  /** What a row IS, read off the row: nothing a person sets here. */
  const kinds = (row: PayComponentRow) =>
    row.type === 'ADDITION' && row.includeIn === 'NET_ONLY' ? [<StatusChip key="r" tone="info">Reimbursement</StatusChip>] : [];
  /** A seeded catalogue has no reimbursement, and a column of dashes says nothing — so it is not drawn. */
  const showKind = rows.some((row) => kinds(row).length > 0);

  /**
   * ONE VERDICT FOR THE LIST, not one per row. Every seeded row is DRAFT
   * until somebody reads the authority's schedule against it, and a column of
   * seventeen "Unchecked" chips was the same sentence seventeen times.
   */
  const checkedCount = rows.filter((row) => row.verificationStatus === 'VERIFIED').length;
  const listCheck =
    rows.length === 0 ? null : checkedCount === rows.length ? (
      <StatusChip tone="done">Checked</StatusChip>
    ) : checkedCount === 0 ? (
      <StatusChip tone="attn">Unchecked</StatusChip>
    ) : (
      <StatusChip tone="attn">
        {checkedCount} of {rows.length} checked
      </StatusChip>
    );

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Payroll items
        </>
      }
      title="Payroll items"
      sub="What the clinic can pay or deduct, and what each one counts towards."
      error={components.error instanceof Error ? components.error.message : null}
      actions={
        <>
          {listCheck}
          {mayManage && rows.length === 0 ? (
            <button
              type="button"
              className="hr-btn hr-btn--primary"
              disabled={seed.isPending}
              onClick={() =>
                seed.mutate(undefined, {
                  onSuccess: () => message.success('Catalogue seeded — every flag unchecked'),
                  onError: (e: Error) => message.error(e.message),
                })
              }
            >
              Seed the catalogue
            </button>
          ) : null}
        </>
      }
    >
      <Panel>
        <Table<PayComponentRow>
          rows={rows}
          loading={components.isLoading}
          rowKey="id"
          searchFields={['code', 'name']}
          searchPlaceholder="Search pay items…"
          searchLabel="Search pay items"
          emptyText="No pay items are set up yet."
          emptyHint="Seed the standard Malaysian set, then adjust what each item counts towards."
          columns={[
            {
              title: 'Item',
              dataIndex: 'name',
              render: (value: string, row) => (
                <div>
                  <div className="hr-strong">
                    {value}
                    {row.systemControlled ? (
                      <Tooltip title="System item: it can be switched on or off, but its statutory treatment is not editable here.">
                        <span className="hr-lock" role="img" aria-label="System item, on/off only">
                          <IconLock />
                        </span>
                      </Tooltip>
                    ) : null}
                  </div>
                  <span className="hr-faint hr-small">{row.code}</span>
                </div>
              ),
            },
            {
              title: 'Adds or deducts',
              dataIndex: 'type',
              width: 120,
              render: (value: string) => (
                <StatusChip tone={value === 'DEDUCTION' ? 'attn' : 'info'}>
                  {value === 'DEDUCTION' ? 'Deducts' : value === 'OVERTIME' ? 'Overtime' : 'Adds'}
                </StatusChip>
              ),
            },
            ...FLAGS.map((flag) => ({
              title: flag.title,
              dataIndex: flag.key,
              width: flag.width,
              align: 'center' as const,
              render: (_: unknown, row: PayComponentRow) => {
                const isPending = pending?.row.id === row.id && pending.flag === flag.key;
                return (
                  <span className="hr-anchor">
                    <Switch
                      size="small"
                      checked={isPending ? pending.next : row[flag.key]}
                      disabled={!mayManage || row.systemControlled || upsert.isPending}
                      aria-label={`${flag.title} for ${row.name}`}
                      title={row.systemControlled ? 'A system item keeps its statutory treatment.' : undefined}
                      onChange={(next) => {
                        setPending({ row, flag: flag.key, next });
                        setFrom(dayjs().add(1, 'month').startOf('month'));
                        setReason('');
                        setProblem(null);
                      }}
                    />
                    {isPending ? (
                      <div className="hr-popover" role="dialog" aria-label="When does this take effect?">
                        <div className="hr-popover__title">
                          {flag.title} {pending.next ? 'on' : 'off'} for {row.name}
                        </div>
                        <div className="hr-popover__hint">
                          A changed treatment is a new version, not an edit — months already priced keep the old one.
                        </div>
                        <label htmlFor={`from-${row.id}`}>From which month</label>
                        <DatePicker
                          id={`from-${row.id}`}
                          picker="month"
                          value={from}
                          allowClear={false}
                          format="MMM YYYY"
                          style={{ width: '100%' }}
                          onChange={(value) => value && setFrom(value.startOf('month'))}
                        />
                        <label htmlFor={`reason-${row.id}`}>Why</label>
                        <Input
                          id={`reason-${row.id}`}
                          value={reason}
                          placeholder="e.g. KWSP circular of 12 Aug"
                          maxLength={500}
                          onChange={(event) => setReason(event.target.value)}
                          onPressEnter={save}
                        />
                        {problem ? <div className="hr-small" style={{ color: 'var(--hr-red)', marginTop: 6 }}>{problem}</div> : null}
                        <div className="hr-popover__actions">
                          <button type="button" className="hr-btn hr-btn--sm" onClick={cancel}>
                            Cancel
                          </button>
                          <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={save} disabled={upsert.isPending}>
                            Save
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </span>
                );
              },
            })),
            ...(showKind
              ? [
                  {
                    title: 'Kind',
                    key: 'kind',
                    width: 130,
                    render: (_: unknown, row: PayComponentRow) =>
                      kinds(row).length > 0 ? <span style={{ display: 'inline-flex', gap: 4 }}>{kinds(row)}</span> : <span className="hr-faint">—</span>,
                  },
                ]
              : []),
            {
              title: 'In use',
              dataIndex: 'active',
              width: 80,
              align: 'center' as const,
              render: (active: boolean, row: PayComponentRow) => (
                <Switch
                  size="small"
                  checked={active}
                  disabled={!mayManage || upsert.isPending}
                  aria-label={`${row.name} in use`}
                  onChange={(next) => toggleActive(row, next)}
                />
              ),
            },
          ]}
        />
        {components.data ? <div className="hr-panelNote">{components.data.verificationNotice.statement}</div> : null}
      </Panel>
    </HrPage>
  );
}
