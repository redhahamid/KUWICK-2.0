import { CreateItemDto, DurationUnit, Item } from './types';

/**
 * PHASE 1G (1F) — moving a medicine's standard prescription between the form
 * and the API.
 *
 * Small, and separate from the screen, because of one asymmetry that is easy to
 * get wrong and impossible to see: `JSON.stringify` DROPS keys whose value is
 * `undefined`. antd's `allowClear` hands back `undefined` when a doctor clears a
 * dropdown, so a cleared field would leave the browser as "field not sent" — and
 * "not sent" means "leave it alone" to the API. The default the doctor deleted
 * would still be there next time they opened the form, and nothing would have
 * reported a failure.
 *
 * So: for these fields only, an empty box is sent as an explicit `null`.
 */

export const STANDARD_PRESCRIPTION_KEYS = [
  'defaultDoseAmount',
  'defaultDoseUnitId',
  'defaultFrequencyId',
  'defaultDurationValue',
  'defaultDurationUnit',
  'defaultQuantity',
  'defaultConsumptionMethodId',
] as const;

/**
 * PIECE 2 — the same trap, one section down, and it costs money rather than a
 * dose.
 *
 * `stockUnitId` and `quantityPerStockUnit` are cleared through exactly the same
 * antd `allowClear`, so a clinic withdrawing a divisor they are no longer sure
 * of would see "saved" and the old number would still be dividing their
 * dispense quantities. The whole point of the NEEDS ATTENTION worklist is that
 * a divisor nobody has confirmed is visible; a divisor that cannot be
 * withdrawn is worse than one that was never set.
 *
 * `dispensedWhole` is NOT in this list: it is a boolean the form always sends,
 * and `false` is the withdrawal.
 */
export const COUNTING_KEYS = ['stockUnitId', 'quantityPerStockUnit'] as const;

export type StandardPrescriptionValues = {
  defaultDoseAmount?: number | null;
  defaultDoseUnitId?: string | null;
  defaultFrequencyId?: string | null;
  defaultDurationValue?: number | null;
  defaultDurationUnit?: DurationUnit | null;
  defaultQuantity?: number | null;
  defaultConsumptionMethodId?: string | null;
};

/**
 * What the form should open with for an existing medicine.
 *
 * `defaultDoseAmount` arrives as a string because it is a database decimal —
 * `2.50`, not `2.5` — and an antd `InputNumber` given a string shows it but
 * will not increment it.
 */
export function standardPrescriptionValues(item: Item): StandardPrescriptionValues {
  return {
    defaultDoseAmount: item.defaultDoseAmount == null ? null : Number(item.defaultDoseAmount),
    defaultDoseUnitId: item.defaultDoseUnitId ?? null,
    defaultFrequencyId: item.defaultFrequencyId ?? null,
    defaultDurationValue: item.defaultDurationValue ?? null,
    defaultDurationUnit: item.defaultDurationUnit ?? null,
    defaultQuantity: item.defaultQuantity ?? null,
    defaultConsumptionMethodId: item.defaultConsumptionMethodId ?? null,
  };
}

/**
 * The values on their way out, with every empty box made an explicit `null`.
 *
 * Everything OUTSIDE the seven keys is passed through untouched — the rest of
 * the medicine form has always relied on `undefined` meaning "don't change
 * this", and changing that here would turn a partial edit into a wipe.
 */
export function withClearedDefaults(values: CreateItemDto): CreateItemDto {
  const payload: Record<string, unknown> = { ...values };
  for (const key of [...STANDARD_PRESCRIPTION_KEYS, ...COUNTING_KEYS]) {
    // Empty string is what an emptied InputNumber can hand back in some antd
    // versions; treat it the same as cleared rather than sending "".
    if (payload[key] === undefined || payload[key] === '') {
      payload[key] = null;
    }
  }
  return payload as unknown as CreateItemDto;
}

/**
 * Auto-compute the quantity to dispense, or decline to.
 *
 * `null` means "cannot be computed", and it is a real answer rather than a
 * failure: a PRN or STAT frequency has no doses-per-day, so multiplying it out
 * would produce a quantity nobody decided. The caller must leave the box alone
 * when this returns null — never fall back to 1.
 */
export function computeQuantity(input: {
  doseAmount?: number | null;
  timesPerDay?: number | null;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
}): number | null {
  const { doseAmount, timesPerDay, durationValue, durationUnit } = input;
  if (!doseAmount || !timesPerDay || !durationValue || !durationUnit) return null;
  const days = durationValue * DAYS_PER_UNIT[durationUnit];
  const quantity = doseAmount * timesPerDay * days;
  // A part-tablet dose still has to be dispensed as whole units off the shelf,
  // and rounding DOWN would hand the patient a short course.
  return Math.ceil(quantity);
}

const DAYS_PER_UNIT: Record<DurationUnit, number> = { DAY: 1, WEEK: 7, MONTH: 30 };
