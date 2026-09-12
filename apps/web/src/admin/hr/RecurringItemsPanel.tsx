import { useState } from 'react';
import { App, DatePicker, Input, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import { useCreateRecurringItem, useRecurringItemChoices, useRecurringItems, useUpdateRecurringItem } from '../hooks/useAdmin';
import { Drawer, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconEdit, IconPlus } from './ui/icons';
import type { RecurringItemRow } from '../types';

/**
 * RECURRING ITEMS — what a pay component carries for this person every month
 * until an end date. One-off items go in the payroll grid instead.
 *
 * The three marks beside an item are the COMPONENT'S statutory treatment,
 * read from the catalogue: an allowance that is EPF wages is EPF wages on
 * every employee who has it. The item itself only says how much, from when,
 * until when, and why.
 *
 * WHAT THE RUN DOES WITH THEM arrives in 3d: the payroll grid's default for
 * "Other income" and "Other deduction" is the sum of the items in force for
 * the month. Until then an item is recorded and shown, and the panel says so.
 */
const ringgit = (value: string) => Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Mark = ({ on, title }: { on: boolean; title: string }) => (
  <span className={`hr-dot ${on ? 'hr-dot--ok' : 'hr-dot--block'}`} role="img" aria-label={`${title}: ${on ? 'yes' : 'no'}`} title={`${title}: ${on ? 'yes' : 'no'}`} />
);

export function RecurringItemsPanel({ staffId, canSeePay }: { staffId: string; canSeePay: boolean }) {
  const { message } = App.useApp();
  const mayManage = useCan('hr.employee.manage');
  const items = useRecurringItems(canSeePay ? staffId : undefined);
  const choices = useRecurringItemChoices();
  const create = useCreateRecurringItem();
  const update = useUpdateRecurringItem();

  const [editing, setEditing] = useState<RecurringItemRow | 'new' | null>(null);
  const [code, setCode] = useState<string | undefined>();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState<Dayjs>(dayjs().add(1, 'month').startOf('month'));
  const [until, setUntil] = useState<Dayjs | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const openNew = () => {
    setCode(undefined);
    setLabel('');
    setAmount('');
    setFrom(dayjs().add(1, 'month').startOf('month'));
    setUntil(null);
    setNote('');
    setProblem(null);
    setEditing('new');
  };
  const openEdit = (row: RecurringItemRow) => {
    setCode(row.componentCode);
    setLabel(row.label ?? '');
    setAmount(row.amount);
    setFrom(dayjs(row.effectiveFrom));
    setUntil(row.effectiveTo ? dayjs(row.effectiveTo) : null);
    setNote(row.note ?? '');
    setProblem(null);
    setEditing(row);
  };
  const close = () => setEditing(null);

  const save = () => {
    const cleaned = amount.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned) || Number(cleaned) <= 0) {
      setProblem('Enter the amount as a number above zero, with at most two decimal places.');
      return;
    }
    const done = { onSuccess: () => { message.success('Recorded.'); close(); }, onError: (error: Error) => setProblem(error.message) };
    if (editing === 'new') {
      if (!code) {
        setProblem('Choose which pay item this is.');
        return;
      }
      create.mutate(
        {
          staffId,
          componentCode: code,
          label: label.trim() || undefined,
          amount: cleaned,
          effectiveFrom: from.format('YYYY-MM-DD'),
          effectiveTo: until ? until.format('YYYY-MM-DD') : undefined,
          note: note.trim() || undefined,
        },
        done,
      );
    } else if (editing) {
      update.mutate(
        { staffId, id: editing.id, label: label.trim(), amount: cleaned, effectiveTo: until ? until.format('YYYY-MM-DD') : null, note: note.trim() },
        done,
      );
    }
  };

  const rows = items.data ?? [];
  const chosen = choices.data?.find((choice) => choice.code === code);

  return (
    <>
      <PanelHead
        rule
        title="Recurring items"
        sub="Paid every month automatically until an end date. One-off items go in the payroll grid instead."
        actions={
          canSeePay && mayManage ? (
            <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={openNew}>
              <IconPlus />
              Add recurring item
            </button>
          ) : null
        }
      />
      {canSeePay ? (
        <Table<RecurringItemRow>
          rowKey="id"
          loading={items.isLoading}
          rows={rows}
          emptyText="No recurring items."
          emptyHint="A monthly allowance or a deduction being recovered goes here, dated, so payroll carries it without anybody retyping it."
          columns={[
            {
              title: 'Item',
              dataIndex: 'componentName',
              render: (value: string, row) => (
                <span>
                  <span className="hr-strong">{value}</span>
                  {row.label ? ` — ${row.label}` : ''}
                  {row.status === 'ENDED' ? (
                    <>
                      {' '}
                      <StatusChip tone="muted">Ended</StatusChip>
                    </>
                  ) : row.status === 'UPCOMING' ? (
                    <>
                      {' '}
                      <StatusChip tone="info">Upcoming</StatusChip>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Amount (RM)',
              dataIndex: 'amount',
              num: true,
              width: 130,
              render: (value: string, row) => (row.direction === 'DEDUCTION' ? <span className="hr-neg">−{ringgit(value)}</span> : ringgit(value)),
            },
            { title: 'From', dataIndex: 'effectiveFrom', width: 130, render: (value: string) => dayjs(value).format('D MMM YYYY') },
            {
              title: 'Until',
              dataIndex: 'effectiveTo',
              width: 130,
              render: (value: string | null) => (value ? dayjs(value).format('D MMM YYYY') : <span className="hr-faint">—</span>),
            },
            {
              title: 'EPF / SOCSO / PCB',
              key: 'treatment',
              width: 150,
              render: (_: unknown, row) =>
                row.treatment && row.direction === 'ADDITION' ? (
                  <span className="hr-dots">
                    <Mark on={row.treatment.epf} title="EPF wages" />
                    <Mark on={row.treatment.socso} title="SOCSO wages" />
                    <Mark on={row.treatment.pcb} title="Taxable" />
                  </span>
                ) : (
                  <span className="hr-faint">—</span>
                ),
            },
            {
              title: '',
              key: 'edit',
              width: 90,
              render: (_: unknown, row) =>
                mayManage ? (
                  <span className="hr-menu">
                    <button type="button" className="hr-btn hr-btn--sm" onClick={() => openEdit(row)}>
                      <IconEdit />
                      Edit
                    </button>
                  </span>
                ) : null,
            },
          ]}
        />
      ) : null}

      <Drawer
        open={editing !== null}
        onClose={close}
        title={editing === 'new' ? 'Add recurring item' : 'Edit recurring item'}
        sub={editing === 'new' ? 'From a month; until a month, or until it is ended.' : 'An amount already paid by an approved run is settled: end the item and add a new one instead.'}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={save} disabled={create.isPending || update.isPending}>
              {editing === 'new' ? 'Add item' : 'Save'}
            </button>
          </>
        }
      >
        <div className="hr-form">
          <div>
            <label htmlFor="ri-code">Pay item</label>
            <Select
              id="ri-code"
              value={code}
              onChange={setCode}
              disabled={editing !== 'new'}
              placeholder="Choose an item"
              style={{ width: '100%' }}
              options={(choices.data ?? []).map((choice) => ({
                value: choice.code,
                label: `${choice.name}${choice.direction === 'DEDUCTION' ? ' (deducts)' : ''}`,
              }))}
            />
            {chosen ? (
              <div className="hr-form__help">
                {chosen.direction === 'DEDUCTION'
                  ? 'Taken from pay every month.'
                  : `Counts towards ${[chosen.treatment.epf ? 'EPF' : null, chosen.treatment.socso ? 'SOCSO' : null, chosen.treatment.pcb ? 'tax' : null].filter(Boolean).join(', ') || 'nothing statutory'} — the item's treatment is set on Payroll items.`}
              </div>
            ) : null}
          </div>
          <div>
            <label htmlFor="ri-label">Label</label>
            <Input id="ri-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. housing, phone" maxLength={120} />
          </div>
          <div className="hr-form__row">
            <div>
              <label htmlFor="ri-amount">Amount per month</label>
              <Input id="ri-amount" value={amount} onChange={(e) => setAmount(e.target.value)} prefix="RM" inputMode="decimal" />
            </div>
            <div>
              <label htmlFor="ri-from">From</label>
              <DatePicker id="ri-from" picker="month" value={from} disabled={editing !== 'new'} allowClear={false} format="MMM YYYY" style={{ width: '100%' }} onChange={(v) => v && setFrom(v.startOf('month'))} />
            </div>
          </div>
          <div>
            <label htmlFor="ri-until">Until (optional)</label>
            <DatePicker id="ri-until" picker="month" value={until} format="MMM YYYY" style={{ width: '100%' }} onChange={(v) => setUntil(v ? v.endOf('month').startOf('day') : null)} />
            <div className="hr-form__help">The last month it is paid. Leave empty for an item with no end.</div>
          </div>
          <div>
            <label htmlFor="ri-note">Note</label>
            <Input id="ri-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Salary advance of RM800 taken 20 Aug" maxLength={500} />
          </div>
          {problem ? <div className="hr-notice hr-notice--attn">{problem}</div> : null}
        </div>
      </Drawer>
    </>
  );
}
