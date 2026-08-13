import { useMemo, useState } from 'react';
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
  const [durationDays, setDurationDays] = useState(5);
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
    setDurationDays(5);
    setIndication('');
    setRemark('');
    setCalcMethod(undefined);
    setCalcWeightKg(undefined);
    setCalcDoseRateMgKg(undefined);
    setSupplyMode(DEFAULT_SUPPLY_MODE);
  };

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleAdd = async () => {
    if (!itemId || !amount || !frequency || !durationDays) {
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
      durationDays,
      indication: indication || undefined,
      remark: remark || undefined,
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
            <InputNumber min={1} style={{ width: '100%' }} value={quantity} onChange={(v) => setQuantity(v ?? 1)} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary">Dose Amount</Text>
            <InputNumber min={0} style={{ width: '100%' }} value={amount} onChange={(v) => setAmount(v ?? undefined)} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Text type="secondary">Unit</Text>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. ml, tablet" />
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
            <Input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. BD" />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Text type="secondary">Duration (days)</Text>
            <InputNumber
              min={1}
              style={{ width: '100%' }}
              value={durationDays}
              onChange={(v) => setDurationDays(v ?? 1)}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Text type="secondary">Indication</Text>
            <Input value={indication} onChange={(e) => setIndication(e.target.value)} />
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
