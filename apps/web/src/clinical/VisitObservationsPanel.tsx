import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Tag, Typography, message } from 'antd';
import { EditOutlined, HeartOutlined, PlusOutlined } from '@ant-design/icons';
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

/**
 * One saved reading, compact.
 *
 * This IS the resting state after a save (3c1), so it has to carry everything
 * a doctor needs without opening anything: every recorded value, the BMI, who
 * took it and when, and the way to correct it. It wraps rather than scrolls,
 * so the same markup is readable on a phone.
 */
function ObservationLine({
  observation,
  onCorrect,
  highlighted,
}: {
  observation: VisitObservation;
  onCorrect: () => void;
  highlighted?: boolean;
}) {
  const bmi = displayBmi({
    serverBmi: observation.bmi,
    weight: observation.weight,
    height: observation.height,
  });
  return (
    <div
      className="kw-vitals-line"
      style={{
        borderBottom: '1px solid #f5f5f5',
        paddingBottom: 4,
        // While it is being corrected, the row says which one is on the form.
        background: highlighted ? '#fffbe6' : undefined,
      }}
    >
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
        <Button
          size="small"
          type="link"
          style={{ padding: 0 }}
          onClick={onCorrect}
          aria-label={`Edit the reading recorded at ${dayjs(observation.recordedAt).format('D MMM YYYY, HH:mm')}`}
        >
          Edit
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
}

/**
 * G4.5d3c-3c1 — what the panel is doing right now.
 *
 * An explicit mode, because "which of these three things is on screen" was
 * previously spread across two booleans and read wrong: after a save, the
 * saved summary AND an empty entry form were both shown, which is neither
 * state anybody asked for and cost most of the Canvas to say so.
 *
 *   FIRST_ENTRY   the visit has no observations at all. The fields ARE the
 *                 panel — no Add step in front of them, and no Cancel,
 *                 because there is nothing to go back to.
 *   SUMMARY       the resting state once anything is saved. Compact, every
 *                 value, attribution and time, with Edit and Record New
 *                 Reading. NO form underneath.
 *   EDIT          correcting a specific reading. Populated, requires a
 *                 reason (C0/D-051, unchanged), Cancel returns to SUMMARY
 *                 and writes nothing.
 *   NEW_READING   a deliberate second reading later in the visit. Blank,
 *                 Cancel returns to SUMMARY.
 *
 * EDIT and NEW_READING are deliberately different actions with different
 * words, because they are different clinical claims: one says the recorded
 * reading was wrong, the other says the patient was measured again. An
 * always-open blank form conflated them by default.
 */
type PanelMode =
  | { kind: 'FIRST_ENTRY' }
  | { kind: 'SUMMARY' }
  | { kind: 'EDIT'; target: VisitObservation }
  | { kind: 'NEW_READING' };

// C0 (D-051) — vitals/anthropometry/point-of-care, attributed to whoever
// actually recorded them, separate from the doctor's narrative.
//
// G4.5d3c-3c — the fields are simply THERE for a first entry: the commonest
// act on this panel cost a click before any typing could start.
// G4.5d3c-3c1 — and the RESTING state after a save is compact again.
export function VisitObservationsPanel({ visitId, compact }: VisitObservationsPanelProps) {
  const { data: observations, isLoading } = useVisitObservations(visitId);
  const record = useRecordObservation(visitId);
  const correct = useCorrectObservation(visitId);
  const [form] = Form.useForm<RecordObservationDto & { correctionReason?: string }>();

  // NULL means "follow the data": first entry while nothing is saved, the
  // compact summary once something is. Only a deliberate Edit or Record New
  // Reading pins a mode, and finishing either releases it — so a save can
  // never leave the form open, which is the defect this corrects.
  const [pinned, setPinned] = useState<PanelMode | null>(null);

  const [values, setValues] = useState<VitalsFormValues>({});
  // G4.5d3c-3c — the client half of the duplicate-vitals fix. A ref, not
  // state: it must be correct DURING the submit handler, and a state update
  // scheduled by the first Enter has not landed by the time the second runs.
  const guard = useRef<SubmitGuardState>({ inFlight: null, lastAccepted: null });

  const saved = observations ?? [];
  const latest = saved[0];
  const mode: PanelMode = pinned ?? (saved.length === 0 ? { kind: 'FIRST_ENTRY' } : { kind: 'SUMMARY' });
  const showingForm = mode.kind !== 'SUMMARY';

  const valuesOf = (target: VisitObservation): VitalsFormValues => ({
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
  });

  const startEdit = (target: VisitObservation) => {
    setValues(valuesOf(target));
    setPinned({ kind: 'EDIT', target });
  };

  const startNewReading = () => {
    setValues({});
    setPinned({ kind: 'NEW_READING' });
  };

  /** Back to the compact summary, having written nothing. */
  const backToSummary = () => {
    form.resetFields();
    setValues({});
    setPinned({ kind: 'SUMMARY' });
  };

  const handleSubmit = async (submitted: RecordObservationDto & { correctionReason?: string }) => {
    const { correctionReason, ...vitals } = submitted;

    // EDIT is a CORRECTION, not a new row. It targets the reading the doctor
    // opened, carries its expectedVersion, requires a reason and preserves
    // the previous values in an immutable revision — none of that changed.
    if (mode.kind === 'EDIT') {
      try {
        await correct.mutateAsync({
          id: mode.target.id,
          dto: { ...vitals, expectedVersion: mode.target.version, correctionReason: correctionReason ?? '' },
        });
        message.success('Observation corrected — previous value kept in the audit trail');
        backToSummary();
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
      // The correction this checkpoint exists for: a successful save lands in
      // the compact summary, never back on an empty form.
      backToSummary();
    } catch (error) {
      // The guard is released, NOT marked accepted: a failed save must be
      // retryable with exactly the same values, and the form must stay open
      // holding what was typed.
      guard.current = { ...guard.current, inFlight: null };
      message.error(error instanceof ApiError ? error.message : 'Failed to save observations');
    }
  };

  // The form is only MOUNTED in a form mode, so its fields cannot be set from
  // the click handler that opened it — antd warns that the instance is not
  // connected to any Form, and the values would be written into a form that
  // does not exist yet. Populating here runs after the Form has rendered.
  useEffect(() => {
    if (mode.kind === 'EDIT') {
      form.setFieldsValue({ ...valuesOf(mode.target), correctionReason: undefined } as never);
    } else if (mode.kind === 'NEW_READING' || mode.kind === 'FIRST_ENTRY') {
      form.resetFields();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, mode.kind === 'EDIT' ? mode.target.id : null]);

  // A visit switch resets everything: the same reading on a different patient
  // is a different reading. The fields are cleared only while the form is
  // actually mounted — that is the one case the mode effect above cannot
  // cover (the mode key does not change, so it will not re-run). In SUMMARY
  // there is no form to clear, calling into the disconnected instance is a
  // console error (A1), and every later entry into a form mode sets or
  // resets all fields anyway.
  useEffect(() => {
    guard.current = { inFlight: null, lastAccepted: null };
    if (showingForm) form.resetFields();
    setValues({});
    setPinned(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);

  const cardPadding = compact
    ? { header: { padding: '2px 10px', minHeight: 24 }, body: { padding: '6px 10px' } }
    : { header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } };

  return (
    <Card
      size="small"
      data-vitals-mode={mode.kind}
      title={
        <Space size={6} wrap>
          <HeartOutlined aria-hidden /> Vitals &amp; Observations
          {saved.length > 1 && <Tag>{saved.length} sets</Tag>}
        </Space>
      }
      style={{ marginBottom: compact ? 6 : 8 }}
      styles={cardPadding}
      // The two actions live in the header, where they are reachable without
      // scrolling past the readings, and only in the resting state — a form
      // is already open in every other mode.
      extra={
        mode.kind === 'SUMMARY' && (
          <Space size={6} wrap>
            {latest && (
              <Button size="small" icon={<EditOutlined aria-hidden />} onClick={() => startEdit(latest)}>
                Edit
              </Button>
            )}
            {/* A LATER reading, not a correction. Separate words because it is
                a separate clinical claim: the patient was measured again. */}
            <Button size="small" icon={<PlusOutlined aria-hidden />} onClick={startNewReading}>
              Record New Reading
            </Button>
          </Space>
        )
      }
      loading={isLoading}
    >
      {/* The saved readings. In SUMMARY they are the whole panel; while a form
          is open they stay visible above it so the doctor can see what they
          are correcting or adding to. */}
      {saved.length > 0 && (
        <Space
          direction="vertical"
          size={4}
          className="kw-vitals-summary"
          style={{ width: '100%', marginBottom: showingForm ? 8 : 0 }}
        >
          {saved.map((observation) => (
            <ObservationLine
              key={observation.id}
              observation={observation}
              onCorrect={() => startEdit(observation)}
              highlighted={mode.kind === 'EDIT' && mode.target.id === observation.id}
            />
          ))}
        </Space>
      )}

      {/* No form at all in the resting state. This is the correction. */}
      {showingForm && (
        <Form
          form={form}
          layout="vertical"
          size="small"
          onFinish={handleSubmit}
          onValuesChange={(_, all) => setValues(all as VitalsFormValues)}
        >
          {mode.kind === 'EDIT' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message="Correcting an existing reading"
              description="The previous values are preserved in the audit trail. To record a repeat measurement instead, cancel and use Record New Reading."
            />
          )}
          {mode.kind === 'NEW_READING' && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message="Recording a new reading"
              description="This is kept as a separate, separately attributed set — the earlier reading is not changed."
            />
          )}

          <Row gutter={[8, 0]}>
            <Col xs={12} sm={12} md={6}>
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
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="pulse" label="Pulse" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="temperature" label="Temp (°C)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} step={0.1} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="spo2" label="SpO₂ (%)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Form.Item name="respRate" label="Resp. Rate" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item name="painScore" label="Pain Score (0-10)" style={{ marginBottom: 4 }}>
                <Select allowClear options={PAIN_SCORE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="weight" label="Weight (kg)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} step={0.1} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="height" label="Height (cm)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} step={0.1} />
              </Form.Item>
            </Col>
            {/* Present in the schema since Phase 3a but with no input field
                until C0 — recordable at last. */}
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="headCircumference" label="Head Circ. (cm)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} step={0.1} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={12} md={4}>
              <Form.Item name="glucose" label="Glucose (mmol/L)" style={{ marginBottom: 4 }}>
                <InputNumber style={{ width: '100%' }} step={0.1} />
              </Form.Item>
            </Col>
          </Row>

          {/* Live, from the fields above. No Save, no Calculate, no request —
              and it recalculates in EDIT exactly as it does in a new entry. */}
          <LiveBmi values={values} />

          {mode.kind === 'EDIT' && (
            <Form.Item
              name="correctionReason"
              label="Reason for correction"
              // U1 — optional. See visit-observation.service.ts: the revision
              // still records who, when and what changed; only the sentence
              // is now the editor's choice.
              rules={[]}
              style={{ marginBottom: 8, marginTop: 8 }}
            >
              <Input placeholder="e.g. BP transcribed incorrectly" />
            </Form.Item>
          )}

          <Space style={{ marginTop: 8 }} wrap>
            <Button type="primary" htmlType="submit" loading={record.isPending || correct.isPending}>
              {mode.kind === 'EDIT' ? 'Save Correction' : 'Save Vitals'}
            </Button>
            {/* No Cancel on a first entry: there is no saved state to return
                to, and a control that appears to undo nothing is noise. */}
            {mode.kind !== 'FIRST_ENTRY' && <Button onClick={backToSummary}>Cancel</Button>}
          </Space>
        </Form>
      )}
    </Card>
  );
}
