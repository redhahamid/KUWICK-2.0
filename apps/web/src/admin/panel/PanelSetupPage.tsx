import { useMemo, useState } from 'react';
import { App, Button, Checkbox, Input, InputNumber, Select, Table } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../core/api-client';
import { useCreatePanels, usePanelSetupStatus } from '../hooks/useAdmin';
import type { PanelFeeTreatment, PanelSetupDraft, PanelType } from '../types';
import { PANEL_TYPE_LABEL } from '../types';
import { HrPage, Panel, PanelHead, Steps, type Step } from '../hr/ui';
import { IconCompany, IconList, IconSliders } from '../hr/ui/icons';

/**
 * SETTING UP THE PANEL MODULE (N-2).
 *
 * A clinic with no panels lands on a blank claim workspace: nothing on the
 * screen, and no sign that the first step is somewhere else. HR has
 * `PayrollStartGate` for exactly this; Panel had nothing.
 *
 * THE RULE THIS SCREEN IS BUILT ON: every step is skippable, and skipping one
 * records that it was not answered rather than filling in a plausible value.
 * A clinic that answers only "these are my panels" gets working panels — with
 * no payment term and no fee rule, both of which the configuration screen
 * already counts and chases. The alternative is a wizard that will not save
 * until a term is typed, which is answered with a guess, and a guessed term
 * decides when a claim is called overdue and chased from a panel that is not
 * late.
 *
 * PLAIN LANGUAGE, because the person doing this owns a clinic and has never
 * read the schema. "Administrator (TPA)" rather than `TPA`; "They keep their
 * fee out of what they pay us" rather than `WITHHELD_FROM_CLAIM`.
 */

/** The fee question, in the words a clinic owner would use. */
const FEE_CHOICES: { value: string; label: string; sub: string }[] = [
  { value: 'NONE', label: 'No fee', sub: 'They pay the full claim.' },
  {
    value: 'PER_CLAIM',
    label: 'A fixed amount per claim',
    sub: 'For example RM8 on every claim, whatever it is worth.',
  },
  {
    value: 'PERCENT',
    label: 'A percentage of the claim',
    sub: 'For example 10% of what we claim.',
  },
  {
    value: 'UNKNOWN',
    label: "I'm not sure yet",
    sub: 'Recorded as not established. Every figure on this panel will leave the fee out and say so, rather than guessing which way it goes.',
  },
];

interface Row extends PanelSetupDraft {
  /** The key the table and the checkbox list use. Names are unique per run,
      which the server also enforces, so the name is the key. */
  key: string;
}

export function PanelSetupPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const status = usePanelSetupStatus();
  const create = useCreatePanels();

  const [step, setStep] = useState('panels');
  const [chosen, setChosen] = useState<string[]>([]);
  const [own, setOwn] = useState<string[]>([]);
  const [ownDraft, setOwnDraft] = useState('');

  // The answers from steps 2 and 3, applied to every panel and then editable
  // per panel on the review step — because panels genuinely differ, and asking
  // the same two questions twenty times would not be answered honestly.
  const [termDays, setTermDays] = useState<number | null>(null);
  const [termUnit, setTermUnit] = useState<'CALENDAR_DAYS' | 'WORKING_DAYS'>('CALENDAR_DAYS');
  const [feeChoice, setFeeChoice] = useState('UNKNOWN');
  const [feeValue, setFeeValue] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<PanelSetupDraft>>>({});

  const suggestions = status.data?.suggestions ?? [];
  const byName = useMemo(
    () => new Map(suggestions.map((row) => [row.name, row])),
    [suggestions],
  );

  /** The fee answer, turned into the three fields the API takes. */
  const feeFields = (): Partial<PanelSetupDraft> => {
    if (feeChoice === 'NONE') return { feeTreatment: 'NO_FEE' as PanelFeeTreatment };
    if (feeChoice === 'UNKNOWN') return { feeTreatment: 'UNCONFIGURED' as PanelFeeTreatment };
    return {
      // The standing rule from the owner's decision of 31 August 2026, taken
      // on the clinic's own workbook and 2,615 bank credits: a panel's fee is
      // WITHHELD from what it pays, not added to the bill.
      feeTreatment: 'WITHHELD_FROM_CLAIM' as PanelFeeTreatment,
      claimFeeType: feeChoice === 'PERCENT' ? 'PERCENT' : 'AMOUNT',
      claimFeeValue: feeValue ?? undefined,
    };
  };

  const rows: Row[] = useMemo(() => {
    const base = [...chosen, ...own];
    return base.map((name) => {
      const suggestion = byName.get(name);
      return {
        key: name,
        name,
        panelType: suggestion?.panelType ?? undefined,
        portalUrl: suggestion?.portalUrl ?? undefined,
        ...(termDays === null ? {} : { paymentTermDays: termDays, paymentTermUnit: termUnit }),
        ...feeFields(),
        ...edits[name],
      } as Row;
    });
    // `feeFields` reads the fee state, so the fee state is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, own, byName, termDays, termUnit, feeChoice, feeValue, edits]);

  const addOwn = () => {
    const name = ownDraft.trim();
    if (!name) return;
    const already = [...chosen, ...own].some(
      (existing) => existing.trim().toLowerCase() === name.toLowerCase(),
    );
    if (already) {
      message.warning(`${name} is already on the list.`);
      return;
    }
    setOwn([...own, name]);
    setOwnDraft('');
  };

  const save = () => {
    if (rows.length === 0) {
      message.warning('Choose at least one panel first.');
      return;
    }
    create.mutate(
      { panels: rows.map(({ key: _key, ...panel }) => panel) },
      {
        onSuccess: (result: unknown) => {
          const done = result as { created: unknown[]; withoutTerm: number; feeUnsettled: number };
          // Never "done" when two panels have no term. The wizard says what is
          // still open, because the figures on those panels cannot be relied
          // on until somebody answers.
          const open: string[] = [];
          if (done.withoutTerm > 0) open.push(`${done.withoutTerm} with no payment term`);
          if (done.feeUnsettled > 0) open.push(`${done.feeUnsettled} with no fee rule`);
          message.success(
            open.length > 0
              ? `${done.created.length} panel(s) added — ${open.join(', ')}. Finish those in Panel configuration.`
              : `${done.created.length} panel(s) added.`,
          );
          navigate('/admin/panel/configuration');
        },
        onError: (error: Error) =>
          message.error(error instanceof ApiError ? error.message : 'Could not add those panels'),
      },
    );
  };

  const steps: Step[] = [
    { key: 'panels', label: 'Your panels', sub: 'Who you claim from', done: rows.length > 0 },
    {
      key: 'term',
      label: 'How long they take to pay',
      sub: termDays === null ? 'Not answered' : `${termDays} days`,
      done: termDays !== null,
    },
    {
      key: 'fee',
      label: 'What they charge you',
      sub: FEE_CHOICES.find((choice) => choice.value === feeChoice)?.label,
      done: feeChoice !== 'UNKNOWN',
    },
    { key: 'review', label: 'Check and finish', done: false },
  ];

  const feeLabel = (row: Row) => {
    if (row.feeTreatment === 'NO_FEE') return 'No fee';
    if (row.feeTreatment === 'UNCONFIGURED' || row.claimFeeValue === undefined) return 'Not established';
    return row.claimFeeType === 'PERCENT' ? `${row.claimFeeValue}% per claim` : `RM${row.claimFeeValue} per claim`;
  };

  const termLabel = (row: Row) => {
    if (row.paymentTermDays === undefined) return 'Not answered';
    const unit = row.paymentTermUnit === 'WORKING_DAYS' ? 'working days' : 'days';
    return `${row.paymentTermDays} ${unit}`;
  };

  return (
    <HrPage
      title="Set up your panels"
      sub="Four short questions. You can skip any of them and come back — nothing here is guessed on your behalf."
      helpTo={null}
      error={status.isError ? 'Could not load your panels. Nothing has been changed.' : null}
    >
      <Panel>
        <Steps steps={steps} current={step} onSelect={setStep} />

        {step === 'panels' ? (
          <div style={{ padding: '18px 20px' }}>
            <PanelHead
              icon={<IconCompany />}
              tone="teal"
              title="Which panels do you claim from?"
              sub="Tick the ones you have an agreement with. Anything missing, add it below — this list is only a starting point."
            />
            {suggestions.length === 0 ? (
              <div className="kw-muted" style={{ marginBottom: 12 }}>
                Nothing to suggest, so add your panels by name below.
              </div>
            ) : (
              <Checkbox.Group
                value={chosen}
                onChange={(value) => setChosen(value as string[])}
                style={{ display: 'grid', gap: 8 }}
              >
                {suggestions.map((row) => (
                  <Checkbox key={row.name} value={row.name}>
                    {row.name}
                    {row.panelType ? (
                      <span className="kw-muted"> · {PANEL_TYPE_LABEL[row.panelType]}</span>
                    ) : null}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, maxWidth: 420 }}>
              <Input
                placeholder="A panel of your own — a company you bill direct, say"
                value={ownDraft}
                onChange={(event) => setOwnDraft(event.target.value)}
                onPressEnter={addOwn}
              />
              <Button onClick={addOwn}>Add</Button>
            </div>
            {own.length > 0 ? (
              <div className="kw-muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Yours: {own.join(', ')}
              </div>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <Button type="primary" onClick={() => setStep('term')} disabled={rows.length === 0}>
                Next
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'term' ? (
          <div style={{ padding: '18px 20px' }}>
            <PanelHead
              icon={<IconList />}
              tone="indigo"
              title="How long do they take to pay?"
              sub="This is what decides when a claim is shown as late. Leave it blank if you do not know — a claim on a panel with no term is never called overdue, which is better than chasing a panel that is not."
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <InputNumber
                min={0}
                max={400}
                value={termDays}
                onChange={setTermDays}
                placeholder="30"
                style={{ width: 120 }}
                aria-label="Days to pay"
              />
              <Select
                value={termUnit}
                onChange={setTermUnit}
                style={{ width: 230 }}
                aria-label="Kind of days"
                options={[
                  { value: 'CALENDAR_DAYS', label: 'Calendar days' },
                  { value: 'WORKING_DAYS', label: 'Working days (Mon–Fri)' },
                ]}
              />
              <span className="kw-muted" style={{ fontSize: 12.5 }}>
                from the day we send the claim
              </span>
            </div>
            <div className="kw-muted" style={{ fontSize: 12, marginTop: 8, maxWidth: 620 }}>
              Panels whose term is a range, or counted from the invoice date instead, are set up the
              same way afterwards in Panel configuration. This asks the one question most panels
              answer.
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
              <Button onClick={() => setStep('panels')}>Back</Button>
              <Button type="primary" onClick={() => setStep('fee')}>
                Next
              </Button>
              <Button type="link" onClick={() => setStep('fee')}>
                Skip — I&rsquo;ll find out
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'fee' ? (
          <div style={{ padding: '18px 20px' }}>
            <PanelHead
              icon={<IconSliders />}
              tone="violet"
              title="Do they charge you a fee?"
              sub="Most panels that charge one keep it out of what they pay, so a RM100 claim banks RM92. That is how Kuwick will treat it."
            />
            <Select
              style={{ width: '100%', maxWidth: 560 }}
              value={feeChoice}
              onChange={setFeeChoice}
              aria-label="Fee"
              options={FEE_CHOICES.map((choice) => ({
                value: choice.value,
                label: `${choice.label} — ${choice.sub}`,
              }))}
            />
            {feeChoice === 'PER_CLAIM' || feeChoice === 'PERCENT' ? (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5 }}>{feeChoice === 'PERCENT' ? 'Percent' : 'Ringgit'}</span>
                <InputNumber
                  min={0}
                  value={feeValue}
                  onChange={setFeeValue}
                  style={{ width: 140 }}
                  aria-label="Fee amount"
                />
              </div>
            ) : null}
            <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
              <Button onClick={() => setStep('term')}>Back</Button>
              <Button type="primary" onClick={() => setStep('review')}>
                Next
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'review' ? (
          <div style={{ padding: '18px 20px' }}>
            <PanelHead
              title="Check this, then finish"
              sub="One row per panel. Panels differ, so change any row that is not right — the answers above were applied to all of them."
            />
            <Table<Row>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={rows}
              columns={[
                { title: 'Panel', dataIndex: 'name' },
                {
                  title: 'Kind',
                  dataIndex: 'panelType',
                  render: (value: PanelType | undefined) =>
                    value ? PANEL_TYPE_LABEL[value] : <span className="kw-muted">not said</span>,
                },
                {
                  title: 'Pays within',
                  render: (_: unknown, row: Row) => (
                    <InputNumber
                      size="small"
                      min={0}
                      max={400}
                      value={row.paymentTermDays ?? null}
                      placeholder={termLabel(row)}
                      aria-label={`Days to pay — ${row.name}`}
                      onChange={(value) =>
                        setEdits({
                          ...edits,
                          [row.name]: {
                            ...edits[row.name],
                            paymentTermDays: value ?? undefined,
                            paymentTermUnit: termUnit,
                          },
                        })
                      }
                      style={{ width: 90 }}
                    />
                  ),
                },
                { title: 'Their fee', render: (_: unknown, row: Row) => feeLabel(row) },
              ]}
            />
            <div className="kw-muted" style={{ fontSize: 12, marginTop: 10, maxWidth: 640 }}>
              Anything left unanswered is saved as unanswered, not as a default. Panel
              configuration will list those panels and ask you again.
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
              <Button onClick={() => setStep('fee')}>Back</Button>
              <Button type="primary" loading={create.isPending} onClick={save}>
                Add {rows.length} panel{rows.length === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
    </HrPage>
  );
}
