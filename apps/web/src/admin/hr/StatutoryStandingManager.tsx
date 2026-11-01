import { useState } from 'react';
import { App, DatePicker, Input, InputNumber, Modal, Radio, Select } from 'antd';
import dayjs from 'dayjs';
import { useDeleteStatutoryClassification, useRecordStatutoryClassification, useStatutoryClassifications } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { FieldProblem, PanelHead, ProblemNotice, useProblemFocus } from './ui';
import { ReasonPicker } from './ui/ReasonPicker';
import { STANDING_REASONS } from './ui/reasons';
import { Table } from './ui/Table';
import { IconEdit } from './ui/icons';
import type { FormProblem } from './ui';
import type { EmployeeRecord, RecordStatutoryClassificationBody, StatutoryClassificationVersion } from '../types';
import { NO_FIXED_DAY_HELP, REST_DAY_CHOICES, restDayBody, restDayChoiceOf, restDayLabel, type RestDayChoice } from './restDay';

/**
 * THE STATUTORY STANDING — editable as a dated version, never as a patch.
 *
 * Everything that SELECTS a rule for this person — the EPF Third Schedule
 * part and the employee's own share (11% or 9%), whether SOCSO and EIS apply,
 * LINDUNG participation, the tax residence and MTD category, the rest day —
 * is a version with a date, and the payroll run for a month resolves the
 * version in force then. Two rules the form teaches rather than hides:
 *
 *   - a change is dated, and the sensible date is the FIRST DAY OF A MONTH. A
 *     standing that changes mid-period BLOCKS that month's payroll, because a
 *     contribution is worked out for a whole wage period and Kuwick will not
 *     pick which half applies;
 *   - "not recorded" is not a default. The form prefills what is in force and
 *     asks for what is not, and the engine keeps refusing to guess anything
 *     the form does not say.
 */
/** Kept here for the screens that already import it; the list itself lives in `restDay.ts`. */
export { DAY_NAMES } from './restDay';

/** The stored codes, in the words the editor uses. A screen that prints MALAYSIAN_CITIZEN is talking to a developer. */
export const STANDING_LABELS: Record<string, string> = {
  MALAYSIAN_CITIZEN: 'Malaysian citizen',
  PERMANENT_RESIDENT: 'Permanent resident',
  NON_CITIZEN_ELECTED_PRE_1998: 'Non-citizen, elected before 1 Aug 1998',
  NON_CITIZEN: 'Non-citizen',
  NOT_PARTICIPATING: 'Opted out',
  ENROLLED: 'Enrolled',
  MANDATORY_FOREIGN_WORKER: 'Mandatory — foreign worker',
  RESIDENT: 'Resident',
  NON_RESIDENT: 'Non-resident',
  CATEGORY_1: 'Category 1 — single',
  CATEGORY_2: 'Category 2 — married, spouse not working',
  CATEGORY_3: 'Category 3 — married, spouse working',
  PAY_AT_STATUTORY_RATES: 'Paid at the statutory rates',
  NOT_PAID: 'Not paid',
};

/** The fields the form edits, in the words the form uses for them. */
type FormField =
  | 'epfMembership'
  | 'epfEmployeeRate'
  | 'lindungParticipation'
  | 'taxResidence'
  | 'pcbCategory'
  | 'qualifyingChildren'
  | 'additionalPcbCents'
  | 'additionalPcbNote'
  | 'disabledSelf'
  | 'disabledSpouse'
  | 'restDay'
  | 'overtimeContractPolicy';

const FORM_FIELD_LABELS: Record<FormField, string> = {
  epfMembership: 'EPF Third Schedule part',
  epfEmployeeRate: 'EPF employee share',
  lindungParticipation: 'LINDUNG 24 JAM',
  taxResidence: 'Tax residence',
  pcbCategory: 'MTD category',
  qualifyingChildren: 'Qualifying children',
  additionalPcbCents: 'Additional PCB each month',
  additionalPcbNote: 'Additional PCB note',
  disabledSelf: 'Disabled (self)',
  disabledSpouse: 'Disabled spouse',
  restDay: 'Rest day',
  overtimeContractPolicy: 'Overtime above the Act limit',
};

/** One version's answers, normalised so two of them compare field by field. */
type FieldValues = {
  epfMembership: string | null;
  epfEmployeeRate: number | null;
  lindungParticipation: string | null;
  taxResidence: string | null;
  pcbCategory: string | null;
  qualifyingChildren: number;
  additionalPcbCents: number;
  additionalPcbNote: string | null;
  disabledSelf: boolean;
  disabledSpouse: boolean;
  restDay: RestDayChoice | null;
  overtimeContractPolicy: string | null;
};

function valuesOf(v: StatutoryClassificationVersion): FieldValues {
  return {
    epfMembership: v.epfMembership,
    epfEmployeeRate: v.epfEmployeeRate,
    lindungParticipation: v.lindungParticipation,
    taxResidence: v.taxResidence,
    pcbCategory: v.pcbCategory,
    qualifyingChildren: v.qualifyingChildren,
    additionalPcbCents: v.additionalPcbCents ?? 0,
    additionalPcbNote: v.additionalPcbNote ?? null,
    disabledSelf: v.disabledSelf,
    disabledSpouse: v.disabledSpouse,
    restDay: restDayChoiceOf(v) ?? null,
    overtimeContractPolicy: v.overtimeContractPolicy,
  };
}

/** A value in the words the form shows for it. */
function describeValue(field: FormField, value: FieldValues[FormField]): string {
  if (value === null || value === undefined) {
    if (field === 'lindungParticipation') return 'Enrolled (the default)';
    if (field === 'epfEmployeeRate') return '11% (the default)';
    if (field === 'additionalPcbNote') return 'None';
    return 'Not recorded';
  }
  switch (field) {
    case 'epfEmployeeRate':
      return `${value}%`;
    case 'qualifyingChildren':
      return String(value);
    case 'additionalPcbCents':
      return Number(value) > 0 ? `RM${(Number(value) / 100).toFixed(2)}` : 'None';
    case 'additionalPcbNote':
      return String(value);
    case 'disabledSelf':
    case 'disabledSpouse':
      return value ? 'Yes' : 'No';
    case 'restDay':
      return REST_DAY_CHOICES.find((choice) => choice.value === value)?.label ?? String(value);
    default:
      return STANDING_LABELS[String(value)] ?? String(value);
  }
}

type Change = { field: FormField; label: string; before: string; after: string };

/**
 * Each field `next` answers differently from `base`. A field `next` leaves
 * out is not a change: the service carries the base's answer forward.
 */
function changesBetween(base: FieldValues, next: Partial<FieldValues>): Change[] {
  return (Object.keys(FORM_FIELD_LABELS) as FormField[])
    .filter((field) => next[field] !== undefined && next[field] !== base[field])
    .map((field) => ({
      field,
      label: FORM_FIELD_LABELS[field],
      before: describeValue(field, base[field]),
      after: describeValue(field, next[field] as FieldValues[FormField]),
    }));
}

/**
 * The version in force on a date — or, before the first one, the first one.
 *
 * A change is pre-filled from THIS, not from the latest version: back-dating
 * a change to Additional PCB from the latest version silently copied the
 * latest LINDUNG and rest day into the earlier months as well. Reported from
 * UAT as "I only changed Additional PCB".
 */
function versionOn(
  versions: StatutoryClassificationVersion[],
  date: dayjs.Dayjs,
): { base: StatutoryClassificationVersion | null; kind: 'covering' | 'following' | 'none' } {
  const day = date.format('YYYY-MM-DD');
  const covering = versions.find((row) => row.effectiveFrom <= day && (row.effectiveTo === null || row.effectiveTo >= day));
  if (covering) return { base: covering, kind: 'covering' };
  const following = [...versions].filter((row) => row.effectiveFrom > day).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  return following ? { base: following, kind: 'following' } : { base: null, kind: 'none' };
}

const longDate = (value: string | null | undefined) => (value ? dayjs(value).format('D MMM YYYY') : 'now');

/**
 * THE STANDING AS FACTS — pure, so a test can render it without the query
 * layer. A classification this month does not resolve must not read as an
 * answer: every fact says "Not recorded" rather than one of the API's
 * readiness fallbacks, because payroll blocks on that employee and this
 * screen has to agree with it.
 */
export function StatutoryStandingSection({
  data,
  current,
  actions,
}: {
  data: EmployeeRecord;
  current?: StatutoryClassificationVersion;
  actions?: React.ReactNode;
}) {
  const s = data.statutory;
  const resolved = s.classificationState === 'RESOLVED';
  const since = s.classificationEffectiveFrom ? dayjs(s.classificationEffectiveFrom).format('D MMM YYYY') : null;
  // An unresolved standing has no values to show — showing the fallbacks as
  // though they were answers is exactly the overstatement this removes.
  const value = (v: string | null | undefined) => (resolved && v ? (STANDING_LABELS[v] ?? v) : null);
  const facts: [string, React.ReactNode][] = [
    ['EPF Third Schedule part', value(s.epfMembership)],
    ['EPF employee share', current?.epfEmployeeRate != null ? `${current.epfEmployeeRate}%` : resolved ? '11% (the default)' : null],
    ['SOCSO', resolved ? (s.socsoApplicable ? 'Applies' : 'Does not apply') : null],
    ['EIS', resolved ? (s.eisApplicable ? 'Applies' : 'Does not apply') : null],
    ['LINDUNG 24 JAM', value(s.lindungParticipation)],
    ['Tax residence', value(s.taxResidence)],
    ['MTD category', value(s.pcbCategory)],
    ['Qualifying children', resolved ? String(s.qualifyingChildren) : null],
    [
      'Additional PCB each month',
      resolved
        ? s.additionalPcbCents > 0
          ? `RM${(s.additionalPcbCents / 100).toFixed(2)}${s.additionalPcbNote ? ` · ${s.additionalPcbNote}` : ''}`
          : 'None'
        : null,
    ],
    ['Rest day', resolved ? restDayLabel(s) : null],
    ['Overtime above the Act limit', value(s.overtimeContractPolicy)],
  ];
  return (
    <>
      <PanelHead
        rule
        title="Statutory standing"
        sub={
          resolved && since
            ? `In force since ${since}. Changing any of it opens a new dated version, so an earlier month keeps what was true then.`
            : s.classificationNote || 'Recorded from the date it takes effect, so an earlier month keeps what was true then.'
        }
        actions={actions}
      />
      <div className="hr-kv hr-kv--pairs">
        {facts.map(([key, fact]) => (
          <span key={key} style={{ display: 'contents' }}>
            <span className="hr-kv__k">{key}</span>
            <span className="hr-kv__v">{fact ?? <span className="hr-faint">Not recorded</span>}</span>
          </span>
        ))}
      </div>
    </>
  );
}

export function StatutoryStandingManager({ data }: { data: EmployeeRecord }) {
  const { message } = App.useApp();
  const staffId = data.staffId;
  const mayManage = useCan('hr.employee.manage');
  const history = useStatutoryClassifications(staffId);
  const record = useRecordStatutoryClassification();
  const remove = useDeleteStatutoryClassification();
  const s = data.statutory;
  const versions = history.data ?? [];
  const current = versions.find((row) => row.current);

  const [open, setOpen] = useState(false);
  /**
   * The version being restated, if this is a correction rather than a change.
   *
   * The two are different acts and the form says which it is doing. A CHANGE
   * is dated from when it starts and leaves the earlier months alone; a
   * CORRECTION is the row saying properly what it always meant, so its date is
   * the row's own and cannot be moved.
   */
  const [target, setTarget] = useState<StatutoryClassificationVersion | null>(null);
  /** The version a delete has been asked for, awaiting confirmation. */
  const [doomed, setDoomed] = useState<StatutoryClassificationVersion | null>(null);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);
  const [error, setError] = useState<FormProblem>(null);
  /*
   * THE REFUSAL HAS TO BE WHERE THE PERSON PRESSING RECORD IS LOOKING.
   *
   * This form is long enough to scroll and its button sits at the bottom, so a
   * banner drawn at the top of the body is a banner nobody sees. Reported from
   * UAT as "the modal stays open after a successful record, so I press Record
   * again and get told it is a duplicate" — which is what a refusal rendered
   * off-screen looks like from the chair.
   */
  useProblemFocus(error);
  const [from, setFrom] = useState(dayjs().startOf('month'));
  const [epfMembership, setEpfMembership] = useState<string | undefined>();
  const [epfRate, setEpfRate] = useState<number | undefined>();
  const [lindung, setLindung] = useState<string | undefined>();
  const [taxResidence, setTaxResidence] = useState<string | undefined>();
  const [pcbCategory, setPcbCategory] = useState<string | undefined>();
  // NULLABLE, deliberately: MTD relief inputs, and "not recorded" is not a
  // default. Initialising them to 0/false would assert "no children, not
  // disabled" for an employee whose form never said so.
  const [children, setChildren] = useState<number | null>(null);
  const [disabledSelf, setDisabledSelf] = useState<boolean | null>(null);
  const [disabledSpouse, setDisabledSpouse] = useState<boolean | null>(null);
  const [restDay, setRestDay] = useState<RestDayChoice | undefined>();
  /** Ringgit as typed; blank leaves the standing's figure as it is, 0 clears it. */
  const [additionalPcb, setAdditionalPcb] = useState('');
  const [additionalPcbNote, setAdditionalPcbNote] = useState('');
  const [otPolicy, setOtPolicy] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  /** For a change dated before later versions: whether they take it too. Null until the person says. */
  const [applyToLater, setApplyToLater] = useState<boolean | null>(null);

  /** The fields, filled from one version — or, with none on record, from the resolved standing. */
  const fill = (base: StatutoryClassificationVersion | null, fallback: EmployeeRecord['statutory'] | null) => {
    setEpfMembership(base?.epfMembership ?? fallback?.epfMembership ?? undefined);
    setEpfRate(base?.epfEmployeeRate ?? undefined);
    setLindung(base?.lindungParticipation ?? fallback?.lindungParticipation ?? undefined);
    setTaxResidence(base?.taxResidence ?? fallback?.taxResidence ?? undefined);
    setPcbCategory(base?.pcbCategory ?? fallback?.pcbCategory ?? undefined);
    setChildren(base?.qualifyingChildren ?? fallback?.qualifyingChildren ?? null);
    const additionalCents = base?.additionalPcbCents ?? fallback?.additionalPcbCents ?? 0;
    setAdditionalPcb(additionalCents > 0 ? (additionalCents / 100).toFixed(2) : '');
    setAdditionalPcbNote(base?.additionalPcbNote ?? fallback?.additionalPcbNote ?? '');
    setDisabledSelf(base?.disabledSelf ?? null);
    setDisabledSpouse(base?.disabledSpouse ?? null);
    setRestDay(restDayChoiceOf(base) ?? restDayChoiceOf(fallback));
    setOtPolicy(base?.overtimeContractPolicy ?? fallback?.overtimeContractPolicy ?? undefined);
  };

  /**
   * `row` given, the form corrects that version; otherwise it records a change
   * from a date the user chooses.
   *
   * A correction prefills from THE ROW ITSELF and from nothing else. Filling it
   * from the standing in force would quietly carry this month's answers back
   * into a month that never had them — which is the opposite of what somebody
   * opening January came to do. A change prefills from the version IN FORCE ON
   * ITS DATE, for the same reason in the other direction.
   */
  const openForm = (row?: StatutoryClassificationVersion) => {
    const start = row ? dayjs(row.effectiveFrom) : dayjs().startOf('month');
    const base = row ?? versionOn(versions, start).base;
    // Only a change with nothing on record may fall back on the resolved record.
    fill(base, base ? null : s);
    setTarget(row ?? null);
    setFrom(start);
    setApplyToLater(null);
    // Never the old reason: a correction has its own, and it is the only place
    // the history will say why the row stopped saying what it said.
    setReason('');
    setError(null);
    setOpen(true);
  };

  /** A change moved to another date starts again from the version in force on that date. */
  const moveDate = (value: dayjs.Dayjs) => {
    setFrom(value);
    const base = versionOn(versions, value).base;
    fill(base, base ? null : s);
    setApplyToLater(null);
  };

  /** What the form will send: only the fields it has an answer for. */
  const sent: Partial<FieldValues> = {
    ...(epfMembership !== undefined ? { epfMembership } : {}),
    ...(epfRate !== undefined ? { epfEmployeeRate: epfRate } : {}),
    ...(lindung !== undefined ? { lindungParticipation: lindung } : {}),
    ...(taxResidence !== undefined ? { taxResidence } : {}),
    ...(pcbCategory !== undefined ? { pcbCategory } : {}),
    ...(children !== null ? { qualifyingChildren: children } : {}),
    ...(additionalPcb.trim() !== ''
      ? { additionalPcbCents: Math.round(Number(additionalPcb) * 100), additionalPcbNote: additionalPcbNote.trim() || null }
      : {}),
    ...(disabledSelf !== null ? { disabledSelf } : {}),
    ...(disabledSpouse !== null ? { disabledSpouse } : {}),
    ...(restDay !== undefined ? { restDay } : {}),
    ...(otPolicy !== undefined ? { overtimeContractPolicy: otPolicy } : {}),
  };
  /*
   * WHAT THIS STATEMENT CHANGES, said before it is saved. A correction is
   * measured against the row itself; a change against the version in force on
   * its date. Nothing here is a guess the server does not make too: the server
   * refuses a change that differs in nothing from the version in force.
   */
  const basis = target ? { base: target, kind: 'covering' as const } : versionOn(versions, from);
  const changes = basis.base ? changesBetween(valuesOf(basis.base), sent) : [];
  const fromDay = from.format('YYYY-MM-DD');
  // The versions after the one this statement splits or restates. Before the
  // first version there is no old value for a later version to still hold,
  // so nothing is carried and nothing is asked.
  const laterVersions =
    basis.kind === 'covering' ? versions.filter((row) => row.effectiveFrom > fromDay).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) : [];
  const askLater = laterVersions.length > 0 && changes.length > 0;
  const nothingNew = !target && basis.kind === 'covering' && changes.length === 0;

  /** What deleting a version takes those months back to: the version before it, field by field. */
  const doomedPrevious = doomed
    ? ([...versions].filter((row) => row.effectiveFrom < doomed.effectiveFrom).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null)
    : null;
  const reverts = doomed && doomedPrevious ? changesBetween(valuesOf(doomed), valuesOf(doomedPrevious)) : [];
  const earliest = versions.length > 0 ? [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] : null;

  return (
    <>
      <StatutoryStandingSection
        data={data}
        current={current}
        actions={
          mayManage ? (
            <button type="button" className="hr-btn hr-btn--sm" onClick={() => openForm()}>
              <IconEdit />
              Record a change
            </button>
          ) : null
        }
      />

      {versions.length > 0 ? (
        <Table<StatutoryClassificationVersion>
          rowKey="id"
          loading={history.isLoading}
          rows={versions}
          columns={[
            {
              title: 'In force',
              key: 'range',
              width: 230,
              render: (_: unknown, row) => `${dayjs(row.effectiveFrom).format('D MMM YYYY')} — ${row.effectiveTo ? dayjs(row.effectiveTo).format('D MMM YYYY') : 'now'}`,
            },
            {
              title: 'What changed',
              key: 'changed',
              render: (_: unknown, row) =>
                row.changed.length > 0 ? (
                  row.changed.join(', ')
                ) : (
                  <span className="hr-faint">{(row.first ?? row.id === earliest?.id) ? 'First recorded standing' : 'Same as the version before'}</span>
                ),
            },
            {
              title: 'Reason',
              key: 'reason',
              render: (_: unknown, row) => row.reason ?? <span className="hr-faint">No reason given</span>,
            },
            {
              title: 'Recorded by',
              key: 'by',
              width: 200,
              render: (_: unknown, row) => `${row.recordedBy ?? 'Unknown'} · ${dayjs(row.recordedAt).format('D MMM YYYY')}`,
            },
            /*
             * EVERY VERSION IS CORRECTABLE, INCLUDING THE FIRST.
             *
             * The first one is written from the join date by the Add employee
             * form and carries only the three things that form asks for. With
             * no way in, everything else about that employee's first month —
             * LINDUNG, the rest day, the MTD category — was unreachable, and
             * their first payroll blocked on fields with no input anywhere.
             */
            {
              title: '',
              key: 'correct',
              width: 190,
              render: (_: unknown, row) =>
                mayManage ? (
                  <span className="hr-menu">
                    <button type="button" className="hr-btn hr-btn--sm" onClick={() => openForm(row)}>
                      <IconEdit />
                      Correct
                    </button>
                    {/*
                      * A version recorded in error can go. The server refuses
                      * one an approved month was worked out from, and says
                      * which month.
                      */}
                    <button type="button" className="hr-btn hr-btn--sm hr-btn--danger" onClick={() => { setDeleteProblem(null); setDoomed(row); }}>
                      Delete
                    </button>
                  </span>
                ) : null,
            },
          ]}
        />
      ) : null}

      <Modal
        open={Boolean(doomed)}
        title={doomed ? `Delete the version from ${dayjs(doomed.effectiveFrom).format('D MMM YYYY')}?` : ''}
        okText="Delete version"
        okButtonProps={{ danger: true }}
        confirmLoading={remove.isPending}
        onCancel={() => setDoomed(null)}
        onOk={() => {
          if (!doomed) return;
          remove.mutate(
            { staffId, id: doomed.id, reason: 'Recorded in error' },
            {
              onSuccess: () => {
                setDoomed(null);
                message.success(
                  doomedPrevious
                    ? `Version deleted. The one from ${longDate(doomedPrevious.effectiveFrom)} now runs on to cover those months.`
                    : 'Version deleted. Those months have no standing on record until one is recorded.',
                );
              },
              onError: (error: Error) => setDeleteProblem(error.message),
            },
          );
        }}
      >
        {deleteProblem ? (
          <div className="hr-notice hr-notice--attn" role="alert">
            {deleteProblem}
          </div>
        ) : null}
        {doomed ? (
          <div data-testid="st-delete-summary">
            <p>
              <strong>In force {longDate(doomed.effectiveFrom)} to {longDate(doomed.effectiveTo)}</strong>
              {doomed.reason ? ` · ${doomed.reason}` : ''} · recorded by {doomed.recordedBy ?? 'unknown'} on {longDate(doomed.recordedAt)}.
            </p>
            {doomedPrevious ? (
              <>
                <p>
                  After deleting, the version from {longDate(doomedPrevious.effectiveFrom)} runs on to {longDate(doomed.effectiveTo)}, so those months go back to
                  what it says:
                </p>
                {reverts.length > 0 ? (
                  <ul className="hr-list" data-testid="st-delete-reverts">
                    {reverts.map((change) => (
                      <li key={change.field}>
                        {change.label}: {change.before} becomes {change.after}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hr-faint">Nothing differs between the two, so those months read exactly as they do now.</p>
                )}
              </>
            ) : (
              <p>
                There is no earlier version. {longDate(doomed.effectiveFrom)} to {longDate(doomed.effectiveTo)} will have no standing on record, and payroll
                blocks those months until one is recorded.
              </p>
            )}
            <p className="hr-faint">A version an approved payroll month was worked out from cannot be deleted.</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={open}
        title={target ? `Correct the standing from ${dayjs(target.effectiveFrom).format('D MMM YYYY')}` : 'Record a statutory standing'}
        okText={target ? 'Save correction' : 'Record'}
        okButtonProps={{ disabled: nothingNew }}
        width={620}
        confirmLoading={record.isPending}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          setError(null);
          if (!reason.trim()) {
            setError({ field: 'st-reason', message: 'Say why this is being recorded — a standing with no reason is not a record.' });
            return;
          }
          if (askLater && applyToLater === null) {
            setError({ field: 'st-apply-later', message: 'Say whether the later versions should take this change too.' });
            return;
          }
          // Only what the form knows is sent; the service carries the rest of
          // the standing forward, and stores the whole statement.
          const { restDay: sentRestDay, ...fields } = sent;
          const body: RecordStatutoryClassificationBody & { staffId: string } = {
            staffId,
            effectiveFrom: fromDay,
            ...fields,
            ...(sentRestDay !== undefined && sentRestDay !== null ? restDayBody(sentRestDay) : {}),
            reason: reason.trim(),
            ...(askLater ? { applyToLater: applyToLater === true } : {}),
          };
          let carried = 0;
          try {
            const result = (await record.mutateAsync(body)) as { appliedToLater?: unknown[] } | undefined;
            carried = result?.appliedToLater?.length ?? 0;
          } catch (e) {
            setError({ message: e instanceof Error ? e.message : 'The change was not saved. Try again.' });
            return;
          }
          /*
           * CLOSING IS THE SAVE'S OWN CONSEQUENCE, so it is outside the try.
           * Inside it, anything that threw after the write — a toast, a
           * format — was caught and shown as a refusal, leaving the form up
           * over a record that had already been written and inviting the same
           * statement to be sent a second time.
           */
          setOpen(false);
          const later =
            askLater && applyToLater
              ? carried > 0
                ? ` ${carried} later version${carried === 1 ? '' : 's'} took the change too.`
                : ' No later version still held the old value, so none changed.'
              : '';
          message.success(
            target
              ? `Corrected. ${dayjs(target.effectiveFrom).format('D MMM YYYY')} onwards reads this, and no second version was opened.${later}`
              : `Recorded. Payroll resolves it from the date it takes effect.${later}`,
          );
        }}
      >
        <ProblemNotice problem={error} />
        <div className="hr-form" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="st-from">In force from</label>
            <DatePicker
              id="st-from"
              value={from}
              onChange={(v) => v && moveDate(v)}
              style={{ width: '100%' }}
              allowClear={false}
              format="D MMM YYYY"
              // A correction is that row said properly. Moving its date would
              // make it a different version of a different period.
              disabled={Boolean(target)}
            />
            <div className="hr-form__help">
              {target
                ? 'The date this version starts, which a correction does not move. To start a new version from a later date, close this and use Record a change.'
                : "Date it from the first day of the month it took effect, even if that was earlier this year: the version covering that date is split, and the months before it keep what they had. The fields below show the standing in force on this date, and follow the date when it moves. A standing that changes part-way through a month blocks that month's payroll, because a contribution is worked out for a whole wage period. A month already approved refuses the change."}
            </div>
          </div>

          <div className="hr-form__row">
            <div>
              <label htmlFor="st-epf">EPF Third Schedule part</label>
              <Select
                id="st-epf"
                value={epfMembership}
                onChange={setEpfMembership}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'MALAYSIAN_CITIZEN', label: 'Malaysian citizen' },
                  { value: 'PERMANENT_RESIDENT', label: 'Permanent resident' },
                  { value: 'NON_CITIZEN_ELECTED_PRE_1998', label: 'Non-citizen, elected before 1 Aug 1998' },
                  { value: 'NON_CITIZEN', label: 'Non-citizen' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="st-rate">EPF employee share</label>
              <Select
                id="st-rate"
                value={epfRate}
                onChange={setEpfRate}
                style={{ width: '100%' }}
                placeholder="11% (the default)"
                options={[
                  { value: 11, label: '11% — the statutory rate' },
                  { value: 9, label: '9% — the employee elected the lower rate' },
                ]}
              />
              <div className="hr-form__help">The employee's own share only. The employer's share follows the Third Schedule.</div>
            </div>
            <div>
              <label htmlFor="st-lindung">LINDUNG 24 JAM (SKBBK)</label>
              <Select
                id="st-lindung"
                value={lindung}
                onChange={setLindung}
                style={{ width: '100%' }}
                placeholder="Enrolled — the default"
                options={[
                  { value: 'ENROLLED', label: 'Enrolled' },
                  { value: 'NOT_PARTICIPATING', label: 'Opted out through PERKESO' },
                  { value: 'MANDATORY_FOREIGN_WORKER', label: 'Mandatory — foreign worker' },
                ]}
              />
              {/*
                * ENROLMENT IS AUTOMATIC, so leaving this alone contributes.
                * Kuwick used to read silence as "we cannot know" and deduct
                * nothing, which under-deducted from anybody nobody had touched.
                */}
              <div className="hr-form__help">
                Every employee is enrolled unless they opt out through PERKESO's own form. Left blank, this employee
                contributes. Choose Opted out only where the form has actually been filed.
              </div>
            </div>
            <div>
              <label htmlFor="st-residence">Tax residence</label>
              <Select
                id="st-residence"
                value={taxResidence}
                onChange={setTaxResidence}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'RESIDENT', label: 'Resident — progressive table' },
                  { value: 'NON_RESIDENT', label: 'Non-resident — flat 30%' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="st-category">MTD category</label>
              <Select
                id="st-category"
                value={pcbCategory}
                onChange={setPcbCategory}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'CATEGORY_1', label: 'Category 1 — single' },
                  { value: 'CATEGORY_2', label: 'Category 2 — married, spouse not working' },
                  { value: 'CATEGORY_3', label: 'Category 3 — married, spouse working' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="st-children">Qualifying children</label>
              <InputNumber id="st-children" min={0} max={20} value={children} onChange={(v) => setChildren(v)} placeholder="Not recorded" style={{ width: '100%' }} />
            </div>
            <div>
              <label htmlFor="st-additional-pcb">Additional PCB each month (RM)</label>
              <Input
                id="st-additional-pcb"
                inputMode="decimal"
                value={additionalPcb}
                onChange={(event) => setAdditionalPcb(event.target.value)}
                placeholder="e.g. 100.00 — blank for none"
              />
              <span className="hr-fld__help">On top of the computed MTD: a CP38 direction from LHDN, or at the employee’s own request. Not added to a PCB figure typed by hand.</span>
            </div>
            <div>
              <label htmlFor="st-additional-pcb-note">Additional PCB note</label>
              <Input
                id="st-additional-pcb-note"
                value={additionalPcbNote}
                onChange={(event) => setAdditionalPcbNote(event.target.value)}
                placeholder="e.g. CP38 ref 2026/1234"
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="st-rest">Rest day</label>
              <Select
                id="st-rest"
                value={restDay}
                onChange={setRestDay}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={REST_DAY_CHOICES}
              />
              {restDay === 'VARIES' || restDay === 'ROSTER' ? <div className="hr-form__help">{NO_FIXED_DAY_HELP}</div> : null}
            </div>
            <div>
              <label htmlFor="st-ot">Overtime above the Employment Act limit</label>
              <Select
                id="st-ot"
                value={otPolicy}
                onChange={setOtPolicy}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[
                  { value: 'PAY_AT_STATUTORY_RATES', label: 'Company pays overtime at the statutory rates' },
                  { value: 'NOT_PAID', label: 'Overtime is not paid' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="st-dself">Disabled (self) — MTD relief</label>
              <Select
                id="st-dself"
                value={disabledSelf === null ? undefined : disabledSelf ? 'YES' : 'NO'}
                onChange={(v) => setDisabledSelf(v === 'YES')}
                placeholder="Not recorded"
                style={{ width: '100%' }}
                options={[
                  { value: 'NO', label: 'No' },
                  { value: 'YES', label: 'Yes — registered disabled person' },
                ]}
              />
            </div>
            <div>
              <label htmlFor="st-dspouse">Disabled spouse — MTD relief</label>
              <Select
                id="st-dspouse"
                value={disabledSpouse === null ? undefined : disabledSpouse ? 'YES' : 'NO'}
                onChange={(v) => setDisabledSpouse(v === 'YES')}
                placeholder="Not recorded"
                style={{ width: '100%' }}
                options={[
                  { value: 'NO', label: 'No' },
                  { value: 'YES', label: 'Yes — spouse is a registered disabled person' },
                ]}
              />
            </div>
          </div>
          <div className="hr-form__help">
            Overtime above the limit only matters for wages above the First Schedule limit, where the Act's own overtime provisions stop applying. Below it, overtime is statutory and
            that setting is ignored.
          </div>

          {/*
            * SAID BEFORE IT IS SAVED. The list is exactly the fields that differ
            * from the version this statement is measured against, in the words
            * the form uses; everything else stays as that version has it.
            */}
          {basis.base ? (
            changes.length > 0 ? (
              <div className="hr-notice hr-notice--info" data-testid="st-changes">
                <strong>You are changing:</strong>{' '}
                {changes.map((change) => `${change.label} (${change.before} becomes ${change.after})`).join('; ')}.
                <div className="hr-faint">
                  {target
                    ? `Compared with what this version says now.`
                    : basis.kind === 'covering'
                      ? `Compared with the version in force on ${longDate(fromDay)}, from ${longDate(basis.base.effectiveFrom)}. Everything else stays as that version has it.`
                      : `Compared with the first version on record, from ${longDate(basis.base.effectiveFrom)}, which starts after this date.`}
                </div>
              </div>
            ) : (
              <div className={target ? 'hr-notice hr-notice--muted' : 'hr-notice hr-notice--attn'} data-testid="st-changes">
                {target
                  ? 'Nothing differs from what this version says now; saving records the reason only.'
                  : basis.kind === 'covering'
                    ? `Nothing differs from the version in force on ${longDate(fromDay)}, so there is nothing to record. Change a field, or pick another date.`
                    : `Nothing differs from the first version on record, from ${longDate(basis.base.effectiveFrom)}.`}
              </div>
            )
          ) : (
            <div className="hr-notice hr-notice--muted" data-testid="st-changes">
              This is the first standing recorded for this employee.
            </div>
          )}

          {askLater ? (
            <div id="st-apply-later" data-testid="st-apply-later">
              <label id="st-apply-later-label">Apply this change to later versions too?</label>
              <Radio.Group
                aria-labelledby="st-apply-later-label"
                value={applyToLater}
                onChange={(event) => setApplyToLater(event.target.value as boolean)}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <Radio value={true}>
                  Yes — the {laterVersions.length} later version{laterVersions.length === 1 ? '' : 's'} (from{' '}
                  {laterVersions.map((row) => longDate(row.effectiveFrom)).join(', ')}) take the same change where they still carry the old value
                </Radio>
                <Radio value={false}>No — only this version; the later versions keep what they say</Radio>
              </Radio.Group>
              <div className="hr-form__help">
                A later version that changed the same field on purpose keeps its own answer either way, and each version keeps what it was recorded as changing.
              </div>
              <FieldProblem problem={error} field="st-apply-later" />
            </div>
          ) : null}

          <div>
            <label htmlFor="st-reason">Reason</label>
            <ReasonPicker id="st-reason" value={reason} onChange={setReason} options={STANDING_REASONS} placeholder="Recorded at hire, corrected after the LHDN category confirmation…" />
            <FieldProblem problem={error} field="st-reason" />
          </div>
        </div>
      </Modal>
    </>
  );
}
