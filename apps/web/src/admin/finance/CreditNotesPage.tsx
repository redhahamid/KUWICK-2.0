import { useState } from 'react';
import { App, Button, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCan } from '../../core/hooks/useCan';
import { useApproveCreditNote, useCreditNotes } from '../hooks/useAdmin';

/**
 * CREDIT NOTES — correcting revenue without destroying what was billed.
 *
 * The two-person rule is the thing this screen exists to make visible: a DRAFT
 * reduces nothing, and the person who raised it is shown beside the person who
 * approved it. An owner scanning this page should be able to see at a glance
 * that the two names are different.
 */
export function CreditNotesPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const [status, setStatus] = useState<string | undefined>();
  const { data, isLoading, isError, error } = useCreditNotes({ clinicId, status });
  const approve = useApproveCreditNote();
  const mayApprove = useCan('creditNote.approve');

  const drafts = data?.filter((note) => note.status === 'DRAFT') ?? [];
  const issued = data?.filter((note) => note.status === 'ISSUED') ?? [];

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Credit Notes"
      subtitle="A credit note leaves the original invoice exactly as issued and records the reduction as its own dated, approvable document."
      actions={
        <Button.Group size="small">
          {[undefined, 'DRAFT', 'ISSUED', 'VOID'].map((value) => (
            <Button key={value ?? 'all'} type={status === value ? 'primary' : 'default'} onClick={() => setStatus(value)}>
              {value ?? 'All'}
            </Button>
          ))}
        </Button.Group>
      }
    >
      <StatStrip
        stats={[
          { label: 'Awaiting approval', value: drafts.length, tone: drafts.length > 0 ? 'warn' : 'neutral' },
          { label: 'Issued', value: issued.length },
          {
            label: 'Value credited',
            value: money(issued.reduce((total, note) => total + note.totalAmount, 0)),
            explain: 'Only ISSUED notes reduce a balance. A draft has not been approved and a void one was withdrawn.',
          },
        ]}
      />

      <AdminNotice>
        A DRAFT credit note reduces nothing. It becomes effective only when somebody holding the approval permission
        issues it — and that person cannot be the one who raised it unless they hold both.
      </AdminNotice>

      <AdminSection title="Credit notes" padded={false}>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey="id"
          exportName="credit-notes"
          searchFields={['creditNoteNumber' as never, 'invoiceNumber' as never, 'patientName' as never, 'reason' as never]}
          searchPlaceholder="Search note, invoice, patient or reason…"
          emptyText="No credit notes"
          emptyHint="Corrections to revenue appear here rather than as edits to invoices."
          columns={[
            { title: 'Note', dataIndex: 'creditNoteNumber', key: 'creditNoteNumber' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => (
                <Tag color={value === 'ISSUED' ? 'green' : value === 'VOID' ? 'default' : 'gold'}>{value}</Tag>
              ),
            },
            {
              title: 'Raised',
              dataIndex: 'createdAt',
              key: 'createdAt',
              defaultSortOrder: 'descend',
              sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
              render: (value: string) => dayjs(value).format('D MMM YY'),
            },
            { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
            { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
            {
              title: 'Invoice total',
              dataIndex: 'invoiceTotal',
              key: 'invoiceTotal',
              className: 'kw-num',
              optional: true,
              render: (value: number | null) => (value === null ? '—' : money(value)),
            },
            {
              title: 'Credited',
              dataIndex: 'totalAmount',
              key: 'totalAmount',
              className: 'kw-num',
              render: (value: number) => <strong>{money(value)}</strong>,
            },
            { title: 'Reason', dataIndex: 'reason', key: 'reason', ellipsis: true },
            { title: 'Raised by', dataIndex: 'createdBy', key: 'createdBy' },
            {
              title: 'Approved by',
              dataIndex: 'approvedBy',
              key: 'approvedBy',
              render: (value: string | null) => value ?? <span className="kw-muted">—</span>,
            },
            {
              title: '',
              key: 'action',
              noExport: true,
              render: (_: unknown, row) =>
                row.status === 'DRAFT' && mayApprove ? (
                  <Button
                    size="small"
                    type="link"
                    loading={approve.isPending}
                    onClick={() =>
                      approve.mutate(row.id, {
                        onSuccess: () => message.success(`${row.creditNoteNumber} issued`),
                        onError: (error: Error) => message.error(error.message),
                      })
                    }
                  >
                    Approve
                  </Button>
                ) : null,
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
