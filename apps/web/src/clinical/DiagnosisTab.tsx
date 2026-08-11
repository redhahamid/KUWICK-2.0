import { useState } from 'react';
import { Button, Empty, List, Radio, Space, Typography, message } from 'antd';
import { CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAddDiagnosis, useDiagnoses } from './hooks/useDiagnoses';
import { DiagnosisSearchField } from './sections/DiagnosisSearchField';
import { RemoveDiagnosisModal } from './sections/RemoveDiagnosisModal';
import { Diagnosis, DiagnosisCategory } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

// D-027 (docs/DECISIONS.md): Custom/Summarize/Full are catalog *source*
// categories — Custom (clinic-created, via the Diagnoses Directory admin
// screen), Summarize (curated global subset), Full (complete ICD-10
// catalog) — not display-density modes for the already-added list below.
// This filters which category the search box searches against.
interface DiagnosisTabProps {
  visitId: string;
}

export function DiagnosisTab({ visitId }: DiagnosisTabProps) {
  const [category, setCategory] = useState<DiagnosisCategory>('SUMMARIZE');
  const { data: diagnoses, isLoading } = useDiagnoses(visitId);
  const addDiagnosis = useAddDiagnosis(visitId);
  const [removing, setRemoving] = useState<Diagnosis | null>(null);

  const handleAdd = async (value: string, entryId?: string) => {
    try {
      await addDiagnosis.mutateAsync(
        entryId ? { visitId, diagnosisCatalogId: entryId } : { visitId, name: value },
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add diagnosis');
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <Text strong>Search &amp; Add Diagnosis from Catalog</Text>
        <Radio.Group
          size="small"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { label: 'Custom', value: 'CUSTOM' },
            { label: 'Summarize', value: 'SUMMARIZE' },
            { label: 'Full', value: 'FULL' },
          ]}
          optionType="button"
          buttonStyle="solid"
        />
      </Space>

      <div style={{ marginBottom: 16 }}>
        <DiagnosisSearchField
          category={category}
          onAdd={handleAdd}
          adding={addDiagnosis.isPending}
          width={360}
        />
      </div>

      {!isLoading && (!diagnoses || diagnoses.length === 0) ? (
        <Empty
          image={<SafetyCertificateOutlined style={{ fontSize: 40, opacity: 0.3 }} />}
          description={
            <>
              <div>No diagnoses added.</div>
              <Text type="secondary">Search and select diagnoses from the catalog above.</Text>
            </>
          }
        />
      ) : (
        <List
          loading={isLoading}
          dataSource={diagnoses}
          renderItem={(diagnosis) => (
            <List.Item
              actions={[
                <Button key="remove" size="small" danger onClick={() => setRemoving(diagnosis)}>
                  Remove from visit
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={diagnosis.icd10Code ? `${diagnosis.icd10Code} — ${diagnosis.name}` : diagnosis.name}
              />
            </List.Item>
          )}
        />
      )}
      <RemoveDiagnosisModal visitId={visitId} diagnosis={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
