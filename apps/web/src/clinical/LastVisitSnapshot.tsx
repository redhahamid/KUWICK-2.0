import { Button, Skeleton, Space, Tag, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useVisitHistory } from './history/useVisitHistory';
import { attendingClinician } from './attendingClinician';
import { formatClinicDate, formatClinicDateShort, formatClinicTime } from './clinicTime';
import { useIsDesktop } from '../core/hooks/useMediaQuery';
import { VisitHistorySummary } from './types';

const { Text } = Typography;

interface LastVisitSnapshotProps {
  patientId: string;
  /** Excluded from the snapshot — this is the consultation in progress. */
  currentVisitId?: string;
  onViewHistory: () => void;
}

// Colour PAIRS from the token set, and every one is rendered with its word —
// status is never carried by colour alone (D-077 §4).
const INVOICE_CHIP: Record<string, string> = {
  UNPAID: 'kw-chip-pending',
  PAID: 'kw-chip-success',
  CANCELLED: 'kw-chip-neutral',
};

function money(amount: string): string {
  return `RM${Number(amount).toFixed(2)}`;
}

/** A dash is a lie when the reason is "nobody recorded it". Say which. */
function absent(what: string) {
  return (
    <Text type="secondary" italic style={{ fontSize: 12 }}>
      {what} not recorded
    </Text>
  );
}

function mcSummary(mc: { startDate: string | null; endDate: string | null }): string {
  if (!mc.startDate || !mc.endDate) return 'MC';
  const days = dayjs(mc.endDate).diff(dayjs(mc.startDate), 'day') + 1;
  return `MC ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * G4.5d2 (D-076) — the Last Visit Snapshot.
 *
 * A GP's first question is almost always "what happened last time?", and the
 * answer was behind the Previous Visits drawer. This puts the headline on
 * screen: when, who, what for, what was found, what was given, what was
 * issued, what it cost.
 *
 * READ-ONLY, and structurally so. It renders from `useVisitHistory` — the G4
 * hook that contains no mutation and whose cache keys are namespaced to
 * 'visit-history', so nothing here can write, and nothing here can invalidate
 * the current visit's caches out from under an open consultation. It does not
 * touch the selected visit id, the URL, or the C1 draft key. "View History"
 * opens the same approved G4 drawer; click-to-switch is NOT restored.
 *
 * Everything shown is a stored field. Where a field is absent the snapshot
 * says so in those words rather than printing "None", "Normal" or RM0.00 —
 * a zero total reads as a bill for nothing, when the truth is there is no
 * bill. Most importantly, a diagnosis is only called Primary when the
 * priority was explicitly recorded as PRIMARY (the summary's `isPrimary`);
 * being first in the list is not evidence of anything (G2a).
 */
export function LastVisitSnapshot({ patientId, currentVisitId, onViewHistory }: LastVisitSnapshotProps) {
  const { data, isLoading } = useVisitHistory(patientId);
  // Phones get a shorter hierarchy — same facts, fewer words (D-077 §7).
  const compact = !useIsDesktop();

  const visits: VisitHistorySummary[] = data?.pages.flatMap((page) => page.items) ?? [];
  // The most recent visit that is NOT the one being worked on. The list is
  // already newest-first; filtering by id rather than by position means a
  // patient with a single visit correctly shows nothing at all.
  const last = visits.find((visit) => visit.id !== currentVisitId);

  if (isLoading) {
    return (
      <div className="kw-last-visit">
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      </div>
    );
  }

  if (!last) {
    return (
      <div className="kw-last-visit">
        <Text type="secondary" className="kw-last-visit-label">
          LAST VISIT
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No previous visit for this patient
        </Text>
      </div>
    );
  }

  const attending = attendingClinician(last.doctorName, last.doctorRole);
  const meds = last.medications.slice(0, 2);
  const moreMeds = Math.max(last.medicationCount - meds.length, 0);
  const extraDiagnoses = Math.max(last.diagnosisCount - 1, 0);
  const invoice = last.invoices.length === 1 ? last.invoices[0] : undefined;

  return (
    <div className="kw-last-visit" aria-label="Most recent previous visit">
      <div className="kw-last-visit-head">
        <Text type="secondary" className="kw-last-visit-label">
          LAST VISIT
        </Text>
        <Text strong style={{ fontSize: 13 }}>
          {compact ? formatClinicDateShort(last.checkInAt) : formatClinicDate(last.checkInAt)}
        </Text>
        {!compact && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatClinicTime(last.checkInAt)} · {last.visitNumber}
          </Text>
        )}
        {/* D-077 — the stored attending relationship, labelled by the stored
            role. A nurse is never printed under a doctor's title. */}
        <Text
          style={{ fontSize: 12 }}
          italic={!attending.name}
          type={attending.name ? undefined : 'secondary'}
        >
          {compact && attending.name ? attending.name : attending.text}
        </Text>
      </div>

      <div className="kw-last-visit-body">
        {/* Diagnosis carries the clinical emphasis; the complaint supports it. */}
        <div className="kw-last-visit-clinical">
          {last.primaryDiagnosis ? (
            <Space size={4} wrap>
              <Text strong style={{ fontSize: 13 }}>
                {last.primaryDiagnosis.name}
              </Text>
              {last.primaryDiagnosis.icd10Code && <Tag color="geekblue">{last.primaryDiagnosis.icd10Code}</Tag>}
              {/* Only when the priority was actually recorded. */}
              {/* Teal: a recorded clinical judgement. Red is reserved for allergy
                  and destructive actions (D-077 §4). */}
              {last.primaryDiagnosis.isPrimary && <Tag className="kw-chip-clinical">Primary</Tag>}
              {extraDiagnoses > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  +{extraDiagnoses} more
                </Text>
              )}
            </Space>
          ) : (
            absent('Diagnosis')
          )}
          <div>
            {last.presentingComplaint ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {last.presentingComplaint}
              </Text>
            ) : (
              absent('Complaint')
            )}
          </div>
        </div>

        {/* Names and strengths only — the compact snapshot is not a chart. */}
        <div className="kw-last-visit-meds">
          {last.medicationCount === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              No medication prescribed
            </Text>
          ) : meds.length === 0 ? (
            absent('Medication details')
          ) : (
            <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: true }}>
              {meds.map((m) => `${m.name}${m.strength ? ` ${m.strength}mg` : ''}`).join(' · ')}
              {moreMeds > 0 ? ` · +${moreMeds} more` : ''}
            </Text>
          )}
        </div>

        <div className="kw-last-visit-outcome">
          <Space size={4} wrap>
            {last.mc && <Tag className="kw-chip-progress">{mcSummary(last.mc)}</Tag>}
            {last.referral && (
              <Tag className="kw-chip-neutral">
                {last.referral.referredTo ? `Referral ${last.referral.referredTo}` : 'Referral'}
              </Tag>
            )}
            {!compact && last.memo && <Tag className="kw-chip-neutral">Memo</Tag>}
            {!compact &&
              last.documentCount > (last.mc ? 1 : 0) + (last.referral ? 1 : 0) + (last.memo ? 1 : 0) && (
                <Tag className="kw-chip-neutral">{last.documentCount} documents</Tag>
              )}

            {last.invoices.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                No invoice created
              </Text>
            ) : invoice ? (
              <>
                <Text style={{ fontSize: 12 }}>Invoice {money(invoice.totalAmount)}</Text>
                <Tag className={INVOICE_CHIP[invoice.status]}>{invoice.status}</Tag>
                <Tag className="kw-chip-neutral">
                  {last.panelName ? `Panel ${last.panelName}` : 'Cash'}
                </Tag>
              </>
            ) : (
              // Deliberately no combined figure — see the type comment.
              <Tag>{last.invoices.length} invoices</Tag>
            )}
          </Space>
        </div>
      </div>

      <Button
        size="small"
        icon={<HistoryOutlined />}
        className="kw-last-visit-action"
        onClick={onViewHistory}
      >
        View History
      </Button>
    </div>
  );
}
