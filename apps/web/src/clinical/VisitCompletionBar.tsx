import { useState } from 'react';
import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { FileTextOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useDocuments } from './hooks/useDocuments';
import { useInvoices } from './hooks/useInvoices';
import { CreateDocumentDrawer } from './documents/CreateDocumentDrawer';
import { BUILT_IN_TYPES } from './documents/documentPresentation';
import { ClinicalDocument, Invoice, Visit } from './types';

const { Text } = Typography;

interface VisitCompletionBarProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
  /** Opens and scrolls to the full Documents Workspace below the Canvas. */
  onOpenDocuments: () => void;
  /** Opens and scrolls to the read-only Invoice Summary below the Canvas. */
  onOpenInvoice: () => void;
}

// Token colour pairs, always rendered WITH the status word (D-077 §4).
const STATUS_CHIP: Record<string, string> = {
  UNPAID: 'kw-chip-pending',
  PAID: 'kw-chip-success',
  CANCELLED: 'kw-chip-neutral',
};

function typeLabel(document: ClinicalDocument): string {
  if (document.type === 'CUSTOM') return document.title ?? 'Document';
  return BUILT_IN_TYPES.find((t) => t.value === document.type)?.label ?? document.type;
}

/** Malaysian clinic money, written the way a receipt writes it. */
function money(amount: string | number): string {
  return `RM${Number(amount).toFixed(2)}`;
}

/**
 * G4.5d (D-075) — the Visit Completion Bar.
 *
 * Documents and the invoice are how a GP consultation ENDS, and both were
 * collapsed rows at the very bottom of the record: writing an MC meant
 * scrolling past the whole note and expanding a section, for one of the most
 * frequent actions in general practice.
 *
 * This is a summary and a set of entry points, not a second workspace. It
 * deliberately does NOT move the Documents Workspace or the invoice into the
 * clinical rail — the rail stays Diagnosis, Medications, Orders and Direct
 * Services — and it deliberately carries NO money-mutating control: no Pay,
 * no Cancel, no Quick Add, no line editing. Those live on the billing surface
 * behind the billing RBAC (D-066), and putting a payment button in the
 * clinical band would be exactly the confusion G3c removed.
 *
 * Both quick actions open the SAME `CreateDocumentDrawer` the Documents
 * Workspace opens, with the type preselected. There is one document-creation
 * path in the product, and this is a shortcut into it, not a rival to it.
 */
export function VisitCompletionBar({
  visit,
  patientName,
  patientIdentifier,
  onOpenDocuments,
  onOpenInvoice,
}: VisitCompletionBarProps) {
  const [creating, setCreating] = useState<string | null>(null);

  const { data: documents } = useDocuments(visit.id);
  const { data: invoices } = useInvoices(visit.id);

  // `useDocuments` returns the active record; voided documents live in the
  // workspace's history view and must never be counted as issued.
  const active = (documents ?? []).filter((d) => d.recordStatus !== 'VOIDED');
  const latest = [...active].sort(
    (a, b) => dayjs(b.issuedDate ?? b.createdAt).valueOf() - dayjs(a.issuedDate ?? a.createdAt).valueOf(),
  )[0];

  const invoiceList = invoices ?? [];
  // No primary invoice is invented when there are several — the bar says how
  // many and sends the biller to the real list rather than picking one.
  const single = invoiceList.length === 1 ? invoiceList[0] : undefined;
  const onPanel = Boolean(visit.panelClinicId);

  const invoiceSummary = (invoice: Invoice) => (
    <>
      <Text strong style={{ fontSize: 13 }}>
        {invoice.invoiceNumber}
      </Text>
      <Text style={{ fontSize: 13 }}>{money(invoice.totalAmount)}</Text>
      <Tag className={STATUS_CHIP[invoice.status]}>{invoice.status}</Tag>
    </>
  );

  return (
    <>
      <div className="kw-completion-bar" aria-label="Visit completion">
        <div className="kw-completion-group">
          <Text type="secondary" className="kw-completion-label">
            DOCUMENTS
          </Text>
          {active.length > 0 ? (
            <Space size={6} wrap>
              <Text strong style={{ fontSize: 13 }}>
                {active.length} active
              </Text>
              {latest && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Latest {typeLabel(latest)} {dayjs(latest.issuedDate ?? latest.createdAt).format('D MMM')}
                </Text>
              )}
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              None issued
            </Text>
          )}
          {/* b4 PIECE 1 — Create MC, Create Referral and More Documents are
              GONE from this band. They lived here because the canvas had no
              Documents card and this was a doctor's only way to issue an MC;
              the card landed in Phase F and the owner has confirmed it works,
              so keeping them would be three controls doing what the card does,
              two of them jumping to a type the card also offers. One button,
              one function.

              The SUMMARY above stays: "2 active · Latest MC 16 Aug" is the
              band answering what has been issued, which is a different job
              from issuing one. */}
        </div>

        <div className="kw-completion-group">
          <Text type="secondary" className="kw-completion-label">
            INVOICE
          </Text>
          {invoiceList.length === 0 ? (
            // Never "RM0.00" — that reads as a bill for nothing, when the
            // truth is that no bill exists yet.
            <Text type="secondary" style={{ fontSize: 12 }}>
              No invoice created
            </Text>
          ) : single ? (
            <Space size={6} wrap>
              {invoiceSummary(single)}
              <Tag className="kw-chip-neutral">
                {onPanel ? `Panel · ${visit.panelClinic?.name ?? visit.billingType}` : 'Cash'}
              </Tag>
            </Space>
          ) : (
            // D-077 — the count only. The earlier version added the invoices
            // together and called it a total; no visit-level total is stored,
            // so that figure was this component's invention rather than the
            // clinic's number.
            <Space size={6} wrap>
              <Tooltip title="This visit has more than one invoice. Open the invoice list to see each one.">
                <Text strong style={{ fontSize: 13 }}>
                  {invoiceList.length} invoices
                </Text>
              </Tooltip>
              <Tag className="kw-chip-neutral">{onPanel ? 'Panel' : 'Cash'}</Tag>
            </Space>
          )}
          <Space size={6} className="kw-completion-actions">
            {/* D-077 — the LABEL matches the state. "No invoice created" beside
                a button saying "Open Invoice" promises to open something that
                does not exist. Read-only either way: everything that moves
                money is on the billing surface, behind the billing RBAC. */}
            <Button size="small" onClick={onOpenInvoice}>
              {invoiceList.length === 0
                ? 'Open Billing'
                : invoiceList.length === 1
                  ? 'Open Invoice'
                  : 'View Invoices'}
            </Button>
          </Space>
        </div>
      </div>

      {/* The unchanged create flow — same drawer, same templates, same G3b
          authorisation rules; only the starting type differs. */}
      <CreateDocumentDrawer
        visit={visit}
        open={creating !== null}
        initialType={creating ?? undefined}
        patientName={patientName}
        patientIdentifier={patientIdentifier}
        onClose={() => setCreating(null)}
      />
    </>
  );
}
