import { useState } from 'react';
import { Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Row, Select, Space, Tag, Typography, message } from 'antd';
import { HeartOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useCorrectObservation,
  useRecordObservation,
  useVisitObservations,
} from './hooks/useVisitObservations';
import { RecordObservationDto, VisitObservation } from './types';
import { ApiError } from '../core/api-client';

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

interface VisitObservationsPanelProps {
  visitId: string;
  compact?: boolean;
}

// C0 (D-051) — vitals/anthropometry/point-of-care, attributed to whoever
// actually recorded them, separate from the doctor's narrative.
//
// Two distinct actions, deliberately not the same button:
//   "Record vitals"  — a NEW reading (repeat BP after treatment)
//   "Correct"        — fixing a mistyped value; requires a reason and keeps
//                      the previous value in an immutable revision.
export function VisitObservationsPanel({ visitId, compact }: VisitObservationsPanelProps) {
  const { data: observations, isLoading } = useVisitObservations(visitId);
  const record = useRecordObservation(visitId);
  const correct = useCorrectObservation(visitId);
  const [form] = Form.useForm<RecordObservationDto & { correctionReason?: string }>();
  const [mode, setMode] = useState<{ kind: 'idle' } | { kind: 'record' } | { kind: 'correct'; target: VisitObservation }>({
    kind: 'idle',
  });

  // Collapsed by default in Canvas; the doctor opens it only when reading or
  // editing the full set.
  const [expanded, setExpanded] = useState(false);
  const latest = observations?.[0];

  const openRecord = () => {
    form.resetFields();
    setMode({ kind: 'record' });
  };

  const openCorrect = (target: VisitObservation) => {
    form.setFieldsValue({
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
      correctionReason: undefined,
    });
    setMode({ kind: 'correct', target });
  };

  const handleSubmit = async (values: RecordObservationDto & { correctionReason?: string }) => {
    try {
      if (mode.kind === 'correct') {
        const { correctionReason, ...vitals } = values;
        await correct.mutateAsync({
          id: mode.target.id,
          dto: { ...vitals, expectedVersion: mode.target.version, correctionReason: correctionReason ?? '' },
        });
        message.success('Observation corrected — previous value kept in the audit trail');
      } else {
        await record.mutateAsync(values);
        message.success('Observations recorded');
      }
      form.resetFields();
      setMode({ kind: 'idle' });
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save observations');
    }
  };

  // C2 (D-053) — collapsed by default in Canvas: one line with the latest
  // reading and who recorded it, so vitals stay visible and attributed
  // without consuming height the note editor needs. Everything expands
  // unchanged; no observation field or attribution was removed.
  if (compact && mode.kind === 'idle' && !expanded) {
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
              <span>BMI <strong>{latest.bmi ?? '—'}</strong></span>
              {observations && observations.length > 1 && <Tag>{observations.length} sets</Tag>}
            </>
          ) : (
            <Text type="secondary" italic style={{ fontSize: 12 }}>
              No vitals recorded yet
            </Text>
          )}
          <Button size="small" type="link" style={{ padding: 0 }} onClick={openRecord}>
            Record
          </Button>
          {latest && (
            <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setExpanded(true)}>
              Expand
            </Button>
          )}
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
      extra={
        mode.kind === 'idle' && (
          <Button size="small" icon={<PlusOutlined />} onClick={openRecord}>
            Record vitals
          </Button>
        )
      }
      loading={isLoading}
    >
      {mode.kind === 'idle' ? (
        !latest ? (
          <Empty
            image={<HeartOutlined style={{ fontSize: 22, opacity: 0.3 }} />}
            description="No vitals recorded yet"
            style={{ margin: '4px 0' }}
          />
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {observations!.map((observation) => (
              <div key={observation.id} style={{ borderBottom: '1px solid #f5f5f5', paddingBottom: 4 }}>
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
                  <span>BMI <strong>{observation.bmi ?? '—'}</strong></span>
                  <span>Glucose <strong>{observation.glucose ?? '—'}</strong></span>
                  <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openCorrect(observation)}>
                    Correct
                  </Button>
                </Space>
                <div>
                  <Attribution observation={observation} />
                </div>
              </div>
            ))}
          </Space>
        )
      ) : (
        <Form form={form} layout="vertical" size="small" onFinish={handleSubmit}>
          {mode.kind === 'correct' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message="Correcting an existing reading"
              description="The previous values are preserved in the audit trail. To record a repeat reading instead, cancel and use 'Record vitals'."
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
          {mode.kind === 'correct' && (
            <Form.Item
              name="correctionReason"
              label="Reason for correction"
              rules={[{ required: true, message: 'A correction requires a reason' }]}
              style={{ marginBottom: 8 }}
            >
              <Input placeholder="e.g. BP transcribed incorrectly" />
            </Form.Item>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={record.isPending || correct.isPending}>
              {mode.kind === 'correct' ? 'Save Correction' : 'Save Observations'}
            </Button>
            <Button onClick={() => setMode({ kind: 'idle' })}>Cancel</Button>
          </Space>
        </Form>
      )}
    </Card>
  );
}
