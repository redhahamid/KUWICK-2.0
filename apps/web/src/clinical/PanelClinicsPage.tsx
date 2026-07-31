import { useState } from 'react';
import { Button, Drawer, Form, Input, InputNumber, message, Space, Table, Tag, Typography } from 'antd';
import { DollarOutlined, PlusOutlined } from '@ant-design/icons';
import { useCreatePanelClinic, usePanelClinics, useUpdatePanelClinic } from './hooks/usePanelClinics';
import { PanelPricingDrawer } from './PanelPricingDrawer';
import { CreatePanelClinicDto, PanelClinic } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

// Clinical Operations, Phase A1 (Queue End-to-End) — a minimal panel/TPA
// catalog, audited against kuwick.com's "Panel Clinics" and Klinik
// Hijraa's "Panel Companies" admin screens, feeding the registration/
// add-to-queue "Panel or Cash" step. Extended Phase A8 with per-panel
// price overrides + coverage exclusions (see PanelPricingDrawer) — both
// reflect automatically on the invoice. Claims submission/reconciliation
// (a future admin "Panel Claims" menu) stays a later phase, since that's
// an external workflow on the panel's own website today.
export function PanelClinicsPage() {
  const { data: panels, isLoading } = usePanelClinics();
  const createPanel = useCreatePanelClinic();
  const updatePanel = useUpdatePanelClinic();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PanelClinic | null>(null);
  const [pricingPanel, setPricingPanel] = useState<PanelClinic | null>(null);
  const [form] = Form.useForm<CreatePanelClinicDto>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (panel: PanelClinic) => {
    setEditing(panel);
    form.setFieldsValue({
      name: panel.name,
      code: panel.code ?? undefined,
      limitAmount: panel.limitAmount ? Number(panel.limitAmount) : undefined,
    });
    setOpen(true);
  };

  const handleSubmit = async (values: CreatePanelClinicDto) => {
    try {
      if (editing) {
        await updatePanel.mutateAsync({ id: editing.id, dto: values });
        message.success('Panel updated');
      } else {
        await createPanel.mutateAsync(values);
        message.success('Panel created');
      }
      form.resetFields();
      setOpen(false);
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save panel');
    }
  };

  const toggleActive = (panel: PanelClinic) => {
    updatePanel.mutate({ id: panel.id, dto: { active: !panel.active } });
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Panel Clinics
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Panel
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={panels}
        columns={[
          { title: 'No.', render: (_: unknown, __: PanelClinic, index: number) => index + 1 },
          { title: 'Code', render: (_: unknown, r: PanelClinic) => r.code ?? '—' },
          { title: 'Panel Name', dataIndex: 'name' },
          {
            title: 'Limit (RM)',
            render: (_: unknown, r: PanelClinic) => (r.limitAmount ? `RM ${r.limitAmount}` : '—'),
          },
          {
            title: 'Status',
            render: (_: unknown, r: PanelClinic) => <Tag color={r.active ? 'green' : 'default'}>{r.active ? 'Active' : 'Inactive'}</Tag>,
          },
          {
            title: 'Actions',
            render: (_: unknown, r: PanelClinic) => (
              <Space>
                <Button size="small" onClick={() => openEdit(r)}>
                  Edit
                </Button>
                <Button size="small" icon={<DollarOutlined />} onClick={() => setPricingPanel(r)}>
                  Pricing & Exclusions
                </Button>
                <Button size="small" onClick={() => toggleActive(r)}>
                  {r.active ? 'Deactivate' : 'Activate'}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? `Edit Panel — ${editing.name}` : 'Add Panel'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Panel Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. AIA, PM Care" />
          </Form.Item>
          <Form.Item name="code" label="Code">
            <Input placeholder="e.g. AIA" />
          </Form.Item>
          <Form.Item
            name="limitAmount"
            label="Per-Visit Limit (RM)"
            tooltip="Informational only for now — not automatically enforced/deducted."
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createPanel.isPending || updatePanel.isPending} block>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
      <PanelPricingDrawer panel={pricingPanel} onClose={() => setPricingPanel(null)} />
    </>
  );
}
