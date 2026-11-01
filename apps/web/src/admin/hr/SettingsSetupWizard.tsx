import { useEffect, useState, type ReactNode } from 'react';
import { App, Checkbox, Input, Select, Switch } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { useMarkStatutoryChecked, useRecordEmployerHrd, useSeedPayComponents, useUpsertLegalEmployer } from '../hooks/useAdmin';
import { useHolidayPresets, useLoadHolidayPresets } from '../../hr/hooks/usePublicHolidays';
import { useGlobalSetting, useSetGlobalSetting } from '../../core/hooks/useGlobalSetting';
import { useCan } from '../../core/hooks/useCan';
import { HrPage, ProblemNotice, StatusChip } from './ui';
import { EmployerLogoField } from './EmployerLogoField';
import { bankOptions, stateOf, stateOptions } from './malaysianStates';
import { placeOfPostcode } from './postcode';
import { OPENING_BALANCES_SETTING, employersToSetUp, type OpeningBalancesAnswer, type SetupStep, type SetupStepKey } from './useHrSetup';
import type { LegalEmployerRow } from '../types';
import { endSetupTrail, fromSetup } from './setupTrail';

export type { SetupStep, SetupStepKey } from './useHrSetup';

/** The HRD Corp classes, in plain words. Recorded as a dated version of the employer. */
const HRD_CLASSES = [
  // The rate first, so a narrow box still shows it (new-clinic UAT #2, item 55).
  { value: 'MANDATORY_SECTION_14', label: '1% · Must pay (10+ Malaysian staff)' },
  { value: 'OPTIONAL_SECTION_15', label: '0.5% · By choice (5–9 staff)' },
  { value: 'NOT_REGISTERED', label: 'Not registered' },
];

/**
 * A SAVE THAT KEEPS WHAT IT DOES NOT SHOW.
 *
 * The employer endpoint writes every field it is sent and blanks every field
 * it is not, so the wizard's few boxes go up with everything else already on
 * file. The bank account number is write-only: sent only when typed, absent
 * means "leave it alone". A blank box is left out rather than sent as '',
 * which the endpoint refuses for the number fields.
 */
export function employerSaveBody(
  row: LegalEmployerRow | null,
  edits: Record<string, string>,
  settings: {
    hrdLevyBase: LegalEmployerRow['hrdLevyBase'];
    zakatThroughPayroll: boolean;
  },
): Record<string, unknown> {
  const kept: Record<string, string | null | undefined> = row
    ? {
        name: row.name,
        registrationNo: row.registrationNo,
        epfEmployerNo: row.epfEmployerNo,
        socsoEmployerNo: row.socsoEmployerNo,
        lhdnEmployerNo: row.lhdnEmployerNo,
        hrdRegistrationNo: row.hrdRegistrationNo,
        phone: row.phone,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        postcode: row.postcode,
        city: row.city,
        state: row.state,
        bankName: row.bankName,
        bankAccountName: row.bankAccountName,
        eaSignerName: row.eaSignerName,
        eaSignerPosition: row.eaSignerPosition,
      }
    : {};
  const merged = { ...kept, ...edits };
  const body: Record<string, unknown> = row ? { id: row.id } : {};
  for (const [key, value] of Object.entries(merged)) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed !== '') body[key] = trimmed;
  }
  body.hrdLevyBase = settings.hrdLevyBase;
  body.zakatThroughPayroll = settings.zakatThroughPayroll;
  return body;
}

/** Where a step settled on its own page sends people. */
const PAGE: Partial<Record<SetupStepKey, { to: string; label: string }>> = {
  payRules: { to: '/admin/hr/settings/payroll', label: 'Open Pay rules' },
  items: { to: '/admin/hr/settings/payroll-items', label: 'Open Payroll items' },
  employees: { to: '/admin/hr/employees', label: 'Open the Employees page' },
};

/**
 * SET UP PAYROLL (docs/hr-mockup/SetupWizard.html).
 *
 * Only the steps. The left list says where each one stands; the right card is
 * the one step open, with its form, and one button that saves and moves on.
 * It is what HR opens on until every step is done (new-clinic UAT, 15 October
 * 2026), and it reads the same setup status as the Settings cards, so the two
 * cannot disagree about what is missing.
 */
export function SettingsSetupWizard({
  steps,
  open,
  onOpen,
  onFinished,
  reviewing,
  employers,
  facts,
  error,
}: {
  steps: SetupStep[];
  open: SetupStepKey;
  onOpen: (key: SetupStepKey) => void;
  /** Every step is done: back to the Settings home. */
  onFinished: () => void;
  /** Setup was already complete and somebody chose "Review setup". */
  reviewing: boolean;
  employers: LegalEmployerRow[];
  /** Short facts for the steps that are settled elsewhere. */
  facts: Partial<Record<SetupStepKey, { label: string; value: ReactNode }[]>>;
  error?: string | null;
}) {
  const done = steps.filter((step) => step.done).length;
  const index = Math.max(
    0,
    steps.findIndex((step) => step.key === open),
  );
  const step = steps[index];
  const left = steps.filter((row) => !row.done && row.key !== step.key);
  const finishes = left.length === 0;

  const next = () => {
    if (finishes) {
      endSetupTrail();
      onFinished();
      return;
    }
    // The next step still to do, after this one; else the first one still to do.
    const after = steps.slice(index + 1).find((row) => !row.done) ?? left[0];
    onOpen(after.key);
  };
  const stepProps = { employers, finishes, onSaved: next };

  return (
    <HrPage
      title="Set up payroll"
      error={error}
      sub={
        reviewing ? (
          <>
            Setup is complete.{' '}
            <Link className="hr-link" to="/admin/hr/settings">
              Back to Settings
            </Link>
          </>
        ) : (
          <>
            {steps.length} short steps, once. Do them in any order.{' '}
            <Link className="hr-link" to="/admin/hr/settings?all=1">
              Open all settings now
            </Link>
          </>
        )
      }
      actions={
        <div className="hr-progress">
          <span
            className="hr-ring hr-ring--wiz"
            style={{
              background: `conic-gradient(var(--hr-action) 0 ${(done / steps.length) * 360}deg, var(--hr-line2) ${(done / steps.length) * 360}deg 360deg)`,
            }}
          >
            <i>
              {done}/{steps.length}
            </i>
          </span>
          <span>
            <b>
              {done === steps.length
                ? 'All done'
                : done === steps.length - 1
                  ? 'One step left'
                  : `${steps.length - done} steps left`}
            </b>
            {done === steps.length ? 'Payroll is ready to run' : 'Then payroll is ready to run'}
          </span>
        </div>
      }
    >
      <div className="hr-wiz">
        <SetupStepList steps={steps} open={step.key} onOpen={onOpen} />

        <section className="hr-wiz__card" aria-labelledby="hr-wiz-title">
          <div className="hr-wiz__count">
            Step {index + 1} of {steps.length}
          </div>
          <h2 id="hr-wiz-title">{step.title}</h2>
          <p className="hr-sub">{step.intro}</p>
          {step.key === 'company' ? (
            <CompanyStep {...stepProps} />
          ) : step.key === 'bank' ? (
            <BankStep {...stepProps} />
          ) : step.key === 'holidays' ? (
            <HolidaysStep {...stepProps} done={step.done} />
          ) : step.key === 'opening' ? (
            <OpeningStep finishes={finishes} onSaved={next} />
          ) : step.key === 'rates' ? (
            <RatesStep facts={facts.rates ?? []} finishes={finishes} onSaved={next} />
          ) : (
            <FactStep
              page={PAGE[step.key]!}
              facts={facts[step.key] ?? []}
              finishes={finishes}
              // A step settled on another page cannot be finished from here;
              // with nothing else left, the page's own button is the way on.
              canMoveOn={step.done || left.length > 0}
              onNext={next}
              first={step.key === 'items' && !step.done ? <AddDefaultItems /> : step.key === 'employees' && !step.done ? <AddFirstEmployee /> : null}
            />
          )}
        </section>
      </div>
    </HrPage>
  );
}

/**
 * THE STEP LIST, where each step stands. Drawn in the wizard and, while
 * somebody works on a page the wizard opened, pinned in the HR side rail
 * (new-clinic UAT #2, item 69), so they never lose the wizard.
 */
export function SetupStepList({
  steps,
  open,
  onOpen,
  compact,
}: {
  steps: SetupStep[];
  open: SetupStepKey | null;
  onOpen: (key: SetupStepKey) => void;
  compact?: boolean;
}) {
  return (
    <nav aria-label="Setup steps" className={`hr-wiz__steps${compact ? ' hr-wiz__steps--rail' : ''}`}>
      {steps.map((row, i) => (
        <button
          key={row.key}
          type="button"
          className={`hr-wizStep${row.key === open ? ' is-open' : ''}`}
          aria-current={row.key === open ? 'step' : undefined}
          onClick={() => onOpen(row.key)}
        >
          <span className={`hr-wizStep__num${row.key === open ? ' is-open' : row.done ? ' is-done' : ''}`}>
            {row.done && row.key !== open ? '✓' : i + 1}
          </span>
          <span>
            <span className="hr-wizStep__title">{row.title}</span>
            {row.done ? <span className="hr-wizStep__sum">{row.summary}</span> : <StatusChip tone="attn">{row.summary}</StatusChip>}
          </span>
        </button>
      ))}
    </nav>
  );
}

function StepFoot({ children }: { children: ReactNode }) {
  return <div className="hr-wiz__foot">{children}</div>;
}

type StepProps = { employers: LegalEmployerRow[]; finishes: boolean; onSaved: () => void };

/** The employer the step works on: the first one still missing something, else the first. */
function useEmployerChoice(employers: LegalEmployerRow[], missing: (row: LegalEmployerRow) => boolean) {
  const candidates = employersToSetUp(employers);
  const first = candidates.find(missing) ?? candidates[0] ?? null;
  const [employerId, setEmployerId] = useState<string | null>(first?.id ?? null);
  const row = employers.find((candidate) => candidate.id === employerId) ?? null;
  const picker =
    candidates.length > 1 ? (
      <div className="hr-wizChoice" role="group" aria-label="Employer">
        {candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`hr-btn hr-btn--sm${candidate.id === employerId ? ' is-on' : ''}`}
            aria-pressed={candidate.id === employerId}
            onClick={() => setEmployerId(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
      </div>
    ) : null;
  return { row, picker };
}

function SaveButtons({ pending, finishes, onSave, may }: { pending: boolean; finishes: boolean; onSave: (advance: boolean) => void; may: boolean }) {
  return (
    <StepFoot>
      {may ? (
        <>
          <button type="button" className="hr-btn" disabled={pending} onClick={() => onSave(false)}>
            Save for later
          </button>
          <button type="button" className="hr-btn hr-btn--primary" disabled={pending} onClick={() => onSave(true)}>
            {finishes ? 'Save & finish setup' : 'Save & next'}
          </button>
        </>
      ) : (
        <span className="hr-sub">Only somebody who manages company settings can change these.</span>
      )}
    </StepFoot>
  );
}

function WizField({ label, children, help, ok, wide }: { label: string; children: ReactNode; help?: ReactNode; ok?: boolean; wide?: boolean }) {
  return (
    <label className={`hr-wizField${wide ? ' hr-wizField--wide' : ''}`}>
      <span className="hr-wizField__label">{label}</span>
      {children}
      {ok ? <small className="hr-wizField__ok">✓ On file</small> : help ? <small className="hr-wizField__help">{help}</small> : null}
    </label>
  );
}

/** Step 1: the employer's numbers, its HRD Corp class and levy base, and zakat. */
function CompanyStep({ employers, finishes, onSaved }: StepProps) {
  const { message } = App.useApp();
  const upsert = useUpsertLegalEmployer();
  const recordHrd = useRecordEmployerHrd();
  const mayManage = useCan('hr.statutory.manage');
  const { row, picker } = useEmployerChoice(employers, (candidate) => (candidate.statutoryReadiness?.missing ?? []).some((item) => item !== 'Bank account for payment'));
  const [form, setForm] = useState<Record<string, string>>({});
  // The PSMB Act's base, basic plus allowances, unless the clinic chooses otherwise.
  const [levyBase, setLevyBase] = useState<LegalEmployerRow['hrdLevyBase']>('BASIC_PLUS_FIXED_ALLOWANCES');
  const [hrdClass, setHrdClass] = useState<string | null>(null);
  const [hrdFrom, setHrdFrom] = useState(dayjs().startOf('year').format('YYYY-MM-DD'));
  const [zakat, setZakat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: row?.name ?? '',
      registrationNo: row?.registrationNo ?? '',
      epfEmployerNo: row?.epfEmployerNo ?? '',
      socsoEmployerNo: row?.socsoEmployerNo ?? '',
      lhdnEmployerNo: row?.lhdnEmployerNo ?? '',
      phone: row?.phone ?? '',
      addressLine1: row?.addressLine1 ?? '',
      addressLine2: row?.addressLine2 ?? '',
      postcode: row?.postcode ?? '',
      city: row?.city ?? '',
      state: row?.state ?? '',
      eaSignerName: row?.eaSignerName ?? '',
      eaSignerPosition: row?.eaSignerPosition ?? '',
    });
    setLevyBase(row?.hrdLevyBase ?? 'BASIC_PLUS_FIXED_ALLOWANCES');
    setHrdClass(row?.hrdRegistration ?? null);
    setZakat(row?.zakatThroughPayroll ?? false);
    setError(null);
  }, [row]);

  // The postcode fills the town and state when they are blank.
  const postcode = form.postcode;
  useEffect(() => {
    let live = true;
    void placeOfPostcode(postcode).then((place) => {
      if (!live || !place) return;
      setForm((f) => ({ ...f, city: f.city || place.town, state: f.state || place.state }));
    });
    return () => {
      live = false;
    };
  }, [postcode]);

  const save = async (advance: boolean) => {
    setError(null);
    if (!form.name?.trim()) {
      setError('The company needs its registered name.');
      return;
    }
    try {
      const saved = (await upsert.mutateAsync(employerSaveBody(row, form, { hrdLevyBase: levyBase, zakatThroughPayroll: zakat }))) as { id?: string } | undefined;
      const employerId = row?.id ?? saved?.id;
      // The class is a dated record of its own; recorded only when it changes.
      if (employerId && hrdClass && hrdClass !== row?.hrdRegistration) {
        await recordHrd.mutateAsync({ legalEmployerId: employerId, effectiveFrom: hrdFrom, hrdRegistration: hrdClass, reason: 'Recorded during payroll setup' });
      }
      message.success('Saved.');
      if (advance) onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
    }
  };

  const field = (key: string, label: string, placeholder: string, needed?: string, wide?: boolean) => {
    const value = form[key] ?? '';
    const onFile = Boolean(row && (row as unknown as Record<string, unknown>)[key]);
    return (
      <WizField label={label} wide={wide} ok={needed ? onFile : false} help={needed}>
        <Input
          value={value}
          placeholder={placeholder}
          disabled={!mayManage}
          status={needed && value.trim() === '' ? 'warning' : undefined}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      </WizField>
    );
  };

  return (
    <>
      <ProblemNotice problem={error} />
      {picker}
      <div className="hr-wizForm">
        {field('name', 'Company name', 'Registered name, as on the SSM certificate', undefined, true)}
        {field('registrationNo', 'Company registration no.', 'e.g. 202001012345', 'Printed on payslips')}
        {field('epfEmployerNo', 'EPF employer no.', 'e.g. 012345678', 'Needed for the KWSP listing')}
        {field('socsoEmployerNo', 'SOCSO employer code', 'e.g. A3100012345X', 'Needed for the PERKESO listing')}
        {field('lhdnEmployerNo', 'LHDN employer no. (E)', 'e.g. E 1234567890', 'Needed for the PCB listing')}
        {field('phone', 'Company phone', 'e.g. 03-1234 5678', 'Printed on payslips')}
        {field('addressLine1', 'Address', 'Street and number', 'Printed on payslips and the EA form', true)}
        {field('addressLine2', 'Address (line 2)', 'Optional', undefined, true)}
        {field('postcode', 'Postcode', 'e.g. 43000')}
        {field('city', 'Town', 'Filled from the postcode')}
        <WizField label="State">
          <Select showSearch value={form.state || undefined} placeholder="Choose the state" disabled={!mayManage} options={stateOptions} onChange={(value) => setForm((f) => ({ ...f, state: value }))} />
        </WizField>
        {field('eaSignerName', 'EA form signed by', 'Name of the officer who signs Borang EA', 'Printed on each EA form')}
        {field('eaSignerPosition', 'Their position', 'e.g. Pengarah')}
        <WizField label="HRD Corp registration" ok={Boolean(row?.hrdRegistration) && hrdClass === row?.hrdRegistration} help="Decides the HRD levy. “Not registered” is an answer too.">
          <Select
            value={hrdClass ?? undefined}
            placeholder="Choose one"
            disabled={!mayManage}
            options={HRD_CLASSES}
            popupMatchSelectWidth={false}
            status={hrdClass ? undefined : 'warning'}
            onChange={setHrdClass}
          />
        </WizField>
        {hrdClass && hrdClass !== row?.hrdRegistration ? (
          <WizField label="Since" help="The date this registration took effect.">
            <Input type="date" value={hrdFrom} disabled={!mayManage} onChange={(e) => setHrdFrom(e.target.value)} />
          </WizField>
        ) : null}
      </div>

      {/* The logo on payslips (new-clinic UAT, 15 October 2026); without one the payslip prints the company's initials. */}
      {row ? (
        <div className="hr-wizBox">
          <div>
            <div className="hr-wizBox__title">Logo on payslips</div>
            <EmployerLogoField key={row.id} employerId={row.id} employerName={row.name} logoMediaId={row.logoMediaId ?? null} mayManage={mayManage} />
          </div>
        </div>
      ) : null}

      <div className="hr-wizBox">
        <div>
          <div className="hr-wizBox__title">
            <Switch size="small" checked={zakat} onChange={setZakat} disabled={!mayManage} aria-label="Deduct zakat through payroll" /> Zakat through payroll
          </div>
          <div className="hr-sub">{zakat ? 'On: each person’s zakat comes off their pay' : 'Off: staff pay zakat themselves'}</div>
        </div>
        {hrdClass !== 'NOT_REGISTERED' ? (
          <div>
            <div className="hr-wizBox__title">HRD levy worked out on</div>
            <div className="hr-wizChoice" role="radiogroup" aria-label="HRD levy base">
              {(
                [
                  ['BASIC_PLUS_FIXED_ALLOWANCES', 'Basic + allowances (PSMB Act)'],
                  ['BASIC_ONLY', 'Basic salary only'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={levyBase === value}
                  disabled={!mayManage}
                  className={`hr-btn hr-btn--sm${levyBase === value ? ' is-on' : ''}`}
                  onClick={() => setLevyBase(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <SaveButtons may={mayManage} pending={upsert.isPending || recordHrd.isPending} finishes={finishes} onSave={(advance) => void save(advance)} />
    </>
  );
}

/** Step 2: the account salaries are paid from. The number is write-only and never shown back. */
function BankStep({ employers, finishes, onSaved }: StepProps) {
  const { message } = App.useApp();
  const upsert = useUpsertLegalEmployer();
  const mayManage = useCan('hr.statutory.manage');
  const { row, picker } = useEmployerChoice(employers, (candidate) => !candidate.bankAccountOnFile);
  const [bankName, setBankName] = useState<string | undefined>(undefined);
  const [accountName, setAccountName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBankName(row?.bankName ?? undefined);
    setAccountName(row?.bankAccountName ?? row?.name ?? '');
    setAccountNo('');
    setError(null);
  }, [row]);

  if (!row) {
    return <p className="hr-sub">Add the company first, in step 1.</p>;
  }

  const save = async (advance: boolean) => {
    setError(null);
    if (!row.bankAccountOnFile && !accountNo.trim()) {
      setError('Type the account number.');
      return;
    }
    try {
      const body = employerSaveBody(row, { bankName: bankName ?? '', bankAccountName: accountName }, { hrdLevyBase: row.hrdLevyBase, zakatThroughPayroll: row.zakatThroughPayroll });
      if (accountNo.trim()) body.bankAccountNo = accountNo.replace(/[\s-]/g, '');
      await upsert.mutateAsync(body);
      message.success('Saved.');
      if (advance) onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
    }
  };

  return (
    <>
      <ProblemNotice problem={error} />
      {picker}
      <div className="hr-wizForm">
        <WizField label="Bank">
          <Select showSearch value={bankName} placeholder="Choose the bank" disabled={!mayManage} options={bankOptions} onChange={setBankName} />
        </WizField>
        <WizField label="Account name">
          <Input value={accountName} disabled={!mayManage} onChange={(e) => setAccountName(e.target.value)} />
        </WizField>
        <WizField
          label="Account number"
          help={row.bankAccountOnFile ? `On file, ending ${row.bankAccountLastFour ?? '••••'}. Type a new one only to change it.` : 'Kept private: only the last four digits are shown again.'}
        >
          <Input value={accountNo} inputMode="numeric" placeholder={row.bankAccountOnFile ? 'Leave blank to keep it' : 'e.g. 512345678901'} disabled={!mayManage} onChange={(e) => setAccountNo(e.target.value)} />
        </WizField>
      </div>
      <SaveButtons may={mayManage} pending={upsert.isPending} finishes={finishes} onSave={(advance) => void save(advance)} />
    </>
  );
}

/** Step 5: this year's federal and state holidays for the clinic's state, ticked before they are added. */
function HolidaysStep({ employers, finishes, onSaved, done }: StepProps & { done: boolean }) {
  const { message } = App.useApp();
  const mayManage = useCan('settings.manage');
  const year = dayjs().year();
  // The state chosen last time holidays were added, else the employer's.
  const remembered = useGlobalSetting<{ state: string }>('hr.holidayState');
  const [state, setState] = useState<string | null>(stateOf(employersToSetUp(employers)[0]?.state));
  const rememberedState = remembered.data?.state ?? null;
  useEffect(() => {
    if (rememberedState) setState(rememberedState);
  }, [rememberedState]);
  const presets = useHolidayPresets(year, state);
  const load = useLoadHolidayPresets();
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const rows = presets.data?.holidays ?? [];
  const toAdd = rows.filter((row) => !row.onCalendar && !unticked.has(row.date));

  const add = async () => {
    setError(null);
    if (!state) return;
    try {
      const result = await load.mutateAsync({ year, state, dates: toAdd.map((row) => row.date) });
      message.success(`${result.added} ${result.added === 1 ? 'holiday' : 'holidays'} added.`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The holidays were not added. Try again.');
    }
  };

  return (
    <>
      <ProblemNotice problem={error} />
      <div className="hr-wizForm">
        <WizField label="Clinic’s state" help="Each state has its own holidays on top of the federal ones.">
          <Select showSearch value={state ?? undefined} placeholder="Choose the state" options={stateOptions} onChange={(value) => { setState(value); setUnticked(new Set()); }} />
        </WizField>
      </div>
      {state && presets.data && !presets.data.available ? <p className="hr-sub">Kuwick has no list for {year} yet. Add the holidays on the Public holidays page.</p> : null}
      {rows.length > 0 ? (
        <>
          <p className="hr-sub">
            Untick any day the clinic does not observe. Dates marked “check” can move (moon sighting or state announcement): confirm them against the official list. A holiday that falls on the weekly rest day brings its replacement day (cuti ganti), also marked “check”.
          </p>
          <ul className="hr-holidayList">
            {rows.map((row) => (
              <li key={row.date}>
                <Checkbox
                  checked={row.onCalendar || !unticked.has(row.date)}
                  disabled={row.onCalendar || !mayManage}
                  onChange={(e) =>
                    setUnticked((current) => {
                      const nextSet = new Set(current);
                      if (e.target.checked) nextSet.delete(row.date);
                      else nextSet.add(row.date);
                      return nextSet;
                    })
                  }
                >
                  <span className="hr-num">{dayjs(row.date).format('ddd D MMM')}</span> {row.name}
                  {row.onCalendar ? <span className="hr-faint"> · already on the calendar</span> : null}
                  {row.check ? <StatusChip tone="attn">check</StatusChip> : null}
                </Checkbox>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <StepFoot>
        <Link className="hr-btn" to={fromSetup('/admin/hr/settings/public-holidays')}>
          Edit the calendar
        </Link>
        {mayManage && toAdd.length > 0 ? (
          <button type="button" className="hr-btn hr-btn--primary" disabled={load.isPending} onClick={() => void add()}>
            {`Add ${toAdd.length} ${toAdd.length === 1 ? 'holiday' : 'holidays'} · ${finishes ? 'finish setup' : 'next'}`}
          </button>
        ) : done ? (
          <button type="button" className="hr-btn hr-btn--primary" onClick={onSaved}>
            {finishes ? 'Finish setup' : 'Next'}
          </button>
        ) : null}
      </StepFoot>
    </>
  );
}

/** Step 6: one question. Earlier months matter because monthly tax counts the whole year. */
function OpeningStep({ finishes, onSaved }: { finishes: boolean; onSaved: () => void }) {
  const set = useSetGlobalSetting<OpeningBalancesAnswer>(OPENING_BALANCES_SETTING);
  const mayManage = useCan('hr.payroll.run');
  const [answer, setAnswer] = useState<'NONE' | 'IMPORTED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const year = dayjs().year();
  const save = async () => {
    if (!answer) return;
    setError(null);
    try {
      await set.mutateAsync({ answer, year });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The answer was not saved. Try again.');
    }
  };
  return (
    <>
      <ProblemNotice problem={error} />
      <div className="hr-wizChoice" role="radiogroup" aria-label="Payroll earlier this year">
        <button type="button" role="radio" aria-checked={answer === 'NONE'} className={`hr-btn${answer === 'NONE' ? ' is-on' : ''}`} onClick={() => setAnswer('NONE')}>
          No, Kuwick is our first payroll this year
        </button>
        <button type="button" role="radio" aria-checked={answer === 'IMPORTED'} className={`hr-btn${answer === 'IMPORTED' ? ' is-on' : ''}`} onClick={() => setAnswer('IMPORTED')}>
          Yes, we paid staff in another system
        </button>
      </div>
      {answer === 'IMPORTED' ? (
        <p className="hr-sub">
          Bring in what each person was paid this year so far (pay, EPF, SOCSO, EIS and tax), so their tax and year-end EA form are right.{' '}
          <Link className="hr-link" to={fromSetup('/admin/hr/settings/opening-balances')}>
            Open Opening balances
          </Link>
        </p>
      ) : null}
      <StepFoot>
        {mayManage ? (
          <button type="button" className="hr-btn hr-btn--primary" disabled={!answer || set.isPending} onClick={() => void save()}>
            {answer === 'IMPORTED' ? 'I’ve brought them in' : 'Save'} · {finishes ? 'finish setup' : 'next'}
          </button>
        ) : (
          <span className="hr-sub">The person who runs payroll answers this.</span>
        )}
      </StepFoot>
    </>
  );
}

/** Step 8: which official tables Kuwick uses, and an acknowledgement that they were seen. */
function RatesStep({ facts, finishes, onSaved }: { facts: { label: string; value: ReactNode }[]; finishes: boolean; onSaved: () => void }) {
  const { message } = App.useApp();
  const mark = useMarkStatutoryChecked();
  const mayApprove = useCan('hr.payroll.approve');
  const [error, setError] = useState<string | null>(null);
  const acknowledge = async () => {
    setError(null);
    try {
      await mark.mutateAsync(undefined);
      message.success(`Acknowledged on ${dayjs().format('D MMM YYYY')}.`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
    }
  };
  return (
    <>
      <ProblemNotice problem={error} />
      <div className="hr-facts">
        {facts.map((fact) => (
          <div key={fact.label} className="hr-facts__row">
            <span>{fact.label}</span>
            <b>{fact.value}</b>
          </div>
        ))}
      </div>
      <p className="hr-sub">Kuwick keeps these tables up to date. When a new edition comes into force, you will be asked to acknowledge it again.</p>
      <StepFoot>
        <Link className="hr-btn" to={fromSetup('/admin/hr/settings/statutory')}>
          See the tables
        </Link>
        {mayApprove ? (
          <button type="button" className="hr-btn hr-btn--primary" disabled={mark.isPending} onClick={() => void acknowledge()}>
            {finishes ? 'Acknowledge · finish setup' : 'Acknowledge · next'}
          </button>
        ) : (
          <span className="hr-sub">The person who approves payroll acknowledges these.</span>
        )}
      </StepFoot>
    </>
  );
}

/**
 * THE FIRST THING TO DO, INSIDE THE WIZARD (new-clinic UAT #2, items 57/68).
 * Step 4 adds Kuwick's default items here; step 7 opens Add employee with the
 * steps still pinned beside it.
 */
function AddDefaultItems() {
  const { message } = App.useApp();
  const seed = useSeedPayComponents();
  const mayManage = useCan('hr.statutory.manage');
  if (!mayManage) return <span className="hr-sub">The person who manages company settings adds the items.</span>;
  return (
    <button
      type="button"
      className="hr-btn hr-btn--primary"
      disabled={seed.isPending}
      onClick={() =>
        seed.mutate(
          { baseOnly: true },
          {
            onSuccess: () => message.success('Default items added. Open Payroll items to check what each one counts towards.'),
            onError: (e: Error) => message.error(e.message),
          },
        )
      }
    >
      Add default items
    </button>
  );
}

function AddFirstEmployee() {
  const mayManage = useCan('hr.employee.manage');
  if (!mayManage) return null;
  return (
    <Link className="hr-btn hr-btn--primary" to={fromSetup('/admin/hr/employees/new')}>
      Add your first employee
    </Link>
  );
}

/** Steps settled on their own pages. The card says where things stand and opens the page. */
function FactStep({
  page,
  facts,
  finishes,
  canMoveOn,
  onNext,
  first,
}: {
  page: { to: string; label: string };
  facts: { label: string; value: ReactNode }[];
  finishes: boolean;
  canMoveOn: boolean;
  onNext: () => void;
  /** The step's own first action, drawn before the page link. */
  first?: ReactNode;
}) {
  return (
    <>
      <div className="hr-facts">
        {facts.map((fact) => (
          <div key={fact.label} className="hr-facts__row">
            <span>{fact.label}</span>
            <b>{fact.value}</b>
          </div>
        ))}
      </div>
      <StepFoot>
        {first}
        <Link className={`hr-btn${!canMoveOn && !first ? ' hr-btn--primary' : ''}`} to={fromSetup(page.to)}>
          {page.label}
        </Link>
        {canMoveOn ? (
          <button type="button" className={`hr-btn${first ? '' : ' hr-btn--primary'}`} onClick={onNext}>
            {finishes ? 'Finish setup' : 'Next'}
          </button>
        ) : null}
      </StepFoot>
    </>
  );
}
