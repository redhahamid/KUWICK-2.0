/**
 * WHAT THE SERVICE / PROCEDURE BOX ACTUALLY SEARCHES.
 *
 * The third instance of one defect. The diagnosis catalogue reached staging
 * searchable only by wording nobody types; the medicine catalogue was
 * unsearchable by the Malay group 181 of 236 medicines are filed under; and
 * this catalogue searched `name` alone, so **a service could not be found by
 * its own code** — `E2E-CONSULT` returned nothing — while the two surfaces
 * that filter in the browser found it perfectly well, because their option
 * label happens to read "CODE — Name".
 *
 * That asymmetry is the point. Two surfaces onto one catalogue were broken in
 * OPPOSITE directions, so testing either one would have proved the other
 * sound. The owner's rule now reads: a catalogue is only searchable if every
 * surface queries the same source with the same fields, verified
 * independently.
 *
 * Three columns:
 *
 *   name      what the clinic calls the procedure.
 *   code      what appears on the order and the invoice — XRAYCHEST, FBC.
 *             A procedure's code is frequently the ONLY thing the person
 *             ordering it remembers.
 *   category  the clinic's own grouping: Laboratory, Imaging, Procedure,
 *             Consultation. Free text by design, because a clinic's set of
 *             categories is not known ahead of time — which is exactly why it
 *             is worth searching.
 *
 * `orderType` is deliberately NOT here: it is a filter the caller applies, not
 * a term anybody types.
 */
export interface ServiceSearchClause {
  name?: { contains: string; mode: 'insensitive' };
  code?: { contains: string; mode: 'insensitive' };
  category?: { contains: string; mode: 'insensitive' };
}

/** The columns a service search matches. One list, one place. */
export const SERVICE_SEARCH_COLUMNS = ['name', 'code', 'category'] as const;

export function serviceSearchClauses(term: string): ServiceSearchClause[] {
  const contains = { contains: term, mode: 'insensitive' as const };
  return SERVICE_SEARCH_COLUMNS.map((column) => ({ [column]: contains }) as ServiceSearchClause);
}
