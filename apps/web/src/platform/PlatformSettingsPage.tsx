import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Checkbox, Form, Input, InputNumber, message, Typography } from 'antd';
import { platformApi } from './api';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

interface SettingsFormValues {
  systemName?: string;
  currencyCode?: string;
  taxRatePercent?: number;
  gracePeriodDays?: number;
  emailAlertsToTenants?: boolean;
}

// System Configurations (D-037) — General/Billing/Notification sections of
// the owner's reference screen. The LHDN MyInvois fallback-credentials
// section is deliberately absent until the e-Invoice phase (D-032) brings
// proper encrypted-secret handling — storing API secrets as plain JSON
// settings would be worse than not having the section at all.
export function PlatformSettingsPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SettingsFormValues>();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => platformApi.get<Record<string, unknown>>('/platform/settings'),
  });

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        systemName: (settings.systemName as string) ?? 'Kuwick',
        currencyCode: (settings.currencyCode as string) ?? 'MYR',
        taxRatePercent: (settings.taxRatePercent as number) ?? 0,
        gracePeriodDays: (settings.gracePeriodDays as number) ?? 3,
        emailAlertsToTenants: (settings.emailAlertsToTenants as boolean) ?? true,
      });
    }
  }, [settings, form]);

  const save = useMutation({
    mutationFn: (values: SettingsFormValues) => platformApi.put<Record<string, unknown>>('/platform/settings', values),
    onSuccess: () => {
      message.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['platform', 'settings'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to save settings'),
  });

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4}>System Configurations</Title>
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)} disabled={isLoading}>
        <Card title="General" style={{ marginBottom: 16 }}>
          <Form.Item name="systemName" label="System Name">
            <Input />
          </Form.Item>
        </Card>
        <Card title="Billing" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="currencyCode" label="Currency Code" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="taxRatePercent" label="Tax Rate (%)" style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="gracePeriodDays" label="Grace Period (Days)" style={{ flex: 1 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Card>
        <Card title="Notification" style={{ marginBottom: 16 }}>
          <Form.Item name="emailAlertsToTenants" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>Enable Email Alerts to Tenants</Checkbox>
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Email delivery itself is not wired up yet — this switch records the preference for when it is.
          </Text>
        </Card>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Save Settings
        </Button>
      </Form>
    </div>
  );
}
