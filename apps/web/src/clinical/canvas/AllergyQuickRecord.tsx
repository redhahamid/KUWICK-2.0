import { useState } from 'react';
import { Button, Popover, Select, Space, Typography, message } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { useUpdatePatient } from '../../core/hooks/usePatients';
import { Patient } from '../../core/types';
import { allergyRecordState } from '../medications/copyRx';

const { Text } = Typography;

/**
 * A2 — ALLERGY QUICK-RECORD (spec p.2: the header chip is where allergies
 * get asked and answered, mid-consultation, without leaving the canvas).
 *
 * The chip keeps its three states — not asked (amber), none known, present —
 * and becomes the entry point for recording the answer. The popover opens on
 * a deliberate click, which keeps the standing allergy rules intact: nothing
 * red, nothing blocking, no per-add popups. The strip, the Copy Rx modal and
 * the completion checkpoint all read the same patient record this writes, so
 * one save updates every surface through the ['patients', id] invalidation.
 *
 * "Save" records exactly what is in the box, and says so on the button: an
 * emptied box reads "Record: no known allergies", because a confirmed
 * negative is a real answer (NONE_KNOWN) and must never be recordable by
 * accident under a label that says something else.
 */
export function AllergyQuickRecord({ patient }: { patient: Patient }) {
  const updatePatient = useUpdatePatient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const state = allergyRecordState(patient.allergies);
  const allergies = (patient.allergies ?? []).filter((entry) => entry?.trim());

  const openWithCurrent = (next: boolean) => {
    if (next) setDraft(allergies);
    setOpen(next);
  };

  const save = async () => {
    const cleaned = draft.map((entry) => entry.trim()).filter(Boolean);
    try {
      await updatePatient.mutateAsync({ id: patient.id, dto: { allergies: cleaned } });
      message.success(
        cleaned.length > 0 ? 'Allergies recorded.' : 'Recorded: no known allergies.',
      );
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to record allergies');
    }
  };

  const chip =
    state === 'PRESENT' ? (
      <button type="button" className="kw2-chip kw2-chip-danger kw2-chip-button" aria-label={`Allergies: ${allergies.join(', ')} — edit`}>
        <WarningFilled /> {allergies.join(', ')}
      </button>
    ) : state === 'NONE_KNOWN' ? (
      <button type="button" className="kw2-chip kw2-chip-button" aria-label="No known allergy — edit">
        + No known allergy
      </button>
    ) : (
      <button type="button" className="kw2-chip kw2-chip-warn kw2-chip-button" aria-label="Allergy not asked — record now">
        ! Allergy not asked
      </button>
    );

  return (
    <Popover
      open={open}
      onOpenChange={openWithCurrent}
      trigger="click"
      placement="bottomLeft"
      content={
        <Space direction="vertical" size={8} style={{ width: 300 }}>
          <Text strong>Allergies</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            The patient&rsquo;s own words, verbatim. An emptied list records a confirmed
            &ldquo;no known allergies&rdquo; — not an unasked question.
          </Text>
          <Select
            mode="tags"
            open={false}
            value={draft}
            onChange={(next) => setDraft(next as string[])}
            placeholder="Type an allergy and press Enter"
            style={{ width: '100%' }}
            aria-label="Allergies"
          />
          <Button type="primary" block loading={updatePatient.isPending} onClick={save} style={{ minHeight: 44 }}>
            {draft.some((entry) => entry.trim())
              ? 'Save allergies'
              : 'Record: no known allergies'}
          </Button>
        </Space>
      }
    >
      {chip}
    </Popover>
  );
}
