import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, message, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { platformApi } from './api';
import { DefaultProcedure } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

interface ProcedureFormValues {
  code?: string;
  name: string;
  price: number;
}

export function PlatformProceduresPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DefaultProcedure | null>(null);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm<ProcedureFormValues>();

  const { data: procedures, isLoading } = useQuery({
    queryKey: ['platform', 'default-procedures'],
    queryFn: () => platformApi.get<DefaultProcedure[]>('/platform/defaults/procedures'),
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return procedures;
    const term = search.trim().toLowerCase();
    return procedures?.filter(
      (procedure) => procedure.name.toLowerCase().includes(term) || procedure.code?.toLowerCase().includes(term),
    );
  }, [procedures, search]);

  const save = useMutation({
    mutationFn: (values: ProcedureFormValues) =>
      editing
        ? platformApi.patch<DefaultProcedure>(`/platform/defaults/procedures/${editing.id}`, values)
        : platformApi.post<DefaultProcedure>('/platform/defaults/procedures', values),
    onSuccess: () => {
      message.success(editing ? 'Procedure updated' : 'Procedure added');
      form.resetFields();
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-procedures'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to save procedure'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      platformApi.patch<DefaultProcedure>(`/platform/defaults/procedures/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'default-procedures'] }),
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to update procedure'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.delete(`/platform/defaults/procedures/${id}`),
    onSuccess: () => {
      message.success('Procedure deleted');
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-procedures'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to delete procedure'),
  });

  return (
    <div>
      <Title level={4}>Default Procedures</Title>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Text strong>Manage Global Procedures</Text>
          <div style={{ fontSize: 12, color: '#8b93a8' }}>These procedures appear as the defaults in all clinics.</div>
        </div>
        <Space>
          <Input.Search placeholder="Search procedures..." allowClear onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setOpen(true);
            }}
          >
            Add Procedure
          </Button>
        </Space>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        columns={[
          { title: 'No.', render: (_: unknown, __: DefaultProcedure, index: number) => index + 1, width: 60 },
          { title: 'Code', render: (_: unknown, procedure: DefaultProcedure) => procedure.code ?? '—' },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Price (RM)', render: (_: unknown, procedure: DefaultProcedure) => Number(procedure.price).toFixed(2) },
          {
            title: 'Status',
            width: 90,
            render: (_: unknown, procedure: DefaultProcedure) => (
              <Switch
                checked={procedure.active}
                onChange={(checked) => toggleActive.mutate({ id: procedure.id, active: checked })}
              />
            ),
          },
          {
            title: 'Actions',
            width: 140,
            render: (_: unknown, procedure: DefaultProcedure) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditing(procedure);
                    form.setFieldsValue({
                      code: procedure.code ?? undefined,
                      name: procedure.name,
                      price: Number(procedure.price),
                    });
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Popconfirm title="Delete this default procedure?" onConfirm={() => remove.mutate(procedure.id)}>
                  <Button type="link" size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? 'Edit Default Procedure' : 'Add Default Procedure'}
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="code" label="Code">
            <Input placeholder="e.g. XRAYCHEST" />
          </Form.Item>
          <Form.Item name="name" label="Procedure Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. X-Ray Chest" />
          </Form.Item>
          <Form.Item name="price" label="Price (RM)" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending} block>
            {editing ? 'Save Changes' : 'Add Procedure'}
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
