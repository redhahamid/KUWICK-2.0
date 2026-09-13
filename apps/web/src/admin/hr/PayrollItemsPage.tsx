import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, DatePicker, Input, Select, Switch, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import { usePayComponentHistory, usePayComponents, useSeedPayComponents, useUpsertPayComponent } from '../hooks/useAdmin';
import { Drawer, HrPage, Panel, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconLock } from './ui/icons';
import type { PayComponentRow, PayComponentVersion } from '../types';

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
 * A SYSTEM COMPONENT'S IDENTITY IS FIXED; ITS TREATMENT IS THE CLINIC'S.
 * Basic pay, overtime and the statutory deductions cannot be redefined into
 * something else — the calculation reads their type and the year-end forms
 * read their category — but whether an allowance attracts EPF is a POLICY this
 * clinic sets, not a fact Kuwick can ship, and clinics differ. The switches are
 * live on every row; the lock beside a system name says what is still fixed.
 *
 * A row the clinic has decided says so, with the reason underneath. "Why is
 * EPF off on allowances" must be answerable from this screen, by the person
 * who has to answer it, without opening an audit log.
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

/**
 * A NEW COMPONENT STARTS LIABLE TO NOTHING IT HAS NOT BEEN TOLD ABOUT.
 *
 * Every flag off except PCB, which is on because pay is taxable unless
 * something says otherwise. A blank form that pre-ticked EPF, SOCSO and EIS
 * would be Kuwick guessing at a clinic's policy and calling it a default.
 */
const BLANK = {
  code: '',
  name: '',
  type: 'ADDITION' as const,
  category: 'ALLOWANCE',
  includeIn: 'GROSS_AND_NET',
  pcbLiable: true,
  epfLiable: false,
  socsoLiable: false,
  eisLiable: false,
  hrdLiable: false,
  includeInOrpBase: false,
  includeInUnpaidLeaveBase: false,
  additionalRemuneration: false,
  prorated: false,
  employerSide: false,
  active: true,
};

/** What this version changed from the one before it — the only part worth reading twice. */
const moved = (version: PayComponentVersion, previous: PayComponentVersion | undefined): string[] => {
  if (!previous) return [];
  return FLAGS.filter((flag) => version[flag.key] !== previous[flag.key]).map(
    (flag) => `${flag.title} ${version[flag.key] ? 'on' : 'off'}`,
  );
};

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

  /** Which component's versions are open, and the blank form for a new one. */
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const history = usePayComponentHistory(historyOf);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [addProblem, setAddProblem] = useState<string | null>(null);

  const addComponent = () => {
    const code = draft.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (code.length < 2 || draft.name.trim().length < 2) {
      setAddProblem('A code and a name, both at least two characters.');
      return;
    }
    if (rows.some((row) => row.code === code)) {
      setAddProblem(`"${code}" already exists. Change the existing one instead of adding a second.`);
      return;
    }
    upsert.mutate(
      { ...draft, code, name: draft.name.trim() },
      {
        onSuccess: () => {
          message.success(`${draft.name.trim()} added. Nothing about it has been checked against an authority.`);
          setAdding(false);
          setDraft(BLANK);
          setAddProblem(null);
        },
        onError: (error: Error) => setAddProblem(error.message),
      },
    );
  };

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
          {mayManage && rows.length > 0 ? (
            <button type="button" className="hr-btn" onClick={() => { setAdding(true); setDraft(BLANK); setAddProblem(null); }}>
              Add an item
            </button>
          ) : null}
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
                      <Tooltip title="System item: what it IS cannot be changed — the calculation reads its type and the year-end forms read its category. What it counts towards is yours to set.">
                        <span className="hr-lock" role="img" aria-label="System item: its kind is fixed, its treatment is not">
                          <IconLock />
                        </span>
                      </Tooltip>
                    ) : null}
                  </div>
                  <span className="hr-faint hr-small">{row.code}</span>
                  {row.clinicOverride ? (
                    <div className="hr-small hr-decided">
                      <StatusChip tone="info">Your clinic</StatusChip>
                      <span className="hr-faint">from {dayjs(row.effectiveFrom).format('D MMM YYYY')}</span>
                      {row.changeReason ? <span className="hr-decided__why">{row.changeReason}</span> : null}
                    </div>
                  ) : null}
                  <button type="button" className="hr-historyLink" onClick={() => setHistoryOf(row.code)}>
                    History
                  </button>
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
                      disabled={!mayManage || upsert.isPending}
                      aria-label={`${flag.title} for ${row.name}`}
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

      {historyOf ? (
        <Drawer
          open
          title={`${history.data?.name ?? historyOf} — every version`}
          onClose={() => setHistoryOf(null)}
        >
          {history.isLoading ? (
            <div className="hr-faint">Loading…</div>
          ) : (
            <ol className="hr-versions">
              {(history.data?.versions ?? []).map((version, index, all) => {
                const changed = moved(version, all[index + 1]);
                return (
                  <li key={version.id} className="hr-version">
                    <div className="hr-version__when">
                      <span className="hr-strong">
                        {dayjs(version.effectiveFrom).format('D MMM YYYY')}
                        {version.effectiveTo ? ` – ${dayjs(version.effectiveTo).format('D MMM YYYY')}` : ' onwards'}
                      </span>
                      {version.effectiveTo ? null : <StatusChip tone="done">In force</StatusChip>}
                    </div>
                    <div className="hr-version__flags">
                      {FLAGS.map((flag) => (
                        <span key={flag.key} className={version[flag.key] ? 'hr-tg' : 'hr-tn'}>
                          {flag.title} {version[flag.key] ? '✓' : '✗'}
                        </span>
                      ))}
                    </div>
                    {changed.length > 0 ? (
                      <div className="hr-small">Changed: {changed.join(' · ')}</div>
                    ) : null}
                    {/*
                      * WHOSE DECISION THIS WAS. A version Kuwick seeded and one
                      * the clinic chose are different kinds of fact, and the
                      * screen that has to defend a figure must not blur them.
                      */}
                    <div className="hr-small hr-faint">
                      {version.clinicOverride ? (
                        <>
                          Set by {version.setBy ?? 'this clinic'} on {dayjs(version.setAt).format('D MMM YYYY')}
                          {version.changeReason ? ` — ${version.changeReason}` : ''}
                        </>
                      ) : (
                        (version.sourceRef ?? 'Seeded by Kuwick. Not checked against any authority.')
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Drawer>
      ) : null}

      {adding ? (
        <Drawer
          open
          title="Add a payroll item"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className="hr-btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="hr-btn hr-btn--primary" onClick={addComponent} disabled={upsert.isPending}>
                Add it
              </button>
            </>
          }
        >
          <div className="hr-fld">
            <label htmlFor="new-name">What is it called</label>
            <Input
              id="new-name"
              value={draft.name}
              maxLength={120}
              placeholder="e.g. Procedure incentive"
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="hr-fld">
            <label htmlFor="new-code">Short code</label>
            <Input
              id="new-code"
              value={draft.code}
              maxLength={64}
              placeholder="PROCEDURE_INCENTIVE"
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
            />
            <span className="hr-faint hr-small">Letters, numbers and underscores. It never changes once used.</span>
          </div>
          <div className="hr-fld">
            <label htmlFor="new-type">Does it add or deduct</label>
            <Select
              id="new-type"
              value={draft.type}
              style={{ width: '100%' }}
              onChange={(value) => setDraft({ ...draft, type: value })}
              options={[
                { value: 'ADDITION', label: 'Adds to pay' },
                { value: 'DEDUCTION', label: 'Deducts from pay' },
              ]}
            />
          </div>
          <div className="hr-fld">
            <label htmlFor="new-category">What kind of money</label>
            <Select
              id="new-category"
              value={draft.category}
              style={{ width: '100%' }}
              onChange={(value) => setDraft({ ...draft, category: value })}
              options={[
                { value: 'REMUNERATION', label: 'Remuneration' },
                { value: 'ALLOWANCE', label: 'Allowance' },
                { value: 'BENEFIT_IN_KIND', label: 'Benefit in kind' },
                { value: 'PERQUISITE', label: 'Perquisite' },
                { value: 'PAYROLL_DEDUCTION', label: 'Payroll deduction' },
                { value: 'TAX_DEDUCTION', label: 'Tax deduction' },
              ]}
            />
            <span className="hr-faint hr-small">This drives the year-end forms, and it cannot be changed later.</span>
          </div>

          <div className="hr-fld">
            <label>What it counts towards</label>
            <div className="hr-newFlags">
              {FLAGS.map((flag) => (
                <label key={flag.key} className="hr-newFlags__one">
                  <Switch
                    size="small"
                    checked={draft[flag.key]}
                    onChange={(next) => setDraft({ ...draft, [flag.key]: next })}
                    aria-label={flag.title}
                  />
                  <span>{flag.title}</span>
                </label>
              ))}
            </div>
            <span className="hr-faint hr-small">
              Everything starts off except PCB, because pay is taxable unless something says otherwise. Kuwick does not
              guess at the rest: what this clinic remits on is yours to say, and nothing here has been checked against
              KWSP, PERKESO, LHDN or HRD Corp.
            </span>
          </div>
          {addProblem ? <div className="hr-small" style={{ color: 'var(--hr-red)' }}>{addProblem}</div> : null}
        </Drawer>
      ) : null}
    </HrPage>
  );
}
