import { ReactNode } from 'react';
import { Button, Modal, Typography } from 'antd';
import { ExclamationCircleFilled, QuestionCircleFilled } from '@ant-design/icons';

const { Text } = Typography;

/**
 * G4.5d5b-1 — the confirmation for an action that cannot be undone.
 *
 * Separate from KuwickModal because it is a different thing: a question with
 * two answers, not a surface holding a form. Keeping them apart is what stops
 * the confirmation growing fields.
 *
 * `tone` decides the confirm button only. A dangerous action gets a red
 * button; an ordinary one does not, because making every confirmation red
 * teaches staff that red means "continue".
 */
export interface KuwickConfirmModalProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  /** Extra structured context — what is about to be affected. */
  details?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  /** Disables confirm while an acknowledgement is outstanding. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KuwickConfirmModal({
  open,
  title,
  body,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: KuwickConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={
        <span className="kw-confirm-title">
          {tone === 'danger' ? (
            <ExclamationCircleFilled aria-hidden style={{ color: 'var(--kw-danger-fg)' }} />
          ) : (
            <QuestionCircleFilled aria-hidden style={{ color: 'var(--kw-navy)' }} />
          )}{' '}
          {title}
        </span>
      }
      width={480}
      rootClassName="kw-modal kw-confirm"
      // Cancelling must be effortless; confirming must not be.
      maskClosable={!loading}
      onCancel={onCancel}
      destroyOnHidden
      footer={
        <div className="kw-modal-footer">
          <Button onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="primary"
            danger={tone === 'danger'}
            loading={loading}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {body && <Text>{body}</Text>}
      {details && <div style={{ marginTop: 12 }}>{details}</div>}
    </Modal>
  );
}
