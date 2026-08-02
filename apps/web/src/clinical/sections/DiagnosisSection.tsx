import { useDiagnoses } from '../hooks/useDiagnoses';
import { DiagnosisTab } from '../DiagnosisTab';
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

  // Real fields only: name and icd10Code. There is no primary/secondary
  // column in the Diagnosis model yet (G2 adds it), so the summary must not
  // imply one by ordering or labelling.
  const summary = summarise(list.map((d) => (d.icd10Code ? `${d.icd10Code} ${d.name}` : d.name)));

  return (
    <ClinicalSection
      title="Diagnosis"
      count={list.length}
      summary={summary}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No diagnosis recorded for this visit"
      primaryAction={{ label: '+ Add Diagnosis', onClick: () => !expanded && onToggle() }}
      expanded={expanded}
      onToggle={onToggle}
    >
      <DiagnosisTab visitId={visitId} />
    </ClinicalSection>
  );
}
