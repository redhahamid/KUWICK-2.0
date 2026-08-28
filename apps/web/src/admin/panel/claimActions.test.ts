import { describe, expect, it } from 'vitest';
import { canRecordOutcome, canReclaim, canWriteOff } from './claimActions';

describe('which decisions a claim is open to', () => {
  describe('canReclaim', () => {
    it('offers a re-claim on the status that exists to be re-claimed', () => {
      // The defect this was written for. RESUBMISSION_REQUIRED is documented
      // as "rejected with a route back", the work-queue query returns it, and
      // the board showed it with no way to act on it.
      expect(canReclaim({ status: 'RESUBMISSION_REQUIRED' })).toBe(true);
    });

    it('offers a re-claim on a rejection and on a part-approval', () => {
      expect(canReclaim({ status: 'REJECTED' })).toBe(true);
      expect(canReclaim({ status: 'PARTIALLY_APPROVED' })).toBe(true);
    });

    it('refuses a second re-claim once one exists', () => {
      // Two replacements for one rejection is the same money claimed twice.
      expect(canReclaim({ status: 'REJECTED', replacement: { id: 'x' } })).toBe(false);
      expect(canReclaim({ status: 'RESUBMISSION_REQUIRED', replacement: { id: 'x' } })).toBe(false);
    });

    it('refuses a re-claim on a claim that has not lost anything', () => {
      for (const status of ['READY', 'BATCHED', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'PAID'] as const) {
        expect(canReclaim({ status })).toBe(false);
      }
    });

    it('refuses a re-claim on one already written off or closed', () => {
      expect(canReclaim({ status: 'WRITTEN_OFF' })).toBe(false);
      expect(canReclaim({ status: 'CLOSED' })).toBe(false);
    });
  });

  describe('canWriteOff', () => {
    it('is about money still out, not about status', () => {
      // A partially paid claim still owing something can be written off; a
      // fully paid one cannot, whatever happened on the way there.
      expect(canWriteOff({ outstanding: 57.6 })).toBe(true);
      expect(canWriteOff({ outstanding: 0 })).toBe(false);
    });
  });

  describe('canRecordOutcome', () => {
    it('records the panel answer once, and once only', () => {
      expect(canRecordOutcome({ approvedAmount: null })).toBe(true);
      // Zero approved IS an answer — the panel said no. Re-recording it would
      // overwrite an adjudication that has already been acted on.
      expect(canRecordOutcome({ approvedAmount: 0 })).toBe(false);
      expect(canRecordOutcome({ approvedAmount: 180 })).toBe(false);
    });
  });
});
