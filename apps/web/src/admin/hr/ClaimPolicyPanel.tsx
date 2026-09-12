import { useEffect } from 'react';
import { App, Button, Form, Input, Switch, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { Panel, PanelHead } from './ui';
import { useClaimPolicy, useSaveClaimPolicy } from '../hooks/useAdmin';
import { permissionHint, useCan } from '../../core/hooks/useCan';

/**
 * HOW THE CLINIC PRICES AND POLICES CLAIMS.
 *
 * Two facts, one row per clinic: what a kilometre is worth, and whether a
 * claim may be sent without a receipt. The portal prices a mileage claim
 * with this rate as the distance is typed, and the server prices it again
 * with the same rate when it is sent and freezes that rate on the claim, so
 * a change here reprices tomorrow's journeys and none of yesterday's.
 *
 * Reading is `hr.view`, like every policy that decides what a screen says;
 * saving is `settings.manage`, because a rate is money.
 */
type PolicyForm = { mileageRatePerKm: string; receiptRequired: boolean; reason?: string };

export function ClaimPolicyPanel() {
  const { message } = App.useApp();
  const { data, isLoading } = useClaimPolicy();
  const save = useSaveClaimPolicy();
  const canManage = useCan('settings.manage');
  const [form] = Form.useForm<PolicyForm>();

  useEffect(() => {
    if (data) form.setFieldsValue({ mileageRatePerKm: data.mileageRatePerKm, receiptRequired: data.receiptRequired });
  }, [data, form]);

  const onSave = async (values: PolicyForm) => {
    try {
      await save.mutateAsync({
        mileageRatePerKm: Number(values.mileageRatePerKm).toFixed(2),
        receiptRequired: values.receiptRequired,
        reason: values.reason?.trim() || undefined,
      });
      form.setFieldValue('reason', undefined);
      message.success('Saved. Claims sent from now on are priced with this rate.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save the claim rules.');
    }
  };

  return (
    <Panel>
      <PanelHead
        title="Claims"
        sub="What a kilometre is worth, and whether a claim needs a receipt. Each mileage claim keeps the rate it was sent under."
        actions={data ? <span className="hr-faint">Changed {dayjs(data.updatedAt).format('D MMM YYYY')}</span> : null}
      />
      <Form form={form} layout="vertical" onFinish={onSave} disabled={isLoading || !canManage} style={{ padding: '4px 22px 18px' }}>
        <div className="hr-grid3">
          <Form.Item
            name="mileageRatePerKm"
            label="Mileage rate"
            extra="RM per kilometre. The portal shows the amount as the distance is typed."
            rules={[
              { required: true, message: 'A rate is required' },
              { pattern: /^\d{1,3}(\.\d{1,2})?$/, message: 'RM per km, like 0.60' },
            ]}
          >
            <Input addonBefore="RM" addonAfter="per km" inputMode="decimal" />
          </Form.Item>
          <Form.Item
            name="receiptRequired"
            label="A receipt is required"
            valuePropName="checked"
            extra="Off means a claim may be sent with nothing attached; the manager decides it on the description alone."
          >
            <Switch />
          </Form.Item>
        </div>
        <Form.Item
          name="reason"
          label="Why (optional)"
          extra="Recorded with the change."
          rules={[{ min: 3, message: 'A few words, or leave it blank' }]}
        >
          <Input placeholder="e.g. Rate follows the 2026 group travel policy" maxLength={500} />
        </Form.Item>
        <Tooltip title={canManage ? '' : permissionHint('change the claim rules')}>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={!canManage}>
            Save claim rules
          </Button>
        </Tooltip>
      </Form>
    </Panel>
  );
}
