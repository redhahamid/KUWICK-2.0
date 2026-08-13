import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select, Spin, Typography } from 'antd';

const { Text } = Typography;

/**
 * G4.5d5b-1 — the search field for a clinical catalogue.
 *
 * The audit found two opposite failures and this component exists to end
 * both. `/items` and `/services` had no server bound and downloaded the whole
 * catalogue into a Select — every option in the DOM, on every render, on
 * every rail. Diagnosis search was bounded server-side but fired a request per
 * keystroke, so typing "amoxicillin" was eleven requests of which ten were
 * already stale by the time they returned.
 *
 * So: a debounce, a bound, and — the part that is usually missed — a
 * GENERATION COUNTER. Debouncing reduces the number of in-flight requests; it
 * does not stop the second-to-last one landing after the last one. Without the
 * counter, a slow response for "amox" can overwrite the results for
 * "amoxicillin" and the doctor picks from a list that does not match what they
 * typed. Every response carries the query generation it was issued for, and
 * anything that is not the current generation is dropped on arrival.
 *
 * `RESULT_CAP` is the server's page size, mirrored here only so the component
 * can say "refine your search" when it is hit. A capped list that does not say
 * it is capped teaches people the medicine is not in the system.
 */

export const SEARCH_DEBOUNCE_MS = 250;
export const RESULT_CAP = 20;
export const REFINE_MESSAGE = 'Showing the first 20 matches — keep typing to narrow the list.';

export interface KuwickSearchOption {
  value: string;
  /** The main line. */
  label: string;
  /** A quiet second line — strength, code, category. */
  detail?: string;
  disabled?: boolean;
}

export interface KuwickSearchSelectProps {
  /** Accessible name. Required: an unlabelled search field is unusable. */
  ariaLabel: string;
  placeholder?: string;
  value?: string;
  /** Called with the debounced, trimmed term. Must return at most RESULT_CAP. */
  onSearch: (term: string) => Promise<KuwickSearchOption[]>;
  onSelect: (value: string, option: KuwickSearchOption) => void;
  onClear?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Rendered when the term is empty. */
  emptyHint?: ReactNode;
  /** Minimum characters before searching. */
  minChars?: number;
  id?: string;
}

export function KuwickSearchSelect({
  ariaLabel,
  placeholder = 'Search…',
  value,
  onSearch,
  onSelect,
  onClear,
  autoFocus,
  disabled,
  emptyHint,
  minChars = 1,
  id,
}: KuwickSearchSelectProps) {
  const [options, setOptions] = useState<KuwickSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState('');

  // Monotonic. Only a response carrying the CURRENT value may render.
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      generation.current += 1;
      const mine = generation.current;

      if (trimmed.length < minChars) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await onSearch(trimmed);
        // The whole point: a slower earlier request cannot win.
        if (mine !== generation.current) return;
        setOptions(result);
      } catch {
        if (mine !== generation.current) return;
        setOptions([]);
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [minChars, onSearch],
  );

  const handleSearch = useCallback(
    (raw: string) => {
      setTerm(raw);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(raw), SEARCH_DEBOUNCE_MS);
    },
    [run],
  );

  // A pending debounce firing after unmount would setState on a dead
  // component; a repeatedly opened modal would leak one timer per open.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const capped = options.length >= RESULT_CAP;

  const notFound = useMemo(() => {
    if (loading) return <Spin size="small" style={{ margin: 8 }} />;
    if (term.trim().length < minChars) {
      return <Text type="secondary" style={{ padding: 8, display: 'block' }}>{emptyHint ?? 'Start typing to search.'}</Text>;
    }
    return <Text type="secondary" style={{ padding: 8, display: 'block' }}>No match. Check the spelling, or search by code.</Text>;
  }, [emptyHint, loading, minChars, term]);

  return (
    <div className="kw-search-select">
      <Select
        id={id}
        showSearch
        allowClear
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        // The component owns filtering; antd must not also filter the bounded
        // list the server already chose.
        filterOption={false}
        onSearch={handleSearch}
        onClear={onClear}
        onSelect={(selected: string) => {
          const option = options.find((candidate) => candidate.value === selected);
          if (option) onSelect(selected, option);
        }}
        notFoundContent={notFound}
        style={{ width: '100%' }}
        // b1 — `detail` is a VISIBLE second line, which is what this
        // component's own interface has always promised ("a quiet second line
        // — strength, code, category") and never delivered: it was folded into
        // the `title` attribute and nowhere else. A tooltip is unreachable on
        // a touch screen and invisible to anyone scanning a list, and the
        // detail is exactly what the reader is choosing between — a medicine's
        // group, its price and whether it is on the shelf.
        //
        // `optionLabelProp="text"` keeps the CLOSED field showing the plain
        // name: the rich node belongs in the dropdown, not in the input.
        optionLabelProp="text"
        options={options.map((option) => ({
          value: option.value,
          text: option.label,
          disabled: option.disabled,
          title: option.detail ? `${option.label} — ${option.detail}` : option.label,
          label: option.detail ? (
            <div className="kw-search-option">
              <span className="kw-search-option-label">{option.label}</span>
              <span className="kw-search-option-detail">{option.detail}</span>
            </div>
          ) : (
            option.label
          ),
        }))}
      />
      {capped && (
        <Text type="secondary" className="kw-search-refine" style={{ fontSize: 12 }}>
          {REFINE_MESSAGE}
        </Text>
      )}
    </div>
  );
}
