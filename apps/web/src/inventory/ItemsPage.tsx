import { useEffect, useState } from 'react';
import {
  Button,
  Col,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Space,
  Table,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreateItem, useItems, useUpdateItem } from './hooks/useItems';
import { useCreateItemAgeDosage, useItemAgeDosages, useRemoveItemAgeDosage } from './hooks/useItemAgeDosages';
import { CreateItemAgeDosageDto, CreateItemDto, Item } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

const { Text } = Typography;

// Field layout mirrors the audited kuwick.com Edit Inventory screen
// exactly (docs/DECISIONS.md D-027/D-028): Code/Ref, Product Name,
// Category, Conc. Vol (mL)/Strength (mg), then the "Dispensing &
// Prescription Details" section (Stock Unit, Consumption Method, Default
// Dispense Quantity, Dosage Instructions box, Indication, Prescription
// Reference (Dr's Note), Remark). Pricing/Panel Pricing/Stock Control
// sections from the reference aren't built yet — sellPrice/cost only.
export function ItemsPage() {
  const { data: items, isLoading } = useItems();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form] = Form.useForm<CreateItemDto>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    form.setFieldsValue({
      code: item.code ?? undefined,
      name: item.name,
      category: item.category ?? undefined,
      unitOfMeasure: item.unitOfMeasure ?? undefined,
      doseDefault: item.doseDefault ?? undefined,
      doseUnitDefault: item.doseUnitDefault ?? undefined,
      frequencyDefault: item.frequencyDefault ?? undefined,
      durationDefault: item.durationDefault ?? undefined,
      instruction: item.instruction ?? undefined,
      indication: item.indication ?? undefined,
      concVolMl: item.concVolMl ? Number(item.concVolMl) : undefined,
      strengthMg: item.strengthMg ? Number(item.strengthMg) : undefined,
      consumptionMethod: item.consumptionMethod ?? undefined,
      defaultDispenseQuantity: item.defaultDispenseQuantity ?? undefined,
      prescriptionReference: item.prescriptionReference ?? undefined,
      remark: item.remark ?? undefined,
      sellPrice: Number(item.sellPrice),
      cost: item.cost ? Number(item.cost) : undefined,
    });
    setOpen(true);
  };

  const handleSubmit = async (values: CreateItemDto) => {
    try {
      if (editing) {
        await updateItem.mutateAsync({ id: editing.id, dto: values });
        message.success('Item updated');
      } else {
        await createItem.mutateAsync(values);
        message.success('Item created');
      }
      form.resetFields();
      setOpen(false);
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save item');
    }
  };

  return (
    <>
      <PageHeader
        title="Items"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Item
        </Button>
          </>
        }
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={items}
        columns={[
          { title: 'Code', dataIndex: 'code', render: (value: string | null) => value ?? '—' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Category', dataIndex: 'category', render: (value: string | null) => value ?? '—' },
          { title: 'Unit', dataIndex: 'unitOfMeasure', render: (value: string | null) => value ?? '—' },
          { title: 'Sell Price (RM)', dataIndex: 'sellPrice' },
          { title: 'Cost (RM)', dataIndex: 'cost', render: (value: string | null) => value ?? '—' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          {
            title: 'Actions',
            render: (_: unknown, record: Item) => (
              <Button size="small" onClick={() => openEdit(record)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? `Edit Item — ${editing.name}` : 'Add Item'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
        width={480}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="code" label="Code / Ref">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="Category">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="Product Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="unitOfMeasure" label="Stock Unit (Form)">
                <Input placeholder="e.g. Bottle, Box" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="doseUnitDefault" label="Dose Unit">
                <Input placeholder="e.g. ml, tablet" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="concVolMl" label="Conc. Vol (mL)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="strengthMg" label="Strength (mg)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left" plain>
            Dispensing &amp; Prescription Details
          </Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="consumptionMethod" label="Consumption Method">
                <Input placeholder="e.g. Oral" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="defaultDispenseQuantity" label="Default Dispense Quantity">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="doseDefault" label="Dosage">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="frequencyDefault" label="Frequency">
                <Input placeholder="e.g. BD" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="durationDefault" label="Duration">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="instruction" label="Instruction">
            <Input />
          </Form.Item>
          <Form.Item name="indication" label="Indication">
            <Input />
          </Form.Item>
          <Form.Item
            name="prescriptionReference"
            label="Prescription Reference (Dr's Note)"
            tooltip="Free-text guidance shown to the doctor, e.g. 25-40MG/KG — not auto-filled into the calculator."
          >
            <Input placeholder="e.g. 25-40MG/KG" />
          </Form.Item>
          <Form.Item name="remark" label="Remark">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Divider titlePlacement="left" plain>
            Pricing
          </Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="sellPrice" label="Sell Price (RM)" rules={[{ required: true }]}>
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="cost" label="Cost (RM)">
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Button
            type="primary"
            htmlType="submit"
            loading={createItem.isPending || updateItem.isPending}
            block
            style={{ marginBottom: 16 }}
          >
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </Form>

        {editing && <AgeDosageBracketEditor itemId={editing.id} unitOfMeasure={editing.doseUnitDefault} />}
      </Drawer>
    </>
  );
}

// Age-based dosing is a per-medicine bracket lookup (e.g. "2y-5y: 2.5ml
// OD"), not a formula — no admin screen for this exists in the audited
// kuwick.com reference yet (owner-confirmed it's unfinished there); this
// minimal editor is a genuine addition beyond the reference, built with
// explicit owner approval (docs/DECISIONS.md D-028).
function AgeDosageBracketEditor({ itemId, unitOfMeasure }: { itemId: string; unitOfMeasure: string | null }) {
  const { data: brackets, isLoading } = useItemAgeDosages(itemId);
  const createBracket = useCreateItemAgeDosage(itemId);
  const removeBracket = useRemoveItemAgeDosage(itemId);
  const [form] = Form.useForm<Omit<CreateItemAgeDosageDto, 'itemId'>>();

  useEffect(() => {
    if (unitOfMeasure) {
      form.setFieldValue('unit', unitOfMeasure);
    }
  }, [unitOfMeasure, form]);

  const handleAdd = async (values: Omit<CreateItemAgeDosageDto, 'itemId'>) => {
    try {
      await createBracket.mutateAsync({ ...values, itemId });
      form.resetFields();
      if (unitOfMeasure) {
        form.setFieldValue('unit', unitOfMeasure);
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add bracket');
    }
  };

  return (
    <>
      <Divider titlePlacement="left" plain>
        Age-Based Dosage Brackets
      </Divider>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        e.g. 24-60 months: 2.5ml OD
      </Text>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={brackets}
        pagination={false}
        style={{ marginBottom: 16 }}
        columns={[
          { title: 'From (mo)', dataIndex: 'ageFromMonths' },
          { title: 'To (mo)', dataIndex: 'ageToMonths' },
          { title: 'Amount', dataIndex: 'amount' },
          { title: 'Unit', dataIndex: 'unit' },
          { title: 'Frequency', dataIndex: 'frequency' },
          {
            title: '',
            render: (_: unknown, record: { id: string }) => (
              <Button size="small" danger onClick={() => removeBracket.mutate(record.id)}>
                Remove
              </Button>
            ),
          },
        ]}
      />
      <Form form={form} layout="vertical" onFinish={handleAdd}>
        <Row gutter={8}>
          <Col span={5}>
            <Form.Item name="ageFromMonths" label="From (mo)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="ageToMonths" label="To (mo)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="unit" label="Unit" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="frequency" label="Frequency" rules={[{ required: true }]}>
              <Input placeholder="OD" />
            </Form.Item>
          </Col>
        </Row>
        <Button htmlType="submit" loading={createBracket.isPending} block>
          Add Bracket
        </Button>
      </Form>
    </>
  );
}
