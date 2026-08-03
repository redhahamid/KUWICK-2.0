import { useState } from 'react';
import { AutoComplete, Button, Space, Tag, Typography, message } from 'antd';
import {
  useAddDiagnosis,
  useDiagnoses,
  useDiagnosisCatalogSearch,
} from '../hooks/useDiagnoses';
import { useSetDiagnosisPriority } from '../hooks/useDiagnoses';
import { Diagnosis } from '../types';
import { ApiError } from '../../core/api-client';
import { RemoveDiagnosisModal } from './RemoveDiagnosisModal';
import { RailPanel } from './RailPanel';
import { AttributionInfo } from './AttributionInfo';

const { Text } = Typography;

interface DiagnosisRailProps {
  visitId: string;
}

/**
 * G4.5b (D-071) — Diagnosis, always open in the rail.
 *
 * Every mutation still goes through the same hooks the section body used —
 * `useAddDiagnosis`, `useSetDiagnosisPriority` and `RemoveDiagnosisModal` —
 * so the server-derived attribution, the one-active-PRIMARY invariant, the
 * mandatory removal reason and the audited removal history are untouched.
 * What changed is that the list, the ICD-10 code, the priority and the search
 * box are on screen without a click.
 *
 * "Priority not recorded" is shown as itself. G2a made that a real state —
 * a diagnosis entered before priorities existed has no priority, and calling
 * it Secondary would be inventing a clinical judgement nobody made.
 */
export function DiagnosisRail({ visitId }: DiagnosisRailProps) {
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<Diagnosis | null>(null);
  const { data: diagnoses, isLoading, error } = useDiagnoses(visitId);
  const { data: catalogResults } = useDiagnosisCatalogSearch(search, 'SUMMARIZE');
  const addDiagnosis = useAddDiagnosis(visitId);
  const setPriority = useSetDiagnosisPriority(visitId);

  const list = diagnoses ?? [];
  const primary = list.find((d) => d.priority === 'PRIMARY');
  // Primary first — it is what the MC, the referral and the claim quote.
  const ordered = primary ? [primary, ...list.filter((d) => d.id !== primary.id)] : list;

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  const add = async (value: string, option?: { entryId?: string }) => {
    const typed = value.trim();
    if (!typed) return;
    const matched =
      option?.entryId ?? catalogResults?.find((e) => e.name.toLowerCase() === typed.toLowerCase())?.id;
    try {
      await addDiagnosis.mutateAsync(matched ? { visitId, diagnosisCatalogId: matched } : { visitId, name: typed });
      setSearch('');
    } catch (err) {
      report(err, 'Failed to add diagnosis');
    }
  };

  const togglePrimary = async (diagnosis: Diagnosis) => {
    try {
      await setPriority.mutateAsync({
        id: diagnosis.id,
        priority: diagnosis.priority === 'PRIMARY' ? null : 'PRIMARY',
      });
    } catch (err) {
      // A 409 here means a colleague set a primary at the same moment.
      report(err, 'Failed to change the diagnosis priority');
    }
  };

  const priorityTag = (diagnosis: Diagnosis) => {
    if (diagnosis.priority === 'PRIMARY')
      return (
        <Tag color="red">
          Primary
        </Tag>
      );
    if (diagnosis.priority === 'SECONDARY') return <Tag>Secondary</Tag>;
    // G2a made "no priority" a real state. Saying it in the tag itself, rather
    // than only in a tooltip, keeps it readable without a pointer.
    return <Tag>Priority not recorded</Tag>;
  };

  return (
    <>
      <RailPanel
        title="Diagnosis"
        anchorId="kw-anchor-diagnosis"
        count={list.length}
        status={primary ? <Tag color="blue">1° {primary.name}</Tag> : undefined}
        isLoading={isLoading}
        error={error ?? undefined}
        emptyText="No diagnosis recorded for this visit"
        previewLimit={4}
        addControl={
          <Space.Compact style={{ width: '100%' }}>
            <AutoComplete
              style={{ width: '100%' }}
              value={search}
              onChange={setSearch}
              onSelect={(value: string, option) => add(value, { entryId: (option as { entryId: string }).entryId })}
              options={catalogResults?.map((entry) => ({
                value: entry.name,
                entryId: entry.id,
                label: entry.icd10Code ? `${entry.icd10Code} — ${entry.name}` : entry.name,
              }))}
              placeholder="Search diagnosis or ICD-10…"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && search.trim()) void add(search);
              }}
            />
            <Button type="primary" loading={addDiagnosis.isPending} onClick={() => add(search)}>
              Add
            </Button>
          </Space.Compact>
        }
        items={ordered.map((diagnosis) => (
          <div key={diagnosis.id} className="kw-rail-row">
            <div className="kw-rail-row-main">
              <Space size={4} wrap>
                <Text strong style={{ fontSize: 14 }}>
                  {diagnosis.name}
                </Text>
                {/* Attribution is a focusable control, not a second line and
                    not a hover-only tooltip. It is server-derived and legally
                    meaningful so it must be reachable by every input method,
                    but a permanent line of it on each row is the height that
                    pushed Orders and Services off the first screen (D-072). */}
                <AttributionInfo
                  subject={`Diagnosis: ${diagnosis.name}`}
                  name={diagnosis.addedByNameSnapshot}
                  role={diagnosis.addedByRoleSnapshot}
                  at={diagnosis.addedAt}
                />
                {diagnosis.icd10Code && (
                  <Tag color="geekblue">
                    {diagnosis.icd10Code}
                  </Tag>
                )}
                {priorityTag(diagnosis)}
              </Space>
            </div>
            <Space size={4} className="kw-rail-row-actions">
              <Button size="small" loading={setPriority.isPending} onClick={() => togglePrimary(diagnosis)}>
                {diagnosis.priority === 'PRIMARY' ? 'Unset 1°' : 'Set Primary'}
              </Button>
              <Button size="small" danger onClick={() => setRemoving(diagnosis)}>
                Remove
              </Button>
            </Space>
          </div>
        ))}
      />
      {/* Unchanged: reason mandatory, removal audited, history retained. */}
      <RemoveDiagnosisModal visitId={visitId} diagnosis={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
