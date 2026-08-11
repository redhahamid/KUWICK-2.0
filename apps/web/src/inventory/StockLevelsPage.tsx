import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, message, Select, Space, Table, Tag, Typography } from 'antd';
import { ImportOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClinicFilter, useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { useItems } from './hooks/useItems';
import { useSuppliers } from './hooks/useSuppliers';
import { useQuickAddStock, useSetStockMinThreshold, useStockLevels } from './hooks/useStock';
import { QuickAddStockDto, SetStockMinThresholdDto } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

interface QuickAddStockFormValues {
  clinicId: string;
  itemId: string;
  quantity: number;
  supplierId?: string;
  expiryDate?: dayjs.Dayjs;
  batchNumber?: string;
  addedByStaffId?: string;
}

export function StockLevelsPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const defaultClinicId = useDefaultClinicId();
  const { data: items } = useItems();
  const { data: suppliers } = useSuppliers();
  const { data: staff } = useStaff();
  const { data: levels, isLoading } = useStockLevels(clinicId);
  const setMinThreshold = useSetStockMinThreshold();
  const quickAddStock = useQuickAddStock();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SetStockMinThresholdDto>();
  const [stockInOpen, setStockInOpen] = useState(false);
  const [stockInForm] = Form.useForm<QuickAddStockFormValues>();

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

  const handleStockIn = async (values: QuickAddStockFormValues) => {
    const dto: QuickAddStockDto = {
      clinicId: values.clinicId,
      itemId: values.itemId,
      quantity: values.quantity,
      supplierId: values.supplierId,
      batchNumber: values.batchNumber,
      addedByStaffId: values.addedByStaffId,
      expiryDate: values.expiryDate?.format('YYYY-MM-DD'),
    };
    try {
      await quickAddStock.mutateAsync(dto);
      message.success('Stock added');
      stockInForm.resetFields();
      setStockInOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add stock');
    }
  };

  return (
    <>
      <PageHeader
        title="Stock Levels"
        extra={
          <>
            <Space>
          <Button type="primary" icon={<ImportOutlined />} onClick={() => setStockInOpen(true)}>
            Stock In
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => setOpen(true)}>
            Set Min Threshold
          </Button>
        </Space>
          </>
        }
      />
      {showSelector && (
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
      )}
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
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ clinicId: defaultClinicId }}>
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
      <Drawer title="Stock In" open={stockInOpen} onClose={() => setStockInOpen(false)} destroyOnHidden>
        <Form
          form={stockInForm}
          layout="vertical"
          onFinish={handleStockIn}
          initialValues={{ clinicId: defaultClinicId }}
        >
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
          <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="supplierId" label="Supplier" tooltip="Optional — e.g. a free sample or walk-in drop-off with no supplier on file.">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Select supplier"
              options={suppliers?.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
            />
          </Form.Item>
          <Form.Item name="expiryDate" label="Expiry Date">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="batchNumber" label="Batch Number">
            <Input placeholder="e.g. B-2026-014" />
          </Form.Item>
          <Form.Item name="addedByStaffId" label="Added By">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Select staff"
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={quickAddStock.isPending} block>
            Add Stock
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
