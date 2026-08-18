import { DivisorAttention, DivisorSource, divisorFacts } from './dispensing-divisor';

/**
 * THE INVENTORY LIST'S ROW, SHAPED SERVER-SIDE.
 *
 * The screen shows a stock balance in the clinic's own packaging words, an
 * expiry, two prices and whether the row can be priced per dispense at all.
 * Every one of those is a fact about the row, and a browser that assembled
 * them itself would be a second opinion on the divisor — the one thing this
 * package exists to have exactly one of.
 *
 * Pure and separately tested: the counts in particular are the pricing
 * worklist's number, and a worklist that disagrees with its own filter is
 * worse than no worklist.
 */

export interface CatalogueSourceRow {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  active: boolean;
  sellPrice: unknown;
  cost: unknown;
  earliestExpiry: Date | null;
  quantityPerStockUnit: number | null;
  unitsPerPack: number | null;
  dispensedWholeAt: Date | null;
  packDescription: string | null;
  stockUnit: { id: string; name: string; nameMs: string | null; active: boolean } | null;
  stockLevels: Array<{ clinicId: string; quantityOnHand: number; minThreshold: number }>;
}

export interface CatalogueRow {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  active: boolean;
  /** Price to the patient. Strings, not numbers — Decimal(10,2) all the way out. */
  sellPrice: string;
  cost: string | null;
  earliestExpiry: string | null;
  /**
   * The balance, and WHOSE. Null clinicId means every branch summed, which is
   * what an owner looking at the catalogue rather than a shelf is asking for.
   */
  quantityOnHand: number;
  belowThreshold: boolean;
  /** The packaging words, both languages, for "99 Strip / Papan". */
  stockUnit: { id: string; name: string; nameMs: string | null; active: boolean } | null;
  packDescription: string | null;
  divisor: number | null;
  divisorSource: DivisorSource;
  dispensedWhole: boolean;
  attention: DivisorAttention | null;
}

export interface CatalogueCounts {
  /** Every item this clinic has, filtered by nothing. */
  items: number;
  /**
   * The pricing worklist, over ACTIVE items only and deliberately: a
   * deactivated item cannot be dispensed, so it is not outstanding work. It is
   * also NOT narrowed by the search box or the category tab — this is the
   * clinic's total, the number that answers "how much curation is left", and a
   * count that shrank when somebody typed in the search field would answer a
   * question nobody asked.
   */
  needsAttention: number;
}

export interface CatalogueCategory {
  /** Null for a name that is on items but not in the registry — nothing to
   *  rename or delete until somebody adopts it. */
  id: string | null;
  name: string;
  /** How many items carry this name. Zero is legal — a section not yet filled. */
  count: number;
  /**
   * False for a name that is on items but not in the registry — an imported
   * string nobody has adopted. Shown anyway: an in-use category nobody can see
   * is worse than an untidy list.
   */
  registered: boolean;
}

export function catalogueRow(row: CatalogueSourceRow, clinicId?: string): CatalogueRow {
  const facts = divisorFacts(row);
  const levels = clinicId ? row.stockLevels.filter((l) => l.clinicId === clinicId) : row.stockLevels;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    active: row.active,
    sellPrice: String(row.sellPrice),
    cost: row.cost == null ? null : String(row.cost),
    earliestExpiry: row.earliestExpiry ? row.earliestExpiry.toISOString().slice(0, 10) : null,
    quantityOnHand: levels.reduce((sum, l) => sum + l.quantityOnHand, 0),
    // Any branch under its own threshold flags the row. A tenant-wide sum that
    // looks healthy while one branch has run dry is the reading that sends
    // nobody to reorder.
    belowThreshold: levels.some((l) => l.minThreshold > 0 && l.quantityOnHand <= l.minThreshold),
    stockUnit: row.stockUnit,
    packDescription: row.packDescription,
    divisor: facts.divisor,
    divisorSource: facts.source,
    dispensedWhole: facts.dispensedWhole,
    attention: facts.attention,
  };
}

export function catalogueCounts(rows: CatalogueRow[]): CatalogueCounts {
  return {
    items: rows.length,
    needsAttention: rows.filter((r) => r.active && r.attention !== null).length,
  };
}

/**
 * The tabs: the registry UNION the strings actually on items.
 *
 * Both halves are needed and for different reasons. A registered name with no
 * items is a section a clinic has named and not yet filled — dropping it would
 * make "add a category" look broken. An in-use name that was never registered
 * arrived on an imported row, and dropping THAT would hide stock.
 *
 * Sorted by the registry's own order first, then alphabetically, so a clinic
 * that has arranged its sections sees them arranged.
 */
export function catalogueCategories(
  registry: Array<{ id: string; name: string; sortOrder: number }>,
  itemCategories: Array<string | null>,
): CatalogueCategory[] {
  const counts = new Map<string, number>();
  for (const raw of itemCategories) {
    const name = raw?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const order = new Map(registry.map((r) => [r.name, r.sortOrder]));
  const ids = new Map(registry.map((r) => [r.name, r.id]));
  const names = new Set<string>([...registry.map((r) => r.name), ...counts.keys()]);

  return [...names]
    .map((name) => ({
      id: ids.get(name) ?? null,
      name,
      count: counts.get(name) ?? 0,
      registered: order.has(name),
    }))
    .sort((a, b) => {
      const byOrder = (order.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.name) ?? Number.MAX_SAFE_INTEGER);
      return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name);
    });
}
