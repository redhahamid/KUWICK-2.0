import { useEffect, useState, type ReactNode } from 'react';
import { App, Input, Switch } from 'antd';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { useMarkStatutoryChecked, useUpsertLegalEmployer } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import { HrPage, ProblemNotice, StatusChip } from './ui';
import type { LegalEmployerRow } from '../types';

export type SetupStepKey = 'company' | 'payRules' | 'items' | 'employees' | 'rates';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** One short line under the title in the step list: a fact when done, what is missing when not. */
  summary: string;
  /** One sentence under the step's heading. */
  intro: string;
}

/** The HRD class as the Act names it. Recorded with a date on the Company page, never here. */
const HRD_CLASS: Record<string, string> = {
  MANDATORY_SECTION_14: 'Mandatory · s.14',
  OPTIONAL_SECTION_15: 'Optional · s.15',
  NOT_REGISTERED: 'Not registered',
};

/**
 * A SAVE THAT KEEPS WHAT IT DOES NOT SHOW.
 *
 * The employer endpoint writes every field it is sent and blanks every field
 * it is not, so the wizard's four numbers go up with everything else already
 * on file. The bank account number is never sent: it is write-only, and
 * absent means "leave it alone". A blank box is left out rather than sent as
 * '', which the endpoint refuses for the number fields.
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
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        postcode: row.postcode,
        city: row.city,
        state: row.state,
        bankName: row.bankName,
        bankAccountName: row.bankAccountName,
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

/**
 * SETTINGS WHILE SETUP IS INCOMPLETE (docs/hr-mockup/SetupWizard.html).
 *
 * Only the steps. The left list says where each one stands; the right card
 * is the one step open, with its form or what it needs, and one button that
 * saves and moves on. Every other setting waits until these are done.
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
  facts: Record<Exclude<SetupStepKey, 'company'>, { label: string; value: ReactNode }[]>;
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
      onFinished();
      return;
    }
    // The next step still to do, after this one; else the first one still to do.
    const after = steps.slice(index + 1).find((row) => !row.done) ?? left[0];
    onOpen(after.key);
  };

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
            Five steps, once. Payroll can&apos;t go live until they&apos;re done.{' '}
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
            {done === steps.length ? 'Payroll can go live' : "Payroll can't go live until they're done"}
          </span>
        </div>
      }
    >
      <div className="hr-wiz">
        <nav aria-label="Setup steps" className="hr-wiz__steps">
          {steps.map((row, i) => (
            <button
              key={row.key}
              type="button"
              className={`hr-wizStep${row.key === step.key ? ' is-open' : ''}`}
              aria-current={row.key === step.key ? 'step' : undefined}
              onClick={() => onOpen(row.key)}
            >
              <span className={`hr-wizStep__num${row.key === step.key ? ' is-open' : row.done ? ' is-done' : ''}`}>
                {row.done && row.key !== step.key ? '✓' : i + 1}
              </span>
              <span>
                <span className="hr-wizStep__title">{row.title}</span>
                {row.done ? (
                  <span className="hr-wizStep__sum">{row.summary}</span>
                ) : (
                  <StatusChip tone="attn">{row.summary}</StatusChip>
                )}
              </span>
            </button>
          ))}
          <div className="hr-wiz__later">Optional later: bank payment file</div>
        </nav>

        <section className="hr-wiz__card" aria-labelledby="hr-wiz-title">
          <div className="hr-wiz__count">
            Step {index + 1} of {steps.length}
          </div>
          <h2 id="hr-wiz-title">{step.title}</h2>
          <p className="hr-sub">{step.intro}</p>
          {step.key === 'company' ? (
            <CompanyStep employers={employers} finishes={finishes} onSaved={next} />
          ) : (
            <FactStep
              stepKey={step.key}
              facts={facts[step.key]}
              finishes={finishes}
              // A step settled on another page cannot be finished from here;
              // with nothing else left, the page's own button is the way on.
              canMoveOn={step.done || left.length > 0}
              onNext={next}
            />
          )}
        </section>
      </div>
    </HrPage>
  );
}

function StepFoot({ children }: { children: ReactNode }) {
  return <div className="hr-wiz__foot">{children}</div>;
}

/** Step 1: the employer's numbers, typed here, saved with everything else it already has. */
function CompanyStep({
  employers,
  finishes,
  onSaved,
}: {
  employers: LegalEmployerRow[];
  finishes: boolean;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const upsert = useUpsertLegalEmployer();
  const mayManage = useCan('hr.statutory.manage');
  // The first employer still missing a number, else the first one.
  const first =
    employers.find((row) => (row.employeeCount ?? 0) > 0 && (!row.epfEmployerNo || !row.socsoEmployerNo || !row.lhdnEmployerNo)) ??
    employers[0] ??
    null;
  const [employerId, setEmployerId] = useState<string | null>(first?.id ?? null);
  const row = employers.find((candidate) => candidate.id === employerId) ?? null;
  const [form, setForm] = useState<Record<string, string>>({});
  const [levyBase, setLevyBase] = useState<LegalEmployerRow['hrdLevyBase']>('BASIC_PLUS_FIXED_ALLOWANCES');
  const [zakat, setZakat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: row?.name ?? '',
      registrationNo: row?.registrationNo ?? '',
      epfEmployerNo: row?.epfEmployerNo ?? '',
      socsoEmployerNo: row?.socsoEmployerNo ?? '',
      lhdnEmployerNo: row?.lhdnEmployerNo ?? '',
    });
    setLevyBase(row?.hrdLevyBase ?? 'BASIC_PLUS_FIXED_ALLOWANCES');
    setZakat(row?.zakatThroughPayroll ?? false);
    setError(null);
  }, [row]);

  const save = async (advance: boolean) => {
    setError(null);
    if (!form.name?.trim()) {
      setError('An employer needs a registered name.');
      return;
    }
    try {
      await upsert.mutateAsync(
        employerSaveBody(row, form, {
          hrdLevyBase: levyBase,
          zakatThroughPayroll: zakat,
        }),
      );
      message.success('Saved.');
      if (advance) onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change was not saved. Try again.');
    }
  };

  const field = (key: string, label: string, placeholder: string, missingNote?: string, wide?: boolean) => {
    const value = form[key] ?? '';
    const onFile = Boolean(row && (row as unknown as Record<string, unknown>)[key]);
    return (
      <label className={`hr-wizField${wide ? ' hr-wizField--wide' : ''}`}>
        <span className="hr-wizField__label">{label}</span>
        <Input
          value={value}
          placeholder={placeholder}
          disabled={!mayManage}
          status={missingNote && value.trim() === '' ? 'warning' : undefined}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
        {missingNote ? (
          onFile ? (
            <small className="hr-wizField__ok">✓ On file</small>
          ) : (
            <small className="hr-wizField__help">{missingNote}</small>
          )
        ) : null}
      </label>
    );
  };

  return (
    <>
      <ProblemNotice problem={error} />
      {employers.length > 1 ? (
        <div className="hr-wizChoice" role="group" aria-label="Employer">
          {employers.map((candidate) => (
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
      ) : null}
      <div className="hr-wizForm">
        {field('name', 'Employer name', 'Registered name, as on the SSM certificate', undefined, true)}
        {field('registrationNo', 'Company registration no.', 'e.g. 202001012345')}
        {field('epfEmployerNo', 'EPF employer no.', 'e.g. 012345678', 'Needed for the KWSP listing')}
        {field('socsoEmployerNo', 'SOCSO employer code', 'e.g. A3100012345X', 'Needed for the PERKESO listing')}
        {field('lhdnEmployerNo', 'LHDN employer no. (E)', 'e.g. E 1234567890', 'Needed for the PCB listing')}
        <div className="hr-wizField">
          <span className="hr-wizField__label">HRD Corp registration</span>
          <div>
            <StatusChip tone={row?.hrdRegistration ? 'muted' : 'attn'}>
              {row?.hrdRegistration ? HRD_CLASS[row.hrdRegistration] : 'Not recorded'}
            </StatusChip>
          </div>
          <small className="hr-wizField__help">
            Recorded with the date it takes effect, on{' '}
            <Link className="hr-link" to="/admin/hr/settings/company">
              Company &amp; statutory
            </Link>
            .
          </small>
        </div>
      </div>

      <div className="hr-wizBox">
        <div>
          <div className="hr-wizBox__title">
            <Switch
              size="small"
              checked={zakat}
              onChange={setZakat}
              disabled={!mayManage}
              aria-label="Deduct zakat through payroll"
            />{' '}
            Zakat through payroll
          </div>
          <div className="hr-sub">
            {zakat ? 'On: each person’s zakat item comes off net pay' : 'Off: staff pay zakat themselves'}
          </div>
        </div>
        <div>
          <div className="hr-wizBox__title">HRD levy on</div>
          <div className="hr-wizChoice" role="radiogroup" aria-label="HRD levy base">
            {(
              [
                ['BASIC_PLUS_FIXED_ALLOWANCES', 'Basic + allowances marked HRD'],
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
      </div>

      <StepFoot>
        {mayManage ? (
          <>
            <button type="button" className="hr-btn" disabled={upsert.isPending} onClick={() => void save(false)}>
              Save for later
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={upsert.isPending} onClick={() => void save(true)}>
              {finishes ? 'Save & finish setup' : 'Save & next'}
            </button>
          </>
        ) : (
          <span className="hr-sub">Only somebody who manages statutory settings can change these.</span>
        )}
      </StepFoot>
    </>
  );
}

/** Steps 2–5: settled on their own pages. The card says where things stand and opens the page. */
function FactStep({
  stepKey,
  facts,
  finishes,
  canMoveOn,
  onNext,
}: {
  stepKey: Exclude<SetupStepKey, 'company'>;
  facts: { label: string; value: ReactNode }[];
  finishes: boolean;
  canMoveOn: boolean;
  onNext: () => void;
}) {
  const { message } = App.useApp();
  const mark = useMarkStatutoryChecked();
  const mayApprove = useCan('hr.payroll.approve');
  const [error, setError] = useState<string | null>(null);

  const page: Record<typeof stepKey, { to: string; label: string }> = {
    payRules: { to: '/admin/hr/settings/payroll', label: 'Open Pay rules' },
    items: {
      to: '/admin/hr/settings/payroll-items',
      label: 'Open Payroll items',
    },
    employees: { to: '/admin/hr/employees', label: 'Open the Employees page' },
    rates: { to: '/admin/hr/settings/statutory', label: 'See the tables' },
  };

  const checked = async () => {
    setError(null);
    try {
      await mark.mutateAsync(undefined);
      message.success(`Checked on ${dayjs().format('D MMM YYYY')}.`);
      onNext();
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
      <StepFoot>
        <Link className={`hr-btn${stepKey !== 'rates' && !canMoveOn ? ' hr-btn--primary' : ''}`} to={page[stepKey].to}>
          {page[stepKey].label}
        </Link>
        {stepKey === 'rates' ? (
          mayApprove ? (
            <button type="button" className="hr-btn hr-btn--primary" disabled={mark.isPending} onClick={() => void checked()}>
              {finishes ? 'I’ve checked them · finish setup' : 'I’ve checked them · next'}
            </button>
          ) : (
            <span className="hr-sub">The person who approves payroll records this check.</span>
          )
        ) : canMoveOn ? (
          <button type="button" className="hr-btn hr-btn--primary" onClick={onNext}>
            {finishes ? 'Finish setup' : 'Next'}
          </button>
        ) : null}
      </StepFoot>
    </>
  );
}
