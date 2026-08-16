import { Service } from '../types';

/**
 * b2 PHASE E — what an order search result has to say.
 *
 * Pure, and separate from the box, because the row is the whole decision. A
 * doctor picking between "Wound dressing" and "Wound dressing (large)" is
 * choosing on category, price and whether somebody has to carry it out — and
 * a picker that shows only a name makes them open two modals to find out.
 */

/** The clinic's own money format. Never a bare number. */
export function priceLabel(price: string | number | null | undefined): string {
  const value = Number(price ?? 0);
  return `RM ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
}

/**
 * TASK or SERVICE, in one word.
 *
 * The distinction is the most consequential thing on the row: a TASK ORDER
 * puts work in somebody's queue and comes back with a result, a SERVICE is
 * billed and finished. Ordering the wrong one either invents work nobody does
 * or loses work everybody assumed was queued.
 */
export function orderTypeLabel(orderType: Service['orderType']): 'TASK' | 'SERVICE' {
  return orderType === 'TASK_ORDER' ? 'TASK' : 'SERVICE';
}

/** "Imaging · RM 45.00 · TASK" — the three facts, in the order they matter. */
export function serviceSearchDetail(service: Service): string {
  return [service.category, priceLabel(service.price), orderTypeLabel(service.orderType)]
    .filter(Boolean)
    .join(' · ');
}

/** "XRAYCHEST — Chest X-Ray", or just the name where the clinic set no code. */
export function serviceSearchLabel(service: Service): string {
  return service.code ? `${service.code} — ${service.name}` : service.name;
}
