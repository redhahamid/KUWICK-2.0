import { useCallback, useRef, useState } from 'react';
import { KuwickSearchOption, KuwickSearchSelect } from '../../design-system/kuwick';
import { apiClient } from '../../core/api-client';
import { Service } from '../types';
import { serviceSearchDetail, serviceSearchLabel } from './orderPicker';

/**
 * b2 PHASE E — SEARCH-FIRST ORDERING, TASK ORDERS ONLY.
 *
 * "+ Add Order" was a button whose only job was to reveal a picker, so every
 * order began with a click that decided nothing — the same door-in-front-of-a-
 * search that b1 removed from prescribing. This is the box, in the rail, and
 * typing is the first act.
 *
 * It asks the SERVER, which matches name, code AND category. A browser cannot
 * filter a catalogue it was never sent, and the category is exactly the field
 * the catalogue-findability guardrail exists to keep searchable: "imaging" is
 * how a doctor looks for an X-ray they cannot spell.
 *
 * The whole `Service` is handed up. The detail modal needs the price, the
 * category and the order type to open with the service locked as its title,
 * and the row just read carried all three.
 */
interface OrderSearchBoxProps {
  onPick: (service: Service) => void;
  /** Cleared and refocused by the parent after "Add & Add Another". */
  focusSignal?: number;
  disabled?: boolean;
}

export function OrderSearchBox({ onPick, focusSignal = 0, disabled }: OrderSearchBoxProps) {
  const found = useRef(new Map<string, Service>());
  const [instance, setInstance] = useState(0);

  const search = useCallback(async (term: string): Promise<KuwickSearchOption[]> => {
    const services = await apiClient.get<Service[]>(
      // TASK ORDERS ONLY, filtered by the SERVER (owner decision, 2026-08-13).
      //
      // This box briefly offered standard services too, which put a
      // consultation fee in two cards at once. The boundary is the search now:
      // procedures and investigations are ordered here, billable services are
      // added in Direct Services, and the two cards stay separate.
      //
      // Server-side rather than a filter here, because the request is BOUNDED
      // to twenty rows — trimming that page in the browser would silently
      // return three task orders and present them as the whole catalogue.
      `/services?activeOnly=true&take=20&orderType=TASK_ORDER&search=${encodeURIComponent(term)}`,
    );
    const rows = Array.isArray(services) ? services : [];
    found.current = new Map(rows.map((service) => [service.id, service]));
    return rows.map((service) => ({
      value: service.id,
      label: serviceSearchLabel(service),
      // Category, price and TASK/SERVICE — the three facts the choice turns
      // on, so it can be made in the list rather than by opening two modals.
      detail: serviceSearchDetail(service),
    }));
  }, []);

  return (
    <div className="kw-order-search" data-order-search="true">
      <KuwickSearchSelect
        key={`${instance}-${focusSignal}`}
        id="kw-order-search"
        ariaLabel="Add order or service"
        // Names what this box is FOR. "add order or service" invited exactly
        // the confusion the scoping removes.
        placeholder="🔍 search tests, imaging, procedures…"
        disabled={disabled}
        autoFocus={focusSignal > 0}
        onSearch={search}
        onSelect={(value) => {
          const service = found.current.get(value);
          if (!service) return;
          setInstance((n) => n + 1);
          onPick(service);
        }}
        emptyHint="Tests, imaging and procedures — e.g. dressing, XRAYCHEST, imaging. Billable services are added in the Direct Services card."
      />
    </div>
  );
}
