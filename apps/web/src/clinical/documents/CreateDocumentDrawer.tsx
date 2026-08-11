import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Drawer, Input, Segmented, Select, Space, Tag, Typography, message } from 'antd';
import { EditOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useCreateDocument } from '../hooks/useDocuments';
import { useLatestClinicalNote } from '../hooks/useClinicalNote';
import { useLatestVitals } from '../hooks/useVisitObservations';
import { useDiagnoses } from '../hooks/useDiagnoses';
import { useDocumentTemplates } from '../hooks/useDocumentTemplates';
import { useStaff } from '../../hr/hooks/useStaff';
import { useClinics } from '../../core/hooks/useClinics';
import { buildTemplate, doctorRoleLabel, formatDiagnosisList, formatVitals, htmlToPlainText } from '../documentTemplates';
import { resolveTemplate } from '../mergeFields';
import { ApiError } from '../../core/api-client';
import { DocumentType, Visit } from '../types';
import { BUILT_IN_TYPES } from './documentPresentation';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const CUSTOM_PREFIX = 'custom:';

interface CreateDocumentDrawerProps {
  visit: Visit;
  open: boolean;
  patientName?: string;
  patientIdentifier?: string;
  onClose: () => void;
  /**
   * G4.5d (D-075) — the type to land on when the drawer opens, so the
   * completion bar's "+ MC" arrives on the MC form instead of a chooser.
   *
   * A preselection, NOT a separate creation path: the drawer, its templates,
   * its validation and its authorisation rules are the same ones the
   * Documents Workspace uses, and the doctor can still change the type here.
   */
  initialType?: string;
}

/**
 * G3b (§4, §5) — the create flow, structured instead of a generic modal.
 *
 * The order matches how a GP actually works: pick what you are issuing, see
 * the context the record already holds, fill only what the type genuinely
 * needs, read the output, save. Everything the visit already knows is
 * auto-filled and shown as such — nothing is re-typed.
 *
 * The template engine itself is untouched: `buildTemplate` for the built-in
 * types and `resolveTemplate` for a clinic's configured templates, exactly
 * as before. No document-generation logic is duplicated here.
 */
export function CreateDocumentDrawer({
  visit,
  open,
  patientName,
  patientIdentifier,
  onClose,
  initialType,
}: CreateDocumentDrawerProps) {
  const [typeKey, setTypeKey] = useState<string>(initialType ?? 'MC');
  const [content, setContent] = useState('');
  const [contentTouched, setContentTouched] = useState(false);
  // S3c (D-082) — no attending clinician means no default issuer. The user
  // picks, rather than the form proposing whoever registered the patient.
  const [issuedByStaffId, setIssuedByStaffId] = useState<string | undefined>(visit.staffId ?? undefined);
  const [issuedDate, setIssuedDate] = useState<Dayjs>(dayjs());
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [diagnosisText, setDiagnosisText] = useState('');
  const [referredTo, setReferredTo] = useState('');

  const { data: clinicalNote } = useLatestClinicalNote(visit.id);
  const vitals = useLatestVitals(visit.id);
  const { data: diagnoses } = useDiagnoses(visit.id);
  const { data: staff } = useStaff();
  const { data: clinics } = useClinics();
  const { data: customTemplates } = useDocumentTemplates(true);
  const createDocument = useCreateDocument(visit.id);

  const clinic = clinics?.find((c) => c.id === visit.clinicId);
  const doctor = staff?.find((s) => s.id === issuedByStaffId);

  const isCustom = typeKey.startsWith(CUSTOM_PREFIX);
  const selectedTemplate = isCustom
    ? customTemplates?.find((template) => template.id === typeKey.slice(CUSTOM_PREFIX.length))
    : undefined;
  const type: DocumentType = isCustom ? 'CUSTOM' : (typeKey as DocumentType);

  const typeOptions = [
    ...BUILT_IN_TYPES.map((t) => ({ value: t.value as string, label: t.label })),
    ...(customTemplates ?? []).map((template) => ({
      value: `${CUSTOM_PREFIX}${template.id}`,
      label: template.name,
    })),
  ];

  const autoDiagnosis = formatDiagnosisList(diagnoses);
  const vitalsSummary = formatVitals(vitals);

  const generate = useMemo(
    () => () => {
      if (selectedTemplate) {
        return resolveTemplate(selectedTemplate.content, {
          clinic,
          patient: visit.patient,
          doctor,
          visit,
          clinicalNote,
          diagnoses,
          issuedDate,
          observation: vitals,
        });
      }
      return buildTemplate(type, {
        clinicName: clinic?.name,
        clinic,
        patientName: patientName ?? visit.patient?.name,
        patientIdentifier: patientIdentifier ?? visit.patient?.identifierValue,
        doctorName: doctor?.fullName,
        doctorRole: doctorRoleLabel(doctor),
        issuedDate,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
        diagnosisText: diagnosisText || autoDiagnosis,
        referredTo,
        presentingComplaint: visit.presentingComplaint ?? undefined,
        examinationNotes: htmlToPlainText(clinicalNote?.notes),
        vitalsSummary,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedTemplate,
      clinic,
      doctor,
      visit,
      clinicalNote,
      diagnoses,
      issuedDate,
      vitals,
      type,
      patientName,
      patientIdentifier,
      dateRange,
      diagnosisText,
      referredTo,
      autoDiagnosis,
      vitalsSummary,
    ],
  );

  // §5 — context refresh must never silently overwrite a deliberate edit. The
  // draft regenerates as the doctor changes type/dates/diagnosis, but the
  // moment they type in the body themselves it stops moving under them.
  useEffect(() => {
    if (!open || contentTouched) return;
    setContent(generate());
  }, [open, contentTouched, generate]);

  useEffect(() => {
    if (!open) return;
    // Reopening resets everything, including the type — so a quick action
    // always lands where it says it will, whatever the last use left behind.
    setTypeKey(initialType ?? 'MC');
    setContent('');
    setContentTouched(false);
    setIssuedByStaffId(visit.staffId ?? undefined);
    setIssuedDate(dayjs());
    setDateRange(null);
    setDiagnosisText('');
    setReferredTo('');
    // Only on open — a reset on every render would erase the doctor's work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsDateRange = type === 'MC' || type === 'QUARANTINE';
  const needsDiagnosis = type === 'MC' || type === 'QUARANTINE' || type === 'REFERRAL';
  const needsReferredTo = type === 'REFERRAL';
  const days =
    dateRange?.[0] && dateRange?.[1] ? dateRange[1].diff(dateRange[0], 'day') + 1 : null;

  const save = async () => {
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
      message.success('Document created');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create the document');
    }
  };

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {label}
        {hint && <span style={{ marginLeft: 6, color: '#bfbfbf' }}>{hint}</span>}
      </Text>
      {node}
    </div>
  );

  return (
    <Drawer
      title="Create document"
      open={open}
      onClose={onClose}
      width={760}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={createDocument.isPending} disabled={!content.trim()} onClick={save}>
            Save document
          </Button>
        </div>
      }
    >
      {/* 1 — what am I issuing */}
      {field(
        'Document type',
        typeOptions.length <= 5 ? (
          <Segmented
            block
            value={typeKey}
            onChange={(value) => {
              setTypeKey(String(value));
              setContentTouched(false);
            }}
            options={typeOptions.map((o) => ({ value: o.value, label: o.label }))}
          />
        ) : (
          <Select
            style={{ width: '100%' }}
            value={typeKey}
            onChange={(value) => {
              setTypeKey(value);
              setContentTouched(false);
            }}
            options={typeOptions}
            showSearch
            optionFilterProp="label"
          />
        ),
      )}

      {/* 2 — the context the record already holds */}
      <Alert
        type="info"
        style={{ marginBottom: 12 }}
        message="Filled in from this visit"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            <div>
              <Text strong>Patient:</Text> {patientName ?? visit.patient?.name ?? '—'}
              {(patientIdentifier ?? visit.patient?.identifierValue) &&
                ` · ${patientIdentifier ?? visit.patient?.identifierValue}`}
            </div>
            <div>
              <Text strong>Clinic:</Text> {clinic?.name ?? '—'}
            </div>
            <div>
              <Text strong>Diagnosis:</Text> {autoDiagnosis || 'None recorded'}
            </div>
            <div>
              <Text strong>Vitals:</Text> {vitalsSummary}
            </div>
            <div>
              <Text strong>Clinical note:</Text>{' '}
              {clinicalNote?.notes ? 'Available — included in referral letters' : 'None recorded'}
            </div>
          </div>
        }
      />

      {/* 3 — only what this type genuinely needs */}
      <Space wrap size={12} style={{ width: '100%', marginBottom: 4 }}>
        <div style={{ minWidth: 200, flex: '1 1 200px' }}>
          {field(
            'Issued by',
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="Select doctor"
              value={issuedByStaffId}
              onChange={setIssuedByStaffId}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
            />,
            '(auto-filled)',
          )}
        </div>
        <div style={{ minWidth: 160 }}>
          {field(
            'Issued date',
            <DatePicker style={{ width: '100%' }} value={issuedDate} onChange={(d) => d && setIssuedDate(d)} />,
            '(today)',
          )}
        </div>
      </Space>

      {needsDateRange &&
        field(
          type === 'MC' ? 'Rest period' : 'Quarantine period',
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <RangePicker style={{ width: '100%' }} value={dateRange} onChange={setDateRange} />
            {days !== null && <Tag color="blue">{days} day{days === 1 ? '' : 's'}</Tag>}
          </Space>,
        )}

      {needsDiagnosis &&
        field(
          'Diagnosis on the document',
          <Input
            placeholder={autoDiagnosis || 'Type the diagnosis for this document…'}
            value={diagnosisText}
            onChange={(e) => setDiagnosisText(e.target.value)}
          />,
          autoDiagnosis ? '(leave blank to use the recorded diagnosis)' : undefined,
        )}

      {needsReferredTo &&
        field(
          'Referred to',
          <Input
            placeholder="e.g. Hospital Kuala Lumpur, ENT Department"
            value={referredTo}
            onChange={(e) => setReferredTo(e.target.value)}
          />,
        )}

      {/* 4 — read the output before it becomes a record */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Document text
          {contentTouched ? (
            <Tag color="orange" style={{ marginLeft: 8 }} icon={<EditOutlined />}>
              Edited — no longer auto-updating
            </Tag>
          ) : (
            <Tag color="blue" style={{ marginLeft: 8 }}>
              Generated
            </Tag>
          )}
        </Text>
        <Button
          size="small"
          icon={<ThunderboltOutlined />}
          onClick={() => {
            setContent(generate());
            setContentTouched(false);
          }}
        >
          Regenerate
        </Button>
      </div>
      <Input.TextArea
        style={{ fontFamily: "'Courier New', monospace", fontSize: 13 }}
        rows={16}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setContentTouched(true);
        }}
        placeholder="The document text appears here — edit it freely before saving."
      />
    </Drawer>
  );
}
