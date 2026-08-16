import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Drawer, Input, InputNumber, Radio, Segmented, Select, Space, Tag, Typography, message } from 'antd';
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
  // b3 PHASE F — a time slip covers ONE date and a duration. A range here
  // would be an MC wearing the wrong name.
  const [hours, setHours] = useState<number | null>(null);
  const [slipDate, setSlipDate] = useState<Dayjs>(dayjs());
  const [procedure, setProcedure] = useState('');
  /**
   * An MC for a single day, or for a range.
   *
   * "One day" is far and away the commonest MC a GP writes, and the range
   * picker made it a two-click job of selecting the same date twice — which
   * also made "today to today" easy to get wrong by a day. Stored identically
   * either way: a single date is start === end, so nothing downstream has to
   * know which control issued it.
   */
  const [mcSpan, setMcSpan] = useState<'single' | 'range'>('single');
  const [mcDate, setMcDate] = useState<Dayjs>(dayjs());

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

  const needsDiagnosis = type === 'MC' || type === 'QUARANTINE' || type === 'REFERRAL';
  const needsReferredTo = type === 'REFERRAL';
  const isTimeSlip = type === 'TIME_SLIP';
  const isConsent = type === 'CONSENT';
  const singleDayMc = type === 'MC' && mcSpan === 'single';

  /**
   * The dates this document actually carries, whichever control produced them.
   *
   * One place, so the preview, the validation and the save can never disagree
   * about what is being issued — the failure that would otherwise show up as a
   * document reading "1 day" and a stored range of three.
   */
  const [effectiveStart, effectiveEnd] = singleDayMc
    ? [mcDate, mcDate]
    : isTimeSlip
      ? [slipDate, slipDate]
      : [dateRange?.[0] ?? null, dateRange?.[1] ?? null];

  const days =
    effectiveStart && effectiveEnd ? effectiveEnd.diff(effectiveStart, 'day') + 1 : null;

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
        startDate: effectiveStart,
        endDate: effectiveEnd,
        hours: hours ?? undefined,
        procedure,
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
      effectiveStart,
      effectiveEnd,
      hours,
      procedure,
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
    setHours(null);
    setSlipDate(dayjs());
    setProcedure('');
    setMcSpan('single');
    setMcDate(dayjs());
    // Only on open — a reset on every render would erase the doctor's work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
        startDate: effectiveStart?.format('YYYY-MM-DD'),
        endDate: effectiveEnd?.format('YYYY-MM-DD'),
        // Sent only for the type that has them, so a stray hours value cannot
        // ride along on an MC and be read later as an attendance record.
        hours: isTimeSlip ? (hours ?? undefined) : undefined,
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

      {type === 'MC' &&
        field(
          'Rest period',
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            {/* One day is the commonest MC a GP writes, and picking the same
                date twice in a range picker is both slower and easier to get
                wrong by a day. Stored identically either way. */}
            <Radio.Group
              value={mcSpan}
              onChange={(e) => setMcSpan(e.target.value)}
              options={[
                { value: 'single', label: 'One day' },
                { value: 'range', label: 'Date range' },
              ]}
              optionType="button"
              size="small"
            />
            {mcSpan === 'single' ? (
              <DatePicker
                style={{ width: '100%' }}
                value={mcDate}
                onChange={(d) => d && setMcDate(d)}
                aria-label="Rest day"
              />
            ) : (
              <RangePicker style={{ width: '100%' }} value={dateRange} onChange={setDateRange} />
            )}
            {days !== null && <Tag color="blue">{days} day{days === 1 ? '' : 's'}</Tag>}
          </Space>,
        )}

      {type === 'QUARANTINE' &&
        field(
          'Quarantine period',
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <RangePicker style={{ width: '100%' }} value={dateRange} onChange={setDateRange} />
            {days !== null && <Tag color="blue">{days} day{days === 1 ? '' : 's'}</Tag>}
          </Space>,
        )}

      {isTimeSlip && (
        <Space wrap size={12} style={{ width: '100%' }}>
          <div style={{ minWidth: 180 }}>
            {field(
              'Date attended',
              <DatePicker
                style={{ width: '100%' }}
                value={slipDate}
                onChange={(d) => d && setSlipDate(d)}
                aria-label="Date attended"
              />,
            )}
          </div>
          <div style={{ minWidth: 160 }}>
            {field(
              'Hours attended',
              <InputNumber
                style={{ width: '100%' }}
                min={0.25}
                max={24}
                step={0.5}
                value={hours}
                onChange={setHours}
                aria-label="Hours attended"
              />,
              '(e.g. 2.5)',
            )}
          </div>
        </Space>
      )}

      {isConsent &&
        field(
          'Procedure or treatment',
          <Input
            placeholder="e.g. Incision and drainage of abscess"
            value={procedure}
            onChange={(e) => setProcedure(e.target.value)}
            aria-label="Procedure or treatment"
          />,
          '(left blank prints a line to complete by hand)',
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
