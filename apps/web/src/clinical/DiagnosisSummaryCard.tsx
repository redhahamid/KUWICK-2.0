import { useState } from 'react';
import { AutoComplete, Card, Empty, Space, Tag, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useAddDiagnosis, useDiagnoses, useDiagnosisCatalogSearch } from './hooks/useDiagnoses';

const { Text } = Typography;

interface DiagnosisSummaryCardProps {
  visitId: string;
}

// Canvas-mode fast path (user feedback: "search bar straight away, save
// time, less click") — search-and-add happens inline in the card, no
// modal detour. Covers the common case (search the Summarize catalog, pick
// one, done); catalog-source switching (Custom/Full) and free-text custom
// diagnoses stay on DiagnosisTab (Flow mode / the full record view).
export function DiagnosisSummaryCard({ visitId }: DiagnosisSummaryCardProps) {
  const [search, setSearch] = useState('');
  const { data: diagnoses } = useDiagnoses(visitId);
  const { data: catalogResults } = useDiagnosisCatalogSearch(search, 'SUMMARIZE');
  const addDiagnosis = useAddDiagnosis(visitId);

  const handleSelect = async (_value: string, option: { id: string }) => {
    await addDiagnosis.mutateAsync({ visitId, diagnosisCatalogId: option.id });
    setSearch('');
  };

  return (
    <Card
      size="small"
      title="Diagnosis"
      extra={
        <AutoComplete
          size="small"
          style={{ width: 130 }}
          placeholder="Search & add..."
          value={search}
          onChange={setSearch}
          onSelect={handleSelect}
          options={catalogResults?.map((entry) => ({ value: entry.name, id: entry.id }))}
        />
      }
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{
        header: { padding: '4px 12px', minHeight: 32 },
        body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 8 },
      }}
    >
      {!diagnoses || diagnoses.length === 0 ? (
        <Empty
          image={<SafetyCertificateOutlined style={{ fontSize: 24, opacity: 0.3 }} />}
          description="No diagnoses added"
        />
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {diagnoses.map((diagnosis) => (
            <div key={diagnosis.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12 }}>
                {diagnosis.name}
                {diagnosis.icd10Code && <Tag style={{ marginLeft: 4 }}>{diagnosis.icd10Code}</Tag>}
              </Text>
              {/* G2 closure (D-061) — the unaudited delete this card used no longer
                  exists. Kept for rollback only; removal happens through the
                  audited flow in the clinical section. */}
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}
