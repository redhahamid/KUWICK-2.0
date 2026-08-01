import { useState } from 'react';
import { Button, Card, DatePicker, Empty, Input, List, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, FileTextOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useCreateDocument, useDeleteDocument, useDocuments, useSignDocument } from './hooks/useDocuments';
import { useLatestClinicalNote } from './hooks/useClinicalNote';
import { useLatestVitals } from './hooks/useVisitObservations';
import { useDiagnoses } from './hooks/useDiagnoses';
import { useDocumentTemplates } from './hooks/useDocumentTemplates';
import { useStaff } from '../hr/hooks/useStaff';
import { useClinics } from '../core/hooks/useClinics';
import { buildTemplate, doctorRoleLabel, formatDiagnosisList, formatVitals, htmlToPlainText } from './documentTemplates';
import { resolveTemplate } from './mergeFields';
import { printTextDocument } from './printTextDocument';
import { ClinicalDocument, DocumentType, Visit } from './types';
import { ApiError } from '../core/api-client';

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'MC', label: 'Medical Certificate' },
  { value: 'REFERRAL', label: 'Referral Letter' },
  { value: 'MEMO', label: 'Memo' },
  { value: 'QUARANTINE', label: 'Quarantine Letter' },
];

const TYPE_COLOR: Record<DocumentType, string> = {
  MC: 'red',
  REFERRAL: 'blue',
  MEMO: 'default',
  QUARANTINE: 'orange',
  CUSTOM: 'purple',
};

// D-040 — the Select mixes the four built-in types with the clinic's own
// active templates; custom entries are keyed "custom:<templateId>".
const CUSTOM_PREFIX = 'custom:';

function documentLabel(document: ClinicalDocument): string {
  if (document.type === 'CUSTOM') return document.title ?? 'Custom Document';
  return TYPE_OPTIONS.find((o) => o.value === document.type)?.label ?? document.type;
}

interface DocumentsTabProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
}

// Clinical Operations, Phase A4 (owner feedback round 2). MC/Quarantine
// capture a date range + diagnosis + issuing doctor + issued date;
// Referral pulls Clinical Notes/vitals/diagnosis into a proper letter.
// "Generate Template" composes starter text into Content — still fully
// editable before saving, no server-side PDF rendering this phase.
export function DocumentsTab({ visit, patientName, patientIdentifier }: DocumentsTabProps) {
  // Either a built-in DocumentType or "custom:<templateId>" (D-040).
  const [typeKey, setTypeKey] = useState<string>('MC');
  const [content, setContent] = useState('');
  const [issuedByStaffId, setIssuedByStaffId] = useState<string | undefined>(visit.staffId);
  const [issuedDate, setIssuedDate] = useState<Dayjs>(dayjs());
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [diagnosisText, setDiagnosisText] = useState('');
  const [referredTo, setReferredTo] = useState('');

  const { data: documents, isLoading } = useDocuments(visit.id);
  const { data: clinicalNote } = useLatestClinicalNote(visit.id);
  // C0 (D-051) — vitals come from the attributed observation record, falling
  // back to a legacy note's frozen columns for pre-split visits.
  const vitals = useLatestVitals(visit.id);
  const { data: diagnoses } = useDiagnoses(visit.id);
  const { data: staff } = useStaff();
  const { data: clinics } = useClinics();
  const { data: customTemplates } = useDocumentTemplates(true);
  const clinic = clinics?.find((c) => c.id === visit.clinicId);
  const doctor = staff?.find((s) => s.id === issuedByStaffId);

  const isCustom = typeKey.startsWith(CUSTOM_PREFIX);
  const selectedTemplate = isCustom
    ? customTemplates?.find((template) => template.id === typeKey.slice(CUSTOM_PREFIX.length))
    : undefined;
  const type: DocumentType = isCustom ? 'CUSTOM' : (typeKey as DocumentType);

  const typeSelectOptions = [
    ...TYPE_OPTIONS,
    ...(customTemplates ?? []).map((template) => ({
      value: `${CUSTOM_PREFIX}${template.id}`,
      label: template.name,
    })),
  ];

  const createDocument = useCreateDocument(visit.id);
  const deleteDocument = useDeleteDocument(visit.id);
  const signDocument = useSignDocument(visit.id);

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleGenerate = () => {
    if (selectedTemplate) {
      setContent(
        resolveTemplate(selectedTemplate.content, {
          clinic,
          patient: visit.patient,
          doctor,
          visit,
          clinicalNote,
          diagnoses,
          issuedDate,
        }),
      );
      return;
    }
    const generated = buildTemplate(type, {
      clinicName: clinic?.name,
      clinic,
      patientName: patientName ?? visit.patient?.name,
      patientIdentifier: patientIdentifier ?? visit.patient?.identifierValue,
      doctorName: doctor?.fullName,
      doctorRole: doctorRoleLabel(doctor),
      issuedDate,
      startDate: dateRange?.[0],
      endDate: dateRange?.[1],
      diagnosisText: diagnosisText || formatDiagnosisList(diagnoses),
      referredTo,
      presentingComplaint: visit.presentingComplaint ?? undefined,
      examinationNotes: htmlToPlainText(clinicalNote?.notes),
      vitalsSummary: formatVitals(vitals),
    });
    setContent(generated);
  };

  const handleAdd = async () => {
    if (!content.trim()) return;
    try {
      await createDocument.mutateAsync({
        visitId: visit.id,
        type,
        title: selectedTemplate?.name,
        content: content.trim(),
        issuedByStaffId,
        issuedDate: issuedDate.format('YYYY-MM-DD'),
        startDate: dateRange?.[0]?.format('YYYY-MM-DD'),
        endDate: dateRange?.[1]?.format('YYYY-MM-DD'),
        diagnosisText: diagnosisText || undefined,
        referredTo: referredTo || undefined,
      });
      setContent('');
      setDateRange(null);
      setDiagnosisText('');
      setReferredTo('');
    } catch (error) {
      reportFailure(error, 'Failed to add document');
    }
  };

  const needsDateRange = type === 'MC' || type === 'QUARANTINE';
  const needsDiagnosis = type === 'MC' || type === 'QUARANTINE' || type === 'REFERRAL';
  const needsReferredTo = type === 'REFERRAL';

  return (
    <div>
      <Card
        size="small"
        title={
          <Space>
            <FileTextOutlined /> New Document
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap size={12} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">Type</Text>
              <Select
                style={{ width: 220, display: 'block' }}
                value={typeKey}
                onChange={setTypeKey}
                options={typeSelectOptions}
                showSearch
                optionFilterProp="label"
              />
            </div>
            <div>
              <Text type="secondary">Doctor</Text>
              <Select
                showSearch
                style={{ width: 220, display: 'block' }}
                placeholder="Select doctor"
                value={issuedByStaffId}
                onChange={setIssuedByStaffId}
                filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
                options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
              />
            </div>
            <div>
              <Text type="secondary">Issued Date</Text>
              <DatePicker style={{ display: 'block' }} value={issuedDate} onChange={(d) => d && setIssuedDate(d)} />
            </div>
          </Space>

          {needsDateRange && (
            <div>
              <Text type="secondary">{type === 'MC' ? 'Rest Period' : 'Quarantine Period'}</Text>
              <RangePicker style={{ width: '100%', display: 'block' }} value={dateRange} onChange={setDateRange} />
            </div>
          )}

          {needsDiagnosis && (
            <div>
              <Text type="secondary">Diagnosis</Text>
              <Input
                placeholder={
                  diagnoses && diagnoses.length > 0
                    ? formatDiagnosisList(diagnoses)
                    : 'Type the diagnosis for this document...'
                }
                value={diagnosisText}
                onChange={(e) => setDiagnosisText(e.target.value)}
              />
            </div>
          )}

          {needsReferredTo && (
            <div>
              <Text type="secondary">Referred To</Text>
              <Input
                placeholder="e.g. Hospital Kuala Lumpur, ENT Department"
                value={referredTo}
                onChange={(e) => setReferredTo(e.target.value)}
              />
            </div>
          )}

          <div>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text type="secondary">Content</Text>
              <Button size="small" icon={<ThunderboltOutlined />} onClick={handleGenerate}>
                Generate Template
              </Button>
            </Space>
            <Input.TextArea
              style={{ marginTop: 4, fontFamily: 'monospace' }}
              rows={10}
              placeholder="Type the document content, or click Generate Template to start from a ready-made wording..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          <div style={{ textAlign: 'right' }}>
            <Button type="primary" loading={createDocument.isPending} disabled={!content.trim()} onClick={handleAdd}>
              + Add Document
            </Button>
          </div>
        </Space>
      </Card>

      <Card size="small" title="Documents">
        {!isLoading && (!documents || documents.length === 0) ? (
          <Empty image={<FileTextOutlined style={{ fontSize: 40, opacity: 0.3 }} />} description="No documents yet" />
        ) : (
          <List
            loading={isLoading}
            dataSource={documents}
            renderItem={(document: ClinicalDocument) => (
              <List.Item
                actions={[
                  <Button
                    key="print"
                    type="text"
                    size="small"
                    icon={<PrinterOutlined />}
                    onClick={() => printTextDocument(documentLabel(document), document.content)}
                  >
                    Print
                  </Button>,
                  document.signedAt ? null : (
                    <Button
                      key="sign"
                      type="text"
                      size="small"
                      icon={<CheckCircleOutlined />}
                      loading={signDocument.isPending}
                      onClick={() =>
                        signDocument
                          .mutateAsync({ id: document.id, staffId: visit.staffId })
                          .catch((e) => reportFailure(e, 'Failed to sign'))
                      }
                    >
                      Sign
                    </Button>
                  ),
                  <Popconfirm
                    key="delete"
                    title="Remove this document?"
                    onConfirm={() =>
                      deleteDocument.mutateAsync(document.id).catch((e) => reportFailure(e, 'Failed to remove'))
                    }
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space wrap>
                      <Tag color={TYPE_COLOR[document.type]}>{documentLabel(document)}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Issued {dayjs(document.issuedDate).format('YYYY-MM-DD')}
                      </Text>
                      {document.startDate && document.endDate && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          ({dayjs(document.startDate).format('YYYY-MM-DD')} to {dayjs(document.endDate).format('YYYY-MM-DD')})
                        </Text>
                      )}
                      {document.signedAt ? (
                        <Tag color="green" icon={<CheckCircleOutlined />}>
                          Signed {dayjs(document.signedAt).format('YYYY-MM-DD HH:mm')}
                        </Tag>
                      ) : (
                        <Tag>Unsigned</Tag>
                      )}
                    </Space>
                  }
                  description={<Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{document.content}</Paragraph>}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
