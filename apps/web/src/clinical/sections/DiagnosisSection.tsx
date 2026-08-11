import { Tag } from 'antd';
import { useDiagnoses } from '../hooks/useDiagnoses';
import { DiagnosisSectionBody } from './DiagnosisSectionBody';
import { ClinicalSection, summarise } from './ClinicalSection';

interface DiagnosisSectionProps {
  visitId: string;
  expanded: boolean;
  onToggle: () => void;
}

// G1 (D-058) — Diagnosis in the shared shell. The expanded body is the
// existing DiagnosisTab, unchanged: catalog-source toggles, search-and-add,
// free-text custom entries and removal all behave exactly as before. The
// detailed redesign (primary/secondary, added-by, attribution) is G2.
export function DiagnosisSection({ visitId, expanded, onToggle }: DiagnosisSectionProps) {
  const { data: diagnoses, isLoading, error } = useDiagnoses(visitId);
  const list = diagnoses ?? [];

  // G2b — the primary diagnosis leads the summary (the API already returns it
  // first). Everything else follows in the order it was recorded.
  const primary = list.find((d) => d.priority === 'PRIMARY');
  const rest = list.filter((d) => d.id !== primary?.id);
  const label = (d: (typeof list)[number]) => (d.icd10Code ? `${d.icd10Code} ${d.name}` : d.name);
  const summary = summarise([...(primary ? [label(primary)] : []), ...rest.map(label)]);

  return (
    <ClinicalSection
      title="Diagnosis"
      count={list.length}
      summary={summary}
      status={primary ? <Tag color="blue">Primary: {primary.name}</Tag> : undefined}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No diagnosis recorded for this visit"
      primaryAction={{ label: '+ Add Diagnosis', onClick: () => !expanded && onToggle() }}
      expanded={expanded}
      onToggle={onToggle}
    >
      <DiagnosisSectionBody visitId={visitId} />
    </ClinicalSection>
  );
}
