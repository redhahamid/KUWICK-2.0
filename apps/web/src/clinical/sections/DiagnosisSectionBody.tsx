import { useState } from 'react';
import { Button, Radio, Space, Tag, Tooltip, Typography, message } from 'antd';
import { HistoryOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useAddDiagnosis,
  useDiagnoses,
  useDiagnosisHistory,
  useSetDiagnosisPriority,
} from '../hooks/useDiagnoses';
import { Diagnosis, DiagnosisCategory } from '../types';
import { DiagnosisSearchField } from './DiagnosisSearchField';
import { RemoveDiagnosisModal } from './RemoveDiagnosisModal';
import { ApiError } from '../../core/api-client';

const { Text } = Typography;

// G2b — how a diagnosis's recorded priority reads. "Priority not recorded" is
// a real state (every pre-G2a row), never dressed up as Secondary.
function priorityTag(diagnosis: Diagnosis) {
  if (diagnosis.priority === 'PRIMARY') {
    return (
      <Tag color="blue" icon={<StarFilled />}>
        Primary
      </Tag>
    );
  }
  if (diagnosis.priority === 'SECONDARY') {
    return <Tag>Secondary</Tag>;
  }
  return (
    <Tag style={{ borderStyle: 'dashed' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Priority not recorded
      </Text>
    </Tag>
  );
}

// Attribution, in the same voice C0 uses for legacy clinical notes.
function attribution(diagnosis: Diagnosis): string {
  const when = dayjs(diagnosis.addedAt).format('D MMM YYYY, HH:mm');
  if (diagnosis.legacyAttributionUnknown || !diagnosis.addedByNameSnapshot) {
    return `Added by not recorded — legacy entry · ${when}`;
  }
  const role = diagnosis.addedByRoleSnapshot?.replace(/_/g, ' ').toLowerCase();
  return `Added by ${diagnosis.addedByNameSnapshot}${role ? ` (${role})` : ''} · ${when}`;
}

interface DiagnosisSectionBodyProps {
  visitId: string;
}

// G2b (D-060) — the expanded Diagnosis workspace.
//
// Replaces DiagnosisTab inside the clinical section. Search-and-add stays a
// single keyboard flow: type, Enter to pick, done — no modal. Everything the
// owner asked to see is shown per row (name, ICD-10, priority, who added it,
// when), and the only actions offered are ones the backend actually supports:
// set/clear priority and remove. There is no edit, because the API has no
// update for a diagnosis's name or code.
export function DiagnosisSectionBody({ visitId }: DiagnosisSectionBodyProps) {
  const [category, setCategory] = useState<DiagnosisCategory>('SUMMARIZE');
  const { data: diagnoses, isLoading } = useDiagnoses(visitId);
  const addDiagnosis = useAddDiagnosis(visitId);
  const setPriority = useSetDiagnosisPriority(visitId);
  const [removing, setRemoving] = useState<Diagnosis | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { data: history } = useDiagnosisHistory(visitId, showHistory);

  const list = diagnoses ?? [];
  const hasPrimary = list.some((d) => d.priority === 'PRIMARY');

  const report = (error: unknown, fallback: string) =>
    message.error(error instanceof ApiError ? error.message : fallback);

  const add = async (value: string, entryId?: string) => {
    try {
      await addDiagnosis.mutateAsync(
        entryId ? { visitId, diagnosisCatalogId: entryId } : { visitId, name: value },
      );
    } catch (error) {
      report(error, 'Failed to add diagnosis');
    }
  };

  const togglePrimary = async (diagnosis: Diagnosis) => {
    const next = diagnosis.priority === 'PRIMARY' ? null : 'PRIMARY';
    try {
      await setPriority.mutateAsync({ id: diagnosis.id, priority: next });
    } catch (error) {
      // A 409 here means a colleague set a primary at the same moment.
      report(error, 'Failed to change the diagnosis priority');
    }
  };

  return (
    <div>
      {/* width + maxWidth, never minWidth: a min wider than a 281px section at
          375px forces the whole page to scroll sideways (caught by the G2b
          check, which flags any horizontal scroller). */}
      <Space wrap style={{ width: '100%', marginBottom: 12 }} size={8}>
        <DiagnosisSearchField
          category={category}
          onAdd={add}
          adding={addDiagnosis.isPending}
          width="100%"
        />
        <Radio.Group
          size="small"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { label: 'Clinic list', value: 'CUSTOM' },
            { label: 'Common', value: 'SUMMARIZE' },
            { label: 'Full ICD-10', value: 'FULL' },
          ]}
          optionType="button"
        />
      </Space>

      {list.length === 0 && !isLoading ? (
        <Text type="secondary" italic>
          No diagnosis recorded for this visit.
        </Text>
      ) : (
        <div className="kw-dx-list">
          {list.map((diagnosis) => (
            <div key={diagnosis.id} className="kw-dx-row">
              <div className="kw-dx-main">
                <Space wrap size={6}>
                  {diagnosis.icd10Code && <Tag color="geekblue">{diagnosis.icd10Code}</Tag>}
                  <Text strong>{diagnosis.name}</Text>
                  {priorityTag(diagnosis)}
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {attribution(diagnosis)}
                  </Text>
                </div>
              </div>

              <Space size={4} className="kw-dx-actions">
                <Tooltip
                  title={
                    diagnosis.priority === 'PRIMARY'
                      ? 'Clear the primary marking for this visit'
                      : hasPrimary
                        ? 'Make this the primary diagnosis — the current primary becomes secondary'
                        : 'Make this the primary diagnosis'
                  }
                >
                  <Button
                    size="small"
                    icon={diagnosis.priority === 'PRIMARY' ? <StarFilled /> : <StarOutlined />}
                    loading={setPriority.isPending}
                    onClick={() => togglePrimary(diagnosis)}
                  >
                    {diagnosis.priority === 'PRIMARY' ? 'Primary' : 'Set primary'}
                  </Button>
                </Tooltip>
                {/* G2 closure (D-061) — a named action, not a bare trash
                    icon. It opens a confirmation showing what is being
                    removed and demanding a reason. */}
                <Button size="small" danger onClick={() => setRemoving(diagnosis)}>
                  Remove from visit
                </Button>
              </Space>
            </div>
          ))}
        </div>
      )}

      {/* G2 closure (D-061) — the audit view. Removed diagnoses never appear
          in the clinical list above or in its count; they are here, labelled
          for what they are, with the actor, time and reason. */}
      <div style={{ marginTop: 12 }}>
        <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Hide removed diagnoses' : 'Show removed diagnoses'}
        </Button>
      </div>

      {showHistory && (
        <div className="kw-dx-list" style={{ marginTop: 4 }}>
          {(history ?? []).filter((d) => d.recordStatus === 'REMOVED_IN_ERROR').length === 0 ? (
            <Text type="secondary" italic style={{ fontSize: 12 }}>
              No diagnosis has been removed from this visit.
            </Text>
          ) : (
            (history ?? [])
              .filter((d) => d.recordStatus === 'REMOVED_IN_ERROR')
              .map((d) => (
                <div key={d.id} className="kw-dx-row">
                  <div className="kw-dx-main">
                    <Space wrap size={6}>
                      {d.icd10Code && <Tag color="geekblue">{d.icd10Code}</Tag>}
                      <Text delete>{d.name}</Text>
                      <Tag color="red">Removed from visit — entered in error</Tag>
                    </Space>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {attribution(d)}
                      </Text>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Removed by {d.removedByNameSnapshot ?? 'not recorded'} ·{' '}
                        {d.removedAt ? dayjs(d.removedAt).format('D MMM YYYY, HH:mm') : '—'} · Reason:{' '}
                        {d.removalReason ?? '—'}
                      </Text>
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      <RemoveDiagnosisModal visitId={visitId} diagnosis={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
