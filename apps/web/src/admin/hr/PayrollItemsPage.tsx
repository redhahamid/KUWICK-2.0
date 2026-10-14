import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { App, DatePicker, Input, Radio, Select, Switch, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import { useEmployees, usePayComponentHistory, usePayComponents, useSeedPayComponents, useUpsertPayComponent } from '../hooks/useAdmin';
import { Drawer, HrPage, Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { PayDateCell, ordinal } from './PayDateCell';
import { IconLock } from './ui/icons';
import type { PayComponentRow, PayComponentVersion } from '../types';

/**
 * PAYROLL ITEMS — what a clinic can pay or deduct, and what each one counts
 * towards. The table says each item in one line; clicking the row opens its
 * panel, where the switches are (UAT, 10 October 2026).
 *
 * Eight treatment switches, each backed by a real field on the
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

const FLAGS: { key: Flag; title: string; width: number; hint?: string }[] = [
  { key: 'epfLiable', title: 'EPF', width: 70 },
  { key: 'socsoLiable', title: 'SOCSO', width: 78 },
  { key: 'eisLiable', title: 'EIS', width: 70 },
  { key: 'pcbLiable', title: 'PCB', width: 70 },
  {
    key: 'hrdLiable',
    title: 'HRD',
    width: 70,
    // The employer's levy base decides whether an allowance's switch counts (UAT, 10 October 2026).
    hint: 'Counts toward the HRD levy, unless the employer’s levy base is “Basic salary only” (Settings → Company & statutory): then no allowance counts.',
  },
  // Plain words for the three calculation switches (testing, 15 October 2026); the fields are unchanged.
  { key: 'prorated', title: 'Reduced for part months', width: 84, hint: 'Paid in part when somebody joins, leaves or is unpaid for part of the month.' },
  { key: 'includeInOrpBase', title: 'Counts in the overtime rate', width: 84, hint: 'Added to basic pay when the hourly rate for overtime and rest-day work is worked out.' },
  {
    key: 'includeInUnpaidLeaveBase',
    title: 'Counts in the unpaid-leave deduction',
    width: 130,
    hint: 'Added to basic pay when a day of unpaid leave is worked out and taken off.',
  },
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
  gridColumn: row.gridColumn,
  carryForward: row.carryForward,
  appliesTo: row.appliesTo,
  appliesToStaffIds: row.appliesToStaffIds,
  // Stored, not used yet: carried through so a save from this page does not wipe what the API was told.
  pcbExemptionLimitCents: row.pcbExemptionLimitCents,
  eaField: row.eaField,
  active: row.active,
});

/**
 * HOW THE ITEM SITS ON THE PAYROLL GRID — layout, not treatment, so no date
 * and no reason: a column of its own between Basic and Other income, and
 * whether a new month starts with last month's amount for each person.
 * Offered only for an item a person keys; the derived ones have columns of
 * their own already and the server refuses them.
 */
type Layout = 'gridColumn' | 'carryForward';
const LAYOUT: { key: Layout; title: string; width: number; on: (name: string) => string; off: (name: string) => string }[] = [
  {
    key: 'gridColumn',
    title: 'Own column',
    width: 96,
    on: (name) => `${name} now has its own column on the payroll grid.`,
    off: (name) => `${name} is back in Other income on the payroll grid.`,
  },
  {
    key: 'carryForward',
    title: 'Repeat next month automatically',
    width: 110,
    on: (name) => `${name} will start each month with last month’s amount for each person.`,
    off: (name) => `${name} will start each month empty.`,
  },
];

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
  gridColumn: false,
  carryForward: false,
  active: true,
};

/**
 * THE REASONS A CLINIC ACTUALLY GIVES.
 *
 * The reason stays MANDATORY — a year on, when KWSP asks, the sentence beside
 * the flag is what answers them — but typing one on a phone every time a
 * switch is touched is a tax on doing the right thing. These are the four an
 * owner named, as opening sentences rather than codes: picking one fills the
 * box, and the box is still a box, so it can be finished by hand.
 */
const COMMON_REASONS = [
  'Clinic policy.',
  'Following a KWSP circular.',
  'On the auditor’s advice.',
  'Correcting a mistaken tap.',
];

/** What this version changed from the one before it — the only part worth reading twice. */
const moved = (version: PayComponentVersion, previous: PayComponentVersion | undefined): string[] => {
  if (!previous) return [];
  return FLAGS.filter((flag) => version[flag.key] !== previous[flag.key]).map(
    (flag) => `${flag.title} ${version[flag.key] ? 'on' : 'off'}`,
  );
};

/** Has this version begun? A plan and a record are corrected differently. */
const notStarted = (row: PayComponentRow) => dayjs(row.effectiveFrom).isAfter(dayjs(), 'day');

/** The schemes an item counts towards, in the order a payslip lists them. */
const STATUTORY: Flag[] = ['epfLiable', 'socsoLiable', 'eisLiable', 'pcbLiable', 'hrdLiable'];

/**
 * THE ROW IN ONE LINE (UAT, 10 October 2026): "EPF · SOCSO · EIS · PCB · paid
 * 15th, a month in arrears". Every switch behind it is in the item's panel.
 */
export const itemSummary = (row: PayComponentRow): string => {
  const schemes = FLAGS.filter((flag) => STATUTORY.includes(flag.key) && row[flag.key]).map((flag) => flag.title);
  // DEDUCTIONS IN PLAIN WORDS (UAT, 11 October 2026). Labels only: what each
  // item does in the calculation is unchanged.
  if (row.type === 'DEDUCTION') {
    if (row.code === 'PCB') return 'Monthly tax · calculated automatically';
    if (row.code === 'ZAKAT') return 'Reduces monthly tax';
    if (row.code === 'UNPAID_LEAVE') return 'Reduces salary';
    return schemes.length > 0 ? `Reduces ${schemes.join(' · ')}` : 'Taken from take-home pay';
  }
  const paid = `paid ${ordinal(row.payDay)}${row.paidFollowingMonth ? ' of the following month' : ''}${row.paidInArrears ? ', a month in arrears' : ''}`;
  const head = row.includeIn === 'NET_ONLY' ? 'Reimbursement' : schemes.length > 0 ? schemes.join(' · ') : 'No EPF, SOCSO, EIS or PCB';
  return `${head} · ${paid}`;
};

/** The EA form boxes an item can go in, as the form words them (overnight brief, 15 October 2026). */
const EA_BOX_LABEL: Record<string, string> = {
  B1a: 'B1(a) Salary, wages, leave pay, overtime',
  B1b: 'B1(b) Fees, commission or bonus',
  B1c: 'B1(c) Tips, perquisites, other allowances',
  B1d: 'B1(d) Tax paid by the employer',
  B1e: 'B1(e) Share option benefit',
  B1f: 'B1(f) Gratuity',
  B2: 'B2 Arrears for earlier years',
  B3: 'B3 Benefits in kind',
  B4: 'B4 Living accommodation',
  B5: 'B5 Refund from unapproved fund',
  B6: 'B6 Compensation for loss of job',
  F: 'F Tax-exempt',
  NONE: 'Not on the EA form',
};

/** The three groups a clinic reads its items in (testing, 15 October 2026). */
type Group = 'EARNINGS' | 'CLAIMS' | 'DEDUCTIONS';
const GROUPS: { key: Group; title: string; sub: string }[] = [
  { key: 'EARNINGS', title: 'Earnings', sub: 'Pay, allowances, overtime and bonuses.' },
  { key: 'CLAIMS', title: 'Claims', sub: 'Money paid back to staff, outside wages.' },
  { key: 'DEDUCTIONS', title: 'Deductions', sub: 'Taken off pay: tax, unpaid leave and the like.' },
];
export const groupOf = (row: PayComponentRow): Group =>
  row.type === 'DEDUCTION' ? 'DEDUCTIONS' : row.includeIn === 'NET_ONLY' ? 'CLAIMS' : 'EARNINGS';

export function PayrollItemsPage() {
  const { message } = App.useApp();
  const components = usePayComponents();
  const seed = useSeedPayComponents();
  const upsert = useUpsertPayComponent();
  const mayManage = useCan('hr.statutory.manage');
  const rows = components.data?.components ?? [];
  /*
   * STANDARD ITEMS THIS CLINIC HAS NOT GOT YET.
   *
   * The seed is additive, but its button was drawn only on an EMPTY catalogue
   * — so a clinic that seeded once could never receive a component Kuwick
   * added later. It would exist in the product, be absent from this screen,
   * and the payroll run that named it would point at something nobody could
   * find. Drawn whenever there is something to add, named so the reader can
   * see what they would be getting.
   */
  const missing = components.data?.missingPresets ?? [];

  /** The one switch that is waiting for a date and a reason. */
  const [pending, setPending] = useState<{ row: PayComponentRow; flag: Flag | null; next: boolean } | null>(null);
  const [from, setFrom] = useState<Dayjs>(dayjs().add(1, 'month').startOf('month'));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  /** Which component's versions are open, and the blank form for a new one. */
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const history = usePayComponentHistory(historyOf);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [addProblem, setAddProblem] = useState<string | null>(null);
  /** The item whose people are being chosen. */
  const [audienceOf, setAudienceOf] = useState<PayComponentRow | null>(null);
  /**
   * The item open in its panel, by code: a dated change saves a new version
   * with a new id, and the panel should stay on the item.
   */
  const [openCode, setOpenCode] = useState<string | null>(null);
  const openRow = openCode ? (rows.find((row) => row.code === openCode) ?? null) : null;

  /** Who an item is for is audience, not treatment: saved in place like the two layout switches. */
  const saveAudience = (row: PayComponentRow, appliesTo: 'EVERYONE' | 'SELECTED', appliesToStaffIds: string[]) =>
    upsert.mutate(
      { ...whole(row), appliesTo, appliesToStaffIds },
      {
        onSuccess: () => {
          setAudienceOf(null);
          message.success(
            appliesTo === 'EVERYONE'
              ? `${row.name} is for everyone again.`
              : `${row.name} is for ${appliesToStaffIds.length} ${appliesToStaffIds.length === 1 ? 'employee' : 'employees'} only.`,
          );
        },
        onError: (error: Error) => message.error(error.message),
      },
    );

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

  const openItem = (row: PayComponentRow) => {
    cancel();
    setOpenCode(row.code);
  };
  const closeItem = () => {
    cancel();
    setOpenCode(null);
  };

  const save = () => {
    if (!pending) return;
    if (!reason.trim()) {
      setProblem('Say why — it is recorded with the change.');
      return;
    }
    upsert.mutate(
      {
        ...whole(pending.row),
        // A null flag is a DATE-ONLY correction: the treatment already says what
        // the clinic wants and only the month it starts in is wrong.
        ...(pending.flag ? { [pending.flag]: pending.next } : {}),
        effectiveFrom: from.format('YYYY-MM-DD'),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          message.success(
            pending.flag
              ? `${pending.row.name}: ${FLAGS.find((f) => f.key === pending.flag)?.title} ${pending.next ? 'on' : 'off'} from ${from.format('MMM YYYY')}.`
              : `${pending.row.name} now starts ${from.format('MMM YYYY')}, with the same treatment.`,
          );
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

  /** Where the item sits on the grid is layout, saved in place like on/off. */
  const toggleLayout = (row: PayComponentRow, key: Layout, next: boolean) =>
    upsert.mutate(
      { ...whole(row), [key]: next },
      {
        onSuccess: () => {
          const layout = LAYOUT.find((candidate) => candidate.key === key);
          message.success(next ? layout?.on(row.name) : layout?.off(row.name));
        },
        onError: (error: Error) => message.error(error.message),
      },
    );

  /** The EA box is a year-end label, not treatment: saved in place, no date. Null goes back to Kuwick's suggestion. */
  const saveEaBox = (row: PayComponentRow, eaField: string | null) =>
    upsert.mutate(
      { ...whole(row), eaField },
      {
        onSuccess: () => message.success(`${row.name} goes in ${EA_BOX_LABEL[eaField ?? row.eaBoxDefault ?? ''] ?? 'the suggested box'} on the EA form.`),
        onError: (error: Error) => message.error(error.message),
      },
    );

  /** What a row IS, read off the row: nothing a person sets here. */
  const kinds = (row: PayComponentRow) =>
    row.type === 'ADDITION' && row.includeIn === 'NET_ONLY' ? [<StatusChip key="r" tone="info">Reimbursement</StatusChip>] : [];

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
          {mayManage && (rows.length === 0 || missing.length > 0) ? (
            <button
              type="button"
              className="hr-btn hr-btn--primary"
              disabled={seed.isPending}
              onClick={() =>
                seed.mutate(undefined, {
                  onSuccess: () =>
                    message.success(
                      rows.length === 0
                        ? 'Standard items added. Check what each one counts towards before using it.'
                        : `Added ${missing.length === 1 ? missing[0].name : `${missing.length} standard items`}. Check the flags before using it.`,
                    ),
                  onError: (e: Error) => message.error(e.message),
                })
              }
            >
              {rows.length === 0
                ? 'Add the standard items'
                : missing.length === 1
                  ? `Add ${missing[0].name}`
                  : `Add ${missing.length} standard items`}
            </button>
          ) : null}
        </>
      }
    >
      {rows.length === 0 ? (
        <Panel>
          <div className="hr-faint">{components.isLoading ? 'Loading…' : 'No pay items are set up yet. Add the standard items, then say what each one counts towards.'}</div>
        </Panel>
      ) : null}
      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => groupOf(row) === group.key);
        if (groupRows.length === 0) return null;
        return (
          <Panel key={group.key}>
            <PanelHead title={group.title} sub={group.sub} />
            <Table<PayComponentRow>
              rows={groupRows}
              rowKey="id"
              emptyText="None."
              onRow={(row) => ({ onClick: () => openItem(row) })}
              columns={[
                {
                  title: 'Item',
                  dataIndex: 'name',
                  render: (value: string, row) => (
                    <div>
                      <button type="button" className="hr-linkButton hr-strong" onClick={(event) => { event.stopPropagation(); openItem(row); }}>
                        {value}
                      </button>
                      {row.systemControlled ? (
                        <span className="hr-lock" role="img" aria-label="System item: its kind is fixed, its treatment is not">
                          <IconLock />
                        </span>
                      ) : null}
                      {row.clinicOverride ? <div className="hr-faint hr-small">Your clinic’s setting</div> : null}
                    </div>
                  ),
                },
                {
                  title: 'Adds or deducts',
                  dataIndex: 'type',
                  width: 140,
                  render: (value: string) => (
                    <StatusChip tone={value === 'DEDUCTION' ? 'attn' : 'info'}>
                      {value === 'DEDUCTION' ? 'Deducts' : value === 'OVERTIME' ? 'Overtime' : 'Adds'}
                    </StatusChip>
                  ),
                },
                {
                  title: 'What it counts towards',
                  key: 'summary',
                  render: (_: unknown, row: PayComponentRow) => <span className="hr-itemSummary">{itemSummary(row)}</span>,
                },
                {
                  title: 'In use',
                  dataIndex: 'active',
                  width: 110,
                  render: (active: boolean) => <StatusChip tone={active ? 'done' : 'muted'}>{active ? 'In use' : 'Off'}</StatusChip>,
                },
              ]}
            />
          </Panel>
        );
      })}
      <Panel>
        <div className="hr-panelNote">
          Click an item to change what it counts towards, when it is paid, who it is for, or switch it off.
          <details className="hr-details">
            <summary>Details</summary>
          <strong>Own column</strong> gives the item a column of its own on the payroll grid, between Basic and Other income, typed
          straight in. <strong>Repeat next month automatically</strong> starts each new month with last month’s amount for each person, marked as
          carried until it is edited or cleared; a line earned in the month before is carried with its earned-in month moved on
          by one, and a one-off late payment is not carried. <strong>Applies to</strong> says who the item is for: everyone, or
          the employees you name, who alone get its column, its line in the items drawer and its carried amount. All three are
          layout, not treatment: they need no date or reason.
          </details>
        </div>
        {components.data ? <div className="hr-panelNote">{components.data.verificationNotice.statement}</div> : null}
      </Panel>

      {openRow ? (
        <Drawer open title={openRow.name} sub={itemSummary(openRow)} onClose={closeItem}>
          <ItemPanel
            row={openRow}
            mayManage={mayManage}
            saving={upsert.isPending}
            pending={pending?.row.code === openRow.code ? pending : null}
            from={from}
            reason={reason}
            problem={problem}
            kinds={kinds(openRow)}
            onFlag={(flag, next) => {
              setPending({ row: openRow, flag, next });
              setFrom(dayjs().add(1, 'month').startOf('month'));
              setReason('');
              setProblem(null);
            }}
            onMoveMonth={() => {
              setPending({ row: openRow, flag: null, next: false });
              setFrom(dayjs(openRow.effectiveFrom).startOf('month'));
              setReason('');
              setProblem(null);
            }}
            onFrom={setFrom}
            onReason={setReason}
            onCancel={cancel}
            onSave={save}
            onLayout={(key, next) => toggleLayout(openRow, key, next)}
            onActive={(next) => toggleActive(openRow, next)}
            onAudience={() => setAudienceOf(openRow)}
            onEaBox={(value) => saveEaBox(openRow, value)}
            onHistory={() => setHistoryOf(openRow.code)}
          />
        </Drawer>
      ) : null}

      {audienceOf ? (
        <AudienceDrawer
          row={audienceOf}
          saving={upsert.isPending}
          onClose={() => setAudienceOf(null)}
          onSave={(appliesTo, ids) => saveAudience(audienceOf, appliesTo, ids)}
        />
      ) : null}

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
                        (version.sourceRef ?? 'Set by Kuwick. Not checked against any authority.')
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
            <span className="hr-faint hr-small">Used to suggest its EA form box. It cannot be changed later.</span>
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

          {draft.type === 'ADDITION' ? (
            <div className="hr-fld">
              <label>On the payroll grid</label>
              <div className="hr-newFlags">
                {LAYOUT.map((layout) => (
                  <label key={layout.key} className="hr-newFlags__one">
                    <Switch
                      size="small"
                      checked={draft[layout.key]}
                      onChange={(next) => setDraft({ ...draft, [layout.key]: next })}
                      aria-label={layout.title}
                    />
                    <span>{layout.title}</span>
                  </label>
                ))}
              </div>
              <span className="hr-faint hr-small">
                Own column: typed straight into the grid, between Basic and Other income. Carry forward: each new month starts
                with last month’s amount for each person, marked as carried until edited or cleared.
              </span>
            </div>
          ) : null}
          {addProblem ? <div className="hr-small" style={{ color: 'var(--hr-red)' }}>{addProblem}</div> : null}
        </Drawer>
      ) : null}
    </HrPage>
  );
}

/**
 * ONE ITEM, EVERY SWITCH (UAT, 10 October 2026). The table shows the item in
 * one line; this panel, opened by clicking the row, is where it changes. The
 * rules are the ones the row had: a treatment switch asks for the month it
 * takes effect and why, and is a new version (or replaces a plan that has not
 * started); pay date, grid layout, audience and in-use save at once.
 */
function ItemPanel({
  row,
  mayManage,
  saving,
  pending,
  from,
  reason,
  problem,
  kinds,
  onFlag,
  onMoveMonth,
  onFrom,
  onReason,
  onCancel,
  onSave,
  onLayout,
  onActive,
  onAudience,
  onEaBox,
  onHistory,
}: {
  row: PayComponentRow;
  mayManage: boolean;
  saving: boolean;
  pending: { row: PayComponentRow; flag: Flag | null; next: boolean } | null;
  from: Dayjs;
  reason: string;
  problem: string | null;
  kinds: ReactNode[];
  onFlag: (flag: Flag, next: boolean) => void;
  onMoveMonth: () => void;
  onFrom: (value: Dayjs) => void;
  onReason: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onLayout: (key: Layout, next: boolean) => void;
  onActive: (next: boolean) => void;
  onAudience: () => void;
  onEaBox: (value: string | null) => void;
  onHistory: () => void;
}) {
  const ask = (label: string, hint: ReactNode, withCommon: boolean) => (
    <div className="hr-popover hr-popover--inline" role="dialog" aria-label={label}>
      {hint}
      <label htmlFor={`from-${row.id}`}>From which month</label>
      <DatePicker
        id={`from-${row.id}`}
        picker="month"
        value={from}
        allowClear={false}
        format="MMM YYYY"
        style={{ width: '100%' }}
        onChange={(value) => value && onFrom(value.startOf('month'))}
      />
      <label htmlFor={`reason-${row.id}`}>Why</label>
      {withCommon ? (
        <Select
          aria-label="Common reasons"
          placeholder="Pick a common reason"
          style={{ width: '100%', marginBottom: 6 }}
          value={COMMON_REASONS.includes(reason) ? reason : undefined}
          options={COMMON_REASONS.map((value) => ({ value, label: value }))}
          onChange={(value) => onReason(value)}
        />
      ) : null}
      <Input
        id={`reason-${row.id}`}
        value={reason}
        placeholder={withCommon ? 'or write your own' : 'Kept with this version'}
        maxLength={500}
        onChange={(event) => onReason(event.target.value)}
        onPressEnter={onSave}
      />
      {problem ? <div className="hr-small" style={{ color: 'var(--hr-red)', marginTop: 6 }}>{problem}</div> : null}
      <div className="hr-popover__actions">
        <button type="button" className="hr-btn hr-btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={onSave} disabled={saving}>
          Save
        </button>
      </div>
    </div>
  );

  return (
    <div className="hr-itemPanel">
      {row.systemControlled ? (
        <div className="hr-small hr-faint">
          <IconLock /> System item: what it is cannot be changed, because the calculation reads its type. What it counts towards
          is yours to set.
        </div>
      ) : null}

      {row.clinicOverride ? (
        <div className="hr-small hr-decided">
          <StatusChip tone="info">Your clinic</StatusChip>
          <span className="hr-faint">from {dayjs(row.effectiveFrom).format('D MMM YYYY')}</span>
          {/*
            A VERSION'S DATE IS EDITABLE ON ITS OWN: where the switches already
            say what the clinic wants and only the month is wrong. A plan moves
            anywhere; one in force moves earlier, while no month in between is
            approved (UAT, 11 October 2026).
          */}
          <button type="button" className="hr-historyLink" onClick={onMoveMonth}>
            Change the month
          </button>
          {row.changeReason ? <span className="hr-decided__why">{row.changeReason}</span> : null}
        </div>
      ) : null}
      {pending && pending.flag === null
        ? ask(
            `Change when ${row.name} starts`,
            <div className="hr-small">
              {notStarted(row)
                ? 'This change has not started yet, so its date can move without becoming a second version. The treatment stays exactly as it is.'
                : 'Choose an earlier month if this treatment really started then. Refused if any branch has an approved month in between. The treatment stays exactly as it is.'}
            </div>,
            false,
          )
        : null}

      <section className="hr-itemSection">
        <h3 className="hr-itemPanel__head">What it counts towards</h3>
        <div className="hr-itemFlags">
          {FLAGS.map((flag) => {
            const isPending = pending?.flag === flag.key;
            return (
              <div key={flag.key} className="hr-itemFlag">
                <div className="hr-itemFlag__row">
                  <span>
                    {flag.hint ? (
                      <Tooltip title={flag.hint}>
                        <span style={{ borderBottom: '1px dotted currentColor' }}>{flag.title}</span>
                      </Tooltip>
                    ) : (
                      flag.title
                    )}
                  </span>
                  <Switch
                    size="small"
                    checked={isPending ? pending.next : row[flag.key]}
                    disabled={!mayManage || saving}
                    aria-label={`${flag.title} for ${row.name}`}
                    onChange={(next) => onFlag(flag.key, next)}
                  />
                </div>
                {isPending
                  ? ask(
                      'When does this take effect?',
                      <>
                        <div className="hr-popover__title">
                          {flag.title} {pending.next ? 'on' : 'off'} for {row.name}
                        </div>
                        <div className="hr-popover__hint">
                          {/* A version that has not begun is a plan, and editing it replaces it; one in force is history. */}
                          {notStarted(row)
                            ? `This change has not started yet, so editing it replaces it — no third version, and nothing has been paid under it.`
                            : 'A changed treatment is a new version, not an edit — months already priced keep the old one. A month before the version in force applies it from then on, refused if any branch has an approved month from then.'}
                        </div>
                      </>,
                      true,
                    )
                  : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="hr-itemSection">
        <h3 className="hr-itemPanel__head">Paid on</h3>
        <PayDateCell row={row} disabled={!mayManage} />
        {kinds.length > 0 ? <span style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}>{kinds}</span> : null}
      </section>

      {row.handKeyed ? (
        <section className="hr-itemSection">
          <h3 className="hr-itemPanel__head">On the payroll grid</h3>
          {LAYOUT.map((layout) => (
            <div key={layout.key} className="hr-itemFlag__row">
              <span>{layout.title}</span>
              <Switch
                size="small"
                checked={row[layout.key]}
                disabled={!mayManage || saving || !row.active}
                aria-label={`${layout.title} for ${row.name}`}
                onChange={(next) => onLayout(layout.key, next)}
              />
            </div>
          ))}
          <span className="hr-faint hr-small">
            Own column: typed straight into the grid, between Basic and Other income. Carry forward: each new month starts with
            last month’s amount for each person, marked as carried until edited or cleared.
          </span>
        </section>
      ) : null}

      <section className="hr-itemSection">
        <h3 className="hr-itemPanel__head">Applies to</h3>
        {row.audienceEditable ? (
          <button
            type="button"
            className="hr-linkButton"
            disabled={!mayManage || saving}
            aria-label={`Who ${row.name} is for`}
            onClick={onAudience}
          >
            {row.appliesTo === 'SELECTED'
              ? `${row.appliesToStaffIds.length} ${row.appliesToStaffIds.length === 1 ? 'employee' : 'employees'}`
              : 'Everyone'}
          </button>
        ) : (
          <span className="hr-faint">Everyone the records say: this item is worked out from them.</span>
        )}
      </section>

      {row.type !== 'DEDUCTION' || row.includeIn !== 'NET_ONLY' ? (
        <section className="hr-itemSection">
          <h3 className="hr-itemPanel__head">EA form box</h3>
          <Select
            aria-label={`EA form box for ${row.name}`}
            style={{ width: '100%' }}
            disabled={!mayManage || saving}
            value={row.eaField ?? 'SUGGESTED'}
            onChange={(value: string) => onEaBox(value === 'SUGGESTED' ? null : value)}
            options={[
              { value: 'SUGGESTED', label: `Kuwick’s suggestion: ${EA_BOX_LABEL[row.eaBoxDefault ?? ''] ?? '—'}` },
              ...Object.entries(EA_BOX_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <span className="hr-faint hr-small">Where this item’s yearly total goes on each employee’s Borang EA. Check with your tax adviser.</span>
        </section>
      ) : null}

      <section className="hr-itemSection">
        <div className="hr-itemFlag__row">
          <h3 className="hr-itemPanel__head">In use</h3>
          <Switch size="small" checked={row.active} disabled={!mayManage || saving} aria-label={`${row.name} in use`} onChange={onActive} />
        </div>
      </section>

      <button type="button" className="hr-historyLink" onClick={onHistory}>
        History
      </button>
      <details className="hr-details">
        <summary>Details</summary>
        <div className="hr-small hr-faint">Code: {row.code}</div>
      </details>
    </div>
  );
}

/**
 * WHO AN ITEM IS FOR. Everyone, or a list of named employees: a director's
 * fee is for the directors, a locum session for the doctors, and the nurse's
 * row should not carry an empty box for either every month. The list is
 * checkboxes rather than a tag picker, because a clinic has twelve people
 * and a phone has a thumb. A leaver who is still named stays on the list,
 * marked, until somebody takes them off.
 */
function AudienceDrawer({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: PayComponentRow;
  saving: boolean;
  onClose: () => void;
  onSave: (appliesTo: 'EVERYONE' | 'SELECTED', appliesToStaffIds: string[]) => void;
}) {
  const employees = useEmployees({ status: 'ACTIVE' });
  const [appliesTo, setAppliesTo] = useState<'EVERYONE' | 'SELECTED'>(row.appliesTo);
  const [chosen, setChosen] = useState<string[]>(row.appliesToStaffIds);
  const [search, setSearch] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Every active employee, plus anybody named on the item who is no longer active.
  const people = useMemo(() => {
    const active = (employees.data ?? []).map((person) => ({ staffId: person.staffId, fullName: person.fullName, active: true, position: person.position ?? null }));
    const known = new Set(active.map((person) => person.staffId));
    const named = row.appliesToStaff
      .filter((person) => !known.has(person.staffId))
      .map((person) => ({ staffId: person.staffId, fullName: person.fullName, active: person.active, position: null as string | null }));
    return [...active, ...named].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [employees.data, row.appliesToStaff]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? people.filter((person) => person.fullName.toLowerCase().includes(needle)) : people;

  const toggle = (staffId: string, on: boolean) =>
    setChosen((current) => (on ? [...new Set([...current, staffId])] : current.filter((id) => id !== staffId)));

  const save = () => {
    if (appliesTo === 'SELECTED' && chosen.length === 0) {
      setProblem(`Pick at least one employee ${row.name} is for, or choose Everyone.`);
      return;
    }
    setProblem(null);
    onSave(appliesTo, appliesTo === 'SELECTED' ? chosen : []);
  };

  return (
    <Drawer
      open
      title={`Who ${row.name} is for`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="hr-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="hr-btn hr-btn--primary" onClick={save} disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <Radio.Group
        value={appliesTo}
        onChange={(event) => setAppliesTo(event.target.value as 'EVERYONE' | 'SELECTED')}
        options={[
          { value: 'EVERYONE', label: 'Everyone on the payroll' },
          { value: 'SELECTED', label: 'Selected employees only' },
        ]}
      />
      {appliesTo === 'SELECTED' ? (
        <div style={{ marginTop: 14 }}>
          <Input
            allowClear
            placeholder="Search by name"
            aria-label="Search employees"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ marginBottom: 10 }}
          />
          {employees.isLoading ? <div className="hr-faint">Loading employees…</div> : null}
          <div role="group" aria-label={`Employees ${row.name} is for`} style={{ display: 'grid', gap: 6 }}>
            {shown.map((person) => (
              <label key={person.staffId} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(person.staffId)}
                  onChange={(event) => toggle(person.staffId, event.target.checked)}
                />
                <span>
                  {person.fullName}
                  {person.position ? <span className="hr-faint"> · {person.position}</span> : null}
                  {!person.active ? <span className="hr-faint"> · no longer active</span> : null}
                </span>
              </label>
            ))}
            {shown.length === 0 && !employees.isLoading ? <div className="hr-faint">Nobody matches.</div> : null}
          </div>
          <div className="hr-faint" style={{ marginTop: 10 }}>
            {chosen.length} chosen. Only these people get the {row.name} column, its line in the items drawer and its carried
            amount; a line for anybody else is refused.
          </div>
        </div>
      ) : (
        <div className="hr-faint" style={{ marginTop: 12 }}>
          Every employee on the payroll can have a {row.name} line, and the column, if it has one, is on every row.
        </div>
      )}
      {problem ? (
        <div className="hr-notice hr-notice--attn" style={{ marginTop: 12 }}>
          {problem}
        </div>
      ) : null}
    </Drawer>
  );
}
