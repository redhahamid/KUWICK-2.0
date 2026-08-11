/**
 * KW2-Q3 — reading the clinic's own exports.
 *
 * These are real spreadsheets with real conventions: names prefixed "##***"
 * to sort them to the top of somebody's list, "(CASH ONLY)" written into the
 * name because there was nowhere else to put it, packaging described as
 * "10 BIJI / STRIP" or "PLASTIC/6 SACHET" or just "-".
 *
 * THE RULE THROUGHOUT IS PRESERVE, THEN PRESENT. Every value that gets
 * cleaned for display keeps its original beside it. A clinic that cannot find
 * a medicine by the name it has always used will stop trusting the search,
 * and a "tidied" export is one nobody can reconcile against their own records.
 *
 * NOTHING IS INVENTED. Where the source does not say, the field is null —
 * never a plausible default. That matters most for dosing: the export carries
 * no dose data at all, so every imported medicine arrives with empty defaults
 * rather than a dose somebody guessed for a real drug.
 */

/** Sort-order junk the clinic prefixes to float items up a list. */
const NAME_NOISE = /^[#*\s]+/;

/** Written into the name because the old system had nowhere else for it. */
const CASH_ONLY = /\(\s*CASH\s*ONLY\s*\)/i;

export interface ParsedMedication {
  externalRef: string;
  /** Cleaned for display. */
  name: string;
  /** Exactly as exported. */
  sourceName: string;
  category: string;
  groupTag: string | null;
  cashOnly: boolean;
  cost: number | null;
  sellPrice: number;
  stockBalance: number;
  packDescription: string | null;
  unitsPerPack: number | null;
  earliestExpiry: Date | null;
  active: boolean;
}

/**
 * Strip the sort-order prefix and nothing else.
 *
 * "(CASH ONLY)" is deliberately LEFT IN the display name as well as being
 * flagged. It is a real commercial condition the counter needs to see at the
 * moment of prescribing, and moving it into a boolean the form might not
 * render would quietly lose it.
 */
export function cleanMedicationName(raw: string): string {
  return raw.replace(NAME_NOISE, '').replace(/\s{2,}/g, ' ').trim();
}

export function isCashOnly(raw: string): boolean {
  return CASH_ONLY.test(raw);
}

/**
 * The leading count in a packaging string, where there is one.
 *
 * "10 BIJI / STRIP" → 10. "7 SHEETS / PACK" → 7. "6 PATCH/BOX" → 6.
 * "Box", "BOTTLE", "-", "PLASTIC/6 SACHET" → null.
 *
 * The last one is the interesting case: the 6 is not the LEADING number, and
 * reading it as units-per-pack would be a guess about which of "plastic" and
 * "sachet" is the pack. The spec says parse the leading number where possible
 * and do not normalise the rest, so it does not.
 */
export function parseUnitsPerPack(packDescription: string | null | undefined): number | null {
  if (!packDescription) return null;
  const match = /^\s*(\d+)\s*[^\d]/.exec(packDescription);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "01/06/2029" — day-first, as the export writes it. */
export function parseExpiry(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Rejects 31/02: the Date would roll into March and silently record an
  // expiry the clinic never wrote.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

/** Money as exported. Blank means "not stated", which is not zero. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Stock, floored at zero.
 *
 * The export contains -1 in a couple of rows. A negative stock balance is a
 * counting error in the source, not a fact about the shelf, and seeding it
 * would make every downstream sum wrong. Floored and preserved as zero rather
 * than dropped, so the item still exists to be prescribed.
 */
export function parseStock(raw: string | null | undefined): number {
  const value = Number(String(raw ?? '').trim());
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

export function parseMedicationRow(row: Record<string, string>): ParsedMedication | null {
  const externalRef = row.id?.trim();
  const sourceName = row.name?.trim();
  if (!externalRef || !sourceName) return null;

  const sellPrice = parseMoney(row.price_to_patient);
  // A medicine with no price to the patient cannot be prescribed onto an
  // invoice. Imported anyway at 0 would silently give it away.
  if (sellPrice === null) return null;

  const packDescription = row.stock_unit?.trim() || null;

  return {
    externalRef,
    name: cleanMedicationName(sourceName),
    sourceName,
    // Medication / Vaccine / Item, straight from the source.
    category: row.category?.trim() || 'Medication',
    groupTag: row.group?.trim() || null,
    cashOnly: isCashOnly(sourceName),
    cost: parseMoney(row.cost_price),
    sellPrice,
    stockBalance: parseStock(row.stock_balance),
    packDescription,
    unitsPerPack: parseUnitsPerPack(packDescription),
    earliestExpiry: parseExpiry(row.earliest_expiry),
    // Inactive rows are imported and hidden from the prescribing search
    // rather than skipped: they still appear in Settings, and a visit from
    // before they were retired still has to render their name.
    active: (row.status?.trim() || 'Active').toLowerCase() === 'active',
  };
}

export interface ParsedDiagnosis {
  icd10Code: string;
  name: string;
  shortform: string | null;
}

export function parseDiagnosisRow(row: Record<string, string>): ParsedDiagnosis | null {
  const icd10Code = row.icd10_code?.trim();
  const name = row.name?.trim();
  if (!icd10Code || !name) return null;
  return { icd10Code, name, shortform: row.shortform?.trim() || null };
}

/**
 * A CSV reader that handles the one thing this data actually needs: quoted
 * fields containing commas ("ANTI RADANG, ANTIFUNGAL").
 *
 * Deliberately not a dependency. The format here is narrow and known, and a
 * parser whose behaviour is visible is worth more than one whose edge cases
 * have to be looked up.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, index) => {
        record[key.trim()] = cells[index] ?? '';
      });
      return record;
    });
}
