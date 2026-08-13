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
import { Item } from '../../inventory/types';
import { AllergyStrip } from './AllergyStrip';
import { DosageCalculator } from './DosageCalculator';
import { defaultsFromItem, medicineSearchDetail, stockAdvice } from './prescribing';

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
  /** Focused on close — usually the Add Medication button. */
  restoreFocusTo?: () => HTMLElement | null;
}

interface FormState {
  itemId?: string;
  itemLabel?: string;
  amount?: number;
  unit?: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  supplyMode: PrescriptionSupplyMode;
  indication: string;
  remark: string;
}

const EMPTY: FormState = {
  itemId: undefined,
  itemLabel: undefined,
  amount: undefined,
  unit: undefined,
  frequency: '',
  durationDays: 5,
  quantity: 1,
  supplyMode: DEFAULT_SUPPLY_MODE,
  indication: '',
  remark: '',
};

export function AddMedicationModal({ open, visitId, onClose, restoreFocusTo }: AddMedicationModalProps) {
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

  const stock = useMemo(
    () => stockAdvice(form.itemId, form.quantity, stockLevels),
    [form.itemId, form.quantity, stockLevels],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      setLastAdded(null);
      setSelectedItem(undefined);
      setPrefilled(false);
      setCalcMethod(undefined);
    }
  }, [open]);

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
      const defaults = defaultsFromItem(item);
      setForm((current) => ({
        ...current,
        itemId,
        itemLabel: label,
        amount: defaults.amount ?? current.amount,
        unit: defaults.unit ?? current.unit,
        frequency: defaults.frequency ?? current.frequency,
        durationDays: defaults.durationDays ?? current.durationDays,
        quantity: defaults.quantity ?? current.quantity,
        indication: defaults.indication ?? current.indication,
        remark: defaults.remark ?? current.remark,
      }));
      setPrefilled(Object.keys(defaults).length > 0);
    } catch {
      // A failed default lookup must not block prescribing — the doctor types
      // the dose either way.
    }
  }, []);

  const canSubmit = useMemo(
    () => Boolean(form.itemId && form.amount && form.frequency.trim() && form.durationDays > 0),
    [form],
  );

  /** True once anything has been typed — drives the discard guard. */
  const dirty = useMemo(
    () =>
      Boolean(
        form.itemId ||
          form.amount ||
          form.frequency.trim() ||
          form.indication.trim() ||
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
      durationDays: form.durationDays,
      indication: form.indication.trim() || undefined,
      remark: form.remark.trim() || undefined,
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
        // Only the FORM is cleared. The visit, the list behind the modal and
        // every other piece of state stay exactly as they were.
        const added = form.itemLabel ?? 'Medication';
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
      title="Add medication"
      subtitle="One medication at a time. The visit's medication list stays behind this window."
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
        {/* A prefill the doctor cannot see is a prefill they cannot check.
            Said plainly, once, rather than marking six fields individually. */}
        {prefilled && (
          <Text type="secondary" style={{ fontSize: 12 }} role="status" data-prefilled="true">
            Dose, frequency and supply below were filled from the medicine list — check and change them for this
            patient.
          </Text>
        )}
      </KuwickFormSection>

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
            <Input
              id="kw-med-unit"
              value={form.unit}
              placeholder="e.g. ml, tablet"
              onChange={(event) => set('unit', event.target.value)}
            />
          </Col>
          <Col xs={24} md={8}>
            <label htmlFor="kw-med-frequency">
              <Text type="secondary" style={{ fontSize: 12 }}>Frequency</Text>
            </label>
            <Input
              id="kw-med-frequency"
              value={form.frequency}
              placeholder="e.g. TDS"
              onChange={(event) => set('frequency', event.target.value)}
            />
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
            setForm((current) => ({
              ...current,
              amount: dose.amount,
              unit: dose.unit,
              frequency: dose.frequency ?? current.frequency,
            }));
            setCalcMethod(dose.method);
          }}
        />
      </KuwickFormSection>

      <KuwickFormSection title="Supply">
        <Row gutter={[12, 8]}>
          <Col xs={12} md={6}>
            <label htmlFor="kw-med-duration">
              <Text type="secondary" style={{ fontSize: 12 }}>Duration (days)</Text>
            </label>
            <InputNumber
              id="kw-med-duration"
              min={1}
              style={{ width: '100%' }}
              value={form.durationDays}
              onChange={(value) => set('durationDays', value ?? 1)}
            />
          </Col>
          <Col xs={12} md={6}>
            <label htmlFor="kw-med-quantity">
              <Text type="secondary" style={{ fontSize: 12 }}>Quantity</Text>
            </label>
            <InputNumber
              id="kw-med-quantity"
              min={1}
              style={{ width: '100%' }}
              value={form.quantity}
              onChange={(value) => set('quantity', value ?? 1)}
            />
          </Col>
          {/* G4.5d6 — SUPPLY MODE IS GONE FROM THE DOCTOR'S FORM.
              It is a counter decision, not a clinical one: whether the patient
              collects here or buys elsewhere is settled at the dispensary,
              where somebody can actually see the stock and take the money.
              Asking a doctor mid-consultation produced a field that was left
              on its default and stopped being read. It still submits
              ONSITE_DISPENSE explicitly — the dispensary changes it — so
              nothing is left to a hidden database default. */}
          <Col xs={24} md={12}>
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

      <KuwickFormSection title="Notes" hint="Optional">
        <Row gutter={[12, 8]}>
          <Col xs={24} md={12}>
            <label htmlFor="kw-med-indication">
              <Text type="secondary" style={{ fontSize: 12 }}>Indication</Text>
            </label>
            <Input
              id="kw-med-indication"
              value={form.indication}
              onChange={(event) => set('indication', event.target.value)}
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
