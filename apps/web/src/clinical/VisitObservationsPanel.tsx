import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Tag, Typography, message } from 'antd';
import { HeartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useCorrectObservation,
  useRecordObservation,
  useVisitObservations,
} from './hooks/useVisitObservations';
import { RecordObservationDto, VisitObservation } from './types';
import { ApiError } from '../core/api-client';
import { BMI_BAND_LABEL, bmiBand, displayBmi } from './vitalsBmi';
import {
  SubmitGuardState,
  VitalsFormValues,
  decideSubmit,
  isVitalsFormEmpty,
  liveBmi,
  vitalsSignature,
} from './vitalsEntry';

const { Text } = Typography;

const PAIN_SCORE_OPTIONS = [
  { value: undefined, label: 'No Pain / -' },
  ...Array.from({ length: 11 }, (_, score) => ({
    value: score,
    label: `${score === 0 ? 'No Pain' : score <= 3 ? 'Mild' : score <= 6 ? 'Moderate' : 'Severe'} / ${score}`,
  })),
];

function num(value: string | number | null): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

// Who took this reading. Legacy rows migrated from the old ClinicalNote
// vitals columns have no recorder — we say so rather than guessing, because
// inferring one would be false medicolegal attribution.
function Attribution({ observation }: { observation: VisitObservation }) {
  return (
    <Space size={4} wrap style={{ fontSize: 11 }}>
      {observation.legacyRecorderUnknown ? (
        <Text type="secondary" italic style={{ fontSize: 11 }}>
          Recorder not recorded — legacy entry
        </Text>
      ) : (
        <Text type="secondary" style={{ fontSize: 11 }}>
          Recorded by <Text strong style={{ fontSize: 11 }}>{observation.recorderNameSnapshot}</Text>
          {observation.recorderRoleSnapshot ? ` (${observation.recorderRoleSnapshot.replace(/_/g, ' ').toLowerCase()})` : ''}
          {' · '}
          {dayjs(observation.recordedAt).format('D MMM YYYY, HH:mm')}
        </Text>
      )}
      {observation.updaterNameSnapshot && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          · Corrected by <Text strong style={{ fontSize: 11 }}>{observation.updaterNameSnapshot}</Text>{' '}
          {dayjs(observation.updatedAt).format('D MMM, HH:mm')}
        </Text>
      )}
    </Space>
  );
}

/**
 * G4.5d3c-3c — BMI while the numbers are still being typed.
 *
 * Rendered from `liveBmi`, which is a pure function of the two form fields.
 * There is no Save, no Calculate button and no request: the doctor enters a
 * height and a weight and the number is there. Height is in centimetres and
 * the conversion to metres happens inside the shared calculator, so this
 * component cannot get it wrong.
 *
 * Nothing is displayed until BOTH values are usable — an incomplete pair is
 * not a BMI of zero, and printing "NaN" or "Infinity" beside a patient's
 * weight is exactly what the shared calculator exists to prevent.
 */
function LiveBmi({ values }: { values: VitalsFormValues }) {
  const bmi = liveBmi(values);
  const band = bmiBand(bmi);
  return (
    <div className="kw-live-bmi" aria-live="polite" data-testid="live-bmi">
      <Text type="secondary" style={{ fontSize: 12 }}>
        BMI
      </Text>{' '}
      {bmi === null ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          — enter height and weight
        </Text>
      ) : (
        <>
          <Text strong style={{ fontSize: 13 }}>
            {bmi.toFixed(1)}
          </Text>
          {band && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              · {BMI_BAND_LABEL[band]} (adult)
            </Text>
          )}
        </>
      )}
    </div>
  );
}

/** The saved reading as one compact line, with Correct beside it. */
function ObservationLine({
  observation,
  onCorrect,
}: {
  observation: VisitObservation;
  onCorrect: () => void;
}) {
  const bmi = displayBmi({
    serverBmi: observation.bmi,
    weight: observation.weight,
    height: observation.height,
  });
  return (
    <div style={{ borderBottom: '1px solid #f5f5f5', paddingBottom: 4 }}>
      <Space wrap size={10} style={{ fontSize: 12 }}>
        <span>BP <strong>{observation.bpSystolic ?? '—'}/{observation.bpDiastolic ?? '—'}</strong></span>
        <span>Pulse <strong>{observation.pulse ?? '—'}</strong></span>
        <span>Temp <strong>{observation.temperature ?? '—'}</strong></span>
        <span>SpO₂ <strong>{observation.spo2 ?? '—'}</strong></span>
        <span>Resp <strong>{observation.respRate ?? '—'}</strong></span>
        <span>Pain <strong>{observation.painScore ?? '—'}</strong></span>
        <span>Wt <strong>{observation.weight ?? '—'}</strong></span>
        <span>Ht <strong>{observation.height ?? '—'}</strong></span>
        <span>HC <strong>{observation.headCircumference ?? '—'}</strong></span>
        <span>BMI <strong>{bmi ?? '—'}</strong></span>
        <span>Glucose <strong>{observation.glucose ?? '—'}</strong></span>
        <Button size="small" type="link" style={{ padding: 0 }} onClick={onCorrect}>
          Correct
        </Button>
      </Space>
      <div>
        <Attribution observation={observation} />
      </div>
    </div>
  );
}

interface VisitObservationsPanelProps {
  visitId: string;
  compact?: boolean;
  /**
   * G4.5d3c-3c — open with the fields showing.
   *
   * The Canvas mounts this panel ONLY when the doctor has already clicked
   * "Record / Edit" on the vitals strip, so opening collapsed made them click
   * a second time to reach the same fields — the exact friction this
   * checkpoint removes, reintroduced one level down. Caught by the screenshot
   * pass, not by the component tests, which rendered the panel directly.
   *
   * Flow renders the panel unconditionally alongside the note and leaves this
   * false, so it still opens as a compact summary there.
   */
  defaultExpanded?: boolean;
}

// C0 (D-051) — vitals/anthropometry/point-of-care, attributed to whoever
// actually recorded them, separate from the doctor's narrative.
//
// Two distinct actions, deliberately not the same button:
//   RECORD  — a NEW reading (repeat BP after treatment)
//   Correct — fixing a mistyped value; requires a reason and keeps the
//             previous value in an immutable revision.
//
// G4.5d3c-3c — the fields are simply THERE.
//
// Recording used to begin with an "Add"/"Record vitals" action that revealed
// the form: the commonest single act on this panel cost a click before any
// typing could start, on every visit, for a clinic seeing 200 patients a day.
// The entry fields are now the panel's resting state and the saved readings
// sit above them as a compact, editable summary. No field, no attribution and
// no correction rule was removed to do it — Correct still opens the same form
// with the same mandatory reason and the same immutable revision behind it.
export function VisitObservationsPanel({ visitId, compact, defaultExpanded }: VisitObservationsPanelProps) {
  const { data: observations, isLoading } = useVisitObservations(visitId);
  const record = useRecordObservation(visitId);
  const correct = useCorrectObservation(visitId);
  const [form] = Form.useForm<RecordObservationDto & { correctionReason?: string }>();
  const [correcting, setCorrecting] = useState<VisitObservation | null>(null);

  // Collapsed by default only where the panel is always on screen. Where the
  // parent mounted it because the doctor asked for it, it opens ready to type.
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const latest = observations?.[0];

  // Live values for the BMI readout. Form.useWatch would need one hook per
  // field; a single onValuesChange keeps both numbers in one place and makes
  // the pure `liveBmi`/`isVitalsFormEmpty` calls trivial to test.
  const [values, setValues] = useState<VitalsFormValues>({});

  // G4.5d3c-3c — the client half of the duplicate-vitals fix. A ref, not
  // state: it must be correct DURING the submit handler, and a state update
  // scheduled by the first Enter has not landed by the time the second one
  // runs. See vitalsEntry.decideSubmit for the reasoning.
  const guard = useRef<SubmitGuardState>({ inFlight: null, lastAccepted: null });

  const startCorrect = (target: VisitObservation) => {
    const next: VitalsFormValues = {
      bpSystolic: num(target.bpSystolic),
      bpDiastolic: num(target.bpDiastolic),
      pulse: num(target.pulse),
      temperature: num(target.temperature),
      spo2: num(target.spo2),
      respRate: num(target.respRate),
      painScore: target.painScore ?? undefined,
      weight: num(target.weight),
      height: num(target.height),
      headCircumference: num(target.headCircumference),
      glucose: num(target.glucose),
    };
    form.setFieldsValue({ ...next, correctionReason: undefined } as never);
    setValues(next);
    setCorrecting(target);
    setExpanded(true);
  };

  const cancelCorrection = () => {
    form.resetFields();
    setValues({});
    setCorrecting(null);
  };

  const handleSubmit = async (submitted: RecordObservationDto & { correctionReason?: string }) => {
    const { correctionReason, ...vitals } = submitted;

    if (correcting) {
      try {
        await correct.mutateAsync({
          id: correcting.id,
          dto: { ...vitals, expectedVersion: correcting.version, correctionReason: correctionReason ?? '' },
        });
        message.success('Observation corrected — previous value kept in the audit trail');
        cancelCorrection();
      } catch (error) {
        message.error(error instanceof ApiError ? error.message : 'Failed to save observations');
      }
      return;
    }

    if (isVitalsFormEmpty(vitals)) {
      // The server refuses an empty set; saying so here means the doctor does
      // not learn it from a failed request.
      message.warning('Enter at least one observation before saving.');
      return;
    }

    const decision = decideSubmit(guard.current, vitals);
    if (!decision.allow) {
      message.warning(decision.message);
      return;
    }

    const signature = vitalsSignature(vitals);
    guard.current = { ...guard.current, inFlight: signature };
    try {
      await record.mutateAsync(vitals);
      guard.current = { inFlight: null, lastAccepted: signature };
      message.success('Observations recorded');
      form.resetFields();
      setValues({});
    } catch (error) {
      // The guard is released, NOT marked accepted: a failed save must be
      // retryable with exactly the same values.
      guard.current = { ...guard.current, inFlight: null };
      message.error(error instanceof ApiError ? error.message : 'Failed to save observations');
    }
  };

  // A visit switch resets the guard: the same reading on a different patient
  // is a different reading.
  useEffect(() => {
    guard.current = { inFlight: null, lastAccepted: null };
    form.resetFields();
    setValues({});
    setCorrecting(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  // C2 (D-053) — collapsed by default in Canvas: one line with the latest
  // reading and who recorded it, so vitals stay visible and attributed
  // without consuming height the note editor needs. Everything expands
  // unchanged; no observation field or attribution was removed.
  if (compact && !expanded) {
    const compactBmi = latest
      ? displayBmi({ serverBmi: latest.bmi, weight: latest.weight, height: latest.height })
      : null;
    return (
      <div
        style={{
          padding: '4px 10px',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          marginBottom: 4,
          flex: '0 0 auto',
        }}
      >
        <Space wrap size={10} style={{ fontSize: 12, width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <HeartOutlined /> Vitals
          </Text>
          {latest ? (
            <>
              <span>BP <strong>{latest.bpSystolic ?? '—'}/{latest.bpDiastolic ?? '—'}</strong></span>
              <span>Pulse <strong>{latest.pulse ?? '—'}</strong></span>
              <span>Temp <strong>{latest.temperature ?? '—'}</strong></span>
              <span>SpO₂ <strong>{latest.spo2 ?? '—'}</strong></span>
              <span>Wt <strong>{latest.weight ?? '—'}</strong></span>
              <span>BMI <strong>{compactBmi ?? '—'}</strong></span>
              {observations && observations.length > 1 && <Tag>{observations.length} sets</Tag>}
            </>
          ) : (
            <Text type="secondary" italic style={{ fontSize: 12 }}>
              No vitals recorded yet
            </Text>
          )}
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setExpanded(true)}>
            {latest ? 'Record / Edit' : 'Record'}
          </Button>
        </Space>
        {latest && (
          <div style={{ lineHeight: 1.2 }}>
            <Attribution observation={latest} />
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <HeartOutlined /> Vitals &amp; Observations
          {observations && observations.length > 1 && <Tag>{observations.length} sets</Tag>}
          {compact && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setExpanded(false)}>
              Collapse
            </Button>
          )}
        </Space>
      }
      style={{ marginBottom: compact ? 6 : 8 }}
      styles={
        compact
          ? { header: { padding: '2px 10px', minHeight: 24 }, body: { padding: '6px 10px' } }
          : { header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }
      }
      loading={isLoading}
    >
      {/* The saved readings, above the fields. A compact editable summary:
          every value, every attribution, and Correct on each row. */}
      {latest && !correcting && (
        <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 8 }}>
          {observations!.map((observation) => (
            <ObservationLine
              key={observation.id}
              observation={observation}
              onCorrect={() => startCorrect(observation)}
            />
          ))}
        </Space>
      )}

      <Form
        form={form}
        layout="vertical"
        size="small"
        onFinish={handleSubmit}
        onValuesChange={(_, all) => setValues(all as VitalsFormValues)}
      >
        {correcting && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            message="Correcting an existing reading"
            description="The previous values are preserved in the audit trail. To record a repeat reading instead, cancel and enter a new set."
          />
        )}
        <Row gutter={[8, 0]}>
          <Col span={6}>
            <Form.Item label="BP (Sys/Dia)" style={{ marginBottom: 4 }}>
              <Space.Compact>
                <Form.Item name="bpSystolic" noStyle>
                  <InputNumber style={{ width: '50%' }} />
                </Form.Item>
                <Form.Item name="bpDiastolic" noStyle>
                  <InputNumber style={{ width: '50%' }} />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="pulse" label="Pulse" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="temperature" label="Temp (°C)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="spo2" label="SpO₂ (%)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} min={0} max={100} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="respRate" label="Resp. Rate" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="painScore" label="Pain Score (0-10)" style={{ marginBottom: 4 }}>
              <Select allowClear options={PAIN_SCORE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="weight" label="Weight (kg)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="height" label="Height (cm)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
          {/* Present in the schema since Phase 3a but with no input field
              until C0 — recordable at last. */}
          <Col span={4}>
            <Form.Item name="headCircumference" label="Head Circ. (cm)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="glucose" label="Glucose (mmol/L)" style={{ marginBottom: 4 }}>
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Col>
        </Row>

        {/* Live, from the fields above. No Save, no Calculate, no request. */}
        <LiveBmi values={values} />

        {correcting && (
          <Form.Item
            name="correctionReason"
            label="Reason for correction"
            rules={[{ required: true, message: 'A correction requires a reason' }]}
            style={{ marginBottom: 8, marginTop: 8 }}
          >
            <Input placeholder="e.g. BP transcribed incorrectly" />
          </Form.Item>
        )}

        <Space style={{ marginTop: 8 }}>
          <Button type="primary" htmlType="submit" loading={record.isPending || correct.isPending}>
            {correcting ? 'Save Correction' : 'Save Observations'}
          </Button>
          {correcting && <Button onClick={cancelCorrection}>Cancel</Button>}
        </Space>
      </Form>
    </Card>
  );
}
