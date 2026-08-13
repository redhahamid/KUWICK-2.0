import { useCallback, useRef, useState } from 'react';
import { KuwickSearchOption, KuwickSearchSelect } from '../../design-system/kuwick';
import { apiClient } from '../../core/api-client';
import { Item } from '../../inventory/types';
import { medicineSearchDetail } from './prescribing';

/**
 * b1 — SEARCH-FIRST PRESCRIBING (spec p.2).
 *
 * The rail's prescribing affordance was a button called "Add Medication", so
 * every prescription began with a click that did nothing except reveal a search
 * box. The box is the thing; the button was a door in front of it. This is that
 * box, always visible in the rail, and typing is the first act.
 *
 * It does not prescribe. Choosing a result opens the pre-filled form, where the
 * dose, frequency, quantity and duration are still deliberate decisions — what
 * has been removed is the click in front of the search, not the thinking.
 *
 * The full `Item` is handed up, not just its id. The form needs the price, the
 * stock and the dosing type in order to open with the drug locked as its title,
 * and the row the doctor just read already carried all three — fetching them
 * again would be a second request for something the browser has in hand.
 */
interface MedicineSearchBoxProps {
  onPick: (item: Item) => void;
  /** Cleared and refocused by the parent after "Add & Add Another". */
  focusSignal?: number;
  disabled?: boolean;
}

export function MedicineSearchBox({ onPick, focusSignal = 0, disabled }: MedicineSearchBoxProps) {
  // The results of the last search, by id. `onSelect` hands back the option,
  // and an option is a label and a detail string — not the medicine.
  const found = useRef(new Map<string, Item>());
  // Remounting the field is how it clears itself and takes focus after a
  // medicine is chosen: a search box that still holds the last drug's name
  // reads as though that drug is selected.
  const [instance, setInstance] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (term: string): Promise<KuwickSearchOption[]> => {
    const items = await apiClient.get<Item[]>(
      `/items?activeOnly=true&take=20&search=${encodeURIComponent(term)}`,
    );
    found.current = new Map(items.map((item) => [item.id, item]));
    return items.map((item) => ({
      value: item.id,
      label: item.code ? `${item.code} — ${item.name}` : item.name,
      detail: medicineSearchDetail(item),
    }));
  }, []);

  return (
    <div ref={wrapRef} className="kw-medicine-search" data-medicine-search="true">
      <KuwickSearchSelect
        // Two reasons to remount: a medicine was picked (clear the box), and
        // the parent asked for focus back after Add & Add Another.
        key={`${instance}-${focusSignal}`}
        id="kw-medicine-search"
        ariaLabel="Add medicine"
        // The spec's own wording. The magnifier is in the placeholder rather
        // than as an adornment so the box reads as a search at a glance on a
        // rail that is otherwise buttons and rows.
        placeholder="🔍 add medicine…"
        disabled={disabled}
        autoFocus={focusSignal > 0}
        onSearch={search}
        onSelect={(value) => {
          const item = found.current.get(value);
          if (!item) return;
          setInstance((n) => n + 1);
          onPick(item);
        }}
        emptyHint="Type a name, code or group — e.g. amox, PCM500, batuk."
      />
    </div>
  );
}
