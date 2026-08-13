import { useEffect, useRef, useState } from 'react';
import { AutoComplete, Button, Space, message } from 'antd';
import { useDiagnosisCatalogSearch } from '../hooks/useDiagnoses';
import { DiagnosisCatalogEntry, DiagnosisCategory } from '../types';

/** Matches the shared search field used across the clinical surfaces. */
export const DIAGNOSIS_SEARCH_DEBOUNCE_MS = 250;

/**
 * G4.5d6 — search-and-add for a diagnosis, in ONE place.
 *
 * The same control was written out three times (the right rail, the expanded
 * section and the dashboard tab) and carried the same three defects in each
 * copy. UAT reported it as "the ICD-10 search doesn't work"; it was actually
 * three separate faults sitting on top of each other:
 *
 *   1. THE SEARCH ITSELF. The server matches the code as well as the name,
 *      but antd then filtered those results again on the client against the
 *      option's `value` — the name. Typing "J06.9" fetched the right entry
 *      and discarded it before drawing it. `filterOption={false}` hands the
 *      filtering back to the server, which is the only side that can do it.
 *   2. ENTER ADDED TWICE. antd's `onSelect` fires when Enter lands on a
 *      highlighted suggestion; the `onKeyDown` handler then added the raw
 *      typed text as well, so choosing from the list put the diagnosis on
 *      the visit twice.
 *   3. A TYPED CODE BECAME FREE TEXT. Only exact NAME matches resolved to a
 *      catalog entry, so a doctor who typed the code and pressed Enter
 *      created a custom diagnosis literally named "J06.9", with no ICD-10
 *      code on it — invisible to anything that groups by code.
 *
 * Free text is still allowed, deliberately: a diagnosis that is genuinely not
 * in the catalog must be recordable. What is not allowed is free text that
 * LOOKS like a catalogued one.
 *
 * It stays inline. This is not a modal and must not become one (owner
 * direction): the doctor types, arrows, presses Enter, and never leaves the
 * record they are reading.
 */
export interface DiagnosisSearchFieldProps {
  /**
   * Narrow the search to one catalogue category. OPTIONAL, and omitted means
   * "the clinic's whole active catalogue" — the rail used to hardcode
   * SUMMARIZE with no way to change it, so a catalogue tagged anything else
   * was invisible to the doctor with no symptom but silence.
   */
  category?: DiagnosisCategory;
  /** Resolve to a catalog entry where possible, else add as free text. */
  onAdd: (value: string, entryId?: string) => Promise<void> | void;
  adding?: boolean;
  placeholder?: string;
  /** The rail is narrow; the expanded section is not. */
  width?: number | string;
  compact?: boolean;
}

/** Resolve typed text to a catalog entry by exact name OR exact ICD-10 code. */
export function resolveCatalogEntry(
  typed: string,
  results: DiagnosisCatalogEntry[] | undefined,
): string | undefined {
  const needle = typed.trim().toLowerCase();
  if (!needle || !results) return undefined;
  return (
    results.find((entry) => entry.name.toLowerCase() === needle)?.id ??
    results.find((entry) => entry.icd10Code?.toLowerCase() === needle)?.id
  );
}

/** "J06.9 — Acute upper respiratory infection", or just the name. */
export function catalogOptionLabel(entry: DiagnosisCatalogEntry): string {
  return entry.icd10Code ? `${entry.icd10Code} — ${entry.name}` : entry.name;
}

/**
 * Does this text read as an ICD-10 code rather than a diagnosis name?
 *
 * A letter, two digits, and optionally a dot and more — "J06.9", "J069",
 * "E11", "M54.5". Used to REFUSE a free-text add, not to invent a code: if a
 * doctor types a code that resolves to nothing, the honest answer is that the
 * code was not found, not a custom diagnosis named "J06.9" with no code on it
 * that no report can ever group.
 */
export function looksLikeIcd10(text: string): boolean {
  return /^[A-Za-z]\d{2}(\.?\d{1,4})?$/.test(text.trim());
}

export function DiagnosisSearchField({
  category,
  onAdd,
  adding,
  placeholder = 'Search by diagnosis name or ICD-10 code…',
  width = '100%',
  compact,
}: DiagnosisSearchFieldProps) {
  const [search, setSearch] = useState('');
  // Debounced so typing a diagnosis name is one request, not one per letter.
  const [term, setTerm] = useState('');
  const { data: catalogResults, isFetching, isError } = useDiagnosisCatalogSearch(term, category);
  // Set by onSelect so the Enter that CHOSE a suggestion is not also read as
  // an Enter that adds the raw typed text.
  const selected = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => setTerm(search), DIAGNOSIS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const submit = async (value: string, entryId?: string) => {
    const typed = value.trim();
    if (!typed) return;
    const resolved = entryId ?? resolveCatalogEntry(typed, catalogResults);
    if (!resolved && looksLikeIcd10(typed)) {
      // Refusing here is the point. Adding it as free text is what produced
      // visit rows named "J06.9" carrying no ICD-10 code at all.
      message.warning(
        `No diagnosis found for code ${typed.toUpperCase()}. Choose one from the list, or type the diagnosis name.`,
      );
      return;
    }
    await onAdd(typed, resolved);
    setSearch('');
    setTerm('');
  };

  const field = (
    <AutoComplete
      style={{ width }}
      value={search}
      onChange={setSearch}
      aria-label="Search diagnosis"
      filterOption={false}
      onSelect={(value: string, option) => {
        selected.current = true;
        void submit(value, (option as { entryId?: string }).entryId);
      }}
      options={catalogResults?.map((entry) => ({
        value: entry.name,
        entryId: entry.id,
        label: catalogOptionLabel(entry),
      }))}
      placeholder={placeholder}
      /* NEVER fail silently. An empty dropdown is indistinguishable from a
         broken one, and that ambiguity cost a full owner review: the whole
         catalogue was invisible and the box simply did nothing. Each state
         now says which one it is. */
      notFoundContent={
        !term.trim()
          ? null
          : isFetching
            ? 'Searching…'
            : isError
              ? 'Diagnosis search is unavailable — the catalogue could not be reached.'
              : `No diagnosis matches “${term.trim()}”. Press Enter to record it as free text.`
      }
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !search.trim()) return;
        if (selected.current) {
          selected.current = false;
          return;
        }
        void submit(search);
      }}
    />
  );

  const button = (
    <Button type="primary" loading={adding} onClick={() => void submit(search)}>
      Add
    </Button>
  );

  return compact ? (
    <Space.Compact style={{ width: '100%' }}>
      {field}
      {button}
    </Space.Compact>
  ) : (
    <Space wrap size={8}>
      {field}
      {button}
    </Space>
  );
}
