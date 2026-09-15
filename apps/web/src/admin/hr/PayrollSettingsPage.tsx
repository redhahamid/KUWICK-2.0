import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Input, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import {
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  useSetPayrollApprovalPolicy,
  useStatutoryRates,
  useUpsertPayrollPolicy,
} from '../hooks/useAdmin';
import {
  Drawer,
  FieldProblem,
  HrPage,
  NotApplied,
  Panel,
  PanelHead,
  ProblemNotice,
  problemCell,
  StatusChip,
  useProblemFocus,
  type FormProblem,
} from './ui';
import { Table } from './ui/Table';
import { IconEdit, IconPlus } from './ui/icons';
import type { OvertimeMode, PayrollPolicyRow } from '../types';

/**
 * PAYROLL POLICIES — one settings area, reached from the Settings landing.
 *
 * Two decisions live here. Who may approve a run — three choices, written as
 * sentences, because the owner is choosing how their clinic works and not
 * learning a control framework's vocabulary. And how pay is worked out — the
 * bases the engine prices a day and an hour from, per rule set.
 *
 * What does NOT live here any more: the employer table (Company & statutory),
 * the attendance editor (Attendance & leave policies), the pay components
 * (Payroll items), the statutory tables (Statutory rates). Each was a second
 * copy of a fact that has one home, and this page points at the home.
 *
 * HOW EXTRA HOURS ARE PRICED lives here too (§6): each rule set is either
 * the Employment Act's arithmetic or the clinic's own fixed rates, applies to
 * a group of the workforce, and — for anybody on RM4,000 or less — is held
 * to the Act as a floor. The server works the floor out against the
 * employees the rule set actually prices and says who it would underpay; the
 * gold notice under the table is that answer, and the payroll run blocks the
 * same people until the rate is corrected.
 */
const CHOICES = [
  {
    value: 'STANDARD',
    title: 'Anybody who can approve payroll',
    detail: 'One approval, and the person who ran the payroll may give it. Right for a clinic where one person does everything.',
  },
  {
    value: 'MAKER_CHECKER',
    title: 'Somebody other than the person who ran it',
    detail: 'One approval, from a second person. Right once two people share the work and you want the figures looked at twice.',
  },
  {
    value: 'DUAL_APPROVAL',
    title: 'Two people, neither of them the one who ran it',
    detail: 'The run stays open until two different people approve it. Right for a group that treats payroll as a board-level payment.',
  },
] as const;

const basisLabel = (basis: string, days: number | null) =>
  basis === 'CALENDAR_DAYS' ? 'calendar days' : basis === 'FIXED_DAYS' && days ? `${days}-day month` : basis.toLowerCase().replace(/_/g, ' ');

const rm = (value: string) => `RM${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line naming how a rule set prices extra hours. */
/*
 * THE FIGURES IN FORCE, NOT THE FIGURES IN THE ACT.
 *
 * This line used to print "1.5× · rest day 2.0× · public holiday 3.0×" for
 * every statutory rule set, because those were the only multipliers a run
 * could use. A clinic may now raise any of the three, so the line reads them
 * off the rule set and says whose numbers they are — a screen that prints the
 * Act's figure over a clinic's 2× is the same defect as a report that printed
 * "clinic policy" over a hardcoded divisor.
 */
const multiplierLine = (row: PayrollPolicyRow) => {
  const set = row.multipliers;
  if (!set) return 'Employment Act: 1.5× · rest day 2.0× · public holiday 3.0×';
  const own = set.overtime.set || set.restDay.set || set.publicHoliday.set;
  const figures = `${set.overtime.used}× · rest day ${set.restDay.used}× · public holiday ${set.publicHoliday.used}×`;
  return own ? `Clinic multipliers: ${figures}` : `Employment Act: ${figures}`;
};

const pricingLine = (row: PayrollPolicyRow) => {
  if (row.overtimeMode !== 'CLINIC_RATE' || !row.clinicRates) return multiplierLine(row);
  const parts = [
    row.clinicRates.overtimeHourly ? `${rm(row.clinicRates.overtimeHourly)} an hour` : null,
    row.clinicRates.publicHolidayShift ? `${rm(row.clinicRates.publicHolidayShift)} a public holiday shift` : null,
    row.clinicRates.restDayShift ? `${rm(row.clinicRates.restDayShift)} a rest day shift` : null,
    row.clinicRates.session ? `${rm(row.clinicRates.session)} a session` : null,
  ].filter((part): part is string => part !== null);
  // A kind of day with no amount falls back to the Act's formula, which uses
  // whichever multipliers this rule set holds — so both belong on the line.
  return `Clinic rate: ${parts.join(' · ')} · otherwise ${multiplierLine(row).toLowerCase()}`;
};

/**
 * THE ACT'S FIGURES FOR A RM4,000 WAGE, the highest the First Schedule
 * reaches — so the person typing a clinic rate can see the floor before the
 * server checks it against real employees. Same arithmetic as the server:
 * a day is the wage over 26, an hour is a day over the normal hours, rounded
 * to the sen before the multiplier.
 */
const actFloorAt4000 = (hoursPerDay: number) => {
  const daily = 400000 / 26;
  const hourly = Math.round(daily / hoursPerDay);
  const money = (cents: number) => rm((cents / 100).toFixed(2));
  return {
    hour: money(Math.round(hourly * 1.5)),
    holiday: money(Math.round(daily * 2)),
    restDay: money(Math.round(daily)),
  };
};

const MODES: { value: OvertimeMode; title: string; detail: string }[] = [
  {
    value: 'STATUTORY',
    title: 'Employment Act 1955',
    detail: 'A day is the monthly salary over 26 and an hour is a day over the normal hours. The multipliers below decide what an extra hour is worth.',
  },
  {
    value: 'CLINIC_RATE',
    title: 'Clinic rate',
    detail: 'Fixed amounts set here, never typed into the payroll grid. A kind of day left blank is priced by the Act. For anybody on RM4,000 or less the Act is a floor.',
  },
];

/*
 * THE THREE MULTIPLIERS A CLINIC MAY SET, and the Act's floor under each.
 *
 * Found in staging UAT: a rule set could only be the Act's fixed 1.5× / 2× / 3×
 * or fixed ringgit amounts. A clinic that pays overtime at 2× — paying MORE
 * than the Act, which is its right — had no way to say so, and had to choose
 * between a rate it had outgrown and a flat amount that stops tracking salary.
 *
 * Each floor is "not less than", so above is the clinic's to set and below is
 * refused. The figures mirror OVERTIME_MULTIPLIER_FLOORS in the API's
 * employment-act.ts, which is where the server refuses the same values — the
 * browser saying it first is a courtesy, not the control.
 *
 * WHAT THESE PRICE IS THE HOUR, NOT THE DAY. A rest day or public holiday
 * worked is paid in DAYS of ordinary rate by ss.60(3)(b) and 60D(3)(a)(i) —
 * two days' wages for a public holiday however few hours were done — and that
 * is the Act's arithmetic, not a multiplier anybody sets here.
 */
const MULTIPLIERS = [
  {
    field: 'ruleset-ot-multiplier',
    label: 'Overtime',
    act: 1.5,
    what: 'an hour of overtime on a normal working day',
    provision: 'Section 60A(3)(a)',
  },
  {
    field: 'ruleset-restday-multiplier',
    label: 'Rest day',
    act: 2,
    what: 'an hour beyond normal hours on a rest day',
    provision: 'Section 60(3)(c)',
  },
  {
    field: 'ruleset-holiday-multiplier',
    label: 'Public holiday',
    act: 3,
    what: 'an hour beyond normal hours on a public holiday',
    provision: 'Section 60D(3)(aa)',
  },
] as const;

/** The one sentence a below-Act figure gets, wherever it is shown. */
const belowActSentence = (m: { label: string; act: number; what: string; provision: string }, chosen: number) =>
  `${m.label} at ${chosen}× is BELOW the ${m.act}× that ${m.provision} sets as the minimum for ${m.what}.`;

type MultiplierField = (typeof MULTIPLIERS)[number]['field'];

export function PayrollSettingsPage() {
  const { message } = App.useApp();
  const approval = usePayrollApprovalPolicy();
  const setApproval = useSetPayrollApprovalPolicy();
  const policies = usePayrollPolicies();
  const rates = useStatutoryRates();

  const choose = (body: Record<string, unknown>) =>
    setApproval.mutate(body, {
      onSuccess: () => message.success('Approval rule updated'),
      onError: (error: Error) => message.error(error.message),
    });

  const check = rates.data?.check ?? null;
  const error = [approval, policies].find((query) => query.error)?.error;

  const mayManage = useCan('hr.statutory.manage');
  const upsert = useUpsertPayrollPolicy();
  const [editing, setEditing] = useState<PayrollPolicyRow | 'new' | null>(null);
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('__hand');
  const [mode, setMode] = useState<OvertimeMode>('STATUTORY');
  const [hourly, setHourly] = useState('');
  const [holiday, setHoliday] = useState('');
  const [restDay, setRestDay] = useState('');
  const [session, setSession] = useState('');
  // THE ORDINARY-RATE DIVISORS. Held as strings so a half-typed field is not
  // silently read as 0 while somebody is still typing it.
  const [otDays, setOtDays] = useState('26');
  const [hoursDay, setHoursDay] = useState('7.5');
  // THE CLINIC'S OWN MULTIPLIERS, blank for "the Act's". Strings for the same
  // reason the divisors are: "2." mid-keystroke is not the number 2.
  const [multipliers, setMultipliers] = useState<Record<MultiplierField, string>>({
    'ruleset-ot-multiplier': '',
    'ruleset-restday-multiplier': '',
    'ruleset-holiday-multiplier': '',
  });
  const setMultiplier = (field: MultiplierField, value: string) =>
    setMultipliers((current) => ({ ...current, [field]: value }));
  // THE CONFIRMATION, AND THE WORDS. Paying below the Act saves, but not by
  // pressing the same button as everything else: the tick and the reason are
  // what turn a figure into a decision with an author.
  const [belowActOk, setBelowActOk] = useState(false);
  const [belowActWhy, setBelowActWhy] = useState('');
  // The reason, and WHICH BOX it is about. A refusal with no field named is
  // about the form as a whole and keeps the banner.
  const [problem, setProblem] = useState<FormProblem>(null);
  useProblemFocus(problem);
  const refuse = (field: string | undefined, message: string) => {
    setProblem({ field, message });
  };

  const openNew = () => {
    setName('');
    setAppliesTo('__hand');
    setMode('STATUTORY');
    setHourly('');
    setHoliday('');
    setRestDay('');
    setSession('');
    setOtDays('26');
    setHoursDay('7.5');
    setMultipliers({ 'ruleset-ot-multiplier': '', 'ruleset-restday-multiplier': '', 'ruleset-holiday-multiplier': '' });
    setBelowActOk(false);
    setBelowActWhy('');
    setProblem(null);
    setEditing('new');
  };
  const openEdit = (row: PayrollPolicyRow) => {
    setName(row.name);
    setAppliesTo(row.workforceCategory ?? (row.isDefault ? '__default' : '__hand'));
    setMode(row.overtimeMode);
    setHourly(row.clinicRates?.overtimeHourly ?? '');
    setHoliday(row.clinicRates?.publicHolidayShift ?? '');
    setRestDay(row.clinicRates?.restDayShift ?? '');
    setSession(row.clinicRates?.session ?? '');
    setOtDays(String(row.overtime.days ?? 26));
    setHoursDay(String(row.overtime.hoursPerDay));
    // A box left blank is on the Act's, and stays blank so the placeholder can
    // say which figure that is rather than the clinic having to remember.
    setMultipliers({
      'ruleset-ot-multiplier': row.multipliers?.overtime.set ? String(row.multipliers.overtime.used) : '',
      'ruleset-restday-multiplier': row.multipliers?.restDay.set ? String(row.multipliers.restDay.used) : '',
      'ruleset-holiday-multiplier': row.multipliers?.publicHoliday.set ? String(row.multipliers.publicHoliday.used) : '',
    });
    // An acknowledgement already on file covers the figures it was given for,
    // so reopening a rule set to rename it does not demand the whole
    // conversation again. Changing a below-Act figure clears it server-side.
    setBelowActOk(Boolean(row.belowAct?.acknowledgement));
    setBelowActWhy(row.belowAct?.acknowledgement?.reason ?? '');
    setProblem(null);
    setEditing(row);
  };
  const close = () => setEditing(null);

  const clean = (value: string) => value.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  const save = () => {
    const amounts = { clinicOvertimeHourly: clean(hourly), clinicPublicHolidayShift: clean(holiday), clinicRestDayShift: clean(restDay), clinicSessionRate: clean(session) };
    if (name.trim().length < 2) {
      refuse('ruleset-name', 'Give the rule set a name.');
      return;
    }
    if (mode === 'CLINIC_RATE') {
      for (const value of Object.values(amounts)) {
        if (value !== '' && (!/^\d{1,10}(\.\d{1,2})?$/.test(value) || Number(value) <= 0)) {
          refuse(undefined, 'Enter each amount as a number above zero, with at most two decimal places, or leave it blank.');
          return;
        }
      }
      if (Object.values(amounts).every((value) => value === '')) {
        refuse(undefined, 'A clinic-rate rule set needs at least one amount.');
        return;
      }
    }
    /*
     * THE DIVISORS, CHECKED HERE AND AGAIN BY THE ACT.
     *
     * The server bounds them (1-31 days, 0.5-24 hours) and the RUN refuses a
     * divisor above 26 under s.60I(2), because a bigger divisor makes each day
     * worth less and underpays every hour of overtime. Saying it here means the
     * clinic finds out while typing rather than on the morning they try to run
     * payroll.
     */
    const otDaysNum = Number(otDays);
    const hoursNum = Number(hoursDay);
    if (!Number.isInteger(otDaysNum) || otDaysNum < 1 || otDaysNum > 31) {
      refuse('orp-ot-days', 'The overtime divisor is a whole number of days between 1 and 31.');
      return;
    }
    if (otDaysNum > 26) {
      refuse(
        'orp-ot-days',
        `An overtime divisor of ${otDaysNum} makes a day worth less than section 60I(1A) allows, which underpays ` +
          'every hour of overtime, every rest day and every public holiday. Payroll will refuse to calculate. Use 26 or fewer.',
      );
      return;
    }
    if (!Number.isFinite(hoursNum) || hoursNum < 0.5 || hoursNum > 8) {
      refuse('orp-hours', 'Normal hours are between 0.5 and 8 a day. Section 60A(1) of the Employment Act caps them at 8.');
      return;
    }
    /*
     * THE MULTIPLIERS, HELD TO THE ACT'S FLOOR.
     *
     * Same shape as the divisor above: the server refuses these too, and this
     * says it while the clinic is still typing. Blank is not a refusal — it
     * means the Act's figure, which is the answer most rule sets keep.
     */
    const chosen: Record<string, number | null> = {};
    for (const multiplier of MULTIPLIERS) {
      const typed = clean(multipliers[multiplier.field]).replace(/×$/, '').trim();
      if (typed === '') {
        chosen[multiplier.field] = null;
        continue;
      }
      const value = Number(typed);
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(typed) || !Number.isFinite(value) || value <= 0) {
        refuse(multiplier.field, `${multiplier.label} is a multiplier such as ${multiplier.act}, with at most two decimal places.`);
        return;
      }
      // BELOW THE ACT IS NOT REFUSED HERE. It is a decision the clinic is
      // entitled to take; the notice under the row says what it is, and Save
      // asks for a confirmation and a reason before it will go through.
      if (value > 10) {
        refuse(multiplier.field, `${multiplier.label} of ${value}× is higher than any rate a clinic pays. Check the figure.`);
        return;
      }
      chosen[multiplier.field] = value;
    }
    if (belowAct.length > 0) {
      if (!belowActOk) {
        refuse(
          'below-act-confirm',
          `${belowAct.map((row) => belowActSentence(row, row.chosen)).join(' ')} Kuwick will store this — it is your clinic's decision to make ` +
            'and to carry. Confirm that it is deliberate.',
        );
        return;
      }
      if (belowActWhy.trim().length < 4) {
        refuse('below-act-why', 'Say why this rule set pays below the Act. A shortfall nobody can explain is one nobody can defend.');
        return;
      }
    }

    const existing = editing !== 'new' && editing ? editing : null;
    // THE TERMINATION BASIS IS CARRIED THROUGH UNCHANGED. The server replaces
    // every field it is not sent with its default, so an edit that only touched
    // the mode must resend what the rule set already has. It used to be five
    // bases; the other four were answered by the Employment Act and removed.
    upsert.mutate(
      {
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        ...(existing
          ? {
              legalEmployerId: existing.legalEmployerId,
              terminationBasis: existing.termination.basis,
              terminationDays: existing.termination.days ?? undefined,
            }
          : {}),
        // The three the clinic just answered, on a new rule set as well as an
        // edited one — a rule set created without them would price its people
        // from the schema's defaults and nobody would know which they got.
        overtimeDays: otDaysNum,
        overtimeHoursPerDay: hoursNum,
        overtimeMode: mode,
        // Null clears a raised multiplier back to the Act's. Sent on every
        // save, in both modes: a clinic-rate rule set falls back to the Act's
        // formula for a kind of day it fixes no amount for, and that fallback
        // should land on the clinic's own answer.
        overtimeMultiplier: chosen['ruleset-ot-multiplier'],
        restDayMultiplier: chosen['ruleset-restday-multiplier'],
        publicHolidayMultiplier: chosen['ruleset-holiday-multiplier'],
        ...(belowAct.length > 0 ? { belowActAcknowledged: true, belowActReason: belowActWhy.trim() } : {}),
        ...(mode === 'CLINIC_RATE'
          ? Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value === '' ? null : value]))
          : {}),
        workforceCategory: appliesTo.startsWith('__') ? null : appliesTo,
        isDefault: appliesTo === '__default',
      },
      {
        onSuccess: () => {
          message.success(existing ? 'Rule set updated' : 'Rule set added');
          close();
        },
        onError: (mutationError: Error) => refuse(undefined, mutationError.message),
      },
    );
  };

  /*
   * WHAT IS BELOW THE ACT, WORKED OUT FROM WHAT IS IN THE BOXES RIGHT NOW.
   *
   * Not from what was saved. The clinic has to see the consequence of the
   * figure it just typed, before Save — a warning that only appears after a
   * round trip is a warning about something that already happened.
   */
  const belowAct = MULTIPLIERS.map((multiplier) => {
    const typed = clean(multipliers[multiplier.field]).replace(/×$/, '').trim();
    if (typed === '') return null;
    const value = Number(typed);
    return Number.isFinite(value) && value > 0 && value < multiplier.act ? { ...multiplier, chosen: value } : null;
  }).filter((entry): entry is (typeof MULTIPLIERS)[number] & { chosen: number } => entry !== null);

  // Known only for a rule set that exists; a new one has nobody on it yet and
  // says so rather than inventing a count.
  const protectedHere = editing !== 'new' && editing ? (editing.protectedCount ?? null) : null;

  const floorGuide = actFloorAt4000(editing !== 'new' && editing ? editing.overtime.hoursPerDay : 7.5);
  const underpaying = (policies.data?.policies ?? []).filter((row) => (row.floor?.below.length ?? 0) > 0);

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Payroll policies
        </>
      }
      title="Payroll policies"
      sub="Who may approve a run, and how a day and an hour of pay are worked out."
      error={error instanceof Error ? error.message : null}
    >

      <Panel>
        <PanelHead
          title="Who can approve payroll"
          sub="Approving a run locks it and is the moment money is committed. This is who may do it."
          actions={
            approval.data?.updatedAt ? (
              <span className="hr-eff">Changed {dayjs(approval.data.updatedAt).format('D MMM YYYY')}</span>
            ) : null
          }
        />
        {approval.data ? (
          <>
            {CHOICES.map((choice) => {
              const on = approval.data?.mode === choice.value;
              return (
                <label key={choice.value} className={`hr-choice${on ? ' hr-choice--on' : ''}`}>
                  <input
                    type="radio"
                    name="approval-mode"
                    value={choice.value}
                    checked={on}
                    disabled={setApproval.isPending}
                    onChange={() => choose({ mode: choice.value })}
                    style={{ marginTop: 4, accentColor: 'var(--hr-teal)' }}
                  />
                  <span>
                    <span className="hr-choice__title">{choice.title}</span>
                    <span className="hr-choice__detail">{choice.detail}</span>
                  </span>
                </label>
              );
            })}

            {approval.data.mode === 'STANDARD' ? null : (
              <div className="hr-fld">
                <span className="hr-fld__k">Account holders may approve their own runs</span>
                <span style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Switch
                    checked={approval.data.allowOwnerSelfApproval}
                    loading={setApproval.isPending}
                    aria-label="Account holders may approve their own runs"
                    onChange={(checked) => choose({ allowOwnerSelfApproval: checked })}
                  />
                  <span className="hr-small hr-muted">
                    A clinic with one account holder has nobody else to ask. Leave this on and they can approve their own
                    payroll; turn it off and the rule above applies to everybody, so somebody could be left unable to pay
                    anyone.
                  </span>
                </span>
              </div>
            )}

            {/*
              * A RULE THAT CANNOT TAKE EFFECT is worse than no rule: the clinic
              * believes two people are checking payroll and one is. Said out
              * loud rather than left for pay day.
              */}
            {approval.data.inert.length > 0 ? (
              <div className="hr-notice hr-notice--attn">
                <strong>This rule will not change anything yet.</strong>
                <ul>
                  {approval.data.inert.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="hr-panelNote">
              <div>{approval.data.description}</div>
              <div>
                {approval.data.approvers.total} {approval.data.approvers.total === 1 ? 'person' : 'people'} in this clinic can approve
                payroll{approval.data.approvers.names.length > 0 ? `: ${approval.data.approvers.names.join(', ')}.` : '.'}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {approval.data.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </Panel>

      <Panel className="hr-mt">
        <PanelHead
          title="How pay is worked out"
          sub="Which rule set prices overtime, rest days and public holidays for each group, and what a day and an hour are. Frozen into each run, so a later change cannot reprice a past month."
          actions={
            <>
              {policies.data?.policies.length ? (
                <span className="hr-eff">
                  Changed {dayjs([...policies.data.policies.map((row) => row.updatedAt)].sort().reverse()[0]).format('D MMM YYYY')}
                </span>
              ) : null}
              {mayManage ? (
                <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={openNew}>
                  <IconPlus />
                  Add rule set
                </button>
              ) : null}
            </>
          }
        />
        <Table<PayrollPolicyRow>
          rowKey="id"
          loading={policies.isLoading}
          rows={policies.data?.policies}
          emptyText="No rule sets are recorded."
          emptyHint="Everybody is priced by the Employment Act until a rule set is added."
          columns={[
            {
              title: 'Rule set',
              dataIndex: 'name',
              render: (value: string, row) => (
                <span className="hr-strong">
                  {value} {row.isDefault ? <StatusChip tone="muted">Default</StatusChip> : null}
                </span>
              ),
            },
            {
              title: 'Applies to',
              key: 'applies',
              render: (_: unknown, row) => (
                <span title={row.employeeNames.join(', ')}>
                  {row.appliesTo}
                  {row.employeeCount > 0 ? (
                    <span className="hr-faint"> · {row.employeeCount} {row.employeeCount === 1 ? 'employee' : 'employees'}</span>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Overtime and holidays',
              key: 'ot',
              /*
               * THE PERMANENT MARK.
               *
               * A clinic may choose to pay below the Act, and that choice does
               * not expire when the drawer closes. Somebody opening this screen
               * a year later — a new manager, an auditor, the owner on a bad
               * morning — sees it on the row without having to know it was ever
               * made, and sees who made it.
               */
              render: (_: unknown, row) => (
                <span>
                  {pricingLine(row)}
                  {row.belowAct ? (
                    <>
                      {' '}
                      <StatusChip tone="attn">Below the Act</StatusChip>
                      <span className="hr-faint">
                        {' '}
                        {row.protectedCount > 0
                          ? `${row.protectedCount} ${row.protectedCount === 1 ? 'employee' : 'employees'} here on RM4,000 or less`
                          : 'nobody here on RM4,000 or less today'}
                        {row.belowAct.acknowledgement
                          ? ` · ${row.belowAct.acknowledgement.by ?? 'somebody'} on ${dayjs(row.belowAct.acknowledgement.at).format('D MMM YYYY')}`
                          : ''}
                      </span>
                    </>
                  ) : null}
                </span>
              ),
            },
            ...(mayManage
              ? [
                  {
                    title: '',
                    key: 'edit',
                    width: 90,
                    render: (_: unknown, row: PayrollPolicyRow) => (
                      <button type="button" className="hr-btn hr-btn--sm" onClick={() => openEdit(row)}>
                        <IconEdit />
                        Edit
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {/*
          * THE FLOOR, IN GOLD. Worked out by the server against the employees
          * each clinic-rate rule set actually prices, on their salary today.
          * Payroll blocks the same people on the month's real days, so this
          * is the same fact a month early.
          */}
        {underpaying.map((row) => (
          <div key={row.id} className="hr-notice hr-notice--attn" style={{ margin: '12px 22px 0' }}>
            <strong>
              {row.name} pays below the Employment Act for {row.floor?.below.length}{' '}
              {row.floor?.below.length === 1 ? 'employee' : 'employees'} on RM4,000 or less.
            </strong>
            <ul>
              {row.floor?.below.map((employee) => (
                <li key={employee.staffId}>
                  <Link className="hr-link" to={`/admin/hr/employees/${employee.staffId}`}>
                    {employee.name}
                  </Link>{' '}
                  ({employee.wages} a month): {employee.shortfalls.join(' ')}
                </li>
              ))}
            </ul>
            <div>Payroll will block these employees until the rate is raised or they are moved to a rule set on the Act.</div>
          </div>
        ))}
        {policies.data?.notice ? <div className="hr-panelNote">{policies.data.notice}</div> : null}
      </Panel>

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add rule set' : 'Edit rule set'}
        sub="How a group's extra hours are priced. Applies from the next calculation; approved months keep the figures they were approved with."
        onClose={close}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={upsert.isPending} onClick={save}>
              {editing === 'new' ? 'Add rule set' : 'Save changes'}
            </button>
          </>
        }
      >
        <ProblemNotice problem={problem} />
        <div className="hr-form">
          <div className={problemCell(problem, 'ruleset-name')}>
            <label htmlFor="ruleset-name">Name</label>
            <Input id="ruleset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Doctors, Clinical staff…" />
            <FieldProblem problem={problem} field="ruleset-name" />
          </div>
          <div>
            <label htmlFor="ruleset-applies">Applies to</label>
            <Select
              id="ruleset-applies"
              value={appliesTo}
              onChange={setAppliesTo}
              style={{ width: '100%' }}
              options={[
                { value: '__default', label: 'Everyone no other rule set covers (the default)' },
                ...(policies.data?.categories ?? []).map((category) => ({ value: category.key, label: category.label })),
                { value: '__hand', label: 'Only employees assigned to it by hand' },
              ]}
            />
            <div className="hr-form__help">
              An employee assigned a rule set on their record is on that one. Otherwise the rule set for their group applies, then the default.
            </div>
          </div>
          {/*
            * HOW A MONTHLY SALARY BECOMES A DAY AND AN HOUR.
            *
            * These three have been on the rule set since it shipped and the run
            * never read them — every payroll in the system used 26 / 31 / 7.5
            * because that is what the run's own columns default to, while the
            * report printed "clinic policy" over them. They are the clinic's
            * answer now, frozen onto each run as it is created.
            */}
          <div>
            <label>A day and an hour</label>
            {/*
              * EACH REASON INSIDE ITS OWN CELL, and the guilty cell takes the
              * whole row while it speaks (`hr-cell--flagged`). Under the row
              * instead of in the cell read well at 1440 and badly everywhere
              * else: below 992px `.hr-grid3` is a stack, so a reason about the
              * overtime divisor rendered below the unpaid-leave box — which is
              * how it reached staging looking like it was not attached to
              * anything.
              */}
            <div className="hr-grid3">
              <div className={problemCell(problem, 'orp-ot-days')}>
                <label htmlFor="orp-ot-days" className="hr-form__sub">Overtime divisor</label>
                <Input
                  id="orp-ot-days"
                  value={otDays}
                  onChange={(e) => setOtDays(e.target.value)}
                  addonAfter="days"
                  inputMode="numeric"
                />
                <FieldProblem problem={problem} field="orp-ot-days" />
              </div>
              <div className={problemCell(problem, 'orp-hours')}>
                <label htmlFor="orp-hours" className="hr-form__sub">Normal hours</label>
                <Input
                  id="orp-hours"
                  value={hoursDay}
                  onChange={(e) => setHoursDay(e.target.value)}
                  addonAfter="a day"
                  inputMode="decimal"
                />
                <FieldProblem problem={problem} field="orp-hours" />
              </div>
            </div>
            <div className="hr-form__help">
              The ordinary rate is the monthly salary over the overtime divisor, and an hour is that over the normal
              hours. Overtime, rest days and public holidays are all priced from it. Section 60I(1A) sets 26; above it
              every hour of overtime is worth less, and the run refuses to calculate. A day of unpaid leave is not set
              here: section 18A prices an incomplete month on the actual days in it, so the divisor is 28, 29, 30 or 31
              depending on the month.
            </div>
          </div>
          <div>
            <label>Overtime, rest days and public holidays</label>
            <div className="hr-form__choices">
            {MODES.map((choice) => {
              const on = mode === choice.value;
              return (
                <label key={choice.value} className={`hr-choice${on ? ' hr-choice--on' : ''}`}>
                  <input
                    type="radio"
                    name="overtime-mode"
                    value={choice.value}
                    checked={on}
                    onChange={() => setMode(choice.value)}
                    style={{ marginTop: 4, accentColor: 'var(--hr-teal)' }}
                  />
                  <span>
                    <span className="hr-choice__title">{choice.title}</span>
                    <span className="hr-choice__detail">{choice.detail}</span>
                  </span>
                </label>
              );
            })}
            </div>
          </div>
          {/*
            * WHAT AN EXTRA HOUR IS WORTH, IN THE CLINIC'S OWN NUMBERS.
            *
            * Shown in both modes on purpose. A clinic-rate rule set prices only
            * the kinds of day it fixes an amount for; every other day falls
            * back to the Act's formula, and the fallback should use the
            * clinic's multiplier rather than a figure it replaced everywhere
            * else.
            */}
          <div>
            <label>What an extra hour is worth</label>
            <div className="hr-grid3">
              {MULTIPLIERS.map((multiplier) => (
                <div key={multiplier.field} className={problemCell(problem, multiplier.field)}>
                  <label htmlFor={multiplier.field} className="hr-form__sub">
                    {multiplier.label}
                  </label>
                  <Input
                    id={multiplier.field}
                    value={multipliers[multiplier.field]}
                    onChange={(e) => setMultiplier(multiplier.field, e.target.value)}
                    addonAfter="×"
                    inputMode="decimal"
                    placeholder={String(multiplier.act)}
                  />
                  <FieldProblem problem={problem} field={multiplier.field} />
                </div>
              ))}
            </div>
            <div className="hr-form__help">
              Left blank, each is the Employment Act’s own figure — {MULTIPLIERS.map((m) => `${m.act}×`).join(', ')} in that
              order. These price the extra HOURS. The day itself on a rest day or public holiday is priced in days of the
              ordinary rate by the Act — a public holiday worked is two days’ wages however few hours were done — and is
              not set here.
            </div>
            {/*
              * THE CHOICE, BEFORE IT IS MADE.
              *
              * ss.60A(3)(a), 60(3)(c) and 60D(3)(aa) set minimums, and a clinic
              * may decide to pay under them and carry the liability — that is
              * not Kuwick's call to overrule. What it is Kuwick's job to stop
              * is somebody doing it without noticing, so the section, the
              * minimum and the word BELOW appear together, with a tick and a
              * reason between the figure and Save.
              */}
            {belowAct.length > 0 ? (
              <div className="hr-notice hr-notice--attn" id="below-act-confirm">
                <div className="hr-strong">This rule set pays below the Employment Act</div>
                <ul className="hr-notice__list">
                  {belowAct.map((row) => (
                    <li key={row.field}>{belowActSentence(row, row.chosen)}</li>
                  ))}
                </ul>
                <div>
                  {protectedHere === null
                    ? 'The Act’s minimums reach employees on RM4,000 a month or less.'
                    : protectedHere === 0
                      ? 'Nobody on this rule set is on RM4,000 a month or less today, so no minimum binds it right now. The day somebody who is joins it, they are paid under the Act.'
                      : `${protectedHere} ${protectedHere === 1 ? 'employee' : 'employees'} on this rule set ${protectedHere === 1 ? 'is' : 'are'} on RM4,000 a month or less, so the Act’s minimums reach ${protectedHere === 1 ? 'them' : 'them'}. They will be paid less than the Act requires.`}{' '}
                  The rule set will be marked below the Act on this screen, every payslip will print both rates, and each
                  payroll run will name whoever was short that month.
                </div>
                <label className="hr-check">
                  <input type="checkbox" checked={belowActOk} onChange={(e) => setBelowActOk(e.target.checked)} />
                  <span>I am choosing to pay below the Act, and this clinic carries the liability.</span>
                </label>
                <FieldProblem problem={problem} field="below-act-confirm" />
                <div>
                  <label htmlFor="below-act-why" className="hr-form__sub">Why</label>
                  <Input
                    id="below-act-why"
                    value={belowActWhy}
                    onChange={(e) => setBelowActWhy(e.target.value)}
                    placeholder="Agreed in the employment contract, reviewed by…"
                  />
                  <FieldProblem problem={problem} field="below-act-why" />
                </div>
                <div className="hr-form__help">
                  Recorded against your name and today’s date. Change any of these figures later and Kuwick asks again.
                </div>
              </div>
            ) : null}
          </div>
          {mode === 'CLINIC_RATE' ? (
            <div className="hr-form">
              <div className="hr-form__row">
                <div>
                  <label htmlFor="ruleset-hourly">Per hour of overtime</label>
                  <Input id="ruleset-hourly" prefix="RM" inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="Blank: the Act" />
                </div>
                <div>
                  <label htmlFor="ruleset-holiday">Per public holiday shift</label>
                  <Input id="ruleset-holiday" prefix="RM" inputMode="decimal" value={holiday} onChange={(e) => setHoliday(e.target.value)} placeholder="Blank: the Act" />
                </div>
              </div>
              <div className="hr-form__row">
                <div>
                  <label htmlFor="ruleset-restday">Per rest day shift</label>
                  <Input id="ruleset-restday" prefix="RM" inputMode="decimal" value={restDay} onChange={(e) => setRestDay(e.target.value)} placeholder="Blank: the Act" />
                </div>
                <div>
                  <label htmlFor="ruleset-session">Per session</label>
                  <Input id="ruleset-session" prefix="RM" inputMode="decimal" value={session} onChange={(e) => setSession(e.target.value)} placeholder="Blank: shift rate" />
                </div>
              </div>
              <div className="hr-form__help">
                A session is a rest day or public holiday worked for at most half the normal hours. For an employee on RM4,000 the Act’s figures are{' '}
                {floorGuide.hour} an hour, {floorGuide.holiday} a public holiday and {floorGuide.restDay} a rest day; a clinic rate below them is not applied to anybody on RM4,000 or less.
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Panel className="hr-mt">
        <PanelHead title="Also decided in Settings" sub="Each of these has one home. Payroll reads them; it does not set them." />
        <div className="hr-kv">
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/statutory">
              Statutory rates
            </Link>{' '}
            — what Kuwick deducts and what the clinic pays on top
          </span>
          <span className="hr-kv__v">
            {check ? (
              <StatusChip tone={check.current ? 'done' : 'attn'}>Checked {dayjs(check.checkedAt).format('D MMM YYYY')}</StatusChip>
            ) : (
              <StatusChip tone="attn">Not checked</StatusChip>
            )}
          </span>
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/attendance-leave">
              Attendance &amp; leave policies
            </Link>{' '}
            — the grace period, what counts as a full day
          </span>
          <span />
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/payroll-items">
              Payroll items
            </Link>{' '}
            — what each item counts towards
          </span>
          <span />
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/company">
              Company &amp; statutory
            </Link>{' '}
            — the employer's registration, EPF, SOCSO and LHDN numbers
          </span>
          <span />
        </div>
      </Panel>
    </HrPage>
  );
}
