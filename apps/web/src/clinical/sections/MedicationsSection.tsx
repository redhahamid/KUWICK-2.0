import { Tag } from 'antd';
import { usePrescriptions } from '../hooks/usePrescriptions';
import { MedicationsTab } from '../MedicationsTab';
import { ClinicalSection, summarise } from './ClinicalSection';

interface MedicationsSectionProps {
  visitId: string;
  expanded: boolean;
  onToggle: () => void;
}

// G1 (D-058) — Medications in the shared shell, with the full prescribing
// workflow (dosage calculator, weight and age brackets, copy-previous,
// dispense, cancel, drug labels) rendered inline instead of inside a 900px
// modal. Nothing about the calculation, the calcMethod audit trail or the
// stock rules changed — MedicationsTab is reused as-is. G2 redesigns its
// internals.
export function MedicationsSection({ visitId, expanded, onToggle }: MedicationsSectionProps) {
  const { data: prescriptions, isLoading, error } = usePrescriptions(visitId);
  const list = prescriptions ?? [];

  // Strength lives on Item and route is not modelled at all, so the summary
  // shows what actually exists: the medicine name.
  const summary = summarise(list.map((p) => p.item?.name ?? 'Unknown medicine'));
  const awaitingDispense = list.filter((p) => p.status === 'ORDERED').length;

  return (
    <ClinicalSection
      title="Medications"
      count={list.length}
      summary={summary}
      status={awaitingDispense > 0 ? <Tag color="gold">{awaitingDispense} to dispense</Tag> : undefined}
      isLoading={isLoading}
      error={error ?? undefined}
      isEmpty={!isLoading && list.length === 0}
      emptyText="No medications prescribed for this visit"
      primaryAction={{ label: '+ Add Medication', onClick: () => !expanded && onToggle() }}
      expanded={expanded}
      onToggle={onToggle}
    >
      <MedicationsTab visitId={visitId} />
    </ClinicalSection>
  );
}
