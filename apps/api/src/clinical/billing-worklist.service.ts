import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { assertMayTouchVisit, requireActor, withReadOnlyTenantTx } from './clinical-actor';
import { BillingWorklistItem, collectBillingWorklist } from './billing-worklist';

/**
 * G4.5d3c-3b1 (D-093) — the worklist read. Any active staff member with
 * branch access may ask (the same gate as the completion-blocker read: this
 * is workflow state, not clinical content), and the transaction is read-only
 * at the database level, so the freedom from side effects is enforced.
 */
@Injectable()
export class BillingWorklistService {
  constructor(private readonly rawPrisma: PrismaService) {}

  async forVisit(visitId: string): Promise<BillingWorklistItem[]> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);
      const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { id: true } });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      return collectBillingWorklist(tx, visitId);
    });
  }
}
