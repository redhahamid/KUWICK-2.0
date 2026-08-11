import { useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useServices } from './hooks/useServices';
import {
  useConsultationTariffRules,
  useCreateConsultationTariffRule,
  useDeactivateConsultationTariffRule,
  useUpdateConsultationTariffRule,
} from './hooks/useConsultationTariffs';
import { ConsultationTariffRule, UpsertConsultationTariffRuleDto, VisitClassification } from './types';
import { CLASSIFICATION_LABEL } from './invoice/billingReviewPresentation';
import { money } from './invoice/invoicePresentation';

const { Title, Text } = Typography;

interface FormValues {
  name: string;
  active: boolean;
  classification: VisitClassification;
  startTime: string;
  endTime: string;
  serviceCatalogId: string;
  effective?: [dayjs.Dayjs, dayjs.Dayjs] | null;
}

/**
 * G4.5d3c-3b2 (D-094) — Clinic Settings → Consultation Tariffs.
 *
 * The smallest configuration the consultation charge needs: which
 * consultation SERVICE applies in which time band, for which kind of visit.
 *
 * Deliberately no price field. The rule selects the service; the approved
 * pricing resolver prices it (specific panel price → cash + panel service
 * markup → cash), so a panel's consultation price is configured against that
 * service in Panel Pricing, where every other panel price already lives.
 */
export function ConsultationTariffsPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const { data: rules = [], isLoading } = useConsultationTariffRules(clinicId);
  const { data: services = [] } = useServices();
  const createRule = useCreateConsultationTariffRule(clinicId);
  const updateRule = useUpdateConsultationTariffRule(clinicId);
  const deactivateRule = useDeactivateConsultationTariffRule(clinicId);
  const [editing, setEditing] = useState<ConsultationTariffRule | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ active: true, classification: 'CONSULTATION', startTime: '08:00', endTime: '22:59' });
    setOpen(true);
  };

  const openEdit = (rule: ConsultationTariffRule) => {
    setEditing(rule);
    form.setFieldsValue({
      name: rule.name,
      active: rule.active,
      classification: rule.classification,
      startTime: rule.startTime,
      endTime: rule.endTime,
      serviceCatalogId: rule.serviceCatalogId,
      effective:
        rule.effectiveFrom && rule.effectiveTo ? [dayjs(rule.effectiveFrom), dayjs(rule.effectiveTo)] : null,
    });
    setOpen(true);
  };

  const submit = async (values: FormValues) => {
    if (!clinicId) {
      message.error('Select a branch first.');
      return;
    }
    const dto: UpsertConsultationTariffRuleDto = {
      clinicId,
      name: values.name,
      active: values.active,
      classification: values.classification,
      startTime: values.startTime,
      endTime: values.endTime,
      serviceCatalogId: values.serviceCatalogId,
      effectiveFrom: values.effective?.[0]?.toISOString(),
      effectiveTo: values.effective?.[1]?.toISOString(),
    };
    try {
      if (editing) {
        await updateRule.mutateAsync({ id: editing.id, dto });
        message.success('Consultation tariff updated.');
      } else {
        await createRule.mutateAsync(dto);
        message.success('Consultation tariff created.');
      }
      setOpen(false);
      form.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save the consultation tariff');
    }
  };

  const deactivate = async (rule: ConsultationTariffRule) => {
    try {
      await deactivateRule.mutateAsync(rule.id);
      message.success('Consultation tariff deactivated.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to deactivate the tariff');
    }
  };

  return (
    <div>
      <Space direction="vertical" size={4} style={{ marginBottom: 16, width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
          <Title level={4} style={{ margin: 0 }}>
            Consultation Tariffs
          </Title>
          <Space wrap>
            {showSelector && (
              <Select
                value={clinicId}
                onChange={setClinicId}
                style={{ minWidth: 200 }}
                aria-label="Branch"
                options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
              />
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ minHeight: 44 }}>
              Add tariff
            </Button>
          </Space>
        </Space>
        <Text type="secondary">
          Decides which consultation service is charged, and when. The price comes from the service itself — and from
          Panel Pricing where a panel has its own rate — so a tariff is never a second place prices live.
        </Text>
      </Space>

      {rules.length === 0 && !isLoading && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="No consultation tariff is configured for this branch."
          description="Consultation fees are not charged automatically until one exists. Nothing is guessed in the meantime."
        />
      )}

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={rules}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'Rule',
            dataIndex: 'name',
            key: 'name',
            render: (_: unknown, rule: ConsultationTariffRule) => (
              <Space direction="vertical" size={0}>
                <Text strong>{rule.name}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {CLASSIFICATION_LABEL[rule.classification]}
                </Text>
              </Space>
            ),
          },
          {
            title: 'Time band',
            key: 'band',
            render: (_: unknown, rule: ConsultationTariffRule) => (
              <Space direction="vertical" size={0}>
                <Text>
                  {rule.startTime} – {rule.endTime}
                </Text>
                {rule.startTime > rule.endTime && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Crosses midnight
                  </Text>
                )}
              </Space>
            ),
          },
          {
            title: 'Consultation service',
            key: 'service',
            render: (_: unknown, rule: ConsultationTariffRule) => (
              <Space direction="vertical" size={0}>
                <Text>{rule.serviceCatalog?.name ?? '—'}</Text>
                {rule.serviceCatalog && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Cash {money(rule.serviceCatalog.price)}
                  </Text>
                )}
              </Space>
            ),
          },
          {
            title: 'Effective',
            key: 'effective',
            render: (_: unknown, rule: ConsultationTariffRule) =>
              rule.effectiveFrom || rule.effectiveTo ? (
                <Text style={{ fontSize: 12 }}>
                  {rule.effectiveFrom ? dayjs(rule.effectiveFrom).format('D MMM YYYY') : '—'} →{' '}
                  {rule.effectiveTo ? dayjs(rule.effectiveTo).format('D MMM YYYY') : '—'}
                </Text>
              ) : (
                <Text type="secondary">Always</Text>
              ),
          },
          {
            title: 'Status',
            key: 'status',
            render: (_: unknown, rule: ConsultationTariffRule) => (
              <Tag color={rule.active ? 'green' : 'default'}>{rule.active ? 'Active' : 'Inactive'}</Tag>
            ),
          },
          {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, rule: ConsultationTariffRule) => (
              <Space wrap>
                <Button size="small" onClick={() => openEdit(rule)} style={{ minHeight: 44 }}>
                  Edit
                </Button>
                {rule.active && (
                  <Popconfirm
                    title="Deactivate this tariff?"
                    description="Charges it already produced keep their record. New visits stop matching it."
                    onConfirm={() => deactivate(rule)}
                  >
                    <Button size="small" danger style={{ minHeight: 44 }}>
                      Deactivate
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? 'Edit consultation tariff' : 'Add consultation tariff'}
        open={open}
        onClose={() => setOpen(false)}
        width={480}
        destroyOnHidden
        extra={
          <Button type="primary" onClick={() => form.submit()} loading={createRule.isPending || updateRule.isPending}>
            Save
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="Rule name" rules={[{ required: true, min: 2 }]}>
            <Input maxLength={120} placeholder="e.g. Day consultation" />
          </Form.Item>
          <Form.Item name="classification" label="Applies to" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(CLASSIFICATION_LABEL) as VisitClassification[]).map((value) => ({
                value,
                label: CLASSIFICATION_LABEL[value],
              }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="startTime"
              label="From"
              rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Use HH:MM, e.g. 08:00' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="08:00" maxLength={5} />
            </Form.Item>
            <Form.Item
              name="endTime"
              label="To"
              rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Use HH:MM, e.g. 22:59' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="22:59" maxLength={5} />
            </Form.Item>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
            Both ends are included. A band that ends before it starts crosses midnight — 23:00 to 07:59 covers the
            whole night.
          </Text>
          <Form.Item name="serviceCatalogId" label="Consultation service" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Select the service this tariff charges"
              options={services
                .filter((service) => service.active)
                .map((service) => ({
                  value: service.id,
                  label: `${service.name} · ${money(service.price)}`,
                }))}
            />
          </Form.Item>
          <Form.Item name="effective" label="Effective dates (optional)">
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
