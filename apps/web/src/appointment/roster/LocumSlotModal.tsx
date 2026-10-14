import { useState } from 'react';
import { Alert, Input, Modal, Select, TimePicker, message } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../../core/api-client';
import { useCreateLocumSlots, useShiftTemplates } from '../hooks/useRoster';

/**
 * AN EXTERNAL LOCUM ON THE ROSTER (UAT, 14 October 2026): "External locum
 * slots with the locum's name." A name, not a staff member: nobody books into
 * it and payroll never pays it (Finance pays external locums).
 */
export function LocumSlotModal({
  open,
  clinicId,
  dates,
  onClose,
}: {
  open: boolean;
  clinicId: string;
  dates: string[];
  onClose: () => void;
}) {
  const templates = useShiftTemplates({ group: 'DOCTOR', clinicId });
  const create = useCreateLocumSlots();
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = (templates.data ?? []).filter((row) => row.kind === 'WORKING');
  const template = working.find((row) => row.id === templateId);

  const submit = async () => {
    setError(null);
    const startTime = template?.startTime ?? start;
    const endTime = template?.endTime ?? end;
    if (!name.trim()) return setError("Give the locum's name.");
    if (!startTime || !endTime) return setError('Choose a shift, or give a start and an end time.');
    try {
      const result = await create.mutateAsync({
        clinicId,
        dates,
        startTime,
        endTime,
        locumName: name.trim(),
        ...(template ? { templateId: template.id } : {}),
      });
      message.success(`${result.created} locum slot${result.created === 1 ? '' : 's'} added for ${name.trim()}`);
      setName('');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The locum slot could not be saved.');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Add locum"
      confirmLoading={create.isPending}
      title={`External locum — ${dates.length} date${dates.length === 1 ? '' : 's'}`}
      rootClassName="kw-apt3-modal"
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} /> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        <label>
          <div>Locum's name</div>
          <Input aria-label="Locum's name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <label>
          <div>Shift</div>
          <Select
            aria-label="Locum shift"
            value={templateId}
            onChange={setTemplateId}
            style={{ width: '100%' }}
            options={[
              { value: '', label: 'Custom times' },
              ...working.map((row) => ({ value: row.id, label: `${row.name} · ${row.startTime}–${row.endTime}` })),
            ]}
          />
        </label>
        {!template ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <TimePicker
              aria-label="Starts"
              format="HH:mm"
              minuteStep={5}
              needConfirm={false}
              value={start ? dayjs(start, 'HH:mm') : null}
              onChange={(value) => setStart(value ? value.format('HH:mm') : null)}
              style={{ flex: 1 }}
            />
            <TimePicker
              aria-label="Ends"
              format="HH:mm"
              minuteStep={5}
              needConfirm={false}
              value={end ? dayjs(end, 'HH:mm') : null}
              onChange={(value) => setEnd(value ? value.format('HH:mm') : null)}
              style={{ flex: 1 }}
            />
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: '#667085' }}>
          Not bookable, and not paid through payroll: Finance pays external locums.
        </div>
      </div>
    </Modal>
  );
}
