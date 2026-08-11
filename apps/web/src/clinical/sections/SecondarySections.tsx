import { useState } from 'react';
import { Visit } from '../types';
import { DocumentsSection } from './DocumentsSection';
import { InvoiceSection } from './InvoiceSection';

interface SecondarySectionsProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
  /**
   * G4.5d (D-075) — optionally controlled, so the Visit Completion Bar can
   * open the full workspace it summarises. Left uncontrolled these keep their
   * own state and behave exactly as before.
   */
  documentsOpen?: boolean;
  invoiceOpen?: boolean;
  onToggleDocuments?: () => void;
  onToggleInvoice?: () => void;
}

/**
 * G4.5a (D-071) — Documents and the read-only Invoice Summary, below the
 * working Canvas.
 *
 * Both are end-of-consultation surfaces: an MC is written once the diagnosis
 * exists, and the invoice is READ, never edited here (G3c/D-065, billing RBAC
 * D-066). Keeping them below the fold is what makes room for the note and the
 * action rail to be visible together above it — and neither loses any
 * behaviour by being here rather than in the rail.
 *
 * G4.5d (D-075) — the *summary* of both now lives in the completion bar at the
 * top. These stay as the full detail: the document list, void history, other
 * templates, and every invoice line. Nothing moved; a shortcut was added.
 */
export function SecondarySections({
  visit,
  patientName,
  patientIdentifier,
  documentsOpen,
  invoiceOpen,
  onToggleDocuments,
  onToggleInvoice,
}: SecondarySectionsProps) {
  const [ownDocuments, setOwnDocuments] = useState(false);
  const [ownInvoice, setOwnInvoice] = useState(false);

  const docsExpanded = documentsOpen ?? ownDocuments;
  const invExpanded = invoiceOpen ?? ownInvoice;

  return (
    <div className="kw-secondary-sections">
      <div id="kw-anchor-documents">
        <DocumentsSection
          visit={visit}
          patientName={patientName}
          patientIdentifier={patientIdentifier}
          expanded={docsExpanded}
          onToggle={onToggleDocuments ?? (() => setOwnDocuments((prev) => !prev))}
        />
      </div>
      <div id="kw-anchor-invoice">
        <InvoiceSection
          visit={visit}
          expanded={invExpanded}
          onToggle={onToggleInvoice ?? (() => setOwnInvoice((prev) => !prev))}
        />
      </div>
    </div>
  );
}
