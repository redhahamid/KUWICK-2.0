import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Col, Input, InputNumber, Row, Select, Typography, message } from 'antd';
import {
  KuwickFormSection,
  KuwickModal,
  KuwickModalActionBar,
  KuwickSearchOption,
  KuwickSearchSelect,
} from '../../design-system/kuwick';
import { apiClient, ApiError } from '../../core/api-client';
import { useCreatePrescription } from '../hooks/usePrescriptions';
import { useItemAgeDosages } from '../../inventory/hooks/useItemAgeDosages';
import { useStockLevels } from '../../inventory/hooks/useStock';
import { useLatestObservation } from '../hooks/useVisitObservations';
import { useVisit } from '../hooks/useVisits';
import { DEFAULT_SUPPLY_MODE } from '../medicationSupplyPresentation';
import { CreatePrescriptionDto, DosageCalcMethod, PrescriptionSupplyMode } from '../types';
import { DurationUnit, Item } from '../../inventory/types';
import { useReferenceCatalog } from '../hooks/useReferenceCatalogs';
import {
  computeQuantity,
  consumptionLabel,
  durationInDays,
  frequencyLabel,
  hasStandardPrescription,
  indicationLabel,
  indicationMatches,
  matchCatalogueByText,
  prefillFromStandard,
} from './prescriptionForm';
import { AllergyStrip } from './AllergyStrip';
import { DosageCalculator } from './DosageCalculator';
import { defaultsFromItem, itemOnHand, medicineSearchDetail, stockAdvice } from './prescribing';

const { Text } = Typography;

/**
 * G4.5d5b-1 — prescribing one medication.
 *
 * The previous surface was a 720px drawer holding the whole `MedicationsTab`:
 * the prescribing form, the dosage calculators, copy-previous AND the full
 * current medication list, all at once. Adding one paracetamol meant reading
 * past all of it. This modal holds exactly the medication being added, and the
 * visit's medication list stays where it belongs — behind the modal, in the
 * rail, still visible.
 *
 * Three properties matter more than the layout:
 *
 *   THE NOTE IS NEVER TOUCHED. Opening, closing, saving and Add & Add Another
 *   all leave `['clinical-notes', visitId]` alone. The prescription mutation
 *   invalidates only prescriptions and doctor-phase status (the narrow
 *   invalidation established in D-091), so nothing here can remount the editor
 *   or clobber an unsaved draft — the failure C1 exists to prevent.
 *
 *   THE DOCTOR DOES NOT RE-DECIDE SUPPLY MODE. It is pre-selected to clinic
 *   dispensing, visibly, and submitted explicitly. It is not hidden, because
 *   an invisible default is one nobody checks; it is not asked for, because a
 *   decision taken hundreds of times a day and almost never changed is not a
 *   question.
 *
 *   ADD & ADD ANOTHER CLEARS THE FORM, NOT THE VISIT. A doctor prescribing
 *   four medications should press one button four times, not open a modal four
 *   times. Focus returns to the search field, and the medication just added is
 *   confirmed in a line above it rather than by a dialog that has to be
 *   dismissed.
 */

export interface AddMedicationModalProps {
  open: boolean;
  visitId: string;
  onClose: () => void;
  /** Focused on close — usually the rail's medicine search box. */
  restoreFocusTo?: () => HTMLElement | null;
  /**
   * b1 — the medicine already chosen in the rail's search box.
   *
   * When present the form has NO search field of its own: the drug is the
   * modal's title, with its price and stock beside it. Two search boxes onto
   * one decision is the attachments defect in a different costume — the doctor
   * has already said which medicine, and being asked again invites a second,
   * different answer.
   */
  medicine?: Item;
  /**
   * Called instead of onClose when the doctor chose "Add & Add Another", so the
   * parent can put the cursor back in the rail's search box. The next
   * medication starts by typing, which is the whole point of search-first.
   */
  onAddAnother?: () => void;
}

interface FormState {
  itemId?: string;
  itemLabel?: string;
  amount?: number;
  /**
   * b1 PHASE A — the catalogue choice AND its text, side by side.
   *
   * The id is what the server resolves the patient's Malay label from. The
   * text is kept because the dosage calculator produces free text ("ml") that
   * may match no catalogue entry, and because Flow and Copy Rx write
   * prescriptions without any of these dropdowns. Where an id is present it
   * wins server-side; where it is not, the text stands on its own and the
   * prescription honestly carries no Malay label for it.
   */
  unit?: string;
  doseUnitId?: string;
  frequency: string;
  frequencyId?: string;
  consumptionMethodId?: string;
  /** The course as WRITTEN. Days are computed from it, never typed. */
  durationValue: number;
  durationUnit: DurationUnit;
  quantity: number;
  /**
   * Set the moment a person types in the quantity box, and never cleared while
   * the form is open. Auto-compute stops for good at that point: a doctor who
   * has decided on 20 tablets should not have that overwritten because they
   * then corrected the duration.
   */
  quantityTouched: boolean;
  supplyMode: PrescriptionSupplyMode;
  indication: string;
  indicationId?: string;
  remark: string;
}

const EMPTY: FormState = {
  itemId: undefined,
  itemLabel: undefined,
  amount: undefined,
  unit: undefined,
  doseUnitId: undefined,
  frequency: '',
  frequencyId: undefined,
  consumptionMethodId: undefined,
  durationValue: 5,
  durationUnit: 'DAY',
  quantity: 1,
  quantityTouched: false,
  supplyMode: DEFAULT_SUPPLY_MODE,
  indication: '',
  indicationId: undefined,
  remark: '',
};

export function AddMedicationModal({
  open,
  visitId,
  onClose,
  restoreFocusTo,
  medicine,
  onAddAnother,
}: AddMedicationModalProps) {
  const createPrescription = useCreatePrescription(visitId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  // Bumping this remounts ONLY the search field, which is how focus returns to
  // it after Add & Add Another without remounting anything else.
  const [searchKey, setSearchKey] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  // The full item record, for the dosage calculator's concentration figures.
  const [selectedItem, setSelectedItem] = useState<Item | undefined>();
  const [prefilled, setPrefilled] = useState(false);
  const [calcMethod, setCalcMethod] = useState<DosageCalcMethod>();
  const { data: stockLevels } = useStockLevels();
  const { data: ageBrackets } = useItemAgeDosages(form.itemId);
  const { data: visit } = useVisit(visitId);
  // C0 (D-051) — the calculator seeds from the ATTRIBUTED observation record.
  //
  // `useLatestObservation`, deliberately NOT `useLatestVitals`: the latter
  // falls back to a legacy note's frozen vitals columns, which would make
  // this modal fetch a clinical note. That is the one thing it must never do
  // (C1/D-091), and a convenience fallback is not worth breaking it for. On a
  // pre-split visit the weight is simply typed.
  const { data: vitals } = useLatestObservation(visitId);
  const patientAgeMonths = useMemo(() => {
    const dob = visit?.patient?.dob;
    if (!dob) return null;
    const birth = new Date(dob);
    const now = new Date();
    return (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  }, [visit?.patient?.dob]);

  // b1 PHASE A — the prescribing vocabulary. Active rows only: a frequency the
  // clinic has retired must not be offered on a NEW prescription, which is
  // exactly the distinction Settings' `includeRetired` exists to keep apart.
  const { data: units } = useReferenceCatalog('dosage-units');
  const { data: frequencies } = useReferenceCatalog('frequencies');
  const { data: methods } = useReferenceCatalog('consumption-methods');
  const { data: indications } = useReferenceCatalog('indications');

  const stock = useMemo(
    () => stockAdvice(form.itemId, form.quantity, stockLevels),
    [form.itemId, form.quantity, stockLevels],
  );

  /** The chosen frequency's row — the only place doses-per-day comes from. */
  const chosenFrequency = useMemo(
    () => frequencies?.find((row) => row.id === form.frequencyId),
    [frequencies, form.frequencyId],
  );

  const suggestedQuantity = useMemo(
    () =>
      computeQuantity({
        amount: form.amount,
        timesPerDay: chosenFrequency?.timesPerDay ?? null,
        durationValue: form.durationValue,
        durationUnit: form.durationUnit,
      }),
    [form.amount, form.durationValue, form.durationUnit, chosenFrequency?.timesPerDay],
  );

  // Live recalculation, until somebody types in the quantity box.
  //
  // `null` from `computeQuantity` means "cannot be computed" — PRN and STAT
  // have no doses-per-day — and the box is LEFT ALONE on it. Writing 1 there
  // would put a number nobody decided on a when-required painkiller.
  useEffect(() => {
    if (form.quantityTouched || suggestedQuantity === null) return;
    setForm((current) =>
      current.quantity === suggestedQuantity ? current : { ...current, quantity: suggestedQuantity },
    );
  }, [suggestedQuantity, form.quantityTouched]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setError(null);
    setLastAdded(null);
    setSelectedItem(undefined);
    setPrefilled(false);
    setCalcMethod(undefined);
    prefilledForItemId.current = null;
    // b1 — the medicine came from the rail's search box, so the form opens
    // already filled from the item master rather than asking again. The item
    // is passed in whole, so this needs no request: the row the doctor just
    // read carried the price, the stock and the dosing type.
    if (medicine) applyPickedMedicine(medicine);
    // applyPickedMedicine is stable (useCallback with no deps that change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, medicine?.id]);

  /**
   * Bounded, server-side. The catalogue is never pulled into the browser to be
   * filtered there — `KuwickSearchSelect` debounces and drops stale responses.
   */
  const searchItems = useCallback(async (term: string): Promise<KuwickSearchOption[]> => {
    const items = await apiClient.get<Item[]>(
      `/items?activeOnly=true&take=20&search=${encodeURIComponent(term)}`,
    );
    // b1 — the row says what the clinic needs in order to choose: the clinic's
    // own Malay group, the price, and what is on the shelf. It used to say the
    // strength and nothing else, so "which of these do we have, and what does
    // it cost" meant leaving the consultation to find out.
    return items.map((item) => ({
      value: item.id,
      label: item.code ? `${item.code} — ${item.name}` : item.name,
      detail: medicineSearchDetail(item),
    }));
  }, []);

  /**
   * b1 PHASE A — what this medicine's form opens with.
   *
   * The 1F standard prescription FIRST, because it is the structured one and
   * 226 of the clinic's 236 medicines carry it. `defaultsFromItem` stays as
   * the fallback for the rest: ten medicines have no 1F defaults by design,
   * and for anything imported before the seed the legacy free text is all
   * there is. Neither invents anything — a medicine with no default dose opens
   * with the dose EMPTY, which is the rule the whole seed was built around.
   */
  const applied = useCallback(
    (item: Item, current: FormState): Partial<FormState> => {
      const structured = prefillFromStandard(item, { units, frequencies });
      const legacy = defaultsFromItem(item);

      // The legacy columns are free text ("capsule", "TDS") and the fields
      // above them are now dropdowns, so the text is resolved to a catalogue
      // entry or DROPPED. Carrying an unmatched string forward would submit a
      // unit the doctor never saw and cannot check — the same invisible-prefill
      // problem this modal already warns about, one field over. An unfilled
      // dropdown is visible; a hidden mismatched string is not.
      const legacyUnitId = matchCatalogueByText(legacy.unit, units, (row) => row.systemNameEn);
      const legacyFrequencyId = matchCatalogueByText(legacy.frequency, frequencies, (row) => row.code);
      const doseUnitId = structured.doseUnitId ?? legacyUnitId;
      const frequencyId = structured.frequencyId ?? legacyFrequencyId;

      return {
        amount: structured.amount ?? legacy.amount ?? current.amount,
        // Always the catalogue's own spelling, never the item's — the label's
        // Malay half is looked up from the row this id points at.
        unit: units?.find((row) => row.id === doseUnitId)?.systemNameEn,
        doseUnitId,
        frequency: frequencies?.find((row) => row.id === frequencyId)?.code ?? '',
        frequencyId,
        consumptionMethodId: structured.consumptionMethodId,
        durationValue: structured.durationValue ?? legacy.durationDays ?? current.durationValue,
        // A legacy duration is a number of DAYS — "5 days" is all that column
        // ever held — so it lands as DAY rather than inheriting whatever unit
        // the previous medicine in this session happened to use.
        durationUnit: structured.durationUnit ?? (legacy.durationDays ? 'DAY' : current.durationUnit),
        // Only where the medicine states one. Otherwise auto-compute fills it,
        // and `quantityTouched` stays false so it keeps up with edits.
        quantity: structured.quantity ?? legacy.quantity ?? current.quantity,
        quantityTouched: false,
        indication: legacy.indication ?? current.indication,
        remark: legacy.remark ?? current.remark,
      };
    },
    [units, frequencies],
  );

  const prefilledFrom = useCallback(
    (item: Item) =>
      hasStandardPrescription(prefillFromStandard(item, { units, frequencies })) ||
      Object.keys(defaultsFromItem(item)).length > 0,
    [units, frequencies],
  );


  /**
   * Item-master defaults, applied VISIBLY on selection.
   *
   * Only fields the item genuinely carries. Nothing is invented: an item with
   * no default dose unit leaves the unit blank rather than guessing "tablet",
   * because a wrong unit on a prescription is a dosing error.
   */
  const applyItemDefaults = useCallback(async (itemId: string, label: string) => {
    setForm((current) => ({ ...current, itemId, itemLabel: label }));
    setSelectedItem(undefined);
    try {
      const item = await apiClient.get<Item>(`/items/${itemId}`);
      setSelectedItem(item);
      // G4.5d6 — the master already knows the usual dose, frequency, duration,
      // pack size, indication and patient instruction. Retyping all six for
      // every amoxicillin is where prescribing time actually goes.
      // The prefill itself happens in the effect below, once the prescribing
      // vocabulary has actually arrived.
      setForm((current) => ({ ...current, itemId, itemLabel: label }));
    } catch {
      // A failed default lookup must not block prescribing — the doctor types
      // the dose either way.
    }
  }, []);

  /**
   * b1 — apply an item the caller already holds. No request: the rail's search
   * row carried the whole medicine, and asking the server for what is already
   * in hand is a spinner in front of a form that could have opened filled.
   *
   * Shares `defaultsFromItem` with the search-inside-the-modal path, so the two
   * cannot disagree about what a prefill means.
   */
  const applyPickedMedicine = useCallback((item: Item) => {
    const label = item.code ? `${item.code} — ${item.name}` : item.name;
    setSelectedItem(item);
    setForm((current) => ({ ...current, itemId: item.id, itemLabel: label }));
  }, []);

  /**
   * The prefill, applied once per medicine and NOT BEFORE THE VOCABULARY IS
   * LOADED.
   *
   * This was inline in both selection paths and it was a race: the unit and
   * frequency dropdowns are fed by their own requests, and a doctor who picks
   * a medicine before those land would have got NO prefill at all — silently,
   * because an unfilled form looks exactly like a medicine with no defaults.
   * Waiting is correct: the ids being matched are meaningless without the rows
   * they point at.
   *
   * The ref makes it once-per-medicine rather than once-per-render, so a
   * catalogue refetch cannot overwrite a dose the doctor has since changed.
   */
  const prefilledForItemId = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !selectedItem || !units || !frequencies) return;
    if (prefilledForItemId.current === selectedItem.id) return;
    prefilledForItemId.current = selectedItem.id;
    setForm((current) => ({ ...current, ...applied(selectedItem, current) }));
    setPrefilled(prefilledFrom(selectedItem));
  }, [open, selectedItem, units, frequencies, applied, prefilledFrom]);

  /**
   * What the locked title says underneath: the price the clinic charges and
   * what is on the shelf — the two facts the doctor was reading in the search
   * row a moment ago, kept in front of them while they set the dose.
   *
   * "Stock unknown" is stated rather than left out, for the same reason it is
   * on the search row: an absent stock line reads as "in stock".
   */
  const lockedMedicineFacts = useMemo(() => {
    if (!medicine) return undefined;
    const onHand = itemOnHand(medicine);
    return [
      `RM ${Number(medicine.sellPrice ?? 0).toFixed(2)}`,
      onHand === null ? 'stock unknown' : onHand <= 0 ? 'out of stock' : `${onHand} in stock`,
      medicine.cashOnly ? 'CASH ONLY' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [medicine]);

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.itemId && form.amount && (form.frequencyId || form.frequency.trim()) && form.durationValue > 0,
      ),
    [form],
  );

  /** True once anything has been typed — drives the discard guard. */
  const dirty = useMemo(
    () =>
      Boolean(
        form.itemId ||
          form.amount ||
          form.frequency.trim() ||
          form.frequencyId ||
          form.doseUnitId ||
          form.consumptionMethodId ||
          form.indication.trim() ||
          form.indicationId ||
          form.remark.trim(),
      ),
    [form],
  );

  const submit = async (thenAddAnother: boolean) => {
    if (!canSubmit) {
      setError('Choose a medicine and enter the dose, frequency and duration.');
      return;
    }
    setError(null);
    const dto: CreatePrescriptionDto = {
      visitId,
      itemId: form.itemId!,
      quantity: form.quantity,
      amount: form.amount!,
      unit: form.unit || undefined,
      frequency: form.frequency.trim(),
      // Computed here so the field the rest of the system reads is never
      // blank, and recomputed server-side from the pair below — the client's
      // arithmetic is not what the record ends up trusting.
      durationDays: durationInDays(form.durationValue, form.durationUnit),
      indication: form.indication.trim() || undefined,
      remark: form.remark.trim() || undefined,
      // b1 PHASE A — the structured choices. IDS ONLY: the patient-facing
      // Malay text is resolved and copied server-side, never sent from here.
      doseUnitId: form.doseUnitId,
      frequencyId: form.frequencyId,
      consumptionMethodId: form.consumptionMethodId,
      indicationId: form.indicationId,
      durationValue: form.durationValue!,
      durationUnit: form.durationUnit,
      // Still submitted explicitly even though the doctor is no longer asked:
      // there is no hidden database default to fall back on, and the
      // dispensary changes it when the patient is not collecting here.
      supplyMode: form.supplyMode,
      // Recorded so a dose can later be traced to how it was arrived at.
      calcMethod: calcMethod ?? 'MANUAL',
    };
    try {
      await createPrescription.mutateAsync(dto);
      if (thenAddAnother) {
        const added = form.itemLabel ?? 'Medication';
        // b1 — when the medicine came from the RAIL, the next one has to start
        // there too. The parent closes this form and puts the cursor back in
        // the rail's box; keeping the form open on a drug that has already been
        // added would leave a filled form for a finished prescription.
        if (onAddAnother) {
          message.success(`${added} added — search for the next one`);
          onAddAnother();
          return;
        }
        // Only the FORM is cleared. The visit, the list behind the modal and
        // every other piece of state stay exactly as they were.
        setForm(EMPTY);
        setLastAdded(added);
        setSearchKey((key) => key + 1);
        // Focus back to the search field, so the next medication starts by
        // typing rather than by aiming.
        requestAnimationFrame(() => {
          searchWrapRef.current?.querySelector('input')?.focus();
        });
        return;
      }
      // No confirmation dialog after an ordinary successful addition: the row
      // appearing in the list behind is the confirmation.
      message.success(`${form.itemLabel ?? 'Medication'} added`);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The medication could not be added.');
    }
  };

  return (
    <KuwickModal
      open={open}
      // b1 — the DRUG is the title when it was chosen in the rail. A modal
      // headed "Add medication" while a specific medicine is being prescribed
      // makes the doctor look for confirmation of which one; the title is the
      // confirmation.
      title={medicine ? (medicine.code ? `${medicine.code} — ${medicine.name}` : medicine.name) : 'Add medication'}
      subtitle={
        medicine
          ? lockedMedicineFacts
          : "One medication at a time. The visit's medication list stays behind this window."
      }
      size="medium"
      dirty={dirty}
      loading={createPrescription.isPending}
      error={error}
      onClose={onClose}
      restoreFocusTo={restoreFocusTo}
      dataTestId="add-medication-modal"
      footer={
        <KuwickModalActionBar
          cancel={
            <Button onClick={onClose} disabled={createPrescription.isPending}>
              Cancel
            </Button>
          }
          secondary={
            <Button
              onClick={() => void submit(true)}
              disabled={!canSubmit || createPrescription.isPending}
            >
              Add &amp; Add Another
            </Button>
          }
          primary={
            <Button
              type="primary"
              loading={createPrescription.isPending}
              disabled={!canSubmit}
              onClick={() => void submit(false)}
            >
              Add Medication
            </Button>
          }
        />
      }
    >
      {/* KW2-C2 — the SAME persistent strip as the medications card and the
          Copy Rx modal, and deliberately not a popup. A dialog on every add
          is dismissed by muscle memory within a week, after which everyone
          believes it is still being read. Here it is simply present, above
          the search, for as long as the form is open. */}
      <AllergyStrip allergies={visit?.patient ? (visit.patient.allergies ?? null) : undefined} compact />

      {lastAdded && (
        <Alert
          type="success"
          showIcon
          role="status"
          message={`${lastAdded} added to this visit.`}
          style={{ marginBottom: 4 }}
        />
      )}

      {/* b1 — NO search field when the medicine came from the rail. The drug is
          the title; a second box onto the same decision invites a second,
          different answer. The prefill notice stays, because a prefill the
          doctor cannot see is a prefill they cannot check. */}
      {!medicine && (
      <KuwickFormSection title="Medicine">
        <div ref={searchWrapRef}>
          <KuwickSearchSelect
            key={searchKey}
            id="kw-medication-search"
            ariaLabel="Search medicine"
            // b1 — the placeholder names the group, because the group is what
            // staff type and what used to match nothing at all.
            placeholder="Search by name, code or group (e.g. batuk)…"
            value={form.itemId}
            autoFocus
            onSearch={searchItems}
            onSelect={(value, option) => void applyItemDefaults(value, option.label)}
            onClear={() => setForm((current) => ({ ...current, itemId: undefined, itemLabel: undefined }))}
            emptyHint="Type at least one character to search the medicine list."
          />
        </div>
      </KuwickFormSection>
      )}

      {/* A prefill the doctor cannot see is a prefill they cannot check.
          Said plainly, once, rather than marking six fields individually. */}
      {prefilled && (
        <Text type="secondary" style={{ fontSize: 12 }} role="status" data-prefilled="true">
          Dose, frequency and supply below were filled from the medicine list — check and change them for this
          patient.
        </Text>
      )}

      <KuwickFormSection title="Dose">
        <Row gutter={[12, 8]}>
          <Col xs={12} md={8}>
            <label htmlFor="kw-med-amount">
              <Text type="secondary" style={{ fontSize: 12 }}>Dose amount</Text>
            </label>
            <InputNumber
              id="kw-med-amount"
              min={0}
              step={0.1}
              style={{ width: '100%' }}
              value={form.amount}
              onChange={(value) => set('amount', value ?? undefined)}
            />
          </Col>
          <Col xs={12} md={8}>
            <label htmlFor="kw-med-unit">
              <Text type="secondary" style={{ fontSize: 12 }}>Unit</Text>
            </label>
            {/* From the catalogue, so the label can print "Tablet (BIJI)".
                Typing was allowed here before and produced "tab", "tabs",
                "Tablet" and "tablet" on four prescriptions for one drug —
                none of which a patient-facing Malay label can be derived
                from. */}
            <Select
              id="kw-med-unit"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Tablet, Millilitre…"
              value={form.doseUnitId}
              onChange={(value?: string) =>
                setForm((current) => ({
                  ...current,
                  doseUnitId: value,
                  unit: units?.find((row) => row.id === value)?.systemNameEn,
                }))
              }
              options={(units ?? []).map((row) => ({ value: row.id, label: row.systemNameEn }))}
            />
          </Col>
          <Col xs={24} md={8}>
            <label htmlFor="kw-med-frequency">
              <Text type="secondary" style={{ fontSize: 12 }}>Frequency</Text>
            </label>
            <Select
              id="kw-med-frequency"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="OD, BD, TDS…"
              value={form.frequencyId}
              onChange={(value?: string) =>
                setForm((current) => ({
                  ...current,
                  frequencyId: value,
                  frequency: frequencies?.find((row) => row.id === value)?.code ?? '',
                }))
              }
              options={(frequencies ?? []).map((row) => ({ value: row.id, label: frequencyLabel(row) }))}
            />
            {/* Said where the decision is made, not in a footnote. A doctor who
                picks PRN and then watches the quantity box not move deserves to
                know why it did not. */}
            {chosenFrequency?.timesPerDay === null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {chosenFrequency.code} has no fixed daily count — set the quantity yourself.
              </Text>
            )}
          </Col>
        </Row>
      </KuwickFormSection>

      <KuwickFormSection
        title="Dosage calculator"
        hint="Optional — it fills the dose above, it never prescribes"
      >
        <DosageCalculator
          item={selectedItem}
          ageBrackets={ageBrackets}
          patientAgeMonths={patientAgeMonths}
          recordedWeightKg={vitals?.weight ? Number(vitals.weight) : null}
          onApply={(dose) => {
            // The calculator speaks free text ("ml"). Where that is EXACTLY a
            // catalogue entry's name it is the same thing and the id follows,
            // so the label keeps its Malay half; where it is not, the id is
            // cleared and the text stands alone. Matching "tab" to "Tablet"
            // would be this form guessing, which is what the whole 1F seed
            // refused to do.
            setForm((current) => ({
              ...current,
              amount: dose.amount,
              unit: dose.unit,
              doseUnitId: matchCatalogueByText(dose.unit, units, (row) => row.systemNameEn),
              frequency: dose.frequency ?? current.frequency,
              frequencyId: dose.frequency
                ? matchCatalogueByText(dose.frequency, frequencies, (row) => row.code)
                : current.frequencyId,
            }));
            setCalcMethod(dose.method);
          }}
        />
      </KuwickFormSection>

      <KuwickFormSection title="Supply">
        <Row gutter={[12, 8]}>
          <Col xs={12} md={5}>
            <label htmlFor="kw-med-duration">
              <Text type="secondary" style={{ fontSize: 12 }}>Duration</Text>
            </label>
            <InputNumber
              id="kw-med-duration"
              min={1}
              style={{ width: '100%' }}
              value={form.durationValue}
              onChange={(value) => set('durationValue', value ?? 1)}
            />
          </Col>
          <Col xs={12} md={4}>
            <label htmlFor="kw-med-duration-unit">
              <Text type="secondary" style={{ fontSize: 12 }}>&nbsp;</Text>
            </label>
            {/* Beside the number, not a second question. "2 weeks" is one
                thought; making a doctor convert it to 14 is arithmetic the
                server can do and get right every time. */}
            <Select
              id="kw-med-duration-unit"
              aria-label="Duration unit"
              style={{ width: '100%' }}
              value={form.durationUnit}
              onChange={(value: DurationUnit) => set('durationUnit', value)}
              options={[
                { value: 'DAY', label: 'Days' },
                { value: 'WEEK', label: 'Weeks' },
                { value: 'MONTH', label: 'Months' },
              ]}
            />
          </Col>
          <Col xs={12} md={5}>
            <label htmlFor="kw-med-quantity">
              <Text type="secondary" style={{ fontSize: 12 }}>Quantity</Text>
            </label>
            <InputNumber
              id="kw-med-quantity"
              min={1}
              style={{ width: '100%' }}
              value={form.quantity}
              // Typing here stops auto-compute for the rest of this form. A
              // doctor who has decided on 20 tablets must not have that
              // overwritten because they then corrected the duration.
              onChange={(value) =>
                setForm((current) => ({ ...current, quantity: value ?? 1, quantityTouched: true }))
              }
            />
            {form.quantityTouched && suggestedQuantity !== null && suggestedQuantity !== form.quantity && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Dose × frequency × duration comes to {suggestedQuantity}.
              </Text>
            )}
          </Col>
          {/* G4.5d6 — SUPPLY MODE IS GONE FROM THE DOCTOR'S FORM.
              It is a counter decision, not a clinical one: whether the patient
              collects here or buys elsewhere is settled at the dispensary,
              where somebody can actually see the stock and take the money.
              Asking a doctor mid-consultation produced a field that was left
              on its default and stopped being read. It still submits
              ONSITE_DISPENSE explicitly — the dispensary changes it — so
              nothing is left to a hidden database default. */}
          <Col xs={24} md={10}>
            {stock.message && (
              <Alert
                type={
                  stock.position === 'NONE' || stock.position === 'INSUFFICIENT'
                    ? 'warning'
                    : stock.position === 'UNKNOWN'
                      ? 'info'
                      : 'success'
                }
                showIcon
                style={{ marginTop: 18 }}
                message={stock.message}
                // Advisory, never blocking. A doctor may legitimately
                // prescribe something the clinic is out of, and a system that
                // refuses is a system that gets worked around.
                description={
                  stock.position === 'NONE' || stock.position === 'INSUFFICIENT'
                    ? 'You can still prescribe this — the dispensary will resolve supply.'
                    : undefined
                }
              />
            )}
          </Col>
        </Row>
      </KuwickFormSection>

      <KuwickFormSection title="How it is taken">
        <Row gutter={[12, 8]}>
          <Col xs={24} md={12}>
            <label htmlFor="kw-med-consumption">
              <Text type="secondary" style={{ fontSize: 12 }}>Consumption method</Text>
            </label>
            {/* Its reason for existing is the sentence it prints for the
                patient — "Ambil melalui mulut". A route with no instruction
                leaves the patient to guess. */}
            <Select
              id="kw-med-consumption"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="ORAL (MAKAN/MINUM)…"
              value={form.consumptionMethodId}
              onChange={(value?: string) => set('consumptionMethodId', value)}
              options={(methods ?? []).map((row) => ({ value: row.id, label: consumptionLabel(row) }))}
            />
          </Col>
        </Row>
      </KuwickFormSection>

      <KuwickFormSection title="Notes" hint="Optional">
        <Row gutter={[12, 8]}>
          <Col xs={24} md={12}>
            <label htmlFor="kw-med-indication">
              <Text type="secondary" style={{ fontSize: 12 }}>Indication</Text>
            </label>
            {/* A combobox, not a closed list. It matches on EITHER language —
                a Malaysian clinic types "demam" as readily as "fever" — and
                free text remains allowed, because a doctor must never be
                unable to say why. Typed text simply carries no Malay
                translation, which is honest. */}
            <Select
              id="kw-med-indication"
              style={{ width: '100%' }}
              allowClear
              showSearch
              // Typed text becomes the value itself when nothing matches.
              filterOption={(input, option) => {
                const row = indications?.find((candidate) => candidate.id === option?.value);
                return row ? indicationMatches(row, input) : false;
              }}
              value={form.indicationId ?? (form.indication || undefined)}
              onChange={(value?: string) => {
                const row = indications?.find((candidate) => candidate.id === value);
                setForm((current) => ({
                  ...current,
                  indicationId: row?.id,
                  indication: row ? row.labelEn : (value ?? ''),
                }));
              }}
              onSearch={(value) =>
                setForm((current) => ({ ...current, indicationId: undefined, indication: value }))
              }
              options={(indications ?? []).map((row) => ({ value: row.id, label: indicationLabel(row) }))}
            />
          </Col>
          <Col xs={24} md={12}>
            <label htmlFor="kw-med-remark">
              <Text type="secondary" style={{ fontSize: 12 }}>Remark</Text>
            </label>
            <Input
              id="kw-med-remark"
              value={form.remark}
              onChange={(event) => set('remark', event.target.value)}
            />
          </Col>
        </Row>
      </KuwickFormSection>
    </KuwickModal>
  );
}
