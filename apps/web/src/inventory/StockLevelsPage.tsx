import { useState } from 'react';
import { Button, Drawer, Form, InputNumber, message, Select, Space, Table, Tag, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useClinics } from '../core/hooks/useClinics';
import { useItems } from './hooks/useItems';
import { useSetStockMinThreshold, useStockLevels } from './hooks/useStock';
import { SetStockMinThresholdDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

export function StockLevelsPage() {
  const [clinicId, setClinicId] = useState<string>();
  const { data: clinics } = useClinics();
  const { data: items } = useItems();
  const { data: levels, isLoading } = useStockLevels(clinicId);
  const setMinThreshold = useSetStockMinThreshold();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SetStockMinThresholdDto>();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  const handleSubmit = async (values: SetStockMinThresholdDto) => {
    try {
      await setMinThreshold.mutateAsync(values);
      message.success('Minimum threshold saved');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save threshold');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Stock Levels
        </Title>
        <Button type="primary" icon={<SettingOutlined />} onClick={() => setOpen(true)}>
          Set Min Threshold
        </Button>
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by clinic"
          style={{ width: 220 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={levels}
        columns={[
          { title: 'Item', render: (_, record) => record.item.name },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          {
            title: 'Quantity On Hand',
            dataIndex: 'quantityOnHand',
            render: (value: number) => (value < 0 ? <Tag color="error">{value}</Tag> : value),
          },
          { title: 'Min Threshold', dataIndex: 'minThreshold' },
        ]}
      />
      <Drawer title="Set Minimum Threshold" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
            <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
          </Form.Item>
          <Form.Item name="itemId" label="Item" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={items?.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item name="minThreshold" label="Minimum Threshold" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={setMinThreshold.isPending} block>
            Save
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
