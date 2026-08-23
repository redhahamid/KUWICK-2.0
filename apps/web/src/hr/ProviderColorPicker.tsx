import { Tooltip } from 'antd';
import { PROVIDER_COLORS } from '@kuwick/shared';

/**
 * THE PROVIDER'S CALENDAR COLOUR — eight swatches, and no free-form picker.
 *
 * A colour well would let a clinic pick #FFFF00 for one doctor and #FFFF01
 * for the next, and the diary's whole identity system rests on two providers
 * being distinguishable at a 3px edge. So the choice is between eight curated
 * colours, each already checked for that — and the server enforces the same
 * list (`provider-colors.ts`), because a rule that lives only in a form is a
 * rule that lives only until somebody uses the API.
 *
 * Colours already spoken for in this clinic are marked rather than disabled:
 * two doctors sharing a colour is a bad idea, not an illegal one, and a locum
 * covering a colleague's list is a reasonable time to want it.
 */
export interface ProviderColorPickerProps {
  value?: string | null;
  onChange?: (value: string) => void;
  /** Colours other providers in this clinic already hold. */
  taken?: Record<string, string>;
}

export function ProviderColorPicker({ value, onChange, taken = {} }: ProviderColorPickerProps) {
  return (
    <div className="kw-colorpick" role="radiogroup" aria-label="Calendar colour">
      {PROVIDER_COLORS.map((color) => {
        const holder = taken[color.accent];
        const selected = (value ?? '').toUpperCase() === color.accent;
        return (
          <Tooltip
            key={color.name}
            title={holder ? `${color.label} — already used by ${holder}` : color.label}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color.label}
              className="kw-colorpick-swatch"
              data-selected={selected || undefined}
              data-taken={holder ? 'true' : undefined}
              style={{ background: color.pastel, borderColor: color.accent }}
              onClick={() => onChange?.(color.accent)}
            >
              <span style={{ background: color.accent }} aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
