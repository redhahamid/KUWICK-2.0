import { useState } from 'react';
import { Button, Popover, Select, Space, Typography, message } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { Patient } from '../../core/types';
import { allergyBannerState, allergyWords } from '../medications/AllergyStrip';
import {
  allergyAlerts,
  noKnownAllergyAlerts,
  useCreatePatientAlert,
  useDeactivatePatientAlert,
  usePatientAlerts,
} from '../hooks/usePatientAlerts';

const { Text } = Typography;

/**
 * A2 — ALLERGY QUICK-RECORD (spec p.2: the header chip is where allergies get
 * asked and answered, mid-consultation, without leaving the canvas).
 *
 * THE CHIP STAYS. Recording an allergy in two clicks is the behaviour that
 * gets allergies recorded at all, and removing it to win a tidier data model
 * would cost more than the duplication ever did. What changed is only where it
 * WRITES: it used to put free text into `patient.allergies` — no author, no
 * timestamp, no history — while the alerts popover beside it wrote an
 * attributed, append-only ALLERGY alert. Two stores for one clinical fact, and
 * the one a doctor actually reached for was the one that could not say who
 * recorded it. That column is gone; this writes alerts now.
 *
 * A doctor sees no difference: same three states, same words, same two clicks.
 * The difference is that "NSAIDS, 16/08/2026, Dr Amira" is now answerable.
 *
 * "Save" records exactly what is in the box, and says so on the button: an
 * emptied box reads "Record: no known allergies", because a confirmed negative
 * is a real answer and must never be recordable by accident under a label that
 * says something else. It now writes a NO_KNOWN_ALLERGY alert rather than an
 * empty array — the same fact, with an author attached.
 */
export function AllergyQuickRecord({ patient }: { patient: Patient }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: alerts } = usePatientAlerts(patient.id);
  const createAlert = useCreatePatientAlert(patient.id);
  const deactivateAlert = useDeactivatePatientAlert(patient.id);

  // FIX 3 — ALLERGY alerts only. This once read every MEDICAL alert, so
  // diabetes and hypertension arrived in a red do-not-prescribe chip beside
  // three real drug allergies: "NSAIDS, AUGMENTIN, PCM, DM, HPT, OKU". Six
  // words, two meanings, one colour.
  const recorded = allergyAlerts(alerts);
  const noKnown = noKnownAllergyAlerts(alerts);
  const allergyLabels = recorded.map((alert) => alert.label);
  const allergies = allergyWords(allergyLabels);
  const state = allergyBannerState(allergyLabels, noKnown.length > 0);

  const openWithCurrent = (next: boolean) => {
    // Seeded from what is actually recorded, because that is now ONE list
    // rather than two. Before the merge this had to seed from the quick-record
    // half alone, or pressing Save would copy an alert's label into the free
    // text field and the same allergy would live in both stores.
    if (next) setDraft(allergies);
    setOpen(next);
  };

  const save = async () => {
    const cleaned = allergyWords(draft);
    const before = new Map(recorded.map((alert) => [alert.label.trim().toLowerCase(), alert]));
    const after = new Set(cleaned.map((entry) => entry.toLowerCase()));

    setSaving(true);
    try {
      // REMOVED entries are RESOLVED, not deleted. Taking a word out of this
      // box is a clinical decision — "the penicillin reaction turned out to be
      // the virus" — and the record of it is exactly what the free-text array
      // could never hold: the row stays, stamped with who retired it and when.
      for (const [key, alert] of before) {
        if (!after.has(key)) await deactivateAlert.mutateAsync(alert.id);
      }
      for (const entry of cleaned) {
        if (!before.has(entry.toLowerCase())) {
          await createAlert.mutateAsync({ type: 'ALLERGY', label: entry });
        }
      }

      if (cleaned.length === 0) {
        // The confirmed negative, recorded POSITIVELY. An empty list used to
        // mean this by implication; implication does not survive a column
        // being dropped, and it never had an author.
        if (noKnown.length === 0) {
          await createAlert.mutateAsync({ type: 'NO_KNOWN_ALLERGY', label: 'No known allergy' });
        }
      } else {
        // An allergy and "none known" cannot both be true. The negative is
        // retired rather than left to be outranked silently, so the history
        // reads as the sequence it was.
        for (const alert of noKnown) await deactivateAlert.mutateAsync(alert.id);
      }

      message.success(cleaned.length > 0 ? 'Allergies recorded.' : 'Recorded: no known allergies.');
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to record allergies');
    } finally {
      setSaving(false);
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
          <Text type="secondary" style={{ fontSize: 12 }}>
            Recorded against your name, with the time. Removing one resolves it — nothing is
            deleted, and the alerts view keeps the history.
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
          <Button type="primary" block loading={saving} onClick={save} style={{ minHeight: 44 }}>
            {draft.some((entry) => entry.trim()) ? 'Save allergies' : 'Record: no known allergies'}
          </Button>
        </Space>
      }
    >
      {chip}
    </Popover>
  );
}
