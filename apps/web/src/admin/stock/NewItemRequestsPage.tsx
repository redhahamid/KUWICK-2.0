import { useState } from 'react';
import { App, Button, Input, Modal, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useCan } from '../../core/hooks/useCan';
import {
  useApproveNewItemRequest,
  useNewItemRequests,
  useRaiseNewItemRequest,
  useRejectNewItemRequest,
  useSuppliers,
} from '../hooks/useAdmin';
import type { NewItemRequestRow } from '../types';

/**
 * ASKING FOR AN ITEM THAT DOES NOT EXIST YET.
 *
 * The clinic runs this as a five-column sheet — medication, reason, comments,
 * "stock admin noted", supplier — where the approval IS the text in the fourth
 * column (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §2). No state, no actor, no
 * date, and nothing checks whether the item already exists.
 *
 * Deliberately separate from Procurement Requests, which asks for MORE of
 * something the catalogue already knows about. This asks for something that
 * does not exist, and the risk is different: a duplicate item, not a duplicate
 * order.
 */
export function NewItemRequestsPage() {
  const { message } = App.useApp();
  const requests = useNewItemRequests();
  const suppliers = useSuppliers();
  const raise = useRaiseNewItemRequest();
  const approve = useApproveNewItemRequest();
  const reject = useRejectNewItemRequest();

  const mayDecide = useCan('stock.price.manage');

  const [raising, setRaising] = useState(false);
  const [draft, setDraft] = useState({
    requestedName: '',
    reason: '',
    comments: '',
    packSizeNote: '',
    suggestedSupplierId: undefined as string | undefined,
    indicativeCost: '',
    indicativePrice: '',
  });

  const [approving, setApproving] = useState<NewItemRequestRow | null>(null);
  const [approveDraft, setApproveDraft] = useState({
    name: '',
    code: '',
    category: '',
    unitOfMeasure: '',
    sellPrice: '',
    cost: '',
    decisionNote: '',
  });

  const [rejecting, setRejecting] = useState<NewItemRequestRow | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const rows = requests.data ?? [];
  const pending = rows.filter((row) => row.status === 'PENDING');
  const flagged = pending.filter((row) => row.possibleDuplicate !== null);
  const awaitingStock = rows.filter((row) => row.createdItem?.awaitingFirstReceipt);

  return (
    <AdminShell
      error={firstError(requests, suppliers)}
      title="New item requests"
      subtitle="Asking for something the catalogue does not have yet — with a decision that has an author and a date, and a check against what already exists."
      actions={
        <Button type="primary" size="small" onClick={() => setRaising(true)}>
          Request a new item
        </Button>
      }
    >
      <StatStrip
        stats={[
          { label: 'Waiting on a decision', value: String(pending.length), tone: pending.length > 0 ? 'warn' : 'good' },
          {
            label: 'Look like something we have',
            value: String(flagged.length),
            hint: 'Checked against the catalogue',
            tone: flagged.length > 0 ? 'warn' : 'good',
          },
          {
            label: 'Approved, awaiting stock',
            value: String(awaitingStock.length),
            hint: 'In the catalogue, not usable until the first delivery',
            explain:
              'An item exists once it has physically arrived. Ordering it is a promise; prescribing from a promise hands a patient a script the dispensary cannot fill.',
          },
        ]}
      />

      {flagged.length > 0 ? (
        <AdminNotice tone="warn">
          {flagged.length} pending request(s) look like an item the catalogue already has. Two entries for one medicine
          means two stock levels, two costs, and a count that never reconciles — check before approving.
        </AdminNotice>
      ) : null}

      <AdminSection title="Requests" padded={false}>
        <DataTable
          rows={rows}
          loading={requests.isLoading}
          rowKey="id"
          exportName="new-item-requests"
          searchFields={['requestedName' as never, 'reason' as never]}
          searchPlaceholder="Search what was asked for…"
          emptyText="Nobody has asked for a new item"
          columns={[
            { title: 'Asked for', dataIndex: 'requestedName', key: 'requestedName' },
            {
              title: 'Why',
              dataIndex: 'reason',
              key: 'reason',
              ellipsis: true,
              render: (value: string) => <Tooltip title={value}>{value}</Tooltip>,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) =>
                value === 'APPROVED' ? (
                  <Tag color="green">Approved</Tag>
                ) : value === 'REJECTED' ? (
                  <Tag color="red">Rejected</Tag>
                ) : (
                  <Tag color="blue">Pending</Tag>
                ),
            },
            {
              // The check the five-column sheet has never had.
              title: 'Already in the catalogue?',
              key: 'duplicate',
              render: (_: unknown, row) =>
                row.possibleDuplicate === null ? (
                  <span className="kw-muted">nothing similar</span>
                ) : (
                  <Tooltip title={`"${row.possibleDuplicate.name}" looks like the same medicine.`}>
                    <Tag color="orange">{row.possibleDuplicate.name}</Tag>
                  </Tooltip>
                ),
            },
            {
              title: 'Becomes',
              key: 'createdItem',
              render: (_: unknown, row) =>
                row.createdItem === null ? (
                  <span className="kw-muted">—</span>
                ) : row.createdItem.awaitingFirstReceipt ? (
                  <Tooltip title="In the catalogue, but not usable until the first delivery arrives.">
                    <Tag color="gold">awaiting first delivery</Tag>
                  </Tooltip>
                ) : (
                  <Tag color="green">{row.createdItem.name}</Tag>
                ),
            },
            { title: 'Supplier', dataIndex: 'suggestedSupplier', key: 'suggestedSupplier', optional: true },
            { title: 'Pack size', dataIndex: 'packSizeNote', key: 'packSizeNote', optional: true },
            {
              title: 'Indicative cost',
              dataIndex: 'indicativeCost',
              key: 'indicativeCost',
              className: 'kw-num',
              optional: true,
              render: (value: number | null) => (value === null ? <span className="kw-muted">—</span> : money(value)),
            },
            { title: 'Asked by', dataIndex: 'requestedBy', key: 'requestedBy', optional: true },
            {
              title: 'Decided',
              key: 'decided',
              optional: true,
              render: (_: unknown, row) =>
                row.decidedAt === null ? (
                  <span className="kw-muted">open</span>
                ) : (
                  <Tooltip title={row.decisionNote ?? undefined}>
                    {dayjs(row.decidedAt).format('D MMM YY')} · {row.decidedBy}
                  </Tooltip>
                ),
            },
            {
              title: '',
              key: 'actions',
              render: (_: unknown, row) =>
                mayDecide && row.status === 'PENDING' ? (
                  <>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setApproving(row);
                        setApproveDraft({
                          name: row.requestedName,
                          code: '',
                          category: '',
                          unitOfMeasure: '',
                          sellPrice: row.indicativePrice === null ? '' : row.indicativePrice.toFixed(2),
                          cost: row.indicativeCost === null ? '' : row.indicativeCost.toFixed(2),
                          decisionNote: '',
                        });
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      type="link"
                      danger
                      onClick={() => {
                        setRejecting(row);
                        setRejectNote('');
                      }}
                    >
                      Reject
                    </Button>
                  </>
                ) : null,
            },
          ]}
        />
      </AdminSection>

      {/* --- Raise --- */}
      <Modal
        open={raising}
        title="Request a new item"
        okText="Send the request"
        confirmLoading={raise.isPending}
        okButtonProps={{ disabled: draft.requestedName.trim().length < 2 || draft.reason.trim().length < 10 }}
        onCancel={() => setRaising(false)}
        onOk={() =>
          raise.mutate(
            {
              requestedName: draft.requestedName.trim(),
              reason: draft.reason,
              comments: draft.comments || undefined,
              packSizeNote: draft.packSizeNote || undefined,
              suggestedSupplierId: draft.suggestedSupplierId,
              indicativeCost: draft.indicativeCost || undefined,
              indicativePrice: draft.indicativePrice || undefined,
            },
            {
              onSuccess: (result: unknown) => {
                const duplicate = (result as { possibleDuplicate?: { name: string } | null } | undefined)
                  ?.possibleDuplicate;
                message.success(
                  duplicate
                    ? `Requested — but the catalogue already has "${duplicate.name}", which looks like the same thing.`
                    : 'Requested',
                );
                setRaising(false);
                setDraft({ ...draft, requestedName: '', reason: '', comments: '', packSizeNote: '' });
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          The catalogue is checked as soon as you send this. If something similar already exists you will be told
          straight away, which is much cheaper than finding out after there are two.
        </AdminNotice>
        <div style={{ display: 'grid', gap: 8 }}>
          <Input
            addonBefore="Item"
            placeholder="What is needed, in your own words"
            value={draft.requestedName}
            onChange={(event) => setDraft({ ...draft, requestedName: event.target.value })}
          />
          <Input.TextArea
            rows={3}
            placeholder="Why it is needed — the person deciding did not see the patient"
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
          <Input
            addonBefore="Pack size"
            placeholder="e.g. 10 strips, 1 box = 10 strips"
            value={draft.packSizeNote}
            onChange={(event) => setDraft({ ...draft, packSizeNote: event.target.value })}
          />
          <Select
            allowClear
            placeholder="Suggested supplier (optional)"
            value={draft.suggestedSupplierId}
            onChange={(value) => setDraft({ ...draft, suggestedSupplierId: value ?? undefined })}
            options={(suppliers.data ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name }))}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              addonBefore="Cost"
              placeholder="0.00"
              value={draft.indicativeCost}
              onChange={(event) => setDraft({ ...draft, indicativeCost: event.target.value })}
            />
            <Input
              addonBefore="Price"
              placeholder="0.00"
              value={draft.indicativePrice}
              onChange={(event) => setDraft({ ...draft, indicativePrice: event.target.value })}
            />
          </div>
          <Input.TextArea
            rows={2}
            placeholder="Anything else (optional)"
            value={draft.comments}
            onChange={(event) => setDraft({ ...draft, comments: event.target.value })}
          />
        </div>
      </Modal>

      {/* --- Approve --- */}
      <Modal
        open={approving !== null}
        width={600}
        title={`Approve — ${approving?.requestedName ?? ''}`}
        okText="Create the catalogue entry"
        confirmLoading={approve.isPending}
        okButtonProps={{ disabled: !approveDraft.sellPrice }}
        onCancel={() => setApproving(null)}
        onOk={() =>
          approving &&
          approve.mutate(
            {
              id: approving.id,
              name: approveDraft.name || undefined,
              code: approveDraft.code || undefined,
              category: approveDraft.category || undefined,
              unitOfMeasure: approveDraft.unitOfMeasure || undefined,
              sellPrice: approveDraft.sellPrice,
              cost: approveDraft.cost || undefined,
              decisionNote: approveDraft.decisionNote || undefined,
              acknowledgeDuplicate: approving.possibleDuplicate !== null,
            },
            {
              onSuccess: (result: unknown) => {
                message.success((result as { note?: string } | undefined)?.note ?? 'Approved');
                setApproving(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        {approving?.possibleDuplicate ? (
          <AdminNotice tone="warn">
            The catalogue already has <strong>{approving.possibleDuplicate.name}</strong>, which looks like the same
            medicine. Approving here creates a <strong>second</strong> entry — two stock levels, two costs, and a count
            that will never reconcile. Use the existing item unless the difference is real.
          </AdminNotice>
        ) : null}
        <AdminNotice>
          The item is created but <strong>not usable</strong>: it becomes active when the first delivery arrives. Pack
          size and price stop being prose here and become fields, which is the whole point.
        </AdminNotice>
        {approving?.packSizeNote ? (
          <p style={{ fontSize: 12.5 }}>
            Requester wrote: <em>{approving.packSizeNote}</em>
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 8 }}>
          <Input
            addonBefore="Name"
            value={approveDraft.name}
            onChange={(event) => setApproveDraft({ ...approveDraft, name: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              addonBefore="Code"
              value={approveDraft.code}
              onChange={(event) => setApproveDraft({ ...approveDraft, code: event.target.value })}
            />
            <Input
              addonBefore="Category"
              value={approveDraft.category}
              onChange={(event) => setApproveDraft({ ...approveDraft, category: event.target.value })}
            />
          </div>
          <Input
            addonBefore="Stock unit"
            placeholder="Box, Strip, Bottle…"
            value={approveDraft.unitOfMeasure}
            onChange={(event) => setApproveDraft({ ...approveDraft, unitOfMeasure: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              addonBefore="Cost"
              placeholder="0.00"
              value={approveDraft.cost}
              onChange={(event) => setApproveDraft({ ...approveDraft, cost: event.target.value })}
            />
            <Input
              addonBefore="Sell price"
              placeholder="0.00"
              value={approveDraft.sellPrice}
              onChange={(event) => setApproveDraft({ ...approveDraft, sellPrice: event.target.value })}
            />
          </div>
          <Input.TextArea
            rows={2}
            placeholder="Note on the decision (optional)"
            value={approveDraft.decisionNote}
            onChange={(event) => setApproveDraft({ ...approveDraft, decisionNote: event.target.value })}
          />
        </div>
      </Modal>

      {/* --- Reject --- */}
      <Modal
        open={rejecting !== null}
        title={`Reject — ${rejecting?.requestedName ?? ''}`}
        okText="Reject it"
        okButtonProps={{ disabled: rejectNote.trim().length < 5 }}
        confirmLoading={reject.isPending}
        onCancel={() => setRejecting(null)}
        onOk={() =>
          rejecting &&
          reject.mutate(
            { id: rejecting.id, decisionNote: rejectNote },
            {
              onSuccess: () => {
                message.success('Rejected');
                setRejecting(null);
              },
              onError: (error: Error) => message.error(error.message),
            },
          )
        }
      >
        <AdminNotice>
          The person who asked will want to know why, and so will the next person who asks for the same thing.
        </AdminNotice>
        <Input.TextArea
          rows={3}
          value={rejectNote}
          onChange={(event) => setRejectNote(event.target.value)}
          placeholder="Why this is not being added"
        />
      </Modal>
    </AdminShell>
  );
}
