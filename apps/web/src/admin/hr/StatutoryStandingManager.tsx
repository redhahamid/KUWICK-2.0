import { useState } from 'react';
import { App, DatePicker, Input, InputNumber, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import { useDeleteStatutoryClassification, useRecordStatutoryClassification, useStatutoryClassifications } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { FieldProblem, PanelHead, ProblemNotice, useProblemFocus } from './ui';
import { ReasonPicker } from './ui/ReasonPicker';
import { STANDING_REASONS } from './ui/reasons';
import { Table } from './ui/Table';
import { IconEdit } from './ui/icons';
import type { FormProblem } from './ui';
import type { EmployeeRecord, StatutoryClassificationVersion } from '../types';

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
/** The rest day is stored as 0–6. One list of names, so three screens cannot disagree about which day 0 is. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The stored codes, in the words the editor uses. A screen that prints MALAYSIAN_CITIZEN is talking to a developer. */
const STANDING_LABELS: Record<string, string> = {
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
    ['Rest day', resolved ? (s.restDayVaries ? 'Varies week to week' : s.restDayOfWeek !== null ? DAY_NAMES[s.restDayOfWeek] : null) : null],
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
  const [restDay, setRestDay] = useState<number | 'VARIES' | undefined>();
  const [otPolicy, setOtPolicy] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  /**
   * `row` given, the form corrects that version; otherwise it records a change
   * from a date the user chooses.
   *
   * A correction prefills from THE ROW ITSELF and from nothing else. Filling it
   * from the standing in force would quietly carry this month's answers back
   * into a month that never had them — which is the opposite of what somebody
   * opening January came to do.
   */
  const openForm = (row?: StatutoryClassificationVersion) => {
    const base = row ?? current;
    // Only a change may fall back on the resolved record; a correction may not.
    const fallback = row ? null : s;
    setTarget(row ?? null);
    setFrom(row ? dayjs(row.effectiveFrom) : dayjs().startOf('month'));
    setEpfMembership(base?.epfMembership ?? fallback?.epfMembership ?? undefined);
    setEpfRate(base?.epfEmployeeRate ?? undefined);
    setLindung(base?.lindungParticipation ?? fallback?.lindungParticipation ?? undefined);
    setTaxResidence(base?.taxResidence ?? fallback?.taxResidence ?? undefined);
    setPcbCategory(base?.pcbCategory ?? fallback?.pcbCategory ?? undefined);
    setChildren(base?.qualifyingChildren ?? fallback?.qualifyingChildren ?? null);
    setDisabledSelf(base?.disabledSelf ?? null);
    setDisabledSpouse(base?.disabledSpouse ?? null);
    setRestDay(base?.restDayVaries || fallback?.restDayVaries ? 'VARIES' : (base?.restDayOfWeek ?? fallback?.restDayOfWeek ?? undefined));
    setOtPolicy(base?.overtimeContractPolicy ?? fallback?.overtimeContractPolicy ?? undefined);
    // Never the old reason: a correction has its own, and it is the only place
    // the history will say why the row stopped saying what it said.
    setReason('');
    setError(null);
    setOpen(true);
  };

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
              render: (_: unknown, row) => (row.changed.length > 0 ? row.changed.join(', ') : <span className="hr-faint">First recorded standing</span>),
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
                message.success('Version deleted. The one before it now runs on to cover those months.');
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
        <p>
          For a version recorded in error. The version before it runs on to{' '}
          {doomed?.effectiveTo ? dayjs(doomed.effectiveTo).format('D MMM YYYY') : 'now'}, so those months keep an
          answer. A version an approved payroll month was worked out from cannot be deleted.
        </p>
      </Modal>

      <Modal
        open={open}
        title={target ? `Correct the standing from ${dayjs(target.effectiveFrom).format('D MMM YYYY')}` : 'Record a statutory standing'}
        okText={target ? 'Save correction' : 'Record'}
        width={620}
        confirmLoading={record.isPending}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          setError(null);
          if (!reason.trim()) {
            setError({ field: 'st-reason', message: 'Say why this is being recorded — a standing with no reason is not a record.' });
            return;
          }
          try {
            await record.mutateAsync({
              staffId,
              effectiveFrom: from.format('YYYY-MM-DD'),
              // Only what the form knows is sent; the service carries the rest
              // of the standing forward, and stores the whole statement.
              ...(epfMembership !== undefined ? { epfMembership } : {}),
              ...(epfRate !== undefined ? { epfEmployeeRate: epfRate } : {}),
              ...(lindung !== undefined ? { lindungParticipation: lindung } : {}),
              ...(taxResidence !== undefined ? { taxResidence } : {}),
              ...(pcbCategory !== undefined ? { pcbCategory } : {}),
              ...(children !== null ? { qualifyingChildren: children } : {}),
              ...(disabledSelf !== null ? { disabledSelf } : {}),
              ...(disabledSpouse !== null ? { disabledSpouse } : {}),
              ...(restDay === 'VARIES' ? { restDayOfWeek: null, restDayVaries: true } : restDay !== undefined ? { restDayOfWeek: restDay, restDayVaries: false } : {}),
              ...(otPolicy !== undefined ? { overtimeContractPolicy: otPolicy } : {}),
              reason: reason.trim(),
            });
          } catch (e) {
            setError({ message: e instanceof Error ? e.message : 'The server refused the change and did not say why.' });
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
          message.success(
            target
              ? `Corrected. ${dayjs(target.effectiveFrom).format('D MMM YYYY')} onwards reads this, and no second version was opened.`
              : 'Recorded. Payroll resolves it from the date it takes effect.',
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
              onChange={(v) => v && setFrom(v)}
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
                : "Date it from the first day of the month it took effect, even if that was earlier this year: the version covering that date is split, and the months before it keep what they had. A standing that changes part-way through a month blocks that month's payroll, because a contribution is worked out for a whole wage period. A month already approved refuses the change."}
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
              <label htmlFor="st-rest">Rest day</label>
              <Select
                id="st-rest"
                value={restDay}
                onChange={setRestDay}
                style={{ width: '100%' }}
                placeholder="Not recorded"
                options={[...DAY_NAMES.map((day, index) => ({ value: index, label: day })), { value: 'VARIES', label: 'Varies week to week' }]}
              />
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
