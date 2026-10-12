import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Input, Modal, Table, Tag } from 'antd';
import { PageHeader } from '../design-system/components/PageHeader';
import { useCan } from '../core/hooks/useCan';
import { useClinics } from '../core/hooks/useClinics';
import { ApiError, apiClient } from '../core/api-client';
import { useStaff } from './hooks/useStaff';
import type { Staff } from './types';

/**
 * ORGANISATION SETTINGS → USERS (owner, 12 October 2026): everybody who can
 * sign in or is on the staff list, and the owner can correct anybody's
 * display name. Each rename is logged with the old name; a payslip already
 * approved keeps the name it was approved with.
 */
export function UsersSettingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const canManage = useCan('users.manage');
  const staff = useStaff();
  const { data: clinics } = useClinics();
  const [renaming, setRenaming] = useState<Staff | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: ({ id, fullName }: { id: string; fullName: string }) => apiClient.patch<Staff>(`/staff/${id}/name`, { fullName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  const branchOf = (clinicId: string | null) =>
    clinicId ? ((clinics ?? []).find((clinic) => clinic.id === clinicId)?.name ?? '—') : 'All branches';

  const save = async () => {
    if (!renaming) return;
    if (name.trim().length < 2) return setProblem('Type the name, at least two letters.');
    try {
      await rename.mutateAsync({ id: renaming.id, fullName: name });
      message.success(`Renamed to ${name.trim().replace(/\s+/g, ' ')}. Payslips already approved keep the old name.`);
      setRenaming(null);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'The name could not be saved.');
    }
  };

  return (
    <div>
      <PageHeader title="Users" subtitle="Everybody on this clinic’s staff list. The owner can correct anybody’s display name; each change is logged." />
      <Table<Staff>
        rowKey="id"
        loading={staff.isLoading}
        dataSource={staff.data ?? []}
        pagination={false}
        size="middle"
        columns={[
          { title: 'Name', dataIndex: 'fullName' },
          { title: 'Role', dataIndex: 'role', render: (role: string) => role.replace(/_/g, ' ').toLowerCase() },
          { title: 'Branch', dataIndex: 'clinicId', render: (clinicId: string | null) => branchOf(clinicId) },
          { title: 'Status', dataIndex: 'active', render: (active: boolean) => (active ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          ...(canManage
            ? [
                {
                  title: '',
                  key: 'rename',
                  width: 110,
                  render: (_: unknown, row: Staff) => (
                    <Button
                      size="small"
                      aria-label={`Rename ${row.fullName}`}
                      onClick={() => {
                        setRenaming(row);
                        setName(row.fullName);
                        setProblem(null);
                      }}
                    >
                      Rename
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        open={renaming !== null}
        title={renaming ? `Rename ${renaming.fullName}` : ''}
        okText="Save"
        onOk={save}
        confirmLoading={rename.isPending}
        onCancel={() => setRenaming(null)}
      >
        {problem ? <Alert type="error" showIcon message={problem} style={{ marginBottom: 12 }} /> : null}
        <label>
          <div style={{ marginBottom: 4 }}>Display name</div>
          <Input aria-label="Display name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>
        <div style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>
          Shown across Kuwick and printed as Prepared by / Approved by on payslips of months approved from now on.
        </div>
      </Modal>
    </div>
  );
}
