import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, message, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { platformApi } from './api';
import { DefaultPanelClinic } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

interface PanelFormValues {
  name: string;
  url?: string;
}

export function PlatformPanelClinicsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DefaultPanelClinic | null>(null);
  const [form] = Form.useForm<PanelFormValues>();

  const { data: panels, isLoading } = useQuery({
    queryKey: ['platform', 'default-panels'],
    queryFn: () => platformApi.get<DefaultPanelClinic[]>('/platform/defaults/panel-clinics'),
  });

  const save = useMutation({
    mutationFn: (values: PanelFormValues) =>
      editing
        ? platformApi.patch<DefaultPanelClinic>(`/platform/defaults/panel-clinics/${editing.id}`, values)
        : platformApi.post<DefaultPanelClinic>('/platform/defaults/panel-clinics', values),
    onSuccess: () => {
      message.success(editing ? 'Panel updated' : 'Panel added');
      form.resetFields();
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-panels'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to save panel'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      platformApi.patch<DefaultPanelClinic>(`/platform/defaults/panel-clinics/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'default-panels'] }),
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to update panel'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.delete(`/platform/defaults/panel-clinics/${id}`),
    onSuccess: () => {
      message.success('Panel deleted');
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-panels'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to delete panel'),
  });

  return (
    <div>
      <Title level={4}>Default Panel Clinics</Title>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Text strong>Manage Global Panel Clinics</Text>
          <div style={{ fontSize: 12, color: '#8b93a8' }}>These panels serve as the initial default list deployed to each clinic.</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          Add New Default Panel
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={panels}
        columns={[
          { title: 'No.', render: (_: unknown, __: DefaultPanelClinic, index: number) => index + 1, width: 60 },
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'URL',
            render: (_: unknown, panel: DefaultPanelClinic) =>
              panel.url ? (
                <a href={panel.url} target="_blank" rel="noreferrer">
                  {panel.url}
                </a>
              ) : (
                '—'
              ),
          },
          {
            title: 'Status',
            width: 90,
            render: (_: unknown, panel: DefaultPanelClinic) => (
              <Switch
                checked={panel.active}
                onChange={(checked) => toggleActive.mutate({ id: panel.id, active: checked })}
              />
            ),
          },
          {
            title: 'Actions',
            width: 140,
            render: (_: unknown, panel: DefaultPanelClinic) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditing(panel);
                    form.setFieldsValue({ name: panel.name, url: panel.url ?? undefined });
                    setOpen(true);
                  }}
                >
                  Edit
                </Button>
                <Popconfirm title="Delete this default panel?" onConfirm={() => remove.mutate(panel.id)}>
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
        title={editing ? 'Edit Default Panel' : 'Add Default Panel'}
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label="Panel Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. AIA" />
          </Form.Item>
          <Form.Item name="url" label="Portal URL" rules={[{ type: 'url', message: 'Enter a valid URL' }]}>
            <Input placeholder="https://..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending} block>
            {editing ? 'Save Changes' : 'Add Panel'}
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
