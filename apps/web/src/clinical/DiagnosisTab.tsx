import { useState } from 'react';
import { AutoComplete, Button, Empty, List, Segmented, Space, Tag, Typography, message } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAddDiagnosis, useDiagnoses, useDiagnosisCatalogSearch, useRemoveDiagnosis } from './hooks/useDiagnoses';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

// Display-density modes for the diagnosis list — a frontend-only reading of
// the audited "Custom/Summarize/Full" toggle (Clinical 2b plan, judgment
// call #5); no schema impact.
type ViewMode = 'Custom' | 'Summarize' | 'Full';

interface DiagnosisTabProps {
  visitId: string;
}

export function DiagnosisTab({ visitId }: DiagnosisTabProps) {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('Full');
  const { data: diagnoses, isLoading } = useDiagnoses(visitId);
  const { data: catalogResults } = useDiagnosisCatalogSearch(search);
  const addDiagnosis = useAddDiagnosis(visitId);
  const removeDiagnosis = useRemoveDiagnosis(visitId);

  const handleAdd = async (value: string) => {
    if (!value.trim()) return;
    const matched = catalogResults?.find((entry) => entry.name.toLowerCase() === value.trim().toLowerCase());
    try {
      await addDiagnosis.mutateAsync(
        matched ? { visitId, diagnosisCatalogId: matched.id } : { visitId, name: value.trim() },
      );
      setSearch('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add diagnosis');
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeDiagnosis.mutateAsync(id);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to remove diagnosis');
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%' }}>
        <AutoComplete
          style={{ width: 320 }}
          value={search}
          onChange={setSearch}
          onSelect={(value) => handleAdd(value)}
          options={catalogResults?.map((entry) => ({ value: entry.name, label: entry.code ? `${entry.code} — ${entry.name}` : entry.name }))}
          placeholder="Search or add a diagnosis..."
        />
        <Button type="primary" loading={addDiagnosis.isPending} onClick={() => handleAdd(search)}>
          Add
        </Button>
        <Segmented
          value={viewMode}
          onChange={(value) => setViewMode(value as ViewMode)}
          options={['Custom', 'Summarize', 'Full']}
        />
      </Space>

      {!isLoading && (!diagnoses || diagnoses.length === 0) ? (
        <Empty description="No diagnoses added" />
      ) : viewMode === 'Custom' ? (
        <Space wrap>
          {diagnoses?.map((diagnosis) => (
            <Tag key={diagnosis.id} closable onClose={() => handleRemove(diagnosis.id)}>
              {diagnosis.name}
            </Tag>
          ))}
        </Space>
      ) : (
        <List
          loading={isLoading}
          dataSource={diagnoses}
          renderItem={(diagnosis) => (
            <List.Item
              actions={[
                <Button
                  key="remove"
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => handleRemove(diagnosis.id)}
                />,
              ]}
            >
              <List.Item.Meta
                title={diagnosis.code ? `${diagnosis.code} — ${diagnosis.name}` : diagnosis.name}
                description={
                  viewMode === 'Full' ? (
                    <Text type="secondary">Added {dayjs(diagnosis.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                  ) : undefined
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
