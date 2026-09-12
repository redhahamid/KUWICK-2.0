/**
 * INITIALS FOR AN AVATAR — the name, not the title.
 *
 * "Dr Aisyah Rahman" is AR: the honorific is a note about the person, not
 * part of what they are called, and a directory of doctors where every
 * avatar reads "D…" says nothing. A parenthetical — "(Locum)" — is dropped
 * for the same reason.
 */
const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'puan', 'encik', 'cik', 'tuan', 'dato', "dato'", 'datuk', 'datin', 'prof', 'prof.', 'hj', 'hjh', 'haji', 'hajah']);

export function initialsOf(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && HONORIFICS.has(word.toLowerCase())));
  const parts = words.length > 0 ? words : name.split(/\s+/).filter(Boolean);
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}
