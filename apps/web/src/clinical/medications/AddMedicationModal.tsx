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
import { DEFAULT_SUPPLY_MODE, SUPPLY_MODE_OPTIONS } from '../medicationSupplyPresentation';
import { CreatePrescriptionDto, PrescriptionSupplyMode } from '../types';
import { Item } from '../../inventory/types';

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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      setLastAdded(null);
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
    return items.map((item) => ({
      value: item.id,
      label: item.code ? `${item.code} — ${item.name}` : item.name,
      detail: item.strengthMg ? `${item.strengthMg}mg` : undefined,
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
    try {
      const item = await apiClient.get<Item>(`/items/${itemId}`);
      setForm((current) => ({
        ...current,
        itemId,
        itemLabel: label,
        unit: item.doseUnitDefault ?? current.unit,
      }));
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
      supplyMode: form.supplyMode,
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
            placeholder="Search by name or code…"
            value={form.itemId}
            autoFocus
            onSearch={searchItems}
            onSelect={(value, option) => void applyItemDefaults(value, option.label)}
            onClear={() => setForm((current) => ({ ...current, itemId: undefined, itemLabel: undefined }))}
            emptyHint="Type at least one character to search the medicine list."
          />
        </div>
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
          <Col xs={24} md={12}>
            <label htmlFor="kw-med-supply">
              <Text type="secondary" style={{ fontSize: 12 }}>Supply mode</Text>
            </label>
            <Select
              id="kw-med-supply"
              style={{ width: '100%' }}
              value={form.supplyMode}
              onChange={(value) => set('supplyMode', value)}
              options={SUPPLY_MODE_OPTIONS}
            />
            {/* The default says that it IS one. A pre-selected value that reads
                as a deliberate choice is a field people stop checking. */}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {form.supplyMode === DEFAULT_SUPPLY_MODE
                ? 'Default — change this if the patient is not collecting from the clinic.'
                : 'Changed from the clinic default.'}
            </Text>
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
