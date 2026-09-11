import { useMemo, useState } from 'react';
import { App, Button, Drawer, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { AdminNotice } from '../components/AdminShell';
import { usePayComponents, usePayrollInputs, useUpsertPayrollInput, useDeletePayrollInput } from '../hooks/useAdmin';
import type { PayrollInputRow } from '../types';

/**
 * THE PAYROLL INPUT DRAWER.
 *
 * The single highest-value screen in this stage, because until it existed the
 * table behind it had no writer at all: PCB could not be keyed in, and no run
 * containing a PCB-applicable employee could ever be approved.
 *
 * Three things it shows that the audited competitor's equivalent does not:
 * WHO entered each figure, WHERE it came from, and WHY — a clinic asked "why
 * was this RM300 added" can answer without guessing.
 *
 * A derived figure is read-only here on purpose. Correcting an overtime amount
 * by retyping it in payroll would leave the attendance record and the payslip
 * disagreeing, with nothing to say which is right.
 */
export function PayrollInputsDrawer({
  open,
  onClose,
  period,
  staffId,
  staffName,
  clinicId,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  period: string;
  staffId?: string;
  staffName?: string;
  clinicId?: string;
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const inputs = usePayrollInputs({ period, staffId, clinicId });
  const components = usePayComponents();
  const upsert = useUpsertPayrollInput();
  const remove = useDeletePayrollInput();

  const [addOpen, setAddOpen] = useState(false);
  const [componentCode, setComponentCode] = useState<string>();
  const [amount, setAmount] = useState<number>();
  const [kind, setKind] = useState<'RECURRING' | 'ADDITIONAL'>('ADDITIONAL');
  const [reason, setReason] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      (components.data?.components ?? [])
        .filter((c) => c.active)
        .map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
    [components.data],
  );

  async function save() {
    // EVERY REJECTED SAVE PRODUCES A VISIBLE MESSAGE. The audited product
    // returns a correct 400 with a good message and shows the user nothing at
    // all — the Save button simply appears dead. This is the counter-measure,
    // and there is a test asserting the consequence rather than the component.
    setSaveError(null);
    if (!staffId) return;
    if (!componentCode) {
      setSaveError('Choose which kind of pay or deduction this is.');
      return;
    }
    if (amount === undefined || amount === null || Number.isNaN(amount)) {
      setSaveError('Enter an amount.');
      return;
    }
    try {
      await upsert.mutateAsync({
        staffId,
        period,
        componentCode,
        amount: amount.toFixed(2),
        kind,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      message.success('Payroll input saved.');
      setAddOpen(false);
      setComponentCode(undefined);
      setAmount(undefined);
      setReason('');
    } catch (error) {
      setSaveError(
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'The server refused the change and did not say why.',
      );
    }
  }

  const rows = inputs.data ?? [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      // antd 6 deprecated `width`; `styles.wrapper` sets it without warning.
      styles={{ wrapper: { width: 860 } }}
      title={staffName ? `Payroll inputs — ${staffName}` : 'Payroll inputs'}
      extra={
        canEdit && staffId ? (
          <Button type="primary" size="small" onClick={() => setAddOpen(true)}>
            Add input
          </Button>
        ) : null
      }
    >
      <AdminNotice>
        Anything a person supplies for this period: an allowance, a bonus, a reimbursed claim, a recovery — and{' '}
        <strong>PCB</strong>, which this system does not calculate. Each row records who entered it and when.
      </AdminNotice>

      <Table<PayrollInputRow>
        rowKey="id"
        size="small"
        style={{ marginTop: 12 }}
        dataSource={rows}
        loading={inputs.isLoading}
        pagination={false}
        locale={{ emptyText: 'Nothing has been entered for this period yet.' }}
        columns={[
          { title: 'Employee', dataIndex: 'staffName', width: 160 },
          {
            title: 'Component',
            dataIndex: 'componentCode',
            width: 180,
            render: (code: string, row) => (
              <span>
                {row.label ?? code}
                <br />
                <Tag>{code}</Tag>
              </span>
            ),
          },
          { title: 'Amount', dataIndex: 'amount', align: 'right', width: 100 },
          {
            title: 'Kind',
            dataIndex: 'kind',
            width: 110,
            // Labelled, not inferred: PCB treats the two differently.
            render: (k: string) => <Tag color={k === 'RECURRING' ? 'blue' : 'default'}>{k}</Tag>,
          },
          {
            title: 'Source',
            dataIndex: 'source',
            width: 120,
            render: (source: string) => (
              <Tag color={source === 'MANUAL' ? 'default' : 'green'}>{source}</Tag>
            ),
          },
          {
            title: 'Entered by',
            key: 'by',
            render: (_: unknown, row) => (
              <span style={{ fontSize: 12 }}>
                {row.enteredBy}
                <br />
                <span style={{ color: '#888' }}>{new Date(row.enteredAt).toLocaleString()}</span>
                {row.reason ? (
                  <>
                    <br />
                    <span style={{ color: '#888' }}>{row.reason}</span>
                  </>
                ) : null}
              </span>
            ),
          },
          ...(canEdit
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 90,
                  render: (_: unknown, row: PayrollInputRow) =>
                    row.editable ? (
                      <Button
                        size="small"
                        danger
                        onClick={async () => {
                          try {
                            await remove.mutateAsync(row.id);
                            message.success('Removed.');
                          } catch (error) {
                            message.error(
                              error && typeof error === 'object' && 'message' in error
                                ? String((error as { message?: unknown }).message)
                                : 'The server refused the change.',
                            );
                          }
                        }}
                      >
                        Remove
                      </Button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#888' }}>from {row.source.toLowerCase()}</span>
                    ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        open={addOpen}
        onCancel={() => {
          setAddOpen(false);
          setSaveError(null);
        }}
        onOk={save}
        okText="Save input"
        confirmLoading={upsert.isPending}
        title={`Add a payroll input — ${period}`}
      >
        {saveError ? <AdminNotice tone="warn">{saveError}</AdminNotice> : null}
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <label>
            <div>Component</div>
            <Select
              style={{ width: '100%' }}
              placeholder="Allowance, bonus, PCB…"
              options={options}
              value={componentCode}
              onChange={setComponentCode}
              showSearch
              optionFilterProp="label"
            />
          </label>
          <label>
            <div>Amount</div>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              value={amount}
              onChange={(v) => setAmount(v ?? undefined)}
            />
            <div style={{ fontSize: 12, color: '#888' }}>
              Always positive. Whether it adds to or subtracts from pay is decided by the component.
            </div>
          </label>
          <label>
            <div>Recurring or additional</div>
            <Select
              style={{ width: '100%' }}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'ADDITIONAL', label: 'Additional — this period only' },
                { value: 'RECURRING', label: 'Recurring — a standing item' },
              ]}
            />
            <div style={{ fontSize: 12, color: '#888' }}>
              Monthly tax deduction treats the two differently, so it is recorded rather than inferred.
            </div>
          </label>
          <label>
            <div>Reason (optional)</div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this was added" />
          </label>
        </div>
      </Modal>
    </Drawer>
  );
}
