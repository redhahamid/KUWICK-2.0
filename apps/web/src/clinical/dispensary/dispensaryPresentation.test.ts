import { describe, expect, it } from 'vitest';
import {
  EMPTY_BOARD_TEXT,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  VISIT_MOVED_TEXT,
  dispenseStatusPresentation,
  dispenseSummaryText,
  isDispensable,
  needsStockAcknowledgement,
  progressText,
  stockPresentation,
  waitingText,
} from './dispensaryPresentation';
import { applyFilter, matchesSearch } from './DispensaryPatientList';
import type { DispensaryRow } from '../hooks/useDispensary';

// ===========================================================================
// G4.5d5b-3 — WHAT THE DISPENSARY SAYS
//
// Every branch the workspace takes is here, tested without a DOM. The point
// is not coverage: it is that the WORDING a dispenser acts on is reviewable
// in one place. A stock chip that says "In stock" when it means "we cannot
// compare the units" is a defect with a physical consequence.
// ===========================================================================

describe('stock, said honestly', () => {
  it('1. in stock names the number available', () => {
    const stock = stockPresentation({ state: 'IN_STOCK', onHand: 42, required: 10 });
    expect(stock).toMatchObject({ tone: 'success', label: 'In stock' });
    expect(stock.detail).toBe('42 available');
  });

  it('2. low stock is attention, not error — it can still be dispensed', () => {
    expect(stockPresentation({ state: 'LOW_STOCK', onHand: 12, required: 10 }).tone).toBe('attention');
  });

  it('3. insufficient stock states BOTH numbers', () => {
    // "Insufficient stock" alone leaves the dispenser to guess whether they
    // are three short or thirty.
    const stock = stockPresentation({ state: 'INSUFFICIENT', onHand: 4, required: 30 });
    expect(stock.tone).toBe('error');
    expect(stock.detail).toBe('4 available · requires 30');
  });

  it('4. out of stock claims no quantity', () => {
    expect(stockPresentation({ state: 'OUT_OF_STOCK', onHand: 0, required: 5 })).toMatchObject({
      tone: 'error',
      label: 'Out of stock',
      detail: '0 available',
    });
  });

  it('5. an incomparable unit says so rather than inventing a number', () => {
    // There is no unit-conversion model in the product. A confident figure
    // here would be a guess a dispenser acts on.
    const stock = stockPresentation({ state: 'UNIT_UNKNOWN', onHand: null, required: 3 });
    expect(stock.tone).toBe('neutral');
    expect(stock.label).toBe('Unit needs review');
    expect(stock.detail).toMatch(/cannot be compared/);
    expect(stock.detail).not.toMatch(/\d/);
  });

  it('6. no stock wording leaks an enum', () => {
    for (const state of ['IN_STOCK', 'LOW_STOCK', 'INSUFFICIENT', 'OUT_OF_STOCK', 'UNIT_UNKNOWN'] as const) {
      const stock = stockPresentation({ state, onHand: 1, required: 1 });
      expect(`${stock.label} ${stock.detail}`).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });
});

describe('when a shortage must be acknowledged', () => {
  it('7. a shortage and an empty shelf both require it', () => {
    expect(needsStockAcknowledgement('INSUFFICIENT')).toBe(true);
    expect(needsStockAcknowledgement('OUT_OF_STOCK')).toBe(true);
  });

  it('8. a healthy or low shelf does not', () => {
    // Asking on every dispense is how an acknowledgement stops being read.
    expect(needsStockAcknowledgement('IN_STOCK')).toBe(false);
    expect(needsStockAcknowledgement('LOW_STOCK')).toBe(false);
  });

  it('9. an incomparable unit does not force an acknowledgement either', () => {
    // The dispenser is told the units cannot be compared; making them tick a
    // shortage box would assert a shortage nobody established.
    expect(needsStockAcknowledgement('UNIT_UNKNOWN')).toBe(false);
  });
});

describe('what can be dispensed', () => {
  const med = (status: string) => ({ status, stock: { state: 'IN_STOCK' as const } });

  it('10. only an ordered row', () => {
    expect(isDispensable(med('ORDERED'))).toBe(true);
  });

  it('11. never a row already dispensed — there is no partial dispensing', () => {
    expect(isDispensable(med('DISPENSED'))).toBe(false);
  });

  it('12. never a cancelled row', () => {
    expect(isDispensable(med('CANCELLED'))).toBe(false);
  });

  it('13. a shortage does not remove the ability to dispense, only the silence', () => {
    expect(isDispensable({ status: 'ORDERED', stock: { state: 'OUT_OF_STOCK' } })).toBe(true);
  });
});

describe('status wording', () => {
  it.each([
    ['DISPENSED', 'success', 'Dispensed'],
    ['CANCELLED', 'neutral', 'Cancelled'],
    ['ORDERED', 'active', 'To dispense'],
  ])('14. %s reads as %s/%s', (status, tone, label) => {
    expect(dispenseStatusPresentation(status)).toEqual({ tone, label });
  });
});

describe('progress at a glance', () => {
  it('15. a part-done visit gives both halves of the picture', () => {
    expect(progressText({ total: 5, dispensed: 2, remaining: 3 })).toBe('2 of 5 dispensed · 3 remaining');
  });

  it('16. a finished visit says so without arithmetic', () => {
    expect(progressText({ total: 3, dispensed: 3, remaining: 0 })).toBe('All 3 dispensed');
  });

  it('17. a visit with no clinic medication is not "0 of 0"', () => {
    expect(progressText({ total: 0, dispensed: 0, remaining: 0 })).toBe('No clinic medication');
  });
});

describe('how long they have waited', () => {
  const now = new Date('2026-08-06T10:00:00Z');

  it('18. minutes under an hour', () => {
    expect(waitingText('2026-08-06T09:35:00Z', now)).toBe('25m waiting');
  });

  it('19. hours and minutes beyond', () => {
    expect(waitingText('2026-08-06T08:10:00Z', now)).toBe('1h 50m waiting');
  });

  it('20. an unusable timestamp produces nothing, not a zero', () => {
    // Staff order their work by this. An invented "0m waiting" on a busy
    // board is worse than an absent one.
    expect(waitingText(null, now)).toBeNull();
    expect(waitingText('not a date', now)).toBeNull();
    expect(waitingText('2026-08-06T11:00:00Z', now)).toBeNull();
  });
});

describe('the result of a batch', () => {
  it('21. reports every category present', () => {
    expect(dispenseSummaryText({ dispensed: 2, alreadyDispensed: 1, failed: 1 })).toBe(
      '2 dispensed · 1 already dispensed · 1 failed',
    );
  });

  it('22. a clean batch mentions only what happened', () => {
    expect(dispenseSummaryText({ dispensed: 3, alreadyDispensed: 0, failed: 0 })).toBe('3 dispensed');
  });

  it('23. nothing moving is stated plainly, never as a success', () => {
    const summary = dispenseSummaryText({ dispensed: 0, alreadyDispensed: 0, failed: 0 });
    expect(summary).toBe('Nothing was dispensed');
    expect(summary).not.toMatch(/^0 dispensed/);
  });

  it('24. every outcome has a tone and words, and none is a raw enum', () => {
    for (const outcome of Object.keys(OUTCOME_LABEL)) {
      expect(OUTCOME_TONE[outcome]).toBeTruthy();
      expect(OUTCOME_LABEL[outcome]).not.toMatch(/_/);
    }
    // A shortage that was dispensed anyway is not silently a plain success.
    expect(OUTCOME_TONE.STOCK_WARNING_ACKNOWLEDGED).toBe('attention');
    expect(OUTCOME_LABEL.STOCK_WARNING_ACKNOWLEDGED).toMatch(/shortage/i);
  });

  it('25. the empty and moved-on states are written for the counter', () => {
    expect(EMPTY_BOARD_TEXT).toMatch(/No patients are waiting/);
    expect(VISIT_MOVED_TEXT).toMatch(/moved to another stage/);
  });
});

describe('finding a patient in the list', () => {
  const row = (over: Partial<DispensaryRow> = {}) =>
    ({
      visitId: 'v1',
      queueTicketId: 't1',
      displayNumber: 'A012',
      patientName: 'Siti Nurhaliza binti Ahmad',
      visitNumber: 'V-2026-0042',
      doctorName: 'Dr Amira',
      checkInAt: '2026-08-06T09:00:00Z',
      queueStatus: 'READY_FOR_DISPENSARY',
      counts: { total: 2, dispensed: 0, remaining: 2 },
      medications: [],
      unresolvedCount: 0,
      hasStockWarning: false,
      ...over,
    }) as DispensaryRow;

  it('26. an empty search matches everything', () => {
    expect(matchesSearch(row(), '')).toBe(true);
    expect(matchesSearch(row(), '   ')).toBe(true);
  });

  it('27. name, visit number and queue number are all searchable', () => {
    // The counter calls out whichever of the three it has.
    expect(matchesSearch(row(), 'nurhaliza')).toBe(true);
    expect(matchesSearch(row(), 'V-2026-0042')).toBe(true);
    expect(matchesSearch(row(), 'a012')).toBe(true);
    expect(matchesSearch(row(), 'zzz')).toBe(false);
  });

  it('28. a missing queue number does not break the search', () => {
    expect(matchesSearch(row({ displayNumber: null }), 'nurhaliza')).toBe(true);
  });

  it('29. Ready excludes anyone with a stock problem', () => {
    // "Ready" has to mean ready. A row needing a decision about the shelf is
    // not work somebody can pick up and finish.
    expect(applyFilter(row(), 'READY')).toBe(true);
    expect(applyFilter(row({ hasStockWarning: true }), 'READY')).toBe(false);
    expect(applyFilter(row({ counts: { total: 2, dispensed: 2, remaining: 0 } }), 'READY')).toBe(false);
  });

  it('30. Stock issue shows only those rows, and All shows both', () => {
    expect(applyFilter(row({ hasStockWarning: true }), 'STOCK_ISSUE')).toBe(true);
    expect(applyFilter(row(), 'STOCK_ISSUE')).toBe(false);
    expect(applyFilter(row(), 'ALL')).toBe(true);
    expect(applyFilter(row({ hasStockWarning: true }), 'ALL')).toBe(true);
  });
});
