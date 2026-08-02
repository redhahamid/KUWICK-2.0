import { useDocuments } from '../hooks/useDocuments';
import { DocumentsTab } from '../DocumentsTab';
import { ClinicalDocument, DocumentType, Visit } from '../types';
import { ClinicalSection } from './ClinicalSection';

const TYPE_LABEL: Record<DocumentType, string> = {
  MC: 'MC',
  REFERRAL: 'Referral',
  MEMO: 'Memo',
  QUARANTINE: 'Quarantine',
  CUSTOM: 'Custom',
};

interface DocumentsSectionProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
  expanded: boolean;
  onToggle: () => void;
}

// G1 (D-058) — Documents is now its own section. It previously shared a
// single small card with Invoice ("Documents & Invoice"), which put two
// unrelated workflows in one box; the owner did not approve that grouping.
// The document engine, templates and generation logic are untouched — G3
// redesigns the internals (preview, print, download, created-by).
export function DocumentsSection({
  visit,
  patientName,
  patientIdentifier,
  expanded,
  onToggle,
}: DocumentsSectionProps) {
  const { data: documents, isLoading, error } = useDocuments(visit.id);
  const list = documents ?? [];

  // Counted by real stored type, never inferred from document text.
  const byType = list.reduce<Record<string, number>>((acc, doc: ClinicalDocument) => {
    const label = doc.type === 'CUSTOM' ? doc.title ?? TYPE_LABEL.CUSTOM : TYPE_LABEL[doc.type];
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byType)
    .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
    .join(' · ');

  const unsigned = list.filter((doc) => !doc.signedAt).length;

  return (
    <ClinicalSection
      title="Documents"
      count={list.length}
      summary={summary}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No documents issued for this visit"
      primaryAction={{ label: '+ Create Document', onClick: () => !expanded && onToggle() }}
      secondaryActions={
        unsigned > 0
          ? [{ key: 'unsigned', label: `${unsigned} unsigned — open to sign`, onClick: () => !expanded && onToggle() }]
          : undefined
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <DocumentsTab visit={visit} patientName={patientName} patientIdentifier={patientIdentifier} />
    </ClinicalSection>
  );
}
