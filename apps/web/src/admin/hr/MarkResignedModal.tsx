import { useState } from 'react';
import { App, DatePicker, Input, Modal } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useUpsertEmployee } from '../hooks/useAdmin';

/**
 * MARK AS RESIGNED — the one way somebody leaves the directory.
 *
 * There is no delete. A person who was paid is a person the EA form, the
 * EPF return and the ledger still name, so the record stays and its status
 * says what happened: resigned, from a date, for a reason somebody wrote
 * down. The same endpoint the profile form uses; the status and the end date
 * are two fields on it.
 */
export function MarkResignedModal({
  staffId,
  fullName,
  open,
  onClose,
}: {
  staffId: string | null;
  fullName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const upsert = useUpsertEmployee();
  const [lastDay, setLastDay] = useState<Dayjs>(dayjs());
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
      title={`Mark ${fullName} as resigned`}
      okText="Mark as resigned"
      okButtonProps={{ danger: true }}
      confirmLoading={upsert.isPending}
      onCancel={close}
      onOk={() => {
        if (!staffId) return;
        if (!reason.trim()) {
          setProblem('Say why — it is recorded with the change.');
          return;
        }
        upsert.mutate(
          { staffId, employmentStatus: 'RESIGNED', endDate: lastDay.format('YYYY-MM-DD'), endReason: reason.trim() },
          {
            onSuccess: () => {
              message.success(`${fullName} marked as resigned from ${lastDay.format('D MMM YYYY')}.`);
              close();
            },
            onError: (error: Error) => setProblem(error.message),
          },
        );
      }}
    >
      <div className="hr-form" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="resign-last-day">Last working day</label>
          <DatePicker
            id="resign-last-day"
            value={lastDay}
            allowClear={false}
            format="D MMM YYYY"
            style={{ width: '100%' }}
            onChange={(value) => value && setLastDay(value)}
          />
        </div>
        <div>
          <label htmlFor="resign-reason">Reason</label>
          <Input
            id="resign-reason"
            value={reason}
            maxLength={500}
            placeholder="e.g. Resigned, moving to Johor Bahru"
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="hr-form__help">
            The record stays: pay already made, leave taken and the year's forms still name this person. Nothing is
            deleted.
          </div>
        </div>
        {problem ? (
          <div className="hr-small" style={{ color: 'var(--hr-red)' }}>
            {problem}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
