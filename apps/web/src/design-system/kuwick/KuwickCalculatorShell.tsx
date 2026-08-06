import { ReactNode, useState } from 'react';
import { Alert, Button, Collapse, Typography, message } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { KuwickResultCard } from './KuwickResultCard';

const { Text } = Typography;

/**
 * G4.5d5b-1 — the shell every clinical calculator is presented in.
 *
 * A SHELL, and deliberately nothing more. It owns presentation, provenance,
 * reset and copy; it owns no arithmetic at all. Every formula stays in its own
 * pure, separately tested module (`vitalsBmi.ts`, `dosage-calculator.ts`), and
 * this checkpoint introduces no new ones — redesigning how a calculation is
 * displayed must never become an opportunity to invent one.
 *
 * Three safety properties are structural rather than conventional:
 *
 *   NOTHING IS WRITTEN ANYWHERE. There is no onApply, no note integration and
 *   no prescription hook. A calculator that can write into the record is a
 *   calculator that will eventually write the wrong thing into it, and the
 *   owner deferred "Apply to Note" to its own checkpoint. The absence of the
 *   prop is the enforcement.
 *
 *   PATIENT DATA IS BORROWED, NEVER EDITED. `onUseVisitData` copies today's
 *   recorded values INTO the calculator's own local inputs. Changing them
 *   afterwards changes the calculation and nothing else — the observation row
 *   is untouched, which is why `sourceCaption` states which reading was used
 *   and when it was taken.
 *
 *   NO RESULT WITHOUT VALID INPUT. The caller passes `null` when the inputs
 *   are incomplete or impossible, and the result card renders its empty state.
 *   NaN and Infinity are excluded upstream by the shared calculators; this
 *   component simply never has a branch that would print them.
 */
export interface KuwickCalculatorShellProps {
  /** What this calculator is called. */
  name: string;
  /** One line: what it is for. Not a definition of the formula. */
  purpose?: string;
  /** The input controls. */
  children: ReactNode;

  resultLabel: string;
  /** Already rounded and formatted by the caller. Null = not computable. */
  resultValue: string | null;
  resultUnit?: string;
  /** Approved plain-language reading. Never invented here. */
  interpretation?: ReactNode;
  /** Which patient values were used, and when they were recorded. */
  sourceCaption?: ReactNode;

  /** Formula and assumptions, collapsed by default. */
  formula?: ReactNode;
  assumptions?: ReactNode;
  /** Stated rounding, e.g. "Rounded to 1 decimal place." */
  rounding?: string;

  /** Clears the local inputs. Never touches stored data. */
  onReset: () => void;
  /**
   * Copies today's recorded values into the local inputs. Absent when the
   * visit has no reliable source — an unavailable action is better than one
   * that silently fills in nothing.
   */
  onUseVisitData?: () => void;
  useVisitDataLabel?: string;
  /** Plain text placed on the clipboard. */
  copyText?: string | null;
}

export function KuwickCalculatorShell({
  name,
  purpose,
  children,
  resultLabel,
  resultValue,
  resultUnit,
  interpretation,
  sourceCaption,
  formula,
  assumptions,
  rounding,
  onReset,
  onUseVisitData,
  useVisitDataLabel = 'Use current visit data',
  copyText,
}: KuwickCalculatorShellProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard?.writeText(copyText);
      setCopied(true);
      message.success('Result copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      message.warning('Could not copy — select the result and copy it manually.');
    }
  };

  return (
    <section className="kw-calculator" aria-label={name}>
      <header className="kw-calculator-head">
        <Text strong className="kw-calculator-name">
          {name}
        </Text>
        {purpose && (
          <Text type="secondary" className="kw-calculator-purpose">
            {purpose}
          </Text>
        )}
      </header>

      {onUseVisitData && (
        <div className="kw-calculator-source">
          <Button size="small" onClick={onUseVisitData}>
            {useVisitDataLabel}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Copies the recorded values here. Editing them changes only this calculation.
          </Text>
        </div>
      )}

      <div className="kw-calculator-inputs">{children}</div>

      <KuwickResultCard
        label={resultLabel}
        value={resultValue}
        unit={resultUnit}
        interpretation={interpretation}
        caption={sourceCaption}
      />

      {(formula || assumptions || rounding) && (
        <Collapse
          ghost
          size="small"
          className="kw-calculator-formula"
          items={[
            {
              key: 'formula',
              label: 'Formula and assumptions',
              children: (
                <div className="kw-calculator-formula-body">
                  {formula && <div className="kw-calculator-formula-text">{formula}</div>}
                  {rounding && (
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {rounding}
                    </Text>
                  )}
                  {assumptions && <div style={{ marginTop: 8 }}>{assumptions}</div>}
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Said once, here, so no individual calculator has to remember to. */}
      <Alert
        type="info"
        showIcon
        className="kw-calculator-note"
        message="This calculator does not write to the record."
        description="Nothing here is saved to the clinical note, the diagnosis, the prescription or the vitals."
      />

      <div className="kw-calculator-actions">
        <Button icon={<ReloadOutlined aria-hidden />} onClick={onReset}>
          Reset
        </Button>
        <Button
          icon={<CopyOutlined aria-hidden />}
          onClick={copy}
          disabled={!copyText}
          aria-label={`Copy the ${name} result`}
        >
          {copied ? 'Copied' : 'Copy Result'}
        </Button>
      </div>
    </section>
  );
}
