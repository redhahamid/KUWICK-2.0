import { describe, expect, it } from 'vitest';
import { Prescription } from '../types';
import { isCarriedOver, needsReview, reviewedLine } from './reviewState';

// ===========================================================================
// KW2-C2 — the three facts a carried-over medication carries, kept apart.
// ===========================================================================

const RX = (over: Partial<Prescription> = {}): Prescription =>
  ({
    id: 'rx-1',
    status: 'ORDERED',
    sourceVisitId: null,
    reviewFlag: false,
    reviewedByStaffId: null,
    reviewedAt: null,
    ...over,
  }) as Prescription;

describe('provenance', () => {
  it('a row prescribed on this visit is not carried over', () => {
    expect(isCarriedOver(RX())).toBe(false);
  });

  it('provenance SURVIVES the review — it is not the same fact', () => {
    // The tempting shortcut is to drop the "carried over" tag once the box is
    // ticked. That would erase why a dose from three months ago is on today's
    // visit, which is exactly what a later reader needs.
    const reviewed = RX({ sourceVisitId: 'visit-old', reviewFlag: false, reviewedAt: '2026-08-10T01:00:00Z' });
    expect(isCarriedOver(reviewed)).toBe(true);
    expect(needsReview(reviewed)).toBe(false);
  });

  it('an undefined sourceVisitId from an older payload is not carried over', () => {
    const legacy = RX();
    delete (legacy as { sourceVisitId?: unknown }).sourceVisitId;
    expect(isCarriedOver(legacy)).toBe(false);
  });
});

describe('awaiting review', () => {
  it('a copied row starts unreviewed', () => {
    expect(needsReview(RX({ sourceVisitId: 'visit-old', reviewFlag: true }))).toBe(true);
  });

  it('a CANCELLED row is not asked about', () => {
    // It is not going to the patient. The server's own unreviewed list
    // excludes CANCELLED too — if these two disagreed, the footer would warn
    // about a medicine the list offers no way to clear.
    expect(needsReview(RX({ sourceVisitId: 'visit-old', reviewFlag: true, status: 'CANCELLED' }))).toBe(
      false,
    );
  });

  it('a DISPENSED row still asks — it left the counter unread', () => {
    // Dispensing is deliberately NOT blocked by the flag (owner decision), so
    // a copied medicine can reach the patient before anyone re-reads it. That
    // makes the outstanding acknowledgement more worth keeping, not less.
    expect(needsReview(RX({ sourceVisitId: 'visit-old', reviewFlag: true, status: 'DISPENSED' }))).toBe(
      true,
    );
  });

  it('an undefined reviewFlag is not "awaiting" — absence is not a demand', () => {
    const legacy = RX({ sourceVisitId: 'visit-old' });
    delete (legacy as { reviewFlag?: unknown }).reviewFlag;
    expect(needsReview(legacy)).toBe(false);
  });
});

describe('attribution', () => {
  it('names the reviewer and the time', () => {
    expect(reviewedLine({ name: 'Dr Amira Rahman', at: '10 Aug 2026, 09:14' })).toBe(
      'Re-read by Dr Amira Rahman · 10 Aug 2026, 09:14',
    );
  });

  it('an unresolved name loses the name, never the time', () => {
    // A staff list that failed to load must not invent "not recorded" against
    // an acknowledgement that IS recorded, and must not swallow the fact.
    expect(reviewedLine({ name: null, at: '10 Aug 2026, 09:14' })).toBe('Re-read · 10 Aug 2026, 09:14');
  });

  it('no timestamp means no line at all', () => {
    expect(reviewedLine({ name: 'Dr Amira Rahman', at: null })).toBeNull();
  });
});
