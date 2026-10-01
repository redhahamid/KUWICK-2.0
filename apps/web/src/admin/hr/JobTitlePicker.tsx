import { useState } from 'react';
import { App, Button, Input, Select } from 'antd';
import { ApiError } from '../../core/api-client';
import { useCreateJobTitle, useJobTitles } from '../hooks/useAdmin';

/**
 * A JOB TITLE FROM THE CLINIC'S OWN LIST, or a new one added on the spot.
 *
 * "Position" was a text box nobody could pick from, and "Job" was the account
 * role. The list is the clinic's: it starts from the positions already typed
 * on its records, and grows here without a trip to Settings. A retired title
 * stays on the person who holds it and is offered to nobody new.
 */
export function JobTitlePicker({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value?: string | null;
  /** The chosen title's id and name; both undefined when cleared. */
  onChange?: (jobTitleId: string | undefined, name: string | undefined) => void;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const titles = useJobTitles();
  const create = useCreateJobTitle();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const rows = titles.data ?? [];
  const options = rows
    .filter((row) => row.active || row.id === value)
    .map((row) => ({ value: row.id, label: row.active ? row.name : `${row.name} (retired)` }));

  const add = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    try {
      const created = await create.mutateAsync({ name: trimmed });
      onChange?.(created.id, created.name);
      setAdding(false);
      setName('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add the job title');
    }
  };

  return (
    <div>
      <Select
        id={id}
        value={value ?? undefined}
        onChange={(next) => onChange?.(next, rows.find((row) => row.id === next)?.name)}
        allowClear
        showSearch
        optionFilterProp="label"
        options={options}
        placeholder={rows.length > 0 ? 'Choose a job title' : 'No titles yet — add one below'}
        style={{ width: '100%' }}
        disabled={disabled}
        loading={titles.isLoading}
      />
      {adding ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Input
            aria-label="New job title"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Clinic assistant"
            onPressEnter={add}
            autoFocus
          />
          <Button size="small" type="primary" onClick={add} loading={create.isPending}>
            Add
          </Button>
          <Button size="small" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="link" size="small" style={{ paddingInline: 0, marginTop: 4 }} onClick={() => setAdding(true)} disabled={disabled}>
          Add a job title
        </Button>
      )}
    </div>
  );
}
