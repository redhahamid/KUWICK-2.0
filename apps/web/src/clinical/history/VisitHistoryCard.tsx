import { Button, Card, Space, Tag, Typography } from 'antd';
import { DownOutlined, ExportOutlined, UpOutlined } from '@ant-design/icons';
import { VisitHistorySummary } from '../types';
import {
  additionalDiagnosisCount,
  additionalMedicationCount,
  contextChips,
  diagnosisLabel,
  hasNoClinicalSummary,
  mcLabel,
  medicationLabels,
  referralLabel,
  visitDateLabel,
  visitTimeLabel,
} from './historyPresentation';
import { ReadOnlyVisitDetail } from './ReadOnlyVisitDetail';
import { useVisitHistoryDetail } from './useVisitHistory';

const { Text } = Typography;

interface VisitHistoryCardProps {
  patientId: string;
  summary: VisitHistorySummary;
  expanded: boolean;
  onToggle: (visitId: string) => void;
  compact?: boolean;
}

/**
 * G4 (D-067) — one previous visit, collapsed.
 *
 * The card is readable in a couple of seconds: when it happened, who saw the
 * patient, what was diagnosed, what was prescribed, and whether an MC or
 * referral left the building. Everything else waits for Expand.
 *
 * Expanding fetches THIS visit only (see `useVisitHistoryDetail`) and changes
 * nothing about the consultation in progress — no current visit id, no draft,
 * no prompt. Several cards may be open at once on purpose: comparing two
 * antibiotic courses or a repeated MC is exactly what a doctor opens history
 * for, so this is not an accordion.
 */
export function VisitHistoryCard({ patientId, summary, expanded, onToggle, compact }: VisitHistoryCardProps) {
  const detail = useVisitHistoryDetail(patientId, summary.id, expanded);
  const diagnosis = diagnosisLabel(summary);
  const moreDiagnoses = additionalDiagnosisCount(summary);
  const medications = medicationLabels(summary);
  const moreMedications = additionalMedicationCount(summary);
  const mc = mcLabel(summary);
  const referral = referralLabel(summary);

  return (
    <Card
      size="small"
      className="kw-history-card"
      data-visit={summary.visitNumber}
      data-expanded={expanded ? 'yes' : 'no'}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap size={8} style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space direction="vertical" size={0}>
            <Text strong>
              {visitDateLabel(summary.checkInAt)} · {visitTimeLabel(summary.checkInAt)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {summary.visitNumber}
              {summary.doctorName ? ` · ${summary.doctorName}` : ' · Doctor not recorded'}
            </Text>
          </Space>
          <Space size={4} wrap>
            <Button
              size="small"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => onToggle(summary.id)}
              style={{ minHeight: 44, paddingInline: 12 }}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
            {/* A new tab, always: the consultation tab — and its unsaved
                note — must survive being sent to an older visit. */}
            <Button
              size="small"
              icon={<ExportOutlined />}
              href={`/history/patients/${patientId}/visits/${summary.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ minHeight: 44, paddingInline: 12 }}
            >
              Open Full Visit
            </Button>
          </Space>
        </Space>

        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {diagnosis && (
            <Text>
              <Text type="secondary" style={{ fontSize: 12 }}>Diagnosis: </Text>
              {diagnosis}
              {moreDiagnoses > 0 && <Text type="secondary"> +{moreDiagnoses} more</Text>}
            </Text>
          )}
          {medications.length > 0 && (
            <Text>
              <Text type="secondary" style={{ fontSize: 12 }}>Medications: </Text>
              {medications.join(', ')}
              {moreMedications > 0 && <Text type="secondary"> +{moreMedications} more</Text>}
            </Text>
          )}
          {(mc || referral) && (
            <Space wrap size={6}>
              {/* Words, not colour alone — a red dot means nothing to a
                  colourblind reader or on a printed handover. */}
              {mc && <Tag color="orange">{mc}</Tag>}
              {referral && <Tag color="purple">{referral}</Tag>}
            </Space>
          )}
          {summary.voidedDocumentCount > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {summary.voidedDocumentCount} voided document{summary.voidedDocumentCount === 1 ? '' : 's'}
            </Text>
          )}
          {hasNoClinicalSummary(summary) && (
            <Text type="secondary" italic>
              No diagnosis, medication or document was recorded on this visit.
            </Text>
          )}
        </Space>

        <Space wrap size={4}>
          {contextChips(summary).map((chip) => (
            <Tag key={chip.label} style={{ fontSize: 11 }}>
              {chip.label}: {chip.value}
            </Tag>
          ))}
        </Space>

        {expanded && (
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
            <ReadOnlyVisitDetail
              detail={detail.data}
              isLoading={detail.isLoading}
              error={detail.error}
              compact={compact}
            />
          </div>
        )}
      </Space>
    </Card>
  );
}
