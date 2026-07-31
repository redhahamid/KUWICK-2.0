import { useEffect, useState } from 'react';
import { Button, Card, Col, Dropdown, Form, InputNumber, Row, Select, Space, message } from 'antd';
import { AudioOutlined, HeartOutlined, MedicineBoxOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { useClinicalNote, useSaveClinicalNote } from './hooks/useClinicalNote';
import { RichTextEditor } from './RichTextEditor';
import { NoteLanguage, UpsertClinicalNoteDto } from './types';
import { ApiError } from '../core/api-client';

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

const PAIN_SCORE_OPTIONS = [
  { value: undefined, label: 'No Pain / -' },
  ...Array.from({ length: 11 }, (_, score) => ({
    value: score,
    label: `${score === 0 ? 'No Pain' : score <= 3 ? 'Mild' : score <= 6 ? 'Moderate' : 'Severe'} / ${score}`,
  })),
];

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
  // Canvas layout needs the whole record visible without page scroll
  // (user feedback) — compact collapses Vitals/Anthropometry/Point-of-Care
  // into one strip and shrinks the Notes editor to a short, internally-
  // scrollable box instead of Flow mode's full three-card layout.
  compact?: boolean;
}

export function ClinicalNotesTab({ visitId, compact }: ClinicalNotesTabProps) {
  const { data: note, isLoading } = useClinicalNote(visitId);
  const saveNote = useSaveClinicalNote(visitId);
  const [form] = Form.useForm<UpsertClinicalNoteDto>();
  const [language, setLanguage] = useState<NoteLanguage>('EN');
  const [listening, setListening] = useState(false);
  const [weight, setWeight] = useState<number | undefined>();
  const [height, setHeight] = useState<number | undefined>();
  const [notesHtml, setNotesHtml] = useState('');

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
      });
      setLanguage(note.noteLanguage);
      setWeight(note.weight ? Number(note.weight) : undefined);
      setHeight(note.height ? Number(note.height) : undefined);
      setNotesHtml(note.notes ?? '');
    }
  }, [note, form]);

  const bmi = weight && height ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : (note?.bmi ?? null);

  const handleSave = async () => {
    try {
      const values = form.getFieldsValue();
      await saveNote.mutateAsync({ ...values, notes: notesHtml, noteLanguage: language });
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
      setNotesHtml((current) => (current ? `${current}<p>${transcript}</p>` : `<p>${transcript}</p>`));
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const insertAbbreviation = (expansion: string) => {
    setNotesHtml((current) => (current ? `${current}<p>${expansion}</p>` : `<p>${expansion}</p>`));
  };

  return (
    <Form form={form} layout="vertical" disabled={isLoading} size="small">
      {compact ? (
        <Card
          size="small"
          title={
            <Space>
              <HeartOutlined /> Vitals &amp; Measurements
            </Space>
          }
          style={{ marginBottom: 6 }}
          styles={{ header: { padding: '2px 10px', minHeight: 24 }, body: { padding: '6px 10px' } }}
        >
          <Row gutter={[6, 0]} wrap={false} style={{ overflowX: 'auto' }}>
            <Col flex="0 0 88px">
              <Form.Item label="BP" style={{ marginBottom: 0 }}>
                <Space.Compact>
                  <Form.Item name="bpSystolic" noStyle>
                    <InputNumber controls={false} style={{ width: '50%', fontSize: 12, height: 26 }} />
                  </Form.Item>
                  <Form.Item name="bpDiastolic" noStyle>
                    <InputNumber controls={false} style={{ width: '50%', fontSize: 12, height: 26 }} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            </Col>
            <Col flex="0 0 44px">
              <Form.Item name="pulse" label="Pulse" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} />
              </Form.Item>
            </Col>
            <Col flex="0 0 44px">
              <Form.Item name="temperature" label="Temp" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} step={0.1} />
              </Form.Item>
            </Col>
            <Col flex="0 0 44px">
              <Form.Item name="spo2" label="SpO2" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col flex="0 0 44px">
              <Form.Item name="respRate" label="Resp" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} />
              </Form.Item>
            </Col>
            <Col flex="0 0 64px">
              <Form.Item name="painScore" label="Pain" style={{ marginBottom: 0 }}>
                <Select allowClear options={PAIN_SCORE_OPTIONS} style={{ fontSize: 12 }} />
              </Form.Item>
            </Col>
            <Col flex="0 0 50px">
              <Form.Item name="weight" label="Wt (kg)" style={{ marginBottom: 0 }}>
                <InputNumber<number>
                  controls={false}
                  style={{ width: '100%', fontSize: 12, height: 26 }}
                  step={0.1}
                  onChange={(v) => setWeight(v ?? undefined)}
                />
              </Form.Item>
            </Col>
            <Col flex="0 0 50px">
              <Form.Item name="height" label="Ht (cm)" style={{ marginBottom: 0 }}>
                <InputNumber<number>
                  controls={false}
                  style={{ width: '100%', fontSize: 12, height: 26 }}
                  step={0.1}
                  onChange={(v) => setHeight(v ?? undefined)}
                />
              </Form.Item>
            </Col>
            <Col flex="0 0 44px">
              <Form.Item label="BMI" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} value={bmi ?? undefined} disabled />
              </Form.Item>
            </Col>
            <Col flex="0 0 50px">
              <Form.Item name="glucose" label="Glucose" style={{ marginBottom: 0 }}>
                <InputNumber controls={false} style={{ width: '100%', fontSize: 12, height: 26 }} step={0.1} />
              </Form.Item>
            </Col>
          </Row>
        </Card>
      ) : (
        <>
          <Card
            size="small"
            title={
              <Space>
                <HeartOutlined /> Vital Signs
              </Space>
            }
            style={{ marginBottom: 8 }}
            styles={{ header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }}
          >
            <Row gutter={[16, 0]}>
              <Col span={6}>
                <Form.Item label="BP (Sys/Dia)" style={{ marginBottom: 2 }}>
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
              <Col span={6}>
                <Form.Item name="pulse" label="Pulse (bpm)" style={{ marginBottom: 2 }}>
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="temperature" label="Temp (°C)" style={{ marginBottom: 2 }}>
                  <InputNumber style={{ width: '100%' }} step={0.1} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="spo2" label="SpO2 (%)" style={{ marginBottom: 2 }}>
                  <InputNumber style={{ width: '100%' }} min={0} max={100} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="respRate" label="Resp. Rate (r)" style={{ marginBottom: 0 }}>
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="painScore" label="Pain Score (0-10)" style={{ marginBottom: 0 }}>
                  <Select allowClear options={PAIN_SCORE_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <MedicineBoxOutlined /> Anthropometry
              </Space>
            }
            style={{ marginBottom: 8 }}
            styles={{ header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }}
          >
            <Row gutter={[16, 0]}>
              <Col span={8}>
                <Form.Item name="weight" label="Weight (kg)" style={{ marginBottom: 0 }}>
                  <InputNumber<number>
                    style={{ width: '100%' }}
                    step={0.1}
                    onChange={(v) => setWeight(v ?? undefined)}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="height" label="Height (cm)" style={{ marginBottom: 0 }}>
                  <InputNumber<number>
                    style={{ width: '100%' }}
                    step={0.1}
                    onChange={(v) => setHeight(v ?? undefined)}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="BMI (kg/m²)" style={{ marginBottom: 0 }}>
                  <InputNumber style={{ width: '100%' }} value={bmi ?? undefined} disabled />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            size="small"
            title={
              <Space>
                <WarningOutlined /> Point-of-Care / Others
              </Space>
            }
            style={{ marginBottom: 8 }}
            styles={{ header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }}
          >
            <Row gutter={[16, 0]}>
              <Col span={8}>
                <Form.Item name="glucose" label="Glucose (mmol/L)" style={{ marginBottom: 0 }}>
                  <InputNumber style={{ width: '100%' }} step={0.1} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        </>
      )}

      <Card
        size="small"
        title="Notes"
        styles={compact ? { header: { padding: '4px 12px', minHeight: 28 }, body: { padding: 8 } } : undefined}
        extra={
          <Space>
            <Select
              size="small"
              value={language}
              onChange={setLanguage}
              style={{ width: 130 }}
              options={[
                { label: 'ENGLISH', value: 'EN' },
                { label: 'BAHASA MELAYU', value: 'MS' },
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
              <Button size="small" type="primary" icon={<ThunderboltOutlined />}>
                Smart Abbreviation
              </Button>
            </Dropdown>
          </Space>
        }
      >
        <RichTextEditor content={notesHtml} onChange={setNotesHtml} compact={compact} />
      </Card>

      <Button type="primary" loading={saveNote.isPending} onClick={handleSave} style={{ marginTop: compact ? 8 : 16 }}>
        Save Clinical Note
      </Button>
    </Form>
  );
}
