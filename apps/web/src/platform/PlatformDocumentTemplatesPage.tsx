import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, message, Popconfirm, Space, Switch, Table, Typography } from 'antd';
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { platformApi } from './api';
import { DefaultDocumentTemplate } from './types';
import { TemplateContentEditor } from '../clinical/TemplateContentEditor';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

// Platform console (D-040) — the owner's "Default Document Templates"
// reference screen: templates curated once, deployed to every new clinic
// (clinics then customise or disable their own copies).
export function PlatformDocumentTemplatesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DefaultDocumentTemplate | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  const { data: templates, isLoading } = useQuery({
    queryKey: ['platform', 'default-document-templates'],
    queryFn: () => platformApi.get<DefaultDocumentTemplate[]>('/platform/defaults/document-templates'),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? platformApi.patch<DefaultDocumentTemplate>(`/platform/defaults/document-templates/${editing.id}`, {
            name: name.trim(),
            content,
          })
        : platformApi.post<DefaultDocumentTemplate>('/platform/defaults/document-templates', {
            name: name.trim(),
            content,
          }),
    onSuccess: () => {
      message.success(editing ? 'Template updated' : 'Template added');
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-document-templates'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to save template'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      platformApi.patch<DefaultDocumentTemplate>(`/platform/defaults/document-templates/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'default-document-templates'] }),
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to update template'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.delete(`/platform/defaults/document-templates/${id}`),
    onSuccess: () => {
      message.success('Template deleted');
      queryClient.invalidateQueries({ queryKey: ['platform', 'default-document-templates'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to delete template'),
  });

  const openEditor = (template: DefaultDocumentTemplate | null) => {
    setEditing(template);
    setName(template?.name ?? '');
    setContent(template?.content ?? '');
    setOpen(true);
  };

  return (
    <div>
      <Title level={4}>Default Document Templates</Title>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Text strong>Manage Global Document Templates</Text>
          <div style={{ fontSize: 12, color: '#8b93a8' }}>
            These templates appear as the system defaults in all clinics. Clinics can customize or disable them.
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>
          Add Template
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={templates}
        columns={[
          { title: 'No.', render: (_: unknown, __: DefaultDocumentTemplate, index: number) => index + 1, width: 60 },
          {
            title: 'Name',
            render: (_: unknown, template: DefaultDocumentTemplate) => (
              <Space>
                <FileTextOutlined style={{ color: '#2f5bf6' }} />
                {template.name}
              </Space>
            ),
          },
          {
            title: 'Content Snippet',
            render: (_: unknown, template: DefaultDocumentTemplate) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {template.content.replace(/\s+/g, ' ').slice(0, 60)}...
              </Text>
            ),
          },
          {
            title: 'Status',
            width: 90,
            render: (_: unknown, template: DefaultDocumentTemplate) => (
              <Switch
                checked={template.active}
                onChange={(checked) => toggleActive.mutate({ id: template.id, active: checked })}
              />
            ),
          },
          {
            title: 'Actions',
            width: 140,
            render: (_: unknown, template: DefaultDocumentTemplate) => (
              <Space>
                <Button type="link" size="small" onClick={() => openEditor(template)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this default template? Clinics that already received a copy keep theirs."
                  onConfirm={() => remove.mutate(template.id)}
                >
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
        title={editing ? `Edit — ${editing.name}` : 'Add Default Template'}
        open={open}
        onClose={() => setOpen(false)}
        size="large"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Template Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MC (A5, Vertical)" />
          </Form.Item>
          <TemplateContentEditor value={content} onChange={setContent} />
          <Button
            type="primary"
            block
            style={{ marginTop: 16 }}
            loading={save.isPending}
            disabled={!name.trim() || !content.trim()}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save Changes' : 'Add Template'}
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
