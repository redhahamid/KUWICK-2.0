/**
 * b1 — WHAT THE MEDICINE BOX ACTUALLY SEARCHES.
 *
 * Pure, and separate from the service, because "seeded is not findable" has
 * cost this project a live outage once already: the 162 diagnoses reached
 * staging and matched nothing, because the seed wrote one category and every
 * search surface queried another. A row count proved nothing. So the columns
 * the box searches are stated in one place, tested against real imported
 * shapes, and not re-derived at each call site.
 *
 * Four columns, each for a reason:
 *
 *   name        what the medicine is called here, cleaned for display.
 *   code        what it is called on the shelf label.
 *   groupTag    the clinic's OWN Malay grouping — BATUK, DEMAM, ANTIBIOTIK.
 *               This is how the counter and the doctor both think about the
 *               shelf, and it is the one the previous search did not look at:
 *               typing "batuk" found nothing at all while 229 medicines
 *               carried the tag.
 *   sourceName  the name exactly as exported, "##***" and all. Somebody who
 *               knows the spreadsheet should be able to type what they know.
 *
 * Deliberately NOT searched: `remark`, `instruction` and `indication`. They
 * are sentences, so they match far too much — "for cough" in a remark would
 * put an antihistamine under every cough search — and a prescriber picking
 * from a list they did not mean to see is a dispensing error waiting to
 * happen.
 */
export interface ItemSearchClause {
  name?: { contains: string; mode: 'insensitive' };
  code?: { contains: string; mode: 'insensitive' };
  groupTag?: { contains: string; mode: 'insensitive' };
  sourceName?: { contains: string; mode: 'insensitive' };
}

/** The columns a medicine search matches, in the order they are ranked by eye. */
export const ITEM_SEARCH_COLUMNS = ['name', 'code', 'groupTag', 'sourceName'] as const;

export function itemSearchClauses(term: string): ItemSearchClause[] {
  const contains = { contains: term, mode: 'insensitive' as const };
  return ITEM_SEARCH_COLUMNS.map((column) => ({ [column]: contains }) as ItemSearchClause);
}
