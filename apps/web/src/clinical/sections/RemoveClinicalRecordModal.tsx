import { ReactNode, useEffect, useState } from 'react';
import { Alert, Descriptions, Input, Modal, Typography, message } from 'antd';
import { ApiError } from '../../core/api-client';

const { Text } = Typography;

export interface RemovalDetail {
  label: string;
  value: ReactNode;
}

interface RemoveClinicalRecordModalProps {
  open: boolean;
  /** e.g. "Void medical certificate", "Remove image from visit". */
  title: string;
  /** The button the doctor presses to go through with it. */
  okText: string;
  /** What the record is, in the doctor's words — used in the reassurance line. */
  retentionMessage: string;
  placeholder: string;
  details: RemovalDetail[];
  pending: boolean;
  successMessage: string;
  errorMessage: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

/**
 * G3a (D-062) — the shared confirmation for an audited clinical removal.
 *
 * Same contract as the diagnosis removal added in the G2 closure, generalised
 * so documents, visit images and investigation results all ask in one voice:
 * show exactly what is being removed, require a typed reason, and say plainly
 * that the record and the file survive. A doctor should never have to guess
 * whether pressing this destroys evidence.
 */
export function RemoveClinicalRecordModal({
  open,
  title,
  okText,
  retentionMessage,
  placeholder,
  details,
  pending,
  successMessage,
  errorMessage,
  onConfirm,
  onClose,
}: RemoveClinicalRecordModalProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const confirm = async () => {
    try {
      await onConfirm(reason.trim());
      message.success(successMessage);
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : errorMessage);
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={confirm}
      okText={okText}
      cancelText="Cancel"
      okButtonProps={{ danger: true, disabled: reason.trim().length < 3 }}
      confirmLoading={pending}
      width={560}
    >
      <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
        {details.map((detail) => (
          <Descriptions.Item key={detail.label} label={detail.label}>
            {detail.value ?? '—'}
          </Descriptions.Item>
        ))}
      </Descriptions>

      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={retentionMessage} />

      <Text strong style={{ display: 'block', marginBottom: 4 }}>
        Reason (required)
      </Text>
      <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
    </Modal>
  );
}
