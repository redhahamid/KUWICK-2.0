import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { CalculatorOutlined, MedicineBoxOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import { printDrugLabel } from './printTextDocument';
import { useItems } from '../inventory/hooks/useItems';
import { useItemAgeDosages } from '../inventory/hooks/useItemAgeDosages';
import { useVisit } from './hooks/useVisits';
import { useLatestVitals } from './hooks/useVisitObservations';
import {
  useCancelPrescription,
  useCopyPrescriptions,
  useCreatePrescription,
  useDispensePrescription,
  usePrescriptionCopySources,
  usePrescriptions,
  useRemovePrescription,
} from './hooks/usePrescriptions';
import { CreatePrescriptionDto, DosageCalcMethod, PrescriptionSupplyMode } from './types';
import { DurationUnit } from '../inventory/types';
import { useReferenceCatalog } from './hooks/useReferenceCatalogs';
import { defaultsFromItem } from './medications/prescribing';
import {
  computeQuantity,
  consumptionLabel,
  durationInDays,
  frequencyLabel,
  indicationLabel,
  indicationMatches,
  matchCatalogueByText,
  prefillFromStandard,
} from './medications/prescriptionForm';
import { DEFAULT_SUPPLY_MODE, SUPPLY_MODE_OPTIONS } from './medicationSupplyPresentation';
import { PrescribedMedicationList } from './sections/PrescribedMedicationList';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

interface MedicationsTabProps {
  visitId: string;
}

// The calculator exists "to prevent wrong dosage" (owner, docs/DECISIONS.md
// D-028) — WEIGHT_BASED is the confirmed, patient-safety-critical formula;
// AGE_BASED is a genuine addition beyond the audited kuwick.com reference
// (which doesn't have this finished), built with explicit owner approval.
export function MedicationsTab({ visitId }: MedicationsTabProps) {
  const { data: visit } = useVisit(visitId);
  // C0 (D-051) — the paediatric dosage calculator seeds from the attributed
  // observation record, falling back to legacy note vitals for old visits.
  const vitals = useLatestVitals(visitId);
  const { data: clinics } = useClinics();
  const { data: items } = useItems();
  const { data: prescriptions, isLoading } = usePrescriptions(visitId);
  const { data: copySources } = usePrescriptionCopySources(visit?.patientId, visitId);

  const createPrescription = useCreatePrescription(visitId);
  const copyPrescriptions = useCopyPrescriptions(visitId);
  const dispensePrescription = useDispensePrescription(visitId);
  const cancelPrescription = useCancelPrescription(visitId);
  const removePrescription = useRemovePrescription(visitId);

  const [itemId, setItemId] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState<number>();
  const [unit, setUnit] = useState<string>();
  const [frequency, setFrequency] = useState('');
  // b1 PHASE A — the catalogue choices, exactly as the Canvas modal carries
  // them. This surface wrote free text until now, and the golden path uses THIS
  // one — so it went green while proving nothing about any of it, and every
  // prescription a doctor wrote in Flow reached the label with no Malay at all.
  const [doseUnitId, setDoseUnitId] = useState<string>();
  const [frequencyId, setFrequencyId] = useState<string>();
  const [consumptionMethodId, setConsumptionMethodId] = useState<string>();
  const [indicationId, setIndicationId] = useState<string>();
  const [durationValue, setDurationValue] = useState<number | undefined>(5);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('DAY');
  /** Set the moment the quantity box is typed in; auto-compute stops for good. */
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [indication, setIndication] = useState('');
  const [remark, setRemark] = useState('');
  const [calcMethod, setCalcMethod] = useState<DosageCalcMethod>();
  // D-091 — supply intent, VISIBLY defaulted to clinic dispensing and always
  // submitted explicitly. There is no hidden database default to fall back
  // on: what the doctor sees selected is exactly what is stored.
  const [supplyMode, setSupplyMode] = useState<PrescriptionSupplyMode>(DEFAULT_SUPPLY_MODE);
  const [calcWeightKg, setCalcWeightKg] = useState<number>();
  const [calcDoseRateMgKg, setCalcDoseRateMgKg] = useState<number>();
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorTab, setCalculatorTab] = useState<'weight' | 'age'>('weight');
  const [copySourceVisitId, setCopySourceVisitId] = useState<string>();

  const { data: ageDosages } = useItemAgeDosages(itemId);
  const selectedItem = items?.find((item) => item.id === itemId);
  const patientAgeMonths = visit?.patient?.dob ? dayjs().diff(dayjs(visit.patient.dob), 'month') : null;

  const openCalculator = () => {
    setCalcWeightKg(vitals?.weight ? Number(vitals.weight) : undefined);
    setCalculatorOpen(true);
  };

  const weightBasedResult = useMemo(() => {
    if (!selectedItem?.concVolMl || !selectedItem?.strengthMg || !calcWeightKg || !calcDoseRateMgKg) {
      return null;
    }
    const targetDoseMg = calcWeightKg * calcDoseRateMgKg;
    const volumeMl = (targetDoseMg * Number(selectedItem.concVolMl)) / Number(selectedItem.strengthMg);
    return { targetDoseMg, volumeMl: Math.round(volumeMl * 100) / 100 };
  }, [selectedItem, calcWeightKg, calcDoseRateMgKg]);

  const applyWeightBased = () => {
    if (!weightBasedResult) return;
    setAmount(weightBasedResult.volumeMl);
    setUnit(selectedItem?.doseUnitDefault ?? 'ml');
    setCalcMethod('WEIGHT_BASED');
    setCalculatorOpen(false);
  };

  const applyAgeBracket = (bracket: { amount: string; unit: string; frequency: string }) => {
    setAmount(Number(bracket.amount));
    setUnit(bracket.unit);
    setFrequency(bracket.frequency);
    setCalcMethod('AGE_BASED');
    setCalculatorOpen(false);
  };

  const resetForm = () => {
    setItemId(undefined);
    setQuantity(1);
    setAmount(undefined);
    setUnit(undefined);
    setFrequency('');
    setDoseUnitId(undefined);
    setFrequencyId(undefined);
    setConsumptionMethodId(undefined);
    setIndicationId(undefined);
    setDurationValue(5);
    setDurationUnit('DAY');
    setQuantityTouched(false);
    setIndication('');
    setRemark('');
    setCalcMethod(undefined);
    setCalcWeightKg(undefined);
    setCalcDoseRateMgKg(undefined);
    setSupplyMode(DEFAULT_SUPPLY_MODE);
  };

  // Active rows only: a frequency the clinic has retired must not be offered
  // on a NEW prescription.
  const { data: units } = useReferenceCatalog('dosage-units');
  const { data: frequencies } = useReferenceCatalog('frequencies');
  const { data: methods } = useReferenceCatalog('consumption-methods');
  const { data: indications } = useReferenceCatalog('indications');

  const chosenFrequency = frequencies?.find((row) => row.id === frequencyId);
  const suggestedQuantity = computeQuantity({
    amount,
    timesPerDay: chosenFrequency?.timesPerDay ?? null,
    durationValue,
    durationUnit,
  });

  // Live recalculation until somebody types in the quantity box. `null` means
  // "cannot be computed" — PRN and STAT have no doses-per-day — and the box is
  // LEFT ALONE on it rather than collapsing to 1.
  useEffect(() => {
    if (quantityTouched || suggestedQuantity === null) return;
    setQuantity((current) => (current === suggestedQuantity ? current : suggestedQuantity));
  }, [suggestedQuantity, quantityTouched]);

  /**
   * Prefill from the medicine's 1F standard prescription — and NOT until the
   * vocabulary has loaded.
   *
   * The ids being matched are meaningless without the rows they point at, so
   * running this early would silently leave the form empty, which looks exactly
   * like a medicine that carries no defaults. Once per medicine, so a catalogue
   * refetch cannot overwrite a dose the doctor has since changed.
   */
  const prefilledForItemId = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || !units || !frequencies) return;
    if (prefilledForItemId.current === itemId) return;
    const item = items?.find((candidate) => candidate.id === itemId);
    if (!item) return;
    prefilledForItemId.current = itemId;

    const structured = prefillFromStandard(item, { units, frequencies });
    const legacy = defaultsFromItem(item);
    // Legacy free text is resolved to a catalogue entry or DROPPED — carrying
    // an unmatched string forward would submit a unit the doctor never saw.
    const nextUnitId = structured.doseUnitId ?? matchCatalogueByText(legacy.unit, units, (row) => row.systemNameEn);
    const nextFrequencyId =
      structured.frequencyId ?? matchCatalogueByText(legacy.frequency, frequencies, (row) => row.code);

    if (structured.amount ?? legacy.amount) setAmount(structured.amount ?? legacy.amount);
    setDoseUnitId(nextUnitId);
    setUnit(units.find((row) => row.id === nextUnitId)?.systemNameEn);
    setFrequencyId(nextFrequencyId);
    setFrequency(frequencies.find((row) => row.id === nextFrequencyId)?.code ?? '');
    setConsumptionMethodId(structured.consumptionMethodId);
    if (structured.durationValue && structured.durationUnit) {
      setDurationValue(structured.durationValue);
      setDurationUnit(structured.durationUnit);
    } else if (legacy.durationDays) {
      // The legacy column only ever held days.
      setDurationValue(legacy.durationDays);
      setDurationUnit('DAY');
    }
    if (structured.quantity ?? legacy.quantity) {
      setQuantity((structured.quantity ?? legacy.quantity)!);
    }
    setQuantityTouched(false);
    if (legacy.indication) setIndication(legacy.indication);
    if (legacy.remark) setRemark(legacy.remark);
  }, [itemId, units, frequencies, items]);

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleAdd = async () => {
    if (!itemId || !amount || !(frequencyId || frequency) || !durationValue) {
      message.warning('Select a medicine and fill in dose, frequency, and duration');
      return;
    }
    const dto: CreatePrescriptionDto = {
      visitId,
      itemId,
      quantity,
      amount,
      unit,
      frequency,
      // Computed here so the field the rest of the system reads is never
      // blank; the server recomputes it from the pair below rather than
      // trusting this number.
      durationDays: durationInDays(durationValue, durationUnit),
      indication: indication || undefined,
      remark: remark || undefined,
      // IDS ONLY — the patient-facing Malay is resolved and copied on
      // server-side, never sent from a browser.
      doseUnitId,
      frequencyId,
      consumptionMethodId,
      indicationId,
      durationValue,
      durationUnit,
      calcMethod,
      calcWeightKg: calcMethod === 'WEIGHT_BASED' ? calcWeightKg : undefined,
      calcDoseRateMgKg: calcMethod === 'WEIGHT_BASED' ? calcDoseRateMgKg : undefined,
      supplyMode,
    };
    try {
      await createPrescription.mutateAsync(dto);
      resetForm();
    } catch (error) {
      reportFailure(error, 'Failed to add prescription');
    }
  };

  const handleCopy = async () => {
    if (!copySourceVisitId) return;
    try {
      const result = await copyPrescriptions.mutateAsync({
        sourceVisitId: copySourceVisitId,
        targetVisitId: visitId,
      });
      // G4.5d3c-3c — the server's sentence, not a generic "copied". The
      // doctor is told what supply mode the copied lines were given and where
      // it came from, so a rule that ran on their behalf is visible rather
      // than something they discover later in the medication list.
      message.success(result.supplySummary);
    } catch (error) {
      reportFailure(error, 'Failed to copy previous prescription');
    }
  };

  return (
    <div>
      <Card
        size="small"
        title={
          <Space>
            <MedicineBoxOutlined /> Prescribe Medication
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {copySources && copySources.length > 0 && (
          <Space style={{ marginBottom: 12 }}>
            <Text type="secondary">Copy Previous Prescription:</Text>
            <Select
              style={{ width: 220 }}
              placeholder="Or choose date..."
              value={copySourceVisitId}
              onChange={setCopySourceVisitId}
              options={copySources.map((source, index) => ({
                value: source.id,
                label: index === 0 ? `Latest (${dayjs(source.checkInAt).format('D MMM YYYY')})` : dayjs(source.checkInAt).format('D MMM YYYY'),
              }))}
            />
            <Button size="small" disabled={!copySourceVisitId} loading={copyPrescriptions.isPending} onClick={handleCopy}>
              Copy
            </Button>
          </Space>
        )}

        <Text type="secondary">Select Medicine</Text>
        <Select
          showSearch
          allowClear
          style={{ width: '100%', marginTop: 4, marginBottom: 12 }}
          placeholder="Search medicine..."
          value={itemId}
          onChange={(value) => {
            setItemId(value);
            setAmount(undefined);
            setUnit(undefined);
            setCalcMethod(undefined);
          }}
          // b1 — matches what the CLINIC files the medicine under, not just
          // what the option happens to print. This filter read `label` only,
          // so typing "batuk" found nothing here while 181 of 236 medicines
          // carry a Malay group tag — the same defect the Canvas box had, on
          // the other surface. Fixing one and not the other is how the
          // diagnosis outage survived a green build.
          filterOption={(input, option) =>
            String(option?.searchText ?? option?.label ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          options={items?.map((item) => ({
            value: item.id,
            label: item.code ? `${item.code} — ${item.name}` : item.name,
            // Everything the server matches on, so the two surfaces agree
            // about what is findable.
            searchText: [item.code, item.name, item.groupTag, item.sourceName].filter(Boolean).join(' '),
          }))}
        />

        {selectedItem?.prescriptionReference && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`Dr's Note: ${selectedItem.prescriptionReference}`}
          />
        )}

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary">Quantity</Text>
            <InputNumber
              aria-label="Quantity"
              min={1}
              style={{ width: '100%' }}
              value={quantity}
              // Typing here stops auto-compute for the rest of this form.
              onChange={(v) => {
                setQuantity(v ?? 1);
                setQuantityTouched(true);
              }}
            />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary">Dose Amount</Text>
            <InputNumber min={0} style={{ width: '100%' }} value={amount} onChange={(v) => setAmount(v ?? undefined)} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary">Unit</Text>
            {/* From the catalogue, so the label can print "Tablet (BIJI)".
                Free text here produced "tab", "tabs" and "tablet" on three
                prescriptions for one drug, none of which a patient-facing
                Malay label can be derived from. */}
            <Select
              aria-label="Unit"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Tablet, Millilitre…"
              value={doseUnitId}
              onChange={(value?: string) => {
                setDoseUnitId(value);
                setUnit(units?.find((row) => row.id === value)?.systemNameEn);
              }}
              options={(units ?? []).map((row) => ({ value: row.id, label: row.systemNameEn }))}
            />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary"> </Text>
            <Button
              block
              icon={<CalculatorOutlined />}
              disabled={!itemId}
              onClick={openCalculator}
              style={{ display: 'block' }}
            >
              Calculate Dosage
            </Button>
          </Col>
        </Row>

        {calcMethod && (
          <Tag color="blue" style={{ marginBottom: 12 }}>
            {calcMethod === 'WEIGHT_BASED' ? 'Weight-based calculation applied' : 'Age-based bracket applied'}
          </Tag>
        )}

        {calculatorOpen && (
          <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
            <Tabs
              activeKey={calculatorTab}
              onChange={(key) => setCalculatorTab(key as 'weight' | 'age')}
              items={[
                { key: 'weight', label: 'Weight-Based' },
                { key: 'age', label: 'Age-Based' },
              ]}
            />
            {calculatorTab === 'weight' && (
              <>
                {(!selectedItem?.concVolMl || !selectedItem?.strengthMg) && (
                  <Alert
                    type="warning"
                    showIcon
                    message="This item has no Conc. Vol/Strength configured — set it in Items before using the weight-based calculator."
                    style={{ marginBottom: 12 }}
                  />
                )}
                <Row gutter={12} style={{ marginBottom: 12 }}>
                  <Col span={12}>
                    <Text type="secondary">Weight (kg)</Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      step={0.1}
                      value={calcWeightKg}
                      onChange={(v) => setCalcWeightKg(v ?? undefined)}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">Dose Rate (mg/kg)</Text>
                    <InputNumber
                      style={{ width: '100%' }}
                      step={0.1}
                      value={calcDoseRateMgKg}
                      onChange={(v) => setCalcDoseRateMgKg(v ?? undefined)}
                    />
                  </Col>
                </Row>
                {weightBasedResult && (
                  <Alert
                    type="success"
                    style={{ marginBottom: 12 }}
                    message={`Target Dose: ${weightBasedResult.targetDoseMg}mg → Volume: ${weightBasedResult.volumeMl}mL`}
                  />
                )}
                <Button type="primary" disabled={!weightBasedResult} onClick={applyWeightBased}>
                  Apply
                </Button>
              </>
            )}
            {calculatorTab === 'age' && (
              <>
                {patientAgeMonths !== null && (
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    Patient age: {Math.floor(patientAgeMonths / 12)}y {patientAgeMonths % 12}m
                  </Text>
                )}
                {!ageDosages || ageDosages.length === 0 ? (
                  <Empty description="No age brackets configured for this item" />
                ) : (
                  <Table
                    size="small"
                    rowKey="id"
                    dataSource={ageDosages}
                    pagination={false}
                    columns={[
                      { title: 'From (mo)', dataIndex: 'ageFromMonths' },
                      { title: 'To (mo)', dataIndex: 'ageToMonths' },
                      { title: 'Dose', render: (_: unknown, r) => `${r.amount}${r.unit} ${r.frequency}` },
                      {
                        title: '',
                        render: (_: unknown, r) => {
                          const matchesPatient =
                            patientAgeMonths !== null &&
                            patientAgeMonths >= r.ageFromMonths &&
                            patientAgeMonths <= r.ageToMonths;
                          return (
                            <Button size="small" type={matchesPatient ? 'primary' : 'default'} onClick={() => applyAgeBracket(r)}>
                              Use This
                            </Button>
                          );
                        },
                      },
                    ]}
                  />
                )}
              </>
            )}
          </Card>
        )}

        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={8}>
            <Text type="secondary">Frequency</Text>
            <Select
              aria-label="Frequency"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="OD, BD, TDS…"
              value={frequencyId}
              onChange={(value?: string) => {
                setFrequencyId(value);
                setFrequency(frequencies?.find((row) => row.id === value)?.code ?? '');
              }}
              options={(frequencies ?? []).map((row) => ({ value: row.id, label: frequencyLabel(row) }))}
            />
            {/* Said where the choice is made. A doctor who picks PRN and then
                watches the quantity box not move deserves to know why. */}
            {chosenFrequency?.timesPerDay === null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {chosenFrequency.code} has no fixed daily count — set the quantity yourself.
              </Text>
            )}
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Text type="secondary">Duration</Text>
            <InputNumber
              aria-label="Duration"
              min={1}
              style={{ width: '100%' }}
              value={durationValue}
              // Stays EMPTY while it is being retyped. Snapping back to 1 turns
              // "clear, type 10" into 110.
              onChange={(v) => setDurationValue(v ?? undefined)}
            />
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Text type="secondary">&nbsp;</Text>
            <Select
              aria-label="Duration unit"
              style={{ width: '100%' }}
              value={durationUnit}
              onChange={(value: DurationUnit) => setDurationUnit(value)}
              options={[
                { value: 'DAY', label: 'Days' },
                { value: 'WEEK', label: 'Weeks' },
                { value: 'MONTH', label: 'Months' },
              ]}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Text type="secondary">Indication</Text>
            {/* Matches on EITHER language — a Malaysian clinic types "demam" as
                readily as "fever" — and free text is still allowed, because a
                doctor must never be unable to say why. Typed text simply
                carries no translation. */}
            <Select
              aria-label="Indication"
              style={{ width: '100%' }}
              allowClear
              showSearch
              filterOption={(input, option) => {
                const row = indications?.find((candidate) => candidate.id === option?.value);
                return row ? indicationMatches(row, input) : false;
              }}
              value={indicationId ?? (indication || undefined)}
              onChange={(value?: string) => {
                const row = indications?.find((candidate) => candidate.id === value);
                setIndicationId(row?.id);
                setIndication(row ? row.labelEn : (value ?? ''));
              }}
              onSearch={(value) => {
                setIndicationId(undefined);
                setIndication(value);
              }}
              options={(indications ?? []).map((row) => ({ value: row.id, label: indicationLabel(row) }))}
            />
          </Col>
        </Row>
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={8}>
            <Text type="secondary">Consumption method</Text>
            {/* Its reason for existing is the sentence it prints for the
                patient — "Ambil melalui mulut". A route with no instruction
                leaves the patient to guess. */}
            <Select
              aria-label="Consumption method"
              style={{ width: '100%' }}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="ORAL (MAKAN/MINUM)…"
              value={consumptionMethodId}
              onChange={(value?: string) => setConsumptionMethodId(value)}
              options={(methods ?? []).map((row) => ({ value: row.id, label: consumptionLabel(row) }))}
            />
          </Col>
        </Row>
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={8}>
            {/* A visible label and a visible selection. The doctor reads the
                supply intent before saving; the DTO carries it explicitly. */}
            <Text type="secondary">
              <label htmlFor="kw-supply-mode">Supply Mode</label>
            </Text>
            <Select
              id="kw-supply-mode"
              style={{ width: '100%' }}
              value={supplyMode}
              onChange={(value) => setSupplyMode(value)}
              options={SUPPLY_MODE_OPTIONS}
            />
            {/* G4.5d3c-3c — the default says that it IS one. A pre-selected
                value that looks like a deliberate choice is how a doctor stops
                reading the field; saying "change it if" keeps the decision in
                front of them at the cost of one line. */}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {supplyMode === DEFAULT_SUPPLY_MODE
                ? 'Default — change this if the patient is not collecting from the clinic.'
                : 'Changed from the clinic default.'}
            </Text>
          </Col>
        </Row>
        <Input.TextArea
          rows={2}
          placeholder="Remark (optional)"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        <div style={{ textAlign: 'right' }}>
          <Button type="primary" loading={createPrescription.isPending} disabled={!itemId} onClick={handleAdd}>
            + Add to Prescription
          </Button>
        </div>
      </Card>

      {/* G2b (D-060) — the 6-column table that lived here needed horizontal
          scrolling below laptop width and buried indication, remark and
          prescriber in a cramped cell. PrescribedMedicationList shows the same
          records as wrapping rows, and adds the allergy banner, prescriber and
          stock-on-hand the owner asked for. The prescribing form, dosage
          calculator and every mutation above are untouched. */}
      <Card size="small" title="Prescribed Medications">
        <PrescribedMedicationList
          visitId={visitId}
          prescriptions={prescriptions}
          isLoading={isLoading}
          patient={visit?.patient}
          clinic={clinics?.find((c) => c.id === visit?.clinicId)}
          latestWeightKg={vitals?.weight ?? null}
        />
      </Card>
    </div>
  );
}
