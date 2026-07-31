import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, message, Select, Slider, Space, Typography } from 'antd';
import { SoundOutlined } from '@ant-design/icons';
import { useClinics } from '../core/hooks/useClinics';
import { useQueueDisplayConfig, useUpdateQueueDisplayConfig } from './hooks/useQueueTickets';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

interface DisplaySettingsFormValues {
  youtubeUrl?: string;
  runningText?: string;
  voiceName?: string;
  voiceRate: number;
  voicePitch: number;
  voiceVolume: number;
}

// Browser voices load asynchronously — getVoices() can be empty on first
// call until the voiceschanged event fires.
function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

// D-038 — waiting-room monitor settings: the clinic's own YouTube video,
// scrolling text, and voice-calling voice/pitch/volume with a live test
// button. The voice list is the *browser's* installed voices — pick on the
// machine that actually drives the TV for the truest preview.
export function QueueDisplaySettingsPage() {
  const { data: clinics } = useClinics();
  const [clinicId, setClinicId] = useState<string>();
  const { data: config, isLoading } = useQueueDisplayConfig(clinicId);
  const updateConfig = useUpdateQueueDisplayConfig();
  const voices = useSpeechVoices();
  const [form] = Form.useForm<DisplaySettingsFormValues>();

  useEffect(() => {
    if (config) {
      form.setFieldsValue({
        youtubeUrl: config.youtubeUrl ?? undefined,
        runningText: config.runningText ?? undefined,
        voiceName: config.voiceName ?? undefined,
        voiceRate: config.voiceRate,
        voicePitch: config.voicePitch,
        voiceVolume: config.voiceVolume,
      });
    }
  }, [config, form]);

  const testVoice = () => {
    const values = form.getFieldsValue();
    const utterance = new SpeechSynthesisUtterance('Number W zero zero one, please proceed to Consultation 1.');
    const voice = voices.find((v) => v.name === values.voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = values.voiceRate ?? 1;
    utterance.pitch = values.voicePitch ?? 1;
    utterance.volume = values.voiceVolume ?? 1;
    window.speechSynthesis.speak(utterance);
  };

  const handleSave = async (values: DisplaySettingsFormValues) => {
    if (!clinicId) return;
    try {
      await updateConfig.mutateAsync({ clinicId, dto: values });
      message.success('Display settings saved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save settings');
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Queue Screen Settings
        </Title>
        <Select
          placeholder="Select clinic"
          style={{ width: 220 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
      </Space>
      {!clinicId ? (
        <Text type="secondary">Select a clinic to configure its waiting-room screen.</Text>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleSave} disabled={isLoading}>
          <Card title="Video & Text" style={{ marginBottom: 16 }}>
            <Form.Item
              name="youtubeUrl"
              label="YouTube Video URL"
              extra="Plays muted on loop on the queue screen — paste any YouTube watch/share link."
            >
              <Input placeholder="https://www.youtube.com/watch?v=..." />
            </Form.Item>
            <Form.Item name="runningText" label="Scrolling Text">
              <Input placeholder="e.g. Welcome to Klinik Hijraa — we are open 24 hours" />
            </Form.Item>
          </Card>
          <Card
            title="Voice Calling"
            extra={
              <Button size="small" icon={<SoundOutlined />} onClick={testVoice}>
                Test Voice
              </Button>
            }
            style={{ marginBottom: 16 }}
          >
            <Form.Item
              name="voiceName"
              label="Voice"
              extra="Voices come from the browser on the machine running the queue screen — configure there for the truest preview."
            >
              <Select
                allowClear
                showSearch
                placeholder="Browser default"
                options={voices.map((voice) => ({ value: voice.name, label: `${voice.name} (${voice.lang})` }))}
              />
            </Form.Item>
            <Form.Item name="voiceRate" label="Speed">
              <Slider min={0.5} max={2} step={0.1} />
            </Form.Item>
            <Form.Item name="voicePitch" label="Pitch">
              <Slider min={0} max={2} step={0.1} />
            </Form.Item>
            <Form.Item name="voiceVolume" label="Volume">
              <Slider min={0} max={1} step={0.05} />
            </Form.Item>
          </Card>
          <Button type="primary" htmlType="submit" loading={updateConfig.isPending}>
            Save Settings
          </Button>
        </Form>
      )}
    </div>
  );
}
