import { useState } from 'react';
import { Visit } from '../types';
import { DocumentsSection } from './DocumentsSection';
import { InvoiceSection } from './InvoiceSection';

interface SecondarySectionsProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
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
 */
export function SecondarySections({ visit, patientName, patientIdentifier }: SecondarySectionsProps) {
  const [openDocuments, setOpenDocuments] = useState(false);
  const [openInvoice, setOpenInvoice] = useState(false);

  return (
    <div className="kw-secondary-sections">
      <DocumentsSection
        visit={visit}
        patientName={patientName}
        patientIdentifier={patientIdentifier}
        expanded={openDocuments}
        onToggle={() => setOpenDocuments((prev) => !prev)}
      />
      <InvoiceSection visit={visit} expanded={openInvoice} onToggle={() => setOpenInvoice((prev) => !prev)} />
    </div>
  );
}
