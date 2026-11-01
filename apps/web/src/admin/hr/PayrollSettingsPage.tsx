import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Input, Modal, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import {
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  useSetPayrollApprovalPolicy,
  useStatutoryRates,
  useUpsertPayrollPolicy,
  useDeletePayrollPolicy,
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
import { useNewStaffDefaults, useSetNewStaffDefaults, type NewStaffDefaults } from './newStaffDefaults';

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
    detail: 'The month stays open until two different people approve it. Right for a group that treats payroll as a board-level payment.',
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
  const own = set.overtime.set || set.restDay.set || set.publicHoliday.set || set.festiveHoliday?.set;
  const festive = set.festiveHoliday?.set ? ` · festive holiday ${set.festiveHoliday.used}×` : '';
  const figures = `${set.overtime.used}× · rest day ${set.restDay.used}× · public holiday ${set.publicHoliday.used}×${festive}`;
  return own ? `Clinic multipliers: ${figures}` : `Employment Act: ${figures}`;
};

const pricingLine = (row: PayrollPolicyRow) => {
  if (row.overtimeMode !== 'CLINIC_RATE' || !row.clinicRates) return multiplierLine(row);
  const parts = [
    row.clinicRates.overtimeHourly ? `${rm(row.clinicRates.overtimeHourly)} an hour` : null,
    row.clinicRates.publicHolidayShift ? `${rm(row.clinicRates.publicHolidayShift)} a public holiday shift` : null,
    row.clinicRates.festiveHolidayShift ? `${rm(row.clinicRates.festiveHolidayShift)} a festive holiday shift` : null,
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
  {
    field: 'ruleset-festive-multiplier',
    label: 'Festive holiday',
    act: 3,
    what: 'an hour beyond normal hours on a festive public holiday',
    provision: 'Section 60D(3)(aa)',
  },
] as const;

/** The one sentence a below-Act figure gets, wherever it is shown. */
const belowActSentence = (m: { label: string; act: number; what: string; provision: string }, chosen: number) =>
  `${m.label} at ${chosen}× is BELOW the ${m.act}× that ${m.provision} sets as the minimum for ${m.what}.`;

type MultiplierField = (typeof MULTIPLIERS)[number]['field'];

/**
 * DEFAULTS FOR NEW STAFF (new-clinic UAT, 15 October 2026): what Add employee
 * starts from. Each is the clinic's own; Kuwick's defaults apply until set.
 */
function NewStaffDefaultsPanel({ mayEdit }: { mayEdit: boolean }) {
  const { message } = App.useApp();
  const current = useNewStaffDefaults();
  const save = useSetNewStaffDefaults();
  const [draft, setDraft] = useState<NewStaffDefaults | null>(null);
  const shown = draft ?? current;
  const prefix = (shown.employeeNoPrefix ?? '').trim() || 'E';
  const commit = () =>
    draft &&
    save.mutate(
      { ...draft, departments: draft.departments.map((name) => name.trim()).filter(Boolean) },
      { onSuccess: () => { setDraft(null); message.success('Saved.'); }, onError: (e: Error) => message.error(e.message) },
    );
  return (
    <Panel className="hr-mt">
      <PanelHead title="Defaults for new staff" sub="What Add employee fills in. Each can still be changed for one person." />
      <div className="hr-kv">
        <span className="hr-kv__k">Days a week</span>
        <span className="hr-kv__v">
          <Select
            size="small"
            disabled={!mayEdit}
            value={shown.workDaysPerWeek}
            onChange={(value: number) => setDraft({ ...shown, workDaysPerWeek: value })}
            options={[{ value: 5, label: '5 days' }, { value: 5.5, label: '5½ days' }, { value: 6, label: '6 days' }]}
            style={{ width: 110 }}
          />
        </span>
        <span className="hr-kv__k">Probation</span>
        <span className="hr-kv__v">
          <Select
            size="small"
            disabled={!mayEdit}
            value={shown.probationMonths}
            onChange={(value: number) => setDraft({ ...shown, probationMonths: value })}
            options={[0, 1, 2, 3, 6].map((months) => ({ value: months, label: months === 0 ? 'None' : `${months} month${months === 1 ? '' : 's'}` }))}
            style={{ width: 110 }}
          />
        </span>
        <span className="hr-kv__k">Departments</span>
        <span className="hr-kv__v">
          <Select
            mode="tags"
            size="small"
            disabled={!mayEdit}
            value={shown.departments}
            onChange={(value: string[]) => setDraft({ ...shown, departments: value })}
            style={{ minWidth: 260 }}
          />
        </span>
        <span className="hr-kv__k">Employee numbers start with</span>
        <span className="hr-kv__v">
          <Input
            size="small"
            disabled={!mayEdit}
            value={shown.employeeNoPrefix ?? ''}
            maxLength={10}
            aria-label="Employee numbers start with"
            onChange={(e) => setDraft({ ...shown, employeeNoPrefix: e.target.value })}
            style={{ width: 110 }}
          />{' '}
          <span className="hr-small hr-muted">Next numbers: {prefix}001, {prefix}002…</span>
        </span>
      </div>
      {draft && mayEdit ? (
        <div className="hr-mt">
          <button type="button" className="hr-btn hr-btn--primary" disabled={save.isPending} onClick={commit}>
            Save defaults
          </button>{' '}
          <button type="button" className="hr-btn" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

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
  const mayEditDefaults = useCan('hr.employee.manage');
  const upsert = useUpsertPayrollPolicy();
  // A rule set nobody uses can go. The server is the judge: it refuses one that
  // prices somebody, has somebody assigned, is the default, or that a payslip names.
  const removePolicy = useDeletePayrollPolicy();
  const [removing, setRemoving] = useState<PayrollPolicyRow | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [editing, setEditing] = useState<PayrollPolicyRow | 'new' | null>(null);
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('__hand');
  const [mode, setMode] = useState<OvertimeMode>('STATUTORY');
  const [hourly, setHourly] = useState('');
  const [holiday, setHoliday] = useState('');
  const [festive, setFestive] = useState('');
  const [restDay, setRestDay] = useState('');
  const [session, setSession] = useState('');
  // THE ORDINARY-RATE DIVISORS. Held as strings so a half-typed field is not
  // silently read as 0 while somebody is still typing it.
  const [otDays, setOtDays] = useState('26');
  const [pcbProjection, setPcbProjection] = useState<'CURRENT_MONTH' | 'BASIC_ONLY' | 'CONTRACTUAL_MONTHLY'>('CURRENT_MONTH');
  const [partMonth, setPartMonth] = useState<'CALENDAR_DAYS' | 'WORKING_DAYS'>('CALENDAR_DAYS');
  // LATE JOINERS: blank is "same month", the default; a day is the cut-off.
  const [lateJoinerCutoff, setLateJoinerCutoff] = useState('');
  // WEEK BY WEEK (Section C). '' is the old day-by-day approval.
  const [overtimeBasis, setOvertimeBasis] = useState<'' | 'ACT' | 'WEEKLY' | 'AVERAGED'>('ACT');
  const [weeklyHours, setWeeklyHours] = useState('45');
  const [wageCeiling, setWageCeiling] = useState('');
  const [locumRate, setLocumRate] = useState('');
  const [hoursDay, setHoursDay] = useState('7.5');
  // THE CLINIC'S OWN MULTIPLIERS, blank for "the Act's". Strings for the same
  // reason the divisors are: "2." mid-keystroke is not the number 2.
  const [multipliers, setMultipliers] = useState<Record<MultiplierField, string>>({
    'ruleset-ot-multiplier': '',
    'ruleset-restday-multiplier': '',
    'ruleset-holiday-multiplier': '',
    'ruleset-festive-multiplier': '',
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
    setPcbProjection('CURRENT_MONTH');
    setPartMonth('CALENDAR_DAYS');
    setLateJoinerCutoff('');
    setOvertimeBasis('ACT');
    setWeeklyHours('45');
    setWageCeiling('');
    setLocumRate('');
    setHoursDay('7.5');
    setMultipliers({ 'ruleset-ot-multiplier': '', 'ruleset-restday-multiplier': '', 'ruleset-holiday-multiplier': '', 'ruleset-festive-multiplier': '' });
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
    setFestive(row.clinicRates?.festiveHolidayShift ?? '');
    setRestDay(row.clinicRates?.restDayShift ?? '');
    setSession(row.clinicRates?.session ?? '');
    setOtDays(String(row.overtime.days ?? 26));
    setPcbProjection(row.pcbProjectionBasis ?? 'CURRENT_MONTH');
    setPartMonth(row.partMonthBasis ?? 'CALENDAR_DAYS');
    setLateJoinerCutoff(row.lateJoinerCutoffDay ? String(row.lateJoinerCutoffDay) : '');
    setOvertimeBasis(row.overtimeBasis ?? '');
    setWeeklyHours(String(row.weeklyNormalHours ?? 45));
    setWageCeiling(row.overtimeWageCeiling ?? '');
    setLocumRate(row.locumHourlyRate ?? '');
    setHoursDay(String(row.overtime.hoursPerDay));
    // A box left blank is on the Act's, and stays blank so the placeholder can
    // say which figure that is rather than the clinic having to remember.
    setMultipliers({
      'ruleset-ot-multiplier': row.multipliers?.overtime.set ? String(row.multipliers.overtime.used) : '',
      'ruleset-restday-multiplier': row.multipliers?.restDay.set ? String(row.multipliers.restDay.used) : '',
      'ruleset-holiday-multiplier': row.multipliers?.publicHoliday.set ? String(row.multipliers.publicHoliday.used) : '',
      'ruleset-festive-multiplier': row.multipliers?.festiveHoliday?.set ? String(row.multipliers.festiveHoliday.used) : '',
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
    const amounts = {
      clinicOvertimeHourly: clean(hourly),
      clinicPublicHolidayShift: clean(holiday),
      clinicFestiveHolidayShift: clean(festive),
      clinicRestDayShift: clean(restDay),
      clinicSessionRate: clean(session),
    };
    if (name.trim().length < 2) {
      refuse('ruleset-name', 'Give the pay rules a name.');
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
        refuse(undefined, 'Pay rules with clinic rates need at least one amount.');
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
    const cutoffTyped = lateJoinerCutoff.trim();
    const cutoffNum = cutoffTyped === '' ? null : Number(cutoffTyped);
    if (cutoffNum !== null && (!Number.isInteger(cutoffNum) || cutoffNum < 1 || cutoffNum > 28)) {
      refuse('ruleset-late-joiner-day', 'The cut-off is a day of the month between 1 and 28.');
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
        refuse('below-act-why', 'Say why these pay rules pay below the Act. A shortfall nobody can explain is one nobody can defend.');
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
        pcbProjectionBasis: pcbProjection,
        partMonthBasis: partMonth,
        lateJoinerCutoffDay: cutoffNum,
        overtimeBasis: overtimeBasis === '' ? null : overtimeBasis,
        weeklyNormalHours: Number(weeklyHours) || 45,
        overtimeWageCeiling: wageCeiling.trim() === '' ? null : wageCeiling.trim(),
        locumHourlyRate: locumRate.trim() === '' ? null : locumRate.trim(),
        overtimeMode: mode,
        // Null clears a raised multiplier back to the Act's. Sent on every
        // save, in both modes: a clinic-rate rule set falls back to the Act's
        // formula for a kind of day it fixes no amount for, and that fallback
        // should land on the clinic's own answer.
        overtimeMultiplier: chosen['ruleset-ot-multiplier'],
        restDayMultiplier: chosen['ruleset-restday-multiplier'],
        publicHolidayMultiplier: chosen['ruleset-holiday-multiplier'],
        festiveHolidayMultiplier: chosen['ruleset-festive-multiplier'],
        ...(belowAct.length > 0 ? { belowActAcknowledged: true, belowActReason: belowActWhy.trim() } : {}),
        ...(mode === 'CLINIC_RATE'
          ? Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value === '' ? null : value]))
          : {}),
        workforceCategory: appliesTo.startsWith('__') ? null : appliesTo,
        isDefault: appliesTo === '__default',
      },
      {
        onSuccess: () => {
          message.success(existing ? 'Pay rules updated' : 'Pay rules added');
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
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Pay rules
        </>
      }
      title="Pay rules"
      sub="Who may approve a payroll month, and how a day and an hour of pay are worked out."
      error={error instanceof Error ? error.message : null}
    >

      <Panel>
        <PanelHead
          title="Who can approve payroll"
          sub="Approving a month locks it and is the moment money is committed. This is who may do it."
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
                    style={{ marginTop: 4, accentColor: 'var(--hr-action)' }}
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
                <span className="hr-fld__k">Account holders may approve their own payroll</span>
                <span style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Switch
                    checked={approval.data.allowOwnerSelfApproval}
                    loading={setApproval.isPending}
                    aria-label="Account holders may approve their own payroll"
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
          sub="Which pay rules price overtime, rest days and public holidays for each group, and what a day and an hour are. Each month keeps the pay rules it was worked out with, so a later change cannot reprice a past month."
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
                  Add pay rules
                </button>
              ) : null}
            </>
          }
        />
        <Table<PayrollPolicyRow>
          rowKey="id"
          loading={policies.isLoading}
          rows={policies.data?.policies}
          emptyText="No pay rules are recorded."
          emptyHint="Everybody is priced by the Employment Act until pay rules are added."
          columns={[
            {
              title: 'Pay rules',
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
                  {row.partMonthBasis === 'WORKING_DAYS' ? <span className="hr-faint"> · part months by working days</span> : null}
                  {row.lateJoinerCutoffDay ? (
                    <span className="hr-faint"> · joiners after day {row.lateJoinerCutoffDay} paid the next month</span>
                  ) : null}
                  <span className="hr-faint">
                    {' · '}
                    {row.overtimeBasis
                      ? `overtime ${{ ACT: 'by the Act', WEEKLY: 'weekly only', AVERAGED: 'averaged over 3 weeks' }[row.overtimeBasis]}, ${row.weeklyNormalHours ?? 45} h a week`
                      : 'overtime approved day by day'}
                  </span>
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
                    width: 170,
                    render: (_: unknown, row: PayrollPolicyRow) => (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="hr-btn hr-btn--sm" onClick={() => openEdit(row)}>
                          <IconEdit />
                          Edit
                        </button>
                        {row.removable ? (
                          <button
                            type="button"
                            className="hr-btn hr-btn--sm hr-btn--ghost"
                            onClick={() => {
                              setRemoving(row);
                              setRemoveReason('');
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </span>
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
            <div>Payroll will block these employees until the rate is raised or they are moved to pay rules on the Act.</div>
          </div>
        ))}
        {policies.data?.notice ? <div className="hr-panelNote">{policies.data.notice}</div> : null}
      </Panel>

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add pay rules' : 'Edit pay rules'}
        sub="How a group's extra hours are priced. Applies from the next calculation; approved months keep the figures they were approved with."
        onClose={close}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={upsert.isPending} onClick={save}>
              {editing === 'new' ? 'Add pay rules' : 'Save changes'}
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
                { value: '__default', label: 'Everyone no other pay rules cover (the default)' },
                ...(policies.data?.categories ?? []).map((category) => ({ value: category.key, label: category.label })),
                { value: '__hand', label: 'Only employees assigned to it by hand' },
              ]}
            />
            <div className="hr-form__help">
              An employee assigned pay rules on their record is on those. Otherwise the pay rules for their group apply, then the default.
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
              every hour of overtime is worth less, and payroll will not work it out. A day of unpaid leave is not set
              here: section 18A prices it on the actual days in the month, so the divisor is 28, 29, 30 or 31
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
                    style={{ marginTop: 4, accentColor: 'var(--hr-action)' }}
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
          {/*
            * Y2 — WHAT THE REST OF THE YEAR IS ASSUMED TO PAY.
            *
            * The monthly tax method is cumulative AND forward-looking: this
            * month's deduction depends on what the employee is expected to earn
            * for the remaining months. LHDN calls it "the estimated
            * remuneration as Y1" and leaves the estimate to the employer, so it
            * is genuinely a clinic's choice rather than a figure the law fixes.
            *
            * Nothing here changes what anybody OWES for the year — that settles
            * at assessment either way. It changes how much of their money is
            * held back each month until then.
            */}
          {/*
            * A PART MONTH (UAT, 10 October 2026). s.18A's calendar days are
            * the Act's answer and the default; working days are the clinic's
            * own, and the month's review names anybody they pay less.
            */}
          <div>
            <label htmlFor="ruleset-part-month">Part-month proration</label>
            <Select
              id="ruleset-part-month"
              value={partMonth}
              onChange={setPartMonth}
              style={{ width: '100%', maxWidth: 460 }}
              options={[
                { value: 'CALENDAR_DAYS', label: 'Calendar days (the law’s way)' },
                { value: 'WORKING_DAYS', label: 'Working days' },
              ]}
            />
            <div className="hr-form__help">
              {partMonth === 'CALENDAR_DAYS'
                ? 'Someone who joins or leaves during a month is paid monthly salary × days employed ÷ days in the month, e.g. RM1,800 × 11/31 = RM638.71.'
                : 'Someone who joins or leaves during a month is paid monthly salary × working days employed ÷ working days in the month, counted from their own working week and rest day. Where that pays less than the calendar days the Act uses, the month’s review names them and the difference.'}
            </div>
            <div className="hr-form__help">Unpaid leave keeps its own divisor: the days in the month.</div>
          </div>
          {/*
            * WEEK BY WEEK (Section C, 14 October 2026). How extra hours are
            * counted, the weekly normal, who gets overtime, and doctors'
            * locum rate. Every figure is the clinic's.
            */}
          <div>
            <label htmlFor="ruleset-ot-basis">How overtime is counted</label>
            <Select
              id="ruleset-ot-basis"
              value={overtimeBasis}
              onChange={setOvertimeBasis}
              style={{ width: '100%', maxWidth: 460 }}
              options={[
                { value: 'ACT', label: 'Employment Act: past the normal day, then past the weekly normal' },
                { value: 'WEEKLY', label: 'Weekly only: past the weekly normal' },
                { value: 'AVERAGED', label: 'Shift-work averaging (s.60C): over a 3-week cycle' },
                { value: '', label: 'Day by day, approved on the Timesheet (the old way)' },
              ]}
            />
            <div className="hr-form__help">
              {overtimeBasis === ''
                ? 'Each day’s extra time needs a manager’s approval and is paid in its own month.'
                : 'The published roster is the approval; only time past the roster needs approving. Each week is paid in the month after the month it ends in. Doctors’ extra day hours are locum hours, worked out weekly.'}
            </div>
            {overtimeBasis === 'WEEKLY' ? (
              <div className="hr-warn" style={{ marginTop: 8 }}>
                <span>!</span>
                <span>Weekly only can pay less than the Employment Act. The payroll page shows each week where it does.</span>
              </div>
            ) : null}
            {overtimeBasis === 'AVERAGED' ? (
              <div className="hr-form__help">A day over 12 hours is flagged on the week, the s.60C limit.</div>
            ) : null}
          </div>
          {overtimeBasis !== '' ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="ruleset-weekly-hours">Weekly normal hours</label>
                <Input
                  id="ruleset-weekly-hours"
                  inputMode="decimal"
                  value={weeklyHours}
                  onChange={(event) => setWeeklyHours(event.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ width: 110 }}
                />
              </div>
              <div>
                <label htmlFor="ruleset-wage-ceiling">Overtime for wages up to (RM a month)</label>
                <Input
                  id="ruleset-wage-ceiling"
                  inputMode="decimal"
                  placeholder="4000 (the Act)"
                  value={wageCeiling}
                  onChange={(event) => setWageCeiling(event.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ width: 160 }}
                />
              </div>
              <div>
                <label htmlFor="ruleset-locum-rate">Doctors’ locum rate (RM an hour)</label>
                <Input
                  id="ruleset-locum-rate"
                  inputMode="decimal"
                  placeholder="Set per doctor"
                  value={locumRate}
                  onChange={(event) => setLocumRate(event.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ width: 140 }}
                />
              </div>
              <div className="hr-form__help" style={{ flexBasis: '100%' }}>
                A public holiday takes one normal day off the week. The wage limit can only be raised above the Act’s RM4,000. A doctor’s own rate, set on their employee record, comes first.
              </div>
            </div>
          ) : null}
          {/*
            * LATE JOINERS (UAT, 10 October 2026): some clinics pay the days of
            * somebody who joins near the month's end in the next month's run.
            * Off unless chosen; same month is the default.
            */}
          <div>
            <label htmlFor="ruleset-late-joiner">Part-month pay for late joiners</label>
            <Select
              id="ruleset-late-joiner"
              value={lateJoinerCutoff === '' ? 'SAME' : 'NEXT'}
              onChange={(value) => setLateJoinerCutoff(value === 'SAME' ? '' : lateJoinerCutoff || '25')}
              style={{ width: '100%', maxWidth: 460 }}
              options={[
                { value: 'SAME', label: 'Same month' },
                { value: 'NEXT', label: 'Next month, for anybody who joins after a day' },
              ]}
            />
            {lateJoinerCutoff !== '' ? (
              <div style={{ marginTop: 8 }}>
                <label htmlFor="ruleset-late-joiner-day">Joins after day</label>
                <Input
                  id="ruleset-late-joiner-day"
                  inputMode="numeric"
                  value={lateJoinerCutoff}
                  onChange={(event) => setLateJoinerCutoff(event.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                  style={{ width: 90 }}
                />
              </div>
            ) : null}
            <div className="hr-form__help">
              {lateJoinerCutoff === ''
                ? 'Somebody who joins during a month is paid their days in that month’s payroll.'
                : `Somebody who joins after the ${lateJoinerCutoff || '…'} is left out of that month’s payroll; the next month’s payroll adds those days to their basic pay.`}
            </div>
          </div>
          <div>
            <label htmlFor="ruleset-pcb-projection">How the rest of the year is estimated for monthly tax</label>
            <Select
              id="ruleset-pcb-projection"
              value={pcbProjection}
              onChange={setPcbProjection}
              style={{ width: '100%', maxWidth: 460 }}
              options={[
                { value: 'CURRENT_MONTH', label: 'This month’s pay, repeated (recommended)' },
                { value: 'BASIC_ONLY', label: 'Basic salary only' },
                { value: 'CONTRACTUAL_MONTHLY', label: 'Basic plus allowances that recur every month' },
              ]}
            />
            <div className="hr-form__help">
              {pcbProjection === 'CURRENT_MONTH'
                ? 'Assumes the months ahead look like this one. The method’s own default, and the closest fit where pay is steady.'
                : pcbProjection === 'BASIC_ONLY'
                  ? 'Assumes only basic salary from now on, so a month with overtime or incentives deducts less tax than it otherwise would. The shortfall is settled at assessment.'
                  : 'Assumes basic plus the allowances paid every month, and ignores overtime, commission, incentives and locum. Between the other two.'}
            </div>
            <div className="hr-form__help">
              This does not change what anybody owes for the year. It changes how much is held back each month until the
              year is assessed — and on pay that swings, the difference on one payslip runs to hundreds of ringgit.
            </div>
          </div>
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
              order; a festive holiday left blank follows the public holiday figure. These price the extra HOURS. The day
              itself on a rest day or public holiday is priced in days of the ordinary rate by the Act — a public holiday
              worked is two days’ wages however few hours were done — and is not set here. A festive holiday is one marked
              so under Public holidays.
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
                <div className="hr-strong">These pay rules pay below the Employment Act</div>
                <ul className="hr-notice__list">
                  {belowAct.map((row) => (
                    <li key={row.field}>{belowActSentence(row, row.chosen)}</li>
                  ))}
                </ul>
                <div>
                  {protectedHere === null
                    ? 'The Act’s minimums reach employees on RM4,000 a month or less.'
                    : protectedHere === 0
                      ? 'Nobody on these pay rules is on RM4,000 a month or less today, so no minimum binds them right now. The day somebody who is joins them, they are paid under the Act.'
                      : `${protectedHere} ${protectedHere === 1 ? 'employee' : 'employees'} on these pay rules ${protectedHere === 1 ? 'is' : 'are'} on RM4,000 a month or less, so the Act’s minimums reach ${protectedHere === 1 ? 'them' : 'them'}. They will be paid less than the Act requires.`}{' '}
                  These pay rules will be marked below the Act on this screen, every payslip will print both rates, and each
                  payroll month will name whoever was short that month.
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
              <div className="hr-form__row">
                <div>
                  <label htmlFor="ruleset-festive">Per festive holiday shift</label>
                  <Input id="ruleset-festive" prefix="RM" inputMode="decimal" value={festive} onChange={(e) => setFestive(e.target.value)} placeholder="Blank: public holiday shift" />
                </div>
                <div />
              </div>
              <div className="hr-form__help">
                A session is a rest day or public holiday worked for at most half the normal hours. For an employee on RM4,000 the Act’s figures are{' '}
                {floorGuide.hour} an hour, {floorGuide.holiday} a public holiday and {floorGuide.restDay} a rest day; a clinic rate below them is not applied to anybody on RM4,000 or less.
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      <NewStaffDefaultsPanel mayEdit={mayEditDefaults} />

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
            {check?.current ? (
              <StatusChip tone="done">Acknowledged {dayjs(check.checkedAt).format('D MMM YYYY')}</StatusChip>
            ) : (
              <StatusChip tone="attn">{check ? 'New edition to acknowledge' : 'Not acknowledged yet'}</StatusChip>
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

      {/* A RULE SET NOBODY USES, GOING. What it said stays in the audit row. */}
      <Modal
        open={removing !== null}
        title={removing ? `Delete “${removing.name}”?` : ''}
        okText="Delete"
        okButtonProps={{ danger: true, loading: removePolicy.isPending }}
        onCancel={() => setRemoving(null)}
        onOk={async () => {
          if (!removing) return;
          try {
            await removePolicy.mutateAsync({ id: removing.id, reason: removeReason.trim() || undefined });
            message.success(`“${removing.name}” deleted.`);
            setRemoving(null);
          } catch (error) {
            message.error((error as Error).message);
          }
        }}
      >
        <p>
          Nobody is priced by these pay rules and nobody is assigned to them. Pay rules that any past month was
          priced by cannot be deleted.
        </p>
        <label htmlFor="ruleset-delete-why" className="hr-small hr-muted">
          Why (optional)
        </label>
        <Input id="ruleset-delete-why" value={removeReason} onChange={(event) => setRemoveReason(event.target.value)} placeholder="Added by mistake" />
      </Modal>
    </HrPage>
  );
}
