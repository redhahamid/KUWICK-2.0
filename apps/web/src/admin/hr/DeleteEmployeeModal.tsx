import { useState } from 'react';
import { App, Input, Modal } from 'antd';
import { useDeleteEmployee } from '../hooks/useAdmin';

/**
 * DELETE — for a record that should never have existed.
 *
 * The directory said there is no delete, and for anybody who was paid that
 * is right: the EA form, the EPF return and the ledger name them, and the
 * exit is mark-as-resigned. But a wrong entry, a duplicate and a hire who
 * never turned up had no exit at all — they sat in the list for good and
 * counted against payroll readiness every month.
 *
 * The server decides, not this form: a line on an approved run refuses the
 * delete by name and month, and so does having worked here at all. The
 * refusal is shown here, in its own words, with the exit it names.
 */
export function DeleteEmployeeModal({
  staffId,
  fullName,
  open,
  onClose,
  onDeleted,
}: {
  staffId: string | null;
  fullName: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { message } = App.useApp();
  const remove = useDeleteEmployee();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setProblem(null);
    onClose();
  };

  return (
    <Modal
      open={open && Boolean(staffId)}
      title={`Delete ${fullName}?`}
      okText="Delete record"
      okButtonProps={{ danger: true }}
      confirmLoading={remove.isPending}
      onCancel={close}
      onOk={() => {
        if (!staffId) return;
        if (!reason.trim()) {
          setProblem('Say why — it is the only record of this person that will remain.');
          return;
        }
        remove.mutate(
          { staffId, reason: reason.trim() },
          {
            onSuccess: () => {
              message.success(`${fullName} deleted.`);
              close();
              onDeleted?.();
            },
            onError: (error: Error) => setProblem(error.message),
          },
        );
      }}
    >
      {problem ? (
        <div className="hr-notice hr-notice--attn" role="alert">
          {problem}
        </div>
      ) : null}
      <div className="hr-form" style={{ marginTop: 12 }}>
        <p>
          For a record that should never have existed — entered twice, entered wrongly, or a hire who never
          turned up. The record, its salary and standing history and any login go. Somebody an approved
          payroll has paid, or who has worked here, is refused: mark them as resigned instead.
        </p>
        <div>
          <label htmlFor="delete-reason">Reason</label>
          <Input
            id="delete-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Duplicate of an existing record…"
          />
        </div>
      </div>
    </Modal>
  );
}
