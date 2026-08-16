import { useState } from 'react';
import { Button, Popover, Select, Space, Typography, message } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { useUpdatePatient } from '../../core/hooks/usePatients';
import { Patient } from '../../core/types';
import { allergyBannerState, allergyWords } from '../medications/AllergyStrip';
import { allergyAlerts, usePatientAlerts } from '../hooks/usePatientAlerts';

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

  // b1.5 PHASE D — the chip reads MEDICAL alerts too.
  //
  // It said "Allergy not asked" from `patient.allergies` alone, so recording
  // "Penicillin allergy" as a MEDICAL alert left the header still asking the
  // question — the FIFTH surface of the same defect, and the one a doctor
  // looks at first. Found by the E2E, not by reasoning about it.
  const { data: alerts } = usePatientAlerts(patient.id);
  // FIX 3 — ALLERGY alerts only. This read every MEDICAL alert, so diabetes
  // and hypertension arrived in a red do-not-prescribe chip beside three real
  // drug allergies: "NSAIDS, AUGMENTIN, PCM, DM, HPT, OKU". Six words, two
  // meanings, one colour. Chronic conditions now have their own indicator.
  const allergyLabels = allergyAlerts(alerts).map((alert) => alert.label);
  const state = allergyBannerState(patient.allergies, allergyLabels);
  // What the chip SHOWS. Both sources, verbatim — a chip reading PRESENT while
  // listing nothing would be worse than the "not asked" it replaced.
  const allergies = allergyWords(patient.allergies, allergyLabels);
  /** Only the quick-record half is editable here; alerts are the profile's. */
  const editableAllergies = (patient.allergies ?? []).filter((entry) => entry?.trim());

  const openWithCurrent = (next: boolean) => {
    // Seeded from the QUICK-RECORD half only. Seeding from the combined list
    // would copy a MEDICAL alert's label into `patient.allergies` the first
    // time anyone opened this and pressed Save — the same allergy then living
    // in two stores, with no way to tell which one a later edit meant.
    if (next) setDraft(editableAllergies);
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
          {allergyLabels.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {allergyLabels.length} also recorded as an allergy alert ({allergyLabels.join(', ')}). Change those
              in the alerts view.
            </Text>
          )}
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
