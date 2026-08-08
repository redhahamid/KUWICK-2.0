import { useMemo, useState } from 'react';
import { Alert, Button, Col, InputNumber, Row, Space, Table, Tag, Typography } from 'antd';
import { Item, ItemAgeDosage } from '../../inventory/types';
import { bracketForAgeMonths, supportsWeightBasedDosing, weightBasedDose } from './prescribing';

const { Text } = Typography;

/**
 * G4.5d6 — the dosage calculator, INSIDE the prescribing form.
 *
 * It existed only on the Flow tab, behind a button that opened a second
 * dialog on top of the one the doctor was already filling in. So the Canvas —
 * the layout the clinic actually runs — had no calculator at all, and a
 * paediatric syrup dose was worked out on paper next to the screen.
 *
 * It is mounted here, in place, and it never submits anything: it computes,
 * shows its working, and offers to fill the dose fields. The doctor applies
 * it or ignores it. Deliberately not a nested modal — stacking a dialog on a
 * dialog is what made it unusable.
 */
export interface DosageCalculatorProps {
  item?: Item;
  ageBrackets?: ItemAgeDosage[];
  patientAgeMonths?: number | null;
  /** Seeded from the visit's recorded observation where one exists. */
  recordedWeightKg?: number | null;
  onApply: (dose: { amount: number; unit: string; frequency?: string; method: 'WEIGHT_BASED' | 'AGE_BASED' }) => void;
}

export function DosageCalculator({
  item,
  ageBrackets,
  patientAgeMonths,
  recordedWeightKg,
  onApply,
}: DosageCalculatorProps) {
  const [weightKg, setWeightKg] = useState<number | undefined>(recordedWeightKg ?? undefined);
  const [doseRate, setDoseRate] = useState<number | undefined>();

  const byWeight = useMemo(
    () => weightBasedDose(item, weightKg, doseRate),
    [item, weightKg, doseRate],
  );
  const matching = useMemo(
    () => bracketForAgeMonths(ageBrackets, patientAgeMonths),
    [ageBrackets, patientAgeMonths],
  );

  const canWeight = supportsWeightBasedDosing(item);
  const hasBrackets = (ageBrackets?.length ?? 0) > 0;

  if (!item) return null;
  if (!canWeight && !hasBrackets) {
    // Saying so is better than an empty panel that looks broken.
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        No dosage calculation is available for this medicine — it carries no concentration figures and no age
        brackets.
      </Text>
    );
  }

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {canWeight && (
        <>
          <Row gutter={[12, 8]} align="bottom">
            <Col xs={12} md={7}>
              <label htmlFor="kw-calc-weight">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Weight (kg)
                </Text>
              </label>
              <InputNumber
                id="kw-calc-weight"
                min={0.1}
                step={0.1}
                style={{ width: '100%' }}
                value={weightKg}
                onChange={(value) => setWeightKg(value ?? undefined)}
              />
            </Col>
            <Col xs={12} md={7}>
              <label htmlFor="kw-calc-rate">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Dose rate (mg/kg)
                </Text>
              </label>
              <InputNumber
                id="kw-calc-rate"
                min={0.1}
                step={0.5}
                style={{ width: '100%' }}
                value={doseRate}
                onChange={(value) => setDoseRate(value ?? undefined)}
              />
            </Col>
            <Col xs={24} md={10}>
              {/* The clinic's own guidance, verbatim. Never parsed into the
                  rate above — that is the doctor's judgement to enter. */}
              {item.prescriptionReference && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Reference: {item.prescriptionReference}
                </Text>
              )}
            </Col>
          </Row>

          {byWeight ? (
            <Alert
              type="info"
              // The working is shown, not just the answer. A number with no
              // derivation is a number nobody can check.
              message={`${byWeight.targetDoseMg} mg → ${byWeight.volumeMl} ${item.doseUnitDefault ?? 'ml'} per dose`}
              description={`${weightKg} kg × ${doseRate} mg/kg, at ${item.strengthMg} mg per ${item.concVolMl} ml.`}
              action={
                <Button
                  size="small"
                  type="primary"
                  onClick={() =>
                    onApply({
                      amount: byWeight.volumeMl,
                      unit: item.doseUnitDefault ?? 'ml',
                      method: 'WEIGHT_BASED',
                    })
                  }
                >
                  Use this dose
                </Button>
              }
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Enter a weight and a dose rate to calculate the volume.
            </Text>
          )}
        </>
      )}

      {hasBrackets && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Age brackets{' '}
            {patientAgeMonths !== null && patientAgeMonths !== undefined
              ? `· patient is ${patientAgeMonths} months`
              : '· patient date of birth not recorded'}
          </Text>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={ageBrackets}
            // The row that matches this patient is marked, not auto-applied:
            // the doctor chooses the dose, always.
            rowClassName={(row) => (matching?.id === row.id ? 'kw-dose-bracket-match' : '')}
            columns={[
              {
                title: 'Age',
                render: (_: unknown, row: ItemAgeDosage) => (
                  <Space size={4}>
                    <span>
                      {row.ageFromMonths}–{row.ageToMonths} mo
                    </span>
                    {matching?.id === row.id && <Tag color="blue">This patient</Tag>}
                  </Space>
                ),
              },
              { title: 'Dose', render: (_: unknown, row: ItemAgeDosage) => `${row.amount} ${row.unit}` },
              { title: 'Frequency', dataIndex: 'frequency' },
              {
                title: '',
                render: (_: unknown, row: ItemAgeDosage) => (
                  <Button
                    size="small"
                    onClick={() =>
                      onApply({
                        amount: Number(row.amount),
                        unit: row.unit,
                        frequency: row.frequency,
                        method: 'AGE_BASED',
                      })
                    }
                  >
                    Use
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
    </Space>
  );
}
