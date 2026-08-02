import { useEffect, useState } from 'react';
import { Alert, Descriptions, Input, Modal, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useRemoveDiagnosis } from '../hooks/useDiagnoses';
import { Diagnosis } from '../types';
import { ApiError } from '../../core/api-client';

const { Text } = Typography;

function priorityLabel(diagnosis: Diagnosis): string {
  if (diagnosis.priority === 'PRIMARY') return 'Primary';
  if (diagnosis.priority === 'SECONDARY') return 'Secondary';
  return 'Priority not recorded';
}

function addedByLabel(diagnosis: Diagnosis): string {
  if (diagnosis.legacyAttributionUnknown || !diagnosis.addedByNameSnapshot) {
    return 'Not recorded — legacy entry';
  }
  const role = diagnosis.addedByRoleSnapshot?.replace(/_/g, ' ').toLowerCase();
  return `${diagnosis.addedByNameSnapshot}${role ? ` (${role})` : ''}`;
}

interface RemoveDiagnosisModalProps {
  visitId: string;
  diagnosis: Diagnosis | null;
  onClose: () => void;
}

// G2 closure (D-061) — the removal confirmation.
//
// A trash icon and "Are you sure?" is not enough for a clinical record. The
// doctor is shown exactly what they are removing, who recorded it and when,
// must give a reason, and is told plainly that the original entry survives —
// so the decision is made with the facts visible rather than from memory.
export function RemoveDiagnosisModal({ visitId, diagnosis, onClose }: RemoveDiagnosisModalProps) {
  const [reason, setReason] = useState('');
  const removeDiagnosis = useRemoveDiagnosis(visitId);

  useEffect(() => {
    if (diagnosis) setReason('');
  }, [diagnosis?.id]);

  const confirm = async () => {
    if (!diagnosis) return;
    try {
      await removeDiagnosis.mutateAsync({
        id: diagnosis.id,
        removalReason: reason.trim(),
        expectedVersion: diagnosis.version,
      });
      message.success('Diagnosis removed from the visit — the original entry is preserved');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to remove the diagnosis');
    }
  };

  return (
    <Modal
      title="Remove diagnosis from visit"
      open={Boolean(diagnosis)}
      onCancel={onClose}
      onOk={confirm}
      okText="Confirm removal"
      cancelText="Cancel"
      okButtonProps={{ danger: true, disabled: reason.trim().length < 3 }}
      confirmLoading={removeDiagnosis.isPending}
      width={560}
    >
      {diagnosis && (
        <>
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Diagnosis">{diagnosis.name}</Descriptions.Item>
            <Descriptions.Item label="ICD-10">
              {diagnosis.icd10Code ? <Tag color="geekblue">{diagnosis.icd10Code}</Tag> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Current priority">{priorityLabel(diagnosis)}</Descriptions.Item>
            <Descriptions.Item label="Added by">{addedByLabel(diagnosis)}</Descriptions.Item>
            <Descriptions.Item label="Added">
              {dayjs(diagnosis.addedAt).format('D MMM YYYY, HH:mm')}
            </Descriptions.Item>
          </Descriptions>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="This diagnosis will be removed from the active visit record, but the original entry and audit history will remain preserved."
          />

          <Text strong style={{ display: 'block', marginBottom: 4 }}>
            Reason for removal (required)
          </Text>
          <Input.TextArea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered on the wrong patient; recorded in error during triage"
          />
        </>
      )}
    </Modal>
  );
}
