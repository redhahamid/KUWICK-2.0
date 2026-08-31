import { describe, expect, it } from 'vitest';
import { canChargeToPatient, canRecordOutcome, canReclaim, canWriteOff } from './claimActions';

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

describe('canChargeToPatient', () => {
  const base = { status: 'REJECTED' as const, rejectedAmount: 48, chargedToPatient: null };

  it('offers the route only where the panel actually refused something', () => {
    expect(canChargeToPatient(base)).toBe(true);
    expect(canChargeToPatient({ ...base, rejectedAmount: 0 })).toBe(false);
    expect(canChargeToPatient({ ...base, rejectedAmount: null })).toBe(false);
  });

  it('is not offered on a claim the panel has not refused', () => {
    expect(canChargeToPatient({ ...base, status: 'SUBMITTED' })).toBe(false);
    expect(canChargeToPatient({ ...base, status: 'PAID' })).toBe(false);
    expect(canChargeToPatient({ ...base, status: 'WRITTEN_OFF' })).toBe(false);
  });

  it('is offered on every state where a rejection is still open', () => {
    expect(canChargeToPatient({ ...base, status: 'PARTIALLY_APPROVED' })).toBe(true);
    expect(canChargeToPatient({ ...base, status: 'RESUBMISSION_REQUIRED' })).toBe(true);
  });

  it('refuses a second charge — the same rejection cannot be billed twice', () => {
    expect(canChargeToPatient({ ...base, chargedToPatient: 48 })).toBe(false);
  });
});
