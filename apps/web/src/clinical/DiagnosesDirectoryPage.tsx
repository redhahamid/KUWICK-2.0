import { useState } from 'react';
import { Button, Card, Col, Drawer, Form, Input, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  useBulkActivateDiagnosisCategory,
  useCreateCustomDiagnosis,
  useDiagnosisCatalogCounts,
  useDiagnosisDirectory,
  useSetDiagnosisCatalogActive,
} from './hooks/useDiagnoses';
import { CreateCustomDiagnosisDto, DiagnosisCatalogEntry, DiagnosisCategory } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const CATEGORY_COLOR: Record<DiagnosisCategory, string> = {
  CUSTOM: 'purple',
  SUMMARIZE: 'green',
  FULL: 'blue',
};

// D-027 (docs/DECISIONS.md): Diagnoses Directory admin screen — bulk
// activate the two global categories (Summarize/Full), manage individual
// entries, and create clinic-specific Custom diagnoses.
export function DiagnosesDirectoryPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DiagnosisCategory | undefined>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateCustomDiagnosisDto>();

  const { data: entries, isLoading } = useDiagnosisDirectory(categoryFilter);
  const { data: counts } = useDiagnosisCatalogCounts();
  const createCustom = useCreateCustomDiagnosis();
  const setActive = useSetDiagnosisCatalogActive();
  const bulkActivate = useBulkActivateDiagnosisCategory();

  const filtered = entries?.filter(
    (entry) =>
      !search ||
      entry.name.toLowerCase().includes(search.toLowerCase()) ||
      entry.icd10Code?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async (values: CreateCustomDiagnosisDto) => {
    try {
      await createCustom.mutateAsync(values);
      message.success('Custom diagnosis created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create diagnosis');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Diagnoses Directory
          </Title>
          <Text type="secondary">Manage your clinic's diagnoses. You can create custom ones or activate global standard catalogs.</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Custom Diagnosis
        </Button>
      </Space>

      <Text strong>Bulk Activate Global Categories</Text>
      <Row gutter={16} style={{ marginTop: 8, marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space direction="vertical" size={0}>
                <Tag color="green">Summarize Category</Tag>
                <Text type="secondary">
                  Activate global summarize diagnoses for your clinic. Active: {counts?.summarize.active ?? '—'} / {counts?.summarize.total ?? '—'}.
                </Text>
              </Space>
              <Switch
                checked={(counts?.summarize.active ?? 0) === (counts?.summarize.total ?? -1)}
                onChange={(checked) =>
                  bulkActivate.mutate({ category: 'SUMMARIZE', active: checked })
                }
              />
            </Space>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small">
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space direction="vertical" size={0}>
                <Tag color="blue">Full Category</Tag>
                <Text type="secondary">
                  Activate full ICD-10 standard diagnoses. Active: {counts?.full.active ?? '—'} / {counts?.full.total ?? '—'}.
                </Text>
              </Space>
              <Switch
                checked={(counts?.full.active ?? 0) === (counts?.full.total ?? -1)}
                onChange={(checked) => bulkActivate.mutate({ category: 'FULL', active: checked })}
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Input
          style={{ width: 320 }}
          placeholder="Search by ICD10 Code or Description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder="All Categories"
          style={{ width: 180 }}
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { label: 'Custom', value: 'CUSTOM' },
            { label: 'Summarize', value: 'SUMMARIZE' },
            { label: 'Full', value: 'FULL' },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'No.', render: (_: unknown, __: DiagnosisCatalogEntry, index: number) => index + 1 },
          { title: 'Description', dataIndex: 'name' },
          { title: 'ICD10', render: (_: unknown, r: DiagnosisCatalogEntry) => r.icd10Code ?? '—' },
          {
            title: 'Category',
            render: (_: unknown, r: DiagnosisCatalogEntry) => <Tag color={CATEGORY_COLOR[r.category]}>{r.category}</Tag>,
          },
          {
            title: 'Status / Actions',
            render: (_: unknown, r: DiagnosisCatalogEntry) => (
              <Switch
                checked={r.active}
                onChange={(checked) => setActive.mutate({ id: r.id, active: checked })}
              />
            ),
          },
        ]}
      />

      <Drawer title="Add Custom Diagnosis" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Description" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="icd10Code" label="ICD10 Code (optional)">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createCustom.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
