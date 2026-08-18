import { useState } from 'react';
import { Button, Input, List, message, Modal, Popconfirm, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ItemCategory } from './types';
import {
  useAdoptCategory,
  useCreateCategory,
  useDeleteCategory,
  useItemCategories,
  useRenameCategory,
} from './hooks/useItemCatalogue';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

/**
 * MANAGE CATEGORIES — add, rename, and a delete the server is allowed to
 * refuse.
 *
 * The refusal is the point of the screen. A category with 23 items under it
 * cannot be deleted without either orphaning them or blanking their category,
 * and both are a clinic losing the arrangement of their own shelf to one
 * click. So the server counts and refuses IN WORDS, and this renders those
 * words rather than a red toast saying "Conflict".
 *
 * The disabled Delete carries its reason ON the row, not in a tooltip: a
 * tooltip does not exist on a phone, which is the same argument Settings ›
 * Prescription Vocabulary already settled for its locked SYSTEM rows.
 */
export function ManageCategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: categories, isLoading } = useItemCategories();
  const [adding, setAdding] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const create = useCreateCategory();
  const adopt = useAdoptCategory();
  const rename = useRenameCategory();
  const remove = useDeleteCategory();

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      message.success(done);
      return true;
    } catch (error) {
      // The server's own sentence, which names the count. "23 items are filed
      // under ANTIBIOTIK" tells somebody what they are about to have to move.
      message.error(error instanceof ApiError ? error.message : 'That did not work');
      return false;
    }
  };

  return (
    <Modal open={open} onCancel={onClose} title="Manage Categories" footer={null} destroyOnHidden width={520}>
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          placeholder="New category name"
          aria-label="New category name"
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          onPressEnter={async () => {
            if (adding.trim() && (await run(() => create.mutateAsync(adding.trim()), 'Category added'))) setAdding('');
          }}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="Add category"
          loading={create.isPending}
          disabled={!adding.trim()}
          onClick={async () => {
            if (await run(() => create.mutateAsync(adding.trim()), 'Category added')) setAdding('');
          }}
        >
          Add
        </Button>
      </Space.Compact>

      <List<ItemCategory>
        loading={isLoading}
        dataSource={categories ?? []}
        locale={{ emptyText: 'No categories yet. Add one above.' }}
        renderItem={(category) => {
          const editing = editingName === category.name;
          return (
            <List.Item
              actions={
                editing
                  ? [
                      <Button
                        key="save"
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        loading={rename.isPending}
                        aria-label={`Save ${category.name}`}
                        onClick={async () => {
                          if (
                            category.id &&
                            (await run(
                              () => rename.mutateAsync({ id: category.id as string, name: draft.trim() }),
                              'Category renamed, and every item under it moved with it',
                            ))
                          ) {
                            setEditingName(null);
                          }
                        }}
                      />,
                      <Button
                        key="cancel"
                        size="small"
                        icon={<CloseOutlined />}
                        aria-label="Cancel rename"
                        onClick={() => setEditingName(null)}
                      />,
                    ]
                  : [
                      category.registered ? (
                        <Button
                          key="rename"
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={`Rename ${category.name}`}
                          onClick={() => {
                            setEditingName(category.name);
                            setDraft(category.name);
                          }}
                        />
                      ) : (
                        // An imported string is not on the list, so there is
                        // nothing to rename yet. Adopting it is what puts it
                        // there — one tap, and no items move.
                        <Button
                          key="adopt"
                          size="small"
                          loading={adopt.isPending}
                          aria-label={`Add ${category.name} to the list`}
                          onClick={() => run(() => adopt.mutateAsync(category.name), 'Added to the category list')}
                        >
                          Add to list
                        </Button>
                      ),
                      <Popconfirm
                        key="delete"
                        title={`Delete "${category.name}"?`}
                        description="This removes the name from the list. It does not touch any item."
                        okText="Delete"
                        disabled={!category.id || category.count > 0}
                        onConfirm={() =>
                          run(() => remove.mutateAsync(category.id as string), 'Category deleted')
                        }
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={!category.id || category.count > 0}
                          aria-label={`Delete ${category.name}`}
                        />
                      </Popconfirm>,
                    ]
              }
            >
              <List.Item.Meta
                title={
                  editing ? (
                    <Input
                      autoFocus
                      size="small"
                      value={draft}
                      aria-label={`New name for ${category.name}`}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  ) : (
                    <Space size={6}>
                      <Text>{category.name}</Text>
                      {!category.registered && <Tag>from imported items</Tag>}
                    </Space>
                  )
                }
                description={
                  category.count === 0 ? (
                    <Text type="secondary">Nothing filed here yet</Text>
                  ) : (
                    // The reason Delete is off, ON the row. A tooltip does not
                    // exist on a phone.
                    <Text type="secondary">
                      {category.count} {category.count === 1 ? 'item' : 'items'} — move them before this can be deleted
                    </Text>
                  )
                }
              />
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
