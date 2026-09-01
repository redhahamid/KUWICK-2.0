import { useState } from 'react';
import { App, Button, Input, Modal, Table, Tag } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { useLegalEmployers, usePayComponents, useSeedPayComponents, useUpsertLegalEmployer } from '../hooks/useAdmin';
import { useCan } from '../../core/hooks/useCan';
import type { LegalEmployerRow, PayComponentRow } from '../types';

/**
 * THE EMPLOYER, AND THE COMPONENTS IT PAYS.
 *
 * Payroll runs were scoped to a BRANCH. A branch employs nobody and files
 * nothing — EPF, SOCSO, EIS and PCB submissions are all made by an employer,
 * against an employer number, and there was nowhere to put one.
 *
 * The audited competitor has the opposite limitation: one company per account,
 * with location reduced to a name and an address, so a group running two Sdn
 * Bhds cannot use it at all.
 */
export function LegalEmployersPage() {
  const { message } = App.useApp();
  const employers = useLegalEmployers();
  const components = usePayComponents();
  const upsert = useUpsertLegalEmployer();
  const seed = useSeedPayComponents();
  const mayManage = useCan('hr.statutory.manage');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LegalEmployerRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function edit(row: LegalEmployerRow | null) {
    setEditing(row);
    setForm(
      row
        ? {
            name: row.name,
            registrationNo: row.registrationNo ?? '',
            epfEmployerNo: row.epfEmployerNo ?? '',
            socsoEmployerNo: row.socsoEmployerNo ?? '',
            lhdnEmployerNo: row.lhdnEmployerNo ?? '',
            addressLine1: row.addressLine1 ?? '',
            city: row.city ?? '',
            state: row.state ?? '',
            bankName: row.bankName ?? '',
            bankAccountNo: row.bankAccountNo ?? '',
            bankAccountName: row.bankAccountName ?? '',
          }
        : { name: '' },
    );
    setError(null);
    setOpen(true);
  }

  const componentList = components.data?.components ?? [];

  return (
    <AdminShell
      title="Legal employers"
      subtitle="The entity that employs, files and pays. A branch is where work happens; it files nothing."
      error={firstError(employers, components)}
      actions={
        mayManage ? (
          <Button size="small" type="primary" onClick={() => edit(null)}>
            New employer
          </Button>
        ) : null
      }
    >
      <AdminSection padded={false}>
        <Table<LegalEmployerRow>
          rowKey="id"
          size="small"
          pagination={false}
          loading={employers.isLoading}
          dataSource={employers.data ?? []}
          columns={[
            { title: 'Employer', dataIndex: 'name' },
            { title: 'Registration', dataIndex: 'registrationNo', render: (v: string | null) => v ?? '—' },
            { title: 'EPF', dataIndex: 'epfEmployerNo', render: (v: string | null) => v ?? '—' },
            { title: 'SOCSO', dataIndex: 'socsoEmployerNo', render: (v: string | null) => v ?? '—' },
            { title: 'LHDN (E)', dataIndex: 'lhdnEmployerNo', render: (v: string | null) => v ?? '—' },
            { title: 'Employees', dataIndex: 'employeeCount', align: 'right', width: 100 },
            {
              title: 'Could it file?',
              key: 'readiness',
              render: (_: unknown, row) =>
                row.statutoryReadiness.complete ? (
                  <Tag color="green">Complete</Tag>
                ) : (
                  <span>
                    <Tag color="orange">{row.statutoryReadiness.missing.length} missing</Tag>
                    <div style={{ fontSize: 11, color: '#888' }}>{row.statutoryReadiness.missing.join(', ')}</div>
                  </span>
                ),
            },
            ...(mayManage
              ? [
                  {
                    title: '',
                    key: 'a',
                    width: 70,
                    render: (_: unknown, row: LegalEmployerRow) => (
                      <Button size="small" onClick={() => edit(row)}>
                        Edit
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </AdminSection>

      <AdminSection
        title="Pay components"
        description="What each kind of money is liable to. Twelve independent attributes, because an allowance can be EPF wages and PCB-exempt at the same time."
        padded={false}
        actions={
          mayManage && componentList.length === 0 ? (
            <Button
              size="small"
              loading={seed.isPending}
              onClick={() =>
                seed.mutate(undefined, {
                  onSuccess: () => message.success('Catalogue seeded — every flag UNVERIFIED'),
                  onError: (e: Error) => message.error(e.message),
                })
              }
            >
              Seed the catalogue
            </Button>
          ) : null
        }
      >
        {components.data ? (
          <AdminNotice tone="warn">{components.data.verificationNotice.statement}</AdminNotice>
        ) : null}
        <Table<PayComponentRow>
          rowKey="id"
          size="small"
          pagination={false}
          loading={components.isLoading}
          dataSource={componentList}
          locale={{ emptyText: 'No pay components yet.' }}
          columns={[
            { title: 'Component', dataIndex: 'name', render: (n: string, r) => `${n} (${r.code})` },
            { title: 'Type', dataIndex: 'type', width: 100 },
            { title: 'PCB', dataIndex: 'pcbLiable', width: 60, render: (v: boolean) => (v ? '✓' : '—') },
            { title: 'EPF', dataIndex: 'epfLiable', width: 60, render: (v: boolean) => (v ? '✓' : '—') },
            { title: 'SOCSO', dataIndex: 'socsoLiable', width: 70, render: (v: boolean) => (v ? '✓' : '—') },
            { title: 'EIS', dataIndex: 'eisLiable', width: 60, render: (v: boolean) => (v ? '✓' : '—') },
            // The three the audited competitor has no equivalent for.
            { title: 'HRD', dataIndex: 'hrdLiable', width: 60, render: (v: boolean) => (v ? '✓' : '—') },
            { title: 'OT base', dataIndex: 'includeInOrpBase', width: 80, render: (v: boolean) => (v ? '✓' : '—') },
            {
              title: 'UPL base',
              dataIndex: 'includeInUnpaidLeaveBase',
              width: 85,
              render: (v: boolean) => (v ? '✓' : '—'),
            },
            {
              title: 'Verified?',
              dataIndex: 'verificationStatus',
              width: 100,
              render: (v: string) => <Tag color={v === 'VERIFIED' ? 'green' : 'orange'}>{v}</Tag>,
            },
          ]}
        />
      </AdminSection>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'New legal employer'}
        okText="Save"
        confirmLoading={upsert.isPending}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onOk={async () => {
          setError(null);
          if (!form.name?.trim()) {
            setError('An employer needs a registered name.');
            return;
          }
          try {
            await upsert.mutateAsync({ ...(editing ? { id: editing.id } : {}), ...form });
            message.success('Saved.');
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'The server refused the change and did not say why.');
          }
        }}
      >
        {error ? <AdminNotice tone="warn">{error}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {[
            ['name', 'Registered name'],
            ['registrationNo', 'Company registration number'],
            ['epfEmployerNo', 'EPF employer number'],
            ['socsoEmployerNo', 'SOCSO employer code'],
            ['lhdnEmployerNo', 'LHDN employer number (E)'],
            ['addressLine1', 'Address'],
            ['city', 'City'],
            ['state', 'State'],
            ['bankName', 'Bank'],
            ['bankAccountNo', 'Bank account number'],
            ['bankAccountName', 'Account name'],
          ].map(([key, label]) => (
            <label key={key}>
              <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
              <Input
                value={form[key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </Modal>
    </AdminShell>
  );
}
