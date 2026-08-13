import { useState } from 'react';
import { Button, Dropdown, Space, Tag, Typography, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import {
  useAddDiagnosis,
  useDiagnoses,
} from '../hooks/useDiagnoses';
import { useSetDiagnosisPriority } from '../hooks/useDiagnoses';
import { Diagnosis } from '../types';
import { ApiError } from '../../core/api-client';
import { RemoveDiagnosisModal } from './RemoveDiagnosisModal';
import { DiagnosisSearchField } from './DiagnosisSearchField';
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
  const [removing, setRemoving] = useState<Diagnosis | null>(null);
  const { data: diagnoses, isLoading, error } = useDiagnoses(visitId);
  const addDiagnosis = useAddDiagnosis(visitId);
  const setPriority = useSetDiagnosisPriority(visitId);

  const list = diagnoses ?? [];
  const primary = list.find((d) => d.priority === 'PRIMARY');
  // Primary first — it is what the MC, the referral and the claim quote.
  const ordered = primary ? [primary, ...list.filter((d) => d.id !== primary.id)] : list;

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  const add = async (value: string, entryId?: string) => {
    try {
      await addDiagnosis.mutateAsync(
        entryId ? { visitId, diagnosisCatalogId: entryId } : { visitId, name: value },
      );
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
    if (diagnosis.priority === 'PRIMARY') return <Tag className="kw-chip-clinical">Primary</Tag>;
    if (diagnosis.priority === 'SECONDARY') return <Tag className="kw-chip-neutral">Secondary</Tag>;
    // G2a made "no priority" a real state. Saying it in the tag itself, rather
    // than only in a tooltip, keeps it readable without a pointer.
    return <Tag className="kw-chip-neutral">Priority not recorded</Tag>;
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
          <DiagnosisSearchField
            /* No category filter, deliberately. The rail hardcoded
               "SUMMARIZE" and had no way to change it, so a catalogue seeded
               under any other tag was invisible here — the doctor's box
               matched nothing at all, for every term, with no way to tell
               why. A doctor searching diagnoses wants the clinic's whole
               active list; narrowing it is the Flow tab's optional filter,
               never a hidden default. */
            onAdd={add}
            adding={addDiagnosis.isPending}
            placeholder="Search diagnosis or ICD-10…"
            compact
          />
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
            {/* D-077 — one primary action, everything else in More. A red
                "Remove" on every row made destruction the most eye-catching
                thing in the panel. The removal itself is unchanged: same
                modal, same mandatory reason, same audit trail. */}
            <Space size={4} className="kw-rail-row-actions">
              <Button size="small" loading={setPriority.isPending} onClick={() => togglePrimary(diagnosis)}>
                {diagnosis.priority === 'PRIMARY' ? 'Unset 1°' : 'Set Primary'}
              </Button>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'remove',
                      danger: true,
                      label: 'Remove from visit…',
                      onClick: () => setRemoving(diagnosis),
                    },
                  ],
                }}
              >
                <Button size="small" icon={<MoreOutlined />} aria-label={`More actions for ${diagnosis.name}`} />
              </Dropdown>
            </Space>
          </div>
        ))}
      />
      {/* Unchanged: reason mandatory, removal audited, history retained. */}
      <RemoveDiagnosisModal visitId={visitId} diagnosis={removing} onClose={() => setRemoving(null)} />
    </>
  );
}
