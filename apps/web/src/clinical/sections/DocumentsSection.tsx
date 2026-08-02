import { useState } from 'react';
import { Tag } from 'antd';
import dayjs from 'dayjs';
import { useDocumentHistory, useDocuments } from '../hooks/useDocuments';
import { DocumentsWorkspace } from '../documents/DocumentsWorkspace';
import { authorisationState, shortLabel } from '../documents/documentPresentation';
import { ClinicalDocument, Visit } from '../types';
import { ClinicalSection } from './ClinicalSection';

interface DocumentsSectionProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * G1 (D-058) — Documents is its own section; G3b redesigned its contents.
 *
 * The collapsed line answers the question a doctor actually has on a closed
 * section: what has this visit already been given? "1 MC · 1 Referral", the
 * most recent one, and whether anything still needs signing — read without
 * expanding anything.
 *
 * The count is ACTIVE documents only. A voided MC is reported separately and
 * quietly ("1 voided"), never folded into the number, because a count that
 * includes withdrawn paperwork is worse than no count.
 */
export function DocumentsSection({
  visit,
  patientName,
  patientIdentifier,
  expanded,
  onToggle,
}: DocumentsSectionProps) {
  const { data: documents, isLoading, error } = useDocuments(visit.id);
  const { data: history } = useDocumentHistory(visit.id, true);
  const [createOpen, setCreateOpen] = useState(false);

  const active = documents ?? [];
  const voidedCount = (history ?? []).filter((doc) => doc.recordStatus === 'VOIDED').length;

  // Counted by real stored type, never inferred from document text.
  const byType = active.reduce<Record<string, number>>((acc, doc: ClinicalDocument) => {
    const label = shortLabel(doc);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const typeSummary = Object.entries(byType)
    .map(([label, n]) => `${n} ${label}`)
    .join(' · ');

  const latest = active[0];
  const summary = [
    typeSummary,
    latest ? `latest ${shortLabel(latest)} ${dayjs(latest.issuedDate).format('D MMM')}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  // G3b closure (D-064) — count what a doctor still has to do, and say so.
  const awaiting = active.filter((doc) => authorisationState(doc).isDraft).length;

  return (
    <ClinicalSection
      title="Documents"
      count={active.length}
      summary={summary}
      status={
        voidedCount > 0 ? (
          <Tag color="default" style={{ fontSize: 11 }}>
            {voidedCount} voided
          </Tag>
        ) : undefined
      }
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && active.length === 0}
      emptyText="No documents issued for this visit"
      primaryAction={{
        label: '+ Create Document',
        onClick: () => {
          if (!expanded) onToggle();
          setCreateOpen(true);
        },
      }}
      secondaryActions={
        awaiting > 0
          ? [
              {
                key: 'awaiting',
                label: `${awaiting} awaiting clinical authorisation`,
                onClick: () => !expanded && onToggle(),
              },
            ]
          : undefined
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <DocumentsWorkspace
        visit={visit}
        patientName={patientName}
        patientIdentifier={patientIdentifier}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
      />
    </ClinicalSection>
  );
}
