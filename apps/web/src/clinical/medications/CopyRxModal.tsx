import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Skeleton, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../core/api-client';
import { useCopyPrescriptions } from '../hooks/usePrescriptions';
import { Prescription, VisitHistoryDetail } from '../types';
import {
  ALLERGY_HEADING,
  NO_ALLERGY_RECORD_WARNING,
  POSSIBLE_MATCH_LABEL,
  allergyRecordState,
  copyButtonLabel,
  decorateCandidates,
} from './copyRx';

const { Text } = Typography;

/**
 * KW2-C2 — Copy Rx, with the review that makes it safe (spec p.8).
 *
 * NEVER BLIND-COPY. Carrying a prescription forward is a new decision made
 * from old information — the patient's weight, their allergies and the
 * clinic's stock have all had time to change since. So the doctor sees the
 * list, ticks what still applies, and only that is copied. What lands is
 * marked "copied · review" until somebody says otherwise.
 *
 * The allergy panel says exactly what it can stand behind: the patient's own
 * recorded words, verbatim, under a heading that puts the checking on the
 * reader. A row whose name contains one of those words is amber and says
 * "possible match — verify". Nothing here is red, nothing says "interaction",
 * and nothing is blocked — there is no drug dictionary behind this, and a
 * warning that overclaims is one that gets trusted and then missed.
 */
export interface CopyRxModalProps {
  open: boolean;
  /** The visit being copied FROM. */
  sourceVisitId: string;
  sourceLabel: string;
  patientId: string;
  /** The visit being copied TO — the one in progress. */
  targetVisitId: string;
  /** The patient's recorded allergies, exactly as stored. */
  allergies: string[] | null | undefined;
  onClose: () => void;
}

export function CopyRxModal({
  open,
  sourceVisitId,
  sourceLabel,
  patientId,
  targetVisitId,
  allergies,
  onClose,
}: CopyRxModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const copy = useCopyPrescriptions(targetVisitId);

  // The read-only history detail, which already carries the source visit's
  // prescriptions. Its cache keys are namespaced away from the live visit's,
  // so opening this cannot refresh the consultation in progress (D-067).
  const { data, isLoading } = useQuery({
    queryKey: ['visit-history', 'detail', patientId, sourceVisitId],
    queryFn: () =>
      apiClient.get<VisitHistoryDetail>(`/patients/${patientId}/history/${sourceVisitId}`),
    enabled: open && Boolean(sourceVisitId),
  });

  const candidates = useMemo(
    () =>
      (data?.prescriptions ?? [])
        .filter((rx: Prescription) => rx.status !== 'CANCELLED')
        .map((rx: Prescription) => ({
          id: rx.id,
          name: rx.item?.name ?? 'Medication',
          detail: [
            rx.amount && `${rx.amount}${rx.unit ? ` ${rx.unit}` : ''}`,
            rx.frequency,
            rx.durationDays ? `×${rx.durationDays}d` : null,
            rx.quantity ? `${rx.quantity} to dispense` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    [data],
  );

  const rows = useMemo(() => decorateCandidates(candidates, allergies), [candidates, allergies]);
  const recordState = allergyRecordState(allergies);

  // Everything starts ticked: the common case is carrying the whole
  // prescription forward, and the doctor is confirming either way. Unticking
  // is the edit, and it is one click.
  useEffect(() => {
    if (open) setSelected(candidates.map((c) => c.id));
  }, [open, candidates]);

  const confirm = async () => {
    try {
      await copy.mutateAsync({ sourceVisitId, targetVisitId, prescriptionIds: selected });
      message.success(
        `${selected.length} medication${selected.length === 1 ? '' : 's'} copied — marked for review`,
      );
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to copy medications');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Copy prescription from ${sourceLabel}`}
      width={560}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={copy.isPending}
          disabled={selected.length === 0}
          onClick={confirm}
        >
          {copyButtonLabel(selected.length)}
        </Button>,
      ]}
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        Select which medications to prescribe today. Every field stays editable after copying.
      </Text>

      {/* The patient's own words, verbatim, under a heading that puts the
          checking on the reader. Never paraphrased into a claim. */}
      <div style={{ marginTop: 12 }} data-testid="copy-rx-allergies">
        {recordState === 'NONE_RECORDED' ? (
          <Alert type="warning" showIcon={false} message={NO_ALLERGY_RECORD_WARNING} />
        ) : recordState === 'NONE_KNOWN' ? (
          <Alert
            type="info"
            showIcon={false}
            message={ALLERGY_HEADING}
            description="No known allergy recorded."
          />
        ) : (
          <Alert
            type="warning"
            showIcon={false}
            message={ALLERGY_HEADING}
            description={<strong>{(allergies ?? []).join(', ')}</strong>}
          />
        )}
      </div>

      {isLoading && <Skeleton active paragraph={{ rows: 3 }} style={{ marginTop: 12 }} />}

      {!isLoading && rows.length === 0 && (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon={false}
          message="That visit has no medications to copy."
        />
      )}

      <div style={{ marginTop: 12 }}>
        {rows.map((row) => (
          <label
            key={row.id}
            className={`kw2-copy-row${row.flagged ? ' kw2-copy-row-flagged' : ''}`}
            data-testid="copy-rx-row"
            data-flagged={row.flagged ? 'true' : 'false'}
          >
            <Checkbox
              checked={selected.includes(row.id)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, row.id]
                    : current.filter((id) => id !== row.id),
                )
              }
            />
            <span className="kw2-copy-row-body">
              <span className="kw2-copy-row-name">{row.name}</span>
              <span className="kw2-copy-row-detail">{row.detail}</span>
              {row.flagged && (
                <span className="kw2-copy-row-warn">
                  {POSSIBLE_MATCH_LABEL} — matches: {row.matchedAllergies.join(', ')}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
