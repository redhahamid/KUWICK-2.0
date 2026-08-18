/**
 * "99 Strip / Papan" — the balance in the words the shelf is counted in.
 *
 * Kuwick 1.0 prints the stock balance bilingually, and that is not decoration:
 * the person counting the shelf reads the Malay half. The platform stores the
 * unit as "TABLET PER STRIP" — the full name, because that is what makes the
 * DIVISOR unambiguous ("tablets, per strip") — but a balance is counted in
 * strips, not in tablets-per-strip. So the label is the CONTAINER, taken off
 * the end of the name.
 *
 * One derivation, applied to both languages, rather than a third column
 * holding the short form: "TABLET PER PAPAN" yields "Papan" by exactly the
 * rule that yields "Strip", and a stored short form is one more pair of
 * columns to keep in step with the ones above it.
 */

/**
 * The container the balance is counted in. "TABLET PER STRIP" → "Strip";
 * "BOTTLE" → "Bottle". A unit with no "PER" in it already IS the container.
 */
export function containerNoun(unitName: string): string {
  const parts = unitName.split(/\s+PER\s+/i);
  return titleCase(parts[parts.length - 1].trim());
}

export interface StockUnitLabelSource {
  name: string;
  nameMs: string | null;
}

/**
 * The bilingual pair, or the English alone.
 *
 * A clinic-added unit has no translation until somebody types one, and
 * "Strip / " with nothing after the slash is worse than "Strip". The half that
 * exists is shown; the missing half is not faked.
 */
export function stockUnitLabel(unit: StockUnitLabelSource | null | undefined): string | null {
  if (!unit) return null;
  const en = containerNoun(unit.name);
  const ms = unit.nameMs ? containerNoun(unit.nameMs) : null;
  return ms && ms !== en ? `${en} / ${ms}` : en;
}

/**
 * The whole cell: "99 Strip / Papan", or "99" where the item has no stock unit.
 *
 * A bare number is the honest rendering of a row nobody has assigned a unit
 * to — inventing "units" would put a word on the screen the clinic never
 * chose, on exactly the rows the NEEDS ATTENTION marker is already about.
 */
export function stockBalanceLabel(quantity: number, unit: StockUnitLabelSource | null | undefined): string {
  const label = stockUnitLabel(unit);
  return label ? `${quantity} ${label}` : String(quantity);
}

function titleCase(word: string): string {
  return word
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');
}
