import { useMemo, useState } from 'react';
import { Col, InputNumber, Row, Typography } from 'antd';
import { KuwickCalculatorShell } from '../../design-system/kuwick';
import { BMI_BAND_LABEL, BMI_DECIMALS, bmiBand, calculateBmi } from '../vitalsBmi';
import { useLatestObservation } from '../hooks/useVisitObservations';
import { formatClinicDateTime } from '../clinicTime';

const { Text } = Typography;

/**
 * G4.5d5b-1 — the EXISTING BMI calculation, in the shared shell.
 *
 * The arithmetic is untouched: `calculateBmi` is the same D-096 function the
 * vitals form and the vitals strip already use, with the same rounding and the
 * same refusal to produce NaN or Infinity. This checkpoint redesigns how the
 * number is presented; it invents no formula.
 *
 * "Use current visit data" COPIES the recorded height and weight into local
 * inputs. Editing them afterwards changes this calculation and nothing else —
 * the observation row is not touched, which is why the caption states which
 * reading was used and when it was taken. A calculator that silently used a
 * stale weight, or worse wrote back to one, is the failure this shape avoids.
 */
export function BmiCalculator({ visitId }: { visitId?: string }) {
  const { data: latest } = useLatestObservation(visitId);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  /** Set only when the values were copied from the visit, for the caption. */
  const [source, setSource] = useState<string | null>(null);

  const bmi = useMemo(() => calculateBmi(weightKg, heightCm), [heightCm, weightKg]);
  const band = bmiBand(bmi);

  const visitHasVitals = Boolean(latest?.height && latest?.weight);

  return (
    <KuwickCalculatorShell
      name="Body Mass Index"
      purpose="Weight relative to height, for an adult patient."
      resultLabel="BMI"
      resultValue={bmi === null ? null : bmi.toFixed(BMI_DECIMALS)}
      resultUnit="kg/m²"
      interpretation={
        band ? (
          <Text>
            {BMI_BAND_LABEL[band]} <Text type="secondary">(adult classification)</Text>
          </Text>
        ) : undefined
      }
      sourceCaption={source}
      formula={<Text code>BMI = weight (kg) ÷ height (m)²</Text>}
      rounding={`Rounded to ${BMI_DECIMALS} decimal place.`}
      assumptions={
        <Text type="secondary" style={{ fontSize: 12 }}>
          Height is entered in centimetres and converted to metres. The interpretation bands are the adult
          classification and do not apply to children — read a child&apos;s BMI against a growth chart instead.
        </Text>
      }
      copyText={bmi === null ? null : `BMI ${bmi.toFixed(BMI_DECIMALS)} kg/m² (${band ? BMI_BAND_LABEL[band] : ''})`.trim()}
      onReset={() => {
        setHeightCm(null);
        setWeightKg(null);
        setSource(null);
      }}
      onUseVisitData={
        visitHasVitals
          ? () => {
              setHeightCm(Number(latest!.height));
              setWeightKg(Number(latest!.weight));
              setSource(
                `Using the vitals recorded at ${formatClinicDateTime(latest!.recordedAt)}. Editing the values above does not change that reading.`,
              );
            }
          : undefined
      }
    >
      <Row gutter={[12, 8]}>
        <Col xs={12}>
          <label htmlFor="kw-calc-height">
            <Text type="secondary" style={{ fontSize: 12 }}>Height (cm)</Text>
          </label>
          <InputNumber
            id="kw-calc-height"
            style={{ width: '100%' }}
            min={0}
            step={0.1}
            value={heightCm}
            onChange={(value) => {
              setHeightCm(value);
              setSource(null);
            }}
          />
        </Col>
        <Col xs={12}>
          <label htmlFor="kw-calc-weight">
            <Text type="secondary" style={{ fontSize: 12 }}>Weight (kg)</Text>
          </label>
          <InputNumber
            id="kw-calc-weight"
            style={{ width: '100%' }}
            min={0}
            step={0.1}
            value={weightKg}
            onChange={(value) => {
              setWeightKg(value);
              setSource(null);
            }}
          />
        </Col>
      </Row>
    </KuwickCalculatorShell>
  );
}
