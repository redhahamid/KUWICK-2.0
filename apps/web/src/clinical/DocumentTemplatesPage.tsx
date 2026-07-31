import { useState } from 'react';
import { Button, Drawer, Form, Input, message, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  useCreateDocumentTemplate,
  useDeleteDocumentTemplate,
  useDocumentTemplates,
  useUpdateDocumentTemplate,
} from './hooks/useDocumentTemplates';
import { CustomDocumentTemplate } from './types';
import { TemplateContentEditor } from './TemplateContentEditor';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

// Document builder (D-040) — Management > Operation > Document Templates:
// the clinic's own template catalog (platform defaults deployed at tenant
// creation + the clinic's own). Every active template appears in the
// Patient Dashboard's Documents tab as a one-click document type.
export function DocumentTemplatesPage() {
  const { data: templates, isLoading } = useDocumentTemplates();
  const createTemplate = useCreateDocumentTemplate();
  const updateTemplate = useUpdateDocumentTemplate();
  const deleteTemplate = useDeleteDocumentTemplate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomDocumentTemplate | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  const reportFailure = (error: unknown, fallback: string) =>
    message.error(error instanceof ApiError ? error.message : fallback);

  const openEditor = (template: CustomDocumentTemplate | null) => {
    setEditing(template);
    setName(template?.name ?? '');
    setContent(template?.content ?? '');
    setOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    try {
      if (editing) {
        await updateTemplate.mutateAsync({ id: editing.id, dto: { name: name.trim(), content } });
        message.success('Template updated');
      } else {
        await createTemplate.mutateAsync({ name: name.trim(), content });
        message.success('Template created');
      }
      setOpen(false);
      setEditing(null);
    } catch (error) {
      reportFailure(error, 'Failed to save template');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Document Templates
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Active templates appear as document types in the patient dashboard&apos;s Documents tab.
          </Text>
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
          { title: 'Name', dataIndex: 'name' },
          {
            title: 'Content Snippet',
            render: (_: unknown, template: CustomDocumentTemplate) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {template.content.replace(/\s+/g, ' ').slice(0, 80)}...
              </Text>
            ),
          },
          {
            title: 'Source',
            width: 110,
            render: (_: unknown, template: CustomDocumentTemplate) =>
              template.sourceDefaultId ? <Tag>System Default</Tag> : <Tag color="blue">Clinic&apos;s Own</Tag>,
          },
          {
            title: 'Status',
            width: 90,
            render: (_: unknown, template: CustomDocumentTemplate) => (
              <Switch
                checked={template.active}
                onChange={(checked) =>
                  updateTemplate
                    .mutateAsync({ id: template.id, dto: { active: checked } })
                    .catch((e) => reportFailure(e, 'Failed to update template'))
                }
              />
            ),
          },
          {
            title: 'Actions',
            width: 140,
            render: (_: unknown, template: CustomDocumentTemplate) => (
              <Space>
                <Button type="link" size="small" onClick={() => openEditor(template)}>
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this template? Documents already generated from it are unaffected."
                  onConfirm={() =>
                    deleteTemplate.mutateAsync(template.id).catch((e) => reportFailure(e, 'Failed to delete template'))
                  }
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
        title={editing ? `Edit — ${editing.name}` : 'Add Template'}
        open={open}
        onClose={() => setOpen(false)}
        size="large"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Template Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consent Form (Surgery)" />
          </Form.Item>
          <TemplateContentEditor value={content} onChange={setContent} />
          <Button
            type="primary"
            block
            style={{ marginTop: 16 }}
            loading={createTemplate.isPending || updateTemplate.isPending}
            disabled={!name.trim() || !content.trim()}
            onClick={handleSave}
          >
            {editing ? 'Save Changes' : 'Create Template'}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
