import { QueueTicketStatus } from '@prisma/client';
import { QUEUE_STAGE_ORDER, isAtProcedure, isLegacyStatus, stageOf, statusesForStage } from './queue-stage';

// ===========================================================================
// G4.5d3c-3b (D-095) — QUEUE STAGE MAPPING (owner tests 1–11 backend half).
//
// The defect this closes: the queue rendered four statuses and silently
// dropped AT_PROCEDURE, READY_FOR_DISPENSARY and READY_FOR_PAYMENT, so a
// patient the doctor had finished with vanished from the board entirely.
// ===========================================================================

describe('stage mapping', () => {
  it.each([
    ['1. WAITING', QueueTicketStatus.WAITING, 'WAITING'],
    ['2. IN_CONSULTATION', QueueTicketStatus.IN_CONSULTATION, 'CONSULTATION'],
    ['3. AT_PROCEDURE', QueueTicketStatus.AT_PROCEDURE, 'CONSULTATION'],
    ['4. READY_FOR_DISPENSARY', QueueTicketStatus.READY_FOR_DISPENSARY, 'DISPENSARY'],
    ['5. READY_FOR_PAYMENT', QueueTicketStatus.READY_FOR_PAYMENT, 'PAYMENT'],
    ['6. COMPLETED', QueueTicketStatus.COMPLETED, 'COMPLETED'],
    ['8. legacy DISPENSARY_PAYMENT', QueueTicketStatus.DISPENSARY_PAYMENT, 'PAYMENT'],
  ])('%s maps to %s', (_name, status, stage) => {
    expect(stageOf(status)).toBe(stage);
  });

  it('7. CANCELLED has no stage — it is never active work', () => {
    expect(stageOf(QueueTicketStatus.CANCELLED)).toBeNull();
  });

  it('11. EVERY status the enum defines is accounted for — none can vanish', () => {
    // The defect was a page that handled four statuses. A map missing one is
    // a patient nobody can see, so the whole enum is asserted.
    for (const status of Object.values(QueueTicketStatus)) {
      const stage = stageOf(status);
      expect(status === QueueTicketStatus.CANCELLED ? stage === null : stage !== null).toBe(true);
    }
  });

  it('3. AT_PROCEDURE is flagged so the row can say so without its own tab', () => {
    expect(isAtProcedure(QueueTicketStatus.AT_PROCEDURE)).toBe(true);
    expect(isAtProcedure(QueueTicketStatus.IN_CONSULTATION)).toBe(false);
  });

  it('8. only DISPENSARY_PAYMENT is legacy', () => {
    expect(isLegacyStatus(QueueTicketStatus.DISPENSARY_PAYMENT)).toBe(true);
    expect(isLegacyStatus(QueueTicketStatus.READY_FOR_PAYMENT)).toBe(false);
    expect(isLegacyStatus(QueueTicketStatus.READY_FOR_DISPENSARY)).toBe(false);
  });

  it('the Live Patient Flow reads Waiting → Consultation → Dispensary → Payment → Completed', () => {
    expect(QUEUE_STAGE_ORDER).toEqual(['WAITING', 'CONSULTATION', 'DISPENSARY', 'PAYMENT', 'COMPLETED']);
  });

  it('statusesForStage groups both consultation states and both payment states', () => {
    expect(statusesForStage('CONSULTATION').sort()).toEqual(['AT_PROCEDURE', 'IN_CONSULTATION']);
    expect(statusesForStage('PAYMENT').sort()).toEqual(['DISPENSARY_PAYMENT', 'READY_FOR_PAYMENT']);
    expect(statusesForStage('DISPENSARY')).toEqual(['READY_FOR_DISPENSARY']);
  });
});
