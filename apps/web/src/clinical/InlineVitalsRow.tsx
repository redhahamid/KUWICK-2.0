import { useEffect, useMemo, useRef, useState } from 'react';
import { InputNumber, Tooltip, Typography, message } from 'antd';
import { useLatestObservation, useRecordObservation } from './hooks/useVisitObservations';
import { formatClinicTime } from './clinicTime';
import {
  INLINE_VITALS,
  bmiBadge,
  inlineVitalsPayload,
  seedFromObservation,
  shouldSaveVitals,
  vitalsKey,
} from './inlineVitals';
import { VitalsFormValues } from './vitalsEntry';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

/** How long the doctor stops typing before a reading is committed. */
export const VITALS_AUTOSAVE_MS = 1200;

/**
 * KW2-C3 — vitals entered WHERE THEY ARE READ (spec p.2).
 *
 * This replaces a read-only strip plus a "Record vitals" link that opened a
 * separate panel: one screen change, one form, one save and one dismissal to
 * type a blood pressure. It was the most frequently entered thing in a
 * consultation behind the most ceremony.
 *
 * TWO PROPERTIES THAT ARE NOT NEGOTIABLE:
 *
 *  1. It writes OBSERVATIONS, through the same attributed endpoint the full
 *     panel uses. Recording a vital is a clinical act with an author and a
 *     time; typing it in a smaller box does not make it less of one.
 *
 *  2. It never re-sends an unchanged set. Autosave runs on a debounce, and a
 *     re-save would create a second observation row — attributed, timestamped,
 *     and describing a reading nobody took. The comparison is against what is
 *     actually recorded, not against a local "dirty" flag.
 *
 * Correcting a value that is already recorded still belongs in the full
 * panel, which has the reason field the correction endpoint requires. Typing
 * over a number here records a NEW reading, which is what taking a second
 * blood pressure actually is.
 */
interface InlineVitalsRowProps {
  visitId: string;
  /** Hidden entirely on a signed/locked note. */
  readOnly?: boolean;
  /** Opens the full Vitals & Observations panel. */
  onOpenFull?: () => void;
}

export function InlineVitalsRow({ visitId, readOnly, onOpenFull }: InlineVitalsRowProps) {
  const { data: latest } = useLatestObservation(visitId);
  const record = useRecordObservation(visitId);

  const [values, setValues] = useState<VitalsFormValues>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // What the SERVER holds, as a comparable key. Autosave measures against
  // this rather than a dirty flag, so re-typing the same number is a no-op.
  const savedKeyRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The current values, for the timer's closure — a debounced callback
  // captured at schedule time would save whatever was typed 1.2s ago.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Seed once from the recorded reading. Deliberately keyed on the
  // observation's id, not on every fetch: a background refetch returning the
  // same row must not overwrite what the doctor is halfway through typing.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const id = latest?.id ?? null;
    if (id === seededFor.current) return;
    seededFor.current = id;
    const seeded = seedFromObservation(latest as never);
    setValues(seeded);
    savedKeyRef.current = Object.keys(seeded).length ? vitalsKey(seeded) : null;
  }, [latest]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = async () => {
    const current = valuesRef.current;
    if (!shouldSaveVitals(current, savedKeyRef.current)) return;
    try {
      await record.mutateAsync(inlineVitalsPayload(current) as never);
      savedKeyRef.current = vitalsKey(current);
      setSavedAt(new Date());
    } catch (error) {
      // Said out loud, and the typed values are LEFT IN THE INPUTS. A strip
      // that clears itself on a failed save loses a reading the doctor has
      // already taken off the patient.
      message.error(
        error instanceof ApiError ? error.message : 'Vitals could not be saved. Your values are still here.',
      );
    }
  };

  const change = (field: string, value: number | null) => {
    setValues((current) => ({ ...current, [field]: value ?? undefined }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), VITALS_AUTOSAVE_MS);
  };

  const badge = useMemo(() => bmiBadge(values), [values]);

  if (readOnly) return null;

  return (
    <div className="kw-inline-vitals" data-testid="inline-vitals">
      {INLINE_VITALS.map((vital) => (
        <label key={vital.field} className="kw-iv-cell">
          <span className="kw-iv-label">{vital.label}</span>
          <span className="kw-iv-inputs">
            <InputNumber
              size="small"
              controls={false}
              step={vital.step}
              min={0}
              aria-label={vital.label}
              value={values[vital.field] as number | undefined}
              onChange={(v) => change(vital.field, v as number | null)}
              onBlur={() => void commit()}
              className="kw-iv-input"
            />
            {/* Blood pressure is one reading in two boxes, and it reads as
                one: the separator sits between them rather than each half
                carrying its own label. */}
            {vital.pairedWith && (
              <>
                <span className="kw-iv-sep">/</span>
                <InputNumber
                  size="small"
                  controls={false}
                  min={0}
                  aria-label="BP diastolic"
                  value={values[vital.pairedWith] as number | undefined}
                  onChange={(v) => change(vital.pairedWith!, v as number | null)}
                  onBlur={() => void commit()}
                  className="kw-iv-input"
                />
              </>
            )}
            {vital.unit && <span className="kw-iv-unit">{vital.unit}</span>}
          </span>
        </label>
      ))}

      {/* BMI is DERIVED and says so — it has no input, and it never carries a
          category. "Overweight" is wrong against a child, a pregnant patient
          and an amputee alike, and this strip knows about none of them. */}
      <Tooltip title={badge.hint ?? 'Calculated from weight and height'}>
        <div
          className={`kw-iv-cell kw-iv-bmi${badge.computed ? ' kw-iv-bmi-on' : ''}`}
          data-testid="inline-bmi"
        >
          <span className="kw-iv-label">BMI</span>
          <span className="kw-iv-bmi-value">{badge.value}</span>
        </div>
      </Tooltip>

      <div className="kw-iv-tail">
        {record.isPending ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Saving…
          </Text>
        ) : savedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }} role="status" data-testid="vitals-saved">
            Saved {formatClinicTime(savedAt)}
          </Text>
        ) : null}
        {onOpenFull && (
          <button type="button" className="kw-iv-more" onClick={onOpenFull}>
            More…
          </button>
        )}
      </div>
    </div>
  );
}
