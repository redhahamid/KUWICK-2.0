import { useState } from 'react';
import { App, Input } from 'antd';
import { ApiError } from '../../core/api-client';
import { useCreateJobTitle, useJobTitles, useUpdateJobTitle } from '../hooks/useAdmin';
import { Drawer } from './ui';
import type { JobTitleRow } from '../types';

/**
 * THE CLINIC'S JOB TITLES, kept where the employees are. Add, rename or
 * retire; a rename follows through to every record that holds the title, and
 * a retired title stays on the people who have it.
 */
export function JobTitlesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const titles = useJobTitles();
  const create = useCreateJobTitle();
  const update = useUpdateJobTitle();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const say = (error: unknown, fallback: string) => message.error(error instanceof ApiError ? error.message : fallback);
  const add = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    try {
      await create.mutateAsync({ name: trimmed });
      setName('');
    } catch (error) {
      say(error, 'Could not add the title');
    }
  };
  const rename = async () => {
    if (!renaming || renaming.name.trim().length < 2) return;
    try {
      await update.mutateAsync({ id: renaming.id, name: renaming.name.trim() });
      setRenaming(null);
    } catch (error) {
      say(error, 'Could not rename the title');
    }
  };
  const toggle = async (row: JobTitleRow) => {
    try {
      await update.mutateAsync({ id: row.id, active: !row.active });
    } catch (error) {
      say(error, 'Could not change the title');
    }
  };

  const rows = titles.data ?? [];
  return (
    <Drawer
      open={open}
      title="Job titles"
      onClose={onClose}
      footer={
        <button type="button" className="hr-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="hr-faint" style={{ marginBottom: 12 }}>
        The clinic’s own words for its jobs, picked from on the employee form. Renaming one renames it on every record that
        holds it; retiring one keeps it on the people who have it and offers it to nobody new.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Input aria-label="New job title" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Clinic assistant" onPressEnter={add} />
        <button type="button" className="hr-btn hr-btn--primary" onClick={add} disabled={create.isPending || name.trim().length < 2}>
          Add
        </button>
      </div>
      {rows.length === 0 && !titles.isLoading ? <div className="hr-faint">No job titles yet.</div> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: row.active ? 1 : 0.6 }}>
            {renaming?.id === row.id ? (
              <>
                <Input aria-label={`Rename ${row.name}`} value={renaming.name} onChange={(event) => setRenaming({ id: row.id, name: event.target.value })} onPressEnter={rename} autoFocus />
                <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={rename} disabled={update.isPending}>
                  Save
                </button>
                <button type="button" className="hr-btn hr-btn--sm" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span style={{ flex: 1 }}>
                  <span className="hr-strong">{row.name}</span>
                  <span className="hr-faint">
                    {' '}
                    · {row.employeeCount} {row.employeeCount === 1 ? 'person' : 'people'}
                    {row.active ? '' : ' · retired'}
                  </span>
                </span>
                <button type="button" className="hr-linkButton" aria-label={`Rename ${row.name}`} onClick={() => setRenaming({ id: row.id, name: row.name })}>
                  Rename
                </button>
                <button type="button" className="hr-linkButton" aria-label={row.active ? `Retire ${row.name}` : `Restore ${row.name}`} onClick={() => toggle(row)} disabled={update.isPending}>
                  {row.active ? 'Retire' : 'Restore'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}
