import { useEffect, useState } from 'react';
import { Button, Card, Col, Dropdown, Form, Input, InputNumber, Row, Segmented, Space, Statistic, message } from 'antd';
import { AudioOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useClinicalNote, useSaveClinicalNote } from './hooks/useClinicalNote';
import { NoteLanguage, UpsertClinicalNoteDto } from './types';
import { ApiError } from '../core/api-client';

const { TextArea } = Input;

// A hardcoded starter set, not a per-tenant configurable dictionary — no
// admin screen manages this (Clinical 2a plan, judgment call #4).
const SMART_ABBREVIATIONS: Record<string, string> = {
  SOB: 'Shortness of breath',
  'N/V': 'Nausea and vomiting',
  URTI: 'Upper respiratory tract infection',
  HTN: 'Hypertension',
  DM: 'Diabetes mellitus',
  Fx: 'Fracture',
  Hx: 'History of presenting complaint',
  Tx: 'Treatment',
  Dx: 'Diagnosis',
  'c/o': 'Complains of',
};

// TypeScript's bundled DOM lib doesn't ship SpeechRecognition types (still
// vendor-prefixed/experimental) — minimal shape declared here rather than
// pulling in a types package for one browser API (D-025: browser Web Speech
// API only, no paid dependency).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

interface ClinicalNotesTabProps {
  visitId: string;
}

export function ClinicalNotesTab({ visitId }: ClinicalNotesTabProps) {
  const { data: note, isLoading } = useClinicalNote(visitId);
  const saveNote = useSaveClinicalNote(visitId);
  const [form] = Form.useForm<UpsertClinicalNoteDto>();
  const [language, setLanguage] = useState<NoteLanguage>('EN');
  const [listening, setListening] = useState(false);
  const [weight, setWeight] = useState<number | undefined>();
  const [height, setHeight] = useState<number | undefined>();

  useEffect(() => {
    if (note) {
      form.setFieldsValue({
        bpSystolic: note.bpSystolic ?? undefined,
        bpDiastolic: note.bpDiastolic ?? undefined,
        pulse: note.pulse ?? undefined,
        temperature: note.temperature ? Number(note.temperature) : undefined,
        spo2: note.spo2 ?? undefined,
        respRate: note.respRate ?? undefined,
        painScore: note.painScore ?? undefined,
        weight: note.weight ? Number(note.weight) : undefined,
        height: note.height ? Number(note.height) : undefined,
        headCircumference: note.headCircumference ? Number(note.headCircumference) : undefined,
        glucose: note.glucose ? Number(note.glucose) : undefined,
        notes: note.notes ?? undefined,
      });
      setLanguage(note.noteLanguage);
      setWeight(note.weight ? Number(note.weight) : undefined);
      setHeight(note.height ? Number(note.height) : undefined);
    }
  }, [note, form]);

  const bmi = weight && height ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : (note?.bmi ?? null);

  const handleSave = async (values: UpsertClinicalNoteDto) => {
    try {
      await saveNote.mutateAsync({ ...values, noteLanguage: language });
      message.success('Clinical note saved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save clinical note');
    }
  };

  const toggleDictation = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      message.warning('Dictation is not supported in this browser');
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = language === 'MS' ? 'ms-MY' : 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      const current = form.getFieldValue('notes') ?? '';
      form.setFieldValue('notes', current ? `${current} ${transcript}` : transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const insertAbbreviation = (expansion: string) => {
    const current = form.getFieldValue('notes') ?? '';
    form.setFieldValue('notes', current ? `${current} ${expansion}` : expansion);
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleSave} disabled={isLoading}>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="Vital Signs" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={8}>
              <Col span={12}>
                <Form.Item name="bpSystolic" label="BP Systolic">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="bpDiastolic" label="BP Diastolic">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="pulse" label="Pulse (bpm)">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="temperature" label="Temp (°C)">
                  <InputNumber style={{ width: '100%' }} step={0.1} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="spo2" label="SpO2 (%)">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="respRate" label="Resp. Rate">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="painScore" label="Pain Score (0-10)">
                  <InputNumber style={{ width: '100%' }} min={0} max={10} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card title="Point-of-Care / Others" size="small">
            <Form.Item name="glucose" label="Glucose">
              <InputNumber style={{ width: '100%' }} step={0.1} />
            </Form.Item>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Anthropometry" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={8}>
              <Col span={12}>
                <Form.Item name="weight" label="Weight (kg)">
                  <InputNumber<number>
                    style={{ width: '100%' }}
                    step={0.1}
                    onChange={(v) => setWeight(v ?? undefined)}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="height" label="Height (cm)">
                  <InputNumber<number>
                    style={{ width: '100%' }}
                    step={0.1}
                    onChange={(v) => setHeight(v ?? undefined)}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Statistic title="BMI" value={bmi ?? '—'} />
              </Col>
              <Col span={12}>
                <Form.Item name="headCircumference" label="Head Circumference (cm)">
                  <InputNumber style={{ width: '100%' }} step={0.1} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card
            title="Notes"
            size="small"
            extra={
              <Space>
                <Segmented
                  size="small"
                  value={language}
                  onChange={(value) => setLanguage(value as NoteLanguage)}
                  options={[
                    { label: 'EN', value: 'EN' },
                    { label: 'BM', value: 'MS' },
                  ]}
                />
                <Button
                  size="small"
                  icon={<AudioOutlined />}
                  type={listening ? 'primary' : 'default'}
                  onClick={toggleDictation}
                >
                  {listening ? 'Stop' : 'Dictate'}
                </Button>
                <Dropdown
                  menu={{
                    items: Object.entries(SMART_ABBREVIATIONS).map(([code, expansion]) => ({
                      key: code,
                      label: `${code} — ${expansion}`,
                      onClick: () => insertAbbreviation(expansion),
                    })),
                  }}
                >
                  <Button size="small" icon={<ThunderboltOutlined />}>
                    Smart Abbreviation
                  </Button>
                </Dropdown>
              </Space>
            }
          >
            <Form.Item name="notes" noStyle>
              <TextArea rows={10} placeholder="Clinical notes..." />
            </Form.Item>
          </Card>
        </Col>
      </Row>
      <Button type="primary" htmlType="submit" loading={saveNote.isPending} style={{ marginTop: 16 }}>
        Save Clinical Note
      </Button>
    </Form>
  );
}
