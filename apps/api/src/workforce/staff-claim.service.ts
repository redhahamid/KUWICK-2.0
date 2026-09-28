import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StaffClaimStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requireScope, withScopedAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import { CreateStaffClaimDto, DecideStaffClaimDto, SettleStaffClaimDto } from './dto/staff-claim.dto';
import { ClaimPolicyService } from './claim-policy.service';
import { StaffFileService } from './staff-file.service';
import { assertReceiptRule, priceClaim } from './claim-pricing';

function monthStart(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

/**
 * STAFF CLAIMS — the workflow behind a reimbursement.
 *
 * A staff claim was a number somebody typed into a payroll run. There was no
 * claim: no category, no receipt, no approver, no way to tell a reimbursement
 * from an allowance on a payslip, and nothing whatever stopping the same
 * receipt being paid through payroll in September and reimbursed by Finance in
 * October.
 *
 * THE INVARIANT THIS SERVICE EXISTS FOR: an approved claim has exactly ONE
 * payment route, chosen at approval, and can be paid exactly once. The route
 * cannot be changed once money has moved, and the link to the payroll input
 * that carries it is unique in the database — so a second materialisation is a
 * constraint violation rather than a discrepancy somebody notices in a
 * reconciliation months later.
 */
@Injectable()
export class StaffClaimService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly claimPolicies: ClaimPolicyService,
    private readonly files: StaffFileService,
  ) {}

  /**
   * THE CLAIMS QUEUE, FOR THE BRANCHES THIS ACCOUNT MANAGES.
   *
   * It checked the permission and then read every claim in the tenant, so the
   * branch filter did nothing on the Claims screen and a freshly created
   * branch with nobody in it listed other branches' staff. Scoped exactly as
   * the employee list is — `requireScope` asserts the same permission and
   * hands back the branches this account may see, refusing a requested branch
   * outside them rather than quietly returning nothing.
   *
   * Scoped through the PERSON and not through the claim's own `clinicId`:
   * that column is nullable and `create` leaves it null unless a caller
   * happens to send one, so scoping on it would hide almost every claim there
   * is. Where somebody works is a fact about them. The benefit accounts beside
   * this list were already scoped this way (`benefit.service.ts`), which is
   * why the allowance card on that screen was right while the claims under it
   * were not.
   */
  async list(params: { staffId?: string; status?: StaffClaimStatus; period?: string; clinicId?: string } = {}) {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.staffClaim.findMany({
      where: {
        staff: scope.where(params.clinicId),
        ...(params.staffId ? { staffId: params.staffId } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.period ? { payrollPeriod: new Date(`${params.period.slice(0, 7)}-01T00:00:00.000Z`) } : {}),
      },
      orderBy: [{ claimDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        staff: { select: { fullName: true } },
        submittedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
        // `filePath` is how the screen reads the receipt back (Piece 3g):
        // `/me/files/<id>`, fetched by HR through its own route.
        attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true, filePath: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId,
      staffName: row.staff.fullName,
      category: row.category,
      amountClaimed: formatCents(toCents(row.amountClaimed)),
      amountApproved: row.amountApproved === null ? null : formatCents(toCents(row.amountApproved)),
      claimDate: row.claimDate.toISOString().slice(0, 10),
      description: row.description,
      status: row.status,
      submittedBy: row.submittedBy.fullName,
      submittedByStaffId: row.submittedByStaffId,
      /** Somebody other than the claimant keyed it: HR, from a paper receipt. */
      enteredOnBehalf: row.submittedByStaffId !== row.staffId,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy?.fullName ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
      paymentRoute: row.paymentRoute,
      payoutStatus: row.payoutStatus,
      payrollPeriod: row.payrollPeriod?.toISOString().slice(0, 10) ?? null,
      financeReference: row.financeReference,
      paidAt: row.paidAt?.toISOString() ?? null,
      // What the clinic priced a journey at when it was sent (Piece 3g). The
      // rate is frozen on the claim, so a later change to the policy does not
      // rewrite what was approved.
      distanceKm: row.distanceKm === null ? null : String(row.distanceKm),
      mileageRate: row.mileageRate === null ? null : String(row.mileageRate),
      attachments: row.attachments,
      // Said in words on every row, because "where is this being paid from" is
      // the question a duplicate payment turns on.
      routeExplanation: this.routeExplanation(row),
    }));
  }

  private routeExplanation(row: {
    status: StaffClaimStatus;
    paymentRoute: string | null;
    payoutStatus: string;
    payrollPeriod: Date | null;
    financeReference: string | null;
  }): string {
    if (row.status === 'REJECTED') return 'Rejected. Nothing will be paid.';
    if (row.status === 'CANCELLED') return 'Withdrawn before a decision.';
    if (row.status !== 'APPROVED') return 'Not yet approved, so no payment route has been chosen.';
    if (row.paymentRoute === 'PAYROLL') {
      if (row.payoutStatus === 'IN_PAYROLL') {
        return `Being paid with the ${row.payrollPeriod?.toISOString().slice(0, 7) ?? 'next'} salary. It cannot also be reimbursed by Finance.`;
      }
      return 'Approved to be paid with salary. It will appear on the next payroll run for its period.';
    }
    if (row.paymentRoute === 'FINANCE') {
      return row.payoutStatus === 'PAID'
        ? `Reimbursed separately by Finance under ${row.financeReference}. It cannot also reach a payslip.`
        : 'Approved for separate reimbursement by Finance. It will never reach a payslip.';
    }
    return 'Approved, but no payment route has been recorded.';
  }

  /**
   * A CLAIM HR ENTERS FOR SOMEBODY — a paper receipt, a person with no portal
   * login. It is the same claim the portal makes: the person is somebody this
   * account may act for, mileage is priced from the kilometres at the
   * clinic's rate, a receipt is required when the policy says so, and the
   * receipt is the employee's own file (uploaded through workforce/staff-files
   * on their behalf). Who keyed it is on the row: the submitter differs from
   * the claimant, which is what "entered on behalf" means.
   */
  async create(dto: CreateStaffClaimDto) {
    return withScopedAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor, scope) => {
      const profile = await tx.employeeProfile.findFirst({
        where: { staffId: dto.staffId, staff: scope.where(null) },
        include: { staff: { select: { clinicId: true } } },
      });
      if (!profile) throw new NotFoundException('No employment record for this person.');

      const policy = await this.claimPolicies.current();
      const priced = priceClaim({ amountClaimed: dto.amountClaimed, distanceKm: dto.distanceKm }, policy);
      assertReceiptRule(policy, dto.receiptFileId);
      const receipt = dto.receiptFileId ? await this.files.claimOwn(tx, dto.staffId, dto.receiptFileId, 'RECEIPT') : null;
      const claimDate = dto.claimDate.slice(0, 10);
      const claimed = toCents(priced.amountClaimed);

      const saved = await tx.staffClaim.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: scope.assert(dto.clinicId) ?? profile.staff.clinicId ?? null,
          staffId: dto.staffId,
          category: dto.category,
          amountClaimed: priced.amountClaimed,
          distanceKm: priced.distanceKm,
          mileageRate: priced.mileageRate,
          claimDate: new Date(`${claimDate}T00:00:00.000Z`),
          description: dto.description,
          status: 'SUBMITTED',
          submittedByStaffId: actor.id,
          submittedAt: new Date(),
        },
      });
      if (receipt) {
        await tx.staffClaimAttachment.create({
          data: { tenantId: currentTenantId(), staffClaimId: saved.id, ...receipt, uploadedByStaffId: actor.id },
        });
      }

      await this.event(tx, saved.id, actor.id, {
        event: 'submitted',
        detail:
          `${dto.category} claim for ${formatCents(claimed)} on ${claimDate}` +
          `${priced.distanceKm !== null ? ` (${priced.distanceKm} km at ${priced.mileageRate})` : ''}, entered by HR`,
        toStatus: 'SUBMITTED',
      });

      await recordAudit(tx, actor, {
        action: 'staffClaim.submitted',
        entityType: 'StaffClaim',
        entityId: saved.id,
        reason: dto.description,
        after: {
          staffId: dto.staffId,
          category: dto.category,
          amountClaimed: formatCents(claimed),
          distanceKm: priced.distanceKm,
          submittedBy: 'hr',
          onBehalfOf: dto.staffId,
        },
        source: 'hr.claims',
      });

      return saved;
    });
  }

  /**
   * Approve or reject. Approval requires BOTH an amount and a route, and the
   * approver may not be the claimant — a maker-checker rule that applies here
   * whatever the payroll policy says, because a claim is somebody asking for
   * their own money back.
   */
  async decide(id: string, dto: DecideStaffClaimDto) {
    /*
     * `hr.claim.approve`, NOT `hr.payroll.approve` — split after UAT.
     *
     * Deciding somebody's RM180 dental receipt and signing off the month's
     * payroll are not the same job, and while they shared a permission a
     * clinic that wanted the first delegated had to hand over the second with
     * it. `settle` below stays on payroll: that one is money leaving through
     * Finance, which is a different act from saying yes to a receipt.
     */
    return withScopedAdminTx(this.rawPrisma, 'hr.claim.approve', async (tx, actor, scope) => {
      const claim = await tx.staffClaim.findFirst({ where: { id, staff: scope.where(null) } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'SUBMITTED') {
        throw new ConflictException(
          `This claim is ${claim.status.toLowerCase()}, not awaiting a decision. Reopening a decided claim is a ` +
            'deliberate act with its own record.',
        );
      }
      if (claim.staffId === actor.id) {
        throw new ConflictException(
          'You cannot approve your own claim. Somebody else with the payroll approval permission must decide it.',
        );
      }

      if (dto.decision === 'REJECTED') {
        const updated = await tx.staffClaim.update({
          where: { id },
          data: {
            status: 'REJECTED',
            decidedByStaffId: actor.id,
            decidedAt: new Date(),
            decisionReason: dto.reason ?? null,
            payoutStatus: 'VOID',
          },
        });
        await this.event(tx, id, actor.id, {
          event: 'rejected',
          detail: dto.reason ?? null,
          fromStatus: 'SUBMITTED',
          toStatus: 'REJECTED',
        });
        await recordAudit(tx, actor, {
          action: 'staffClaim.decided',
          entityType: 'StaffClaim',
          entityId: id,
          reason: dto.reason ?? 'Rejected',
          after: { status: 'REJECTED' },
          source: 'hr.claims',
        });
        return updated;
      }

      if (!dto.amountApproved) {
        throw new BadRequestException(
          'An approved amount is required. Defaulting it to what was claimed would make approval a rubber stamp.',
        );
      }
      if (!dto.paymentRoute) {
        throw new BadRequestException(
          'A payment route is required: PAYROLL to pay it with salary, or FINANCE to reimburse it separately. ' +
            'A claim with no route is a claim that can be paid twice.',
        );
      }

      const approved = toCents(dto.amountApproved);
      const claimed = toCents(claim.amountClaimed);
      if (approved <= 0) throw new BadRequestException('An approved amount must be more than nothing.');
      if (approved > claimed) {
        throw new BadRequestException(
          `The approved amount (${formatCents(approved)}) is more than was claimed (${formatCents(claimed)}). ` +
            'Approving more than somebody asked for is a payment, not an approval.',
        );
      }

      const updated = await tx.staffClaim.update({
        where: { id },
        data: {
          status: 'APPROVED',
          amountApproved: dto.amountApproved,
          paymentRoute: dto.paymentRoute,
          decidedByStaffId: actor.id,
          decidedAt: new Date(),
          decisionReason: dto.reason ?? null,
          // The period it will be paid in, when the route is payroll: the month
          // the expense falls in, so an August receipt lands on August's run
          // rather than on whichever run happens to be open.
          payrollPeriod: dto.paymentRoute === 'PAYROLL' ? monthStart(claim.claimDate) : null,
        },
      });

      await this.event(tx, id, actor.id, {
        event: 'approved',
        detail: `${formatCents(approved)} approved, paid via ${dto.paymentRoute}`,
        fromStatus: 'SUBMITTED',
        toStatus: 'APPROVED',
      });
      await recordAudit(tx, actor, {
        action: 'staffClaim.decided',
        entityType: 'StaffClaim',
        entityId: id,
        reason: dto.reason ?? `Approved ${formatCents(approved)} via ${dto.paymentRoute}`,
        before: { amountClaimed: formatCents(claimed) },
        after: { amountApproved: formatCents(approved), paymentRoute: dto.paymentRoute },
        source: 'hr.claims',
      });

      return updated;
    });
  }

  /**
   * Finance settled it outside payroll. Refuses a claim routed to payroll,
   * which is the other half of the no-double-payment invariant.
   */
  async settle(id: string, dto: SettleStaffClaimDto) {
    return withScopedAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor, scope) => {
      const claim = await tx.staffClaim.findFirst({ where: { id, staff: scope.where(null) } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status !== 'APPROVED') throw new ConflictException('Only an approved claim can be settled.');
      if (claim.paymentRoute !== 'FINANCE') {
        throw new ConflictException(
          'This claim is being paid with salary, so Finance must not reimburse it as well. ' +
            'That is exactly the double payment the payment route exists to prevent.',
        );
      }
      if (claim.payoutStatus === 'PAID') {
        throw new ConflictException(
          `This claim was already reimbursed${claim.financeReference ? ` under ${claim.financeReference}` : ''}.`,
        );
      }

      const updated = await tx.staffClaim.update({
        where: { id },
        data: {
          payoutStatus: 'PAID',
          financeReference: dto.financeReference,
          paidAt: dto.paidOn ? new Date(`${dto.paidOn}T00:00:00.000Z`) : new Date(),
        },
      });

      await this.event(tx, id, actor.id, {
        event: 'settled',
        detail: `Reimbursed by Finance under ${dto.financeReference}`,
      });
      await recordAudit(tx, actor, {
        action: 'staffClaim.settledByFinance',
        entityType: 'StaffClaim',
        entityId: id,
        reason: `Reimbursed under ${dto.financeReference}`,
        after: { payoutStatus: 'PAID', financeReference: dto.financeReference },
        source: 'hr.claims',
      });

      return updated;
    });
  }

  async cancel(id: string, reason: string) {
    return withScopedAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor, scope) => {
      const claim = await tx.staffClaim.findFirst({ where: { id, staff: scope.where(null) } });
      if (!claim) throw new NotFoundException('Claim not found');
      if (claim.status === 'APPROVED' && claim.payoutStatus !== 'PENDING') {
        throw new ConflictException(
          'This claim has already been routed for payment. Withdrawing it now would leave money in flight with ' +
            'nothing behind it; reverse the payment instead.',
        );
      }
      if (claim.status === 'CANCELLED') throw new ConflictException('This claim is already withdrawn.');

      const updated = await tx.staffClaim.update({
        where: { id },
        data: { status: 'CANCELLED', payoutStatus: 'VOID', decisionReason: reason },
      });
      await this.event(tx, id, actor.id, {
        event: 'cancelled',
        detail: reason,
        fromStatus: claim.status,
        toStatus: 'CANCELLED',
      });
      await recordAudit(tx, actor, {
        action: 'staffClaim.cancelled',
        entityType: 'StaffClaim',
        entityId: id,
        reason,
        after: { status: 'CANCELLED' },
        source: 'hr.claims',
      });
      return updated;
    });
  }

  /** The claim's own history, so a disputed claim does not need an audit-table search. */
  async history(id: string) {
    const { scope } = await requireScope(this.rawPrisma, 'hr.view');
    const rows = await this.prisma.staffClaimEvent.findMany({
      where: { staffClaimId: id, staffClaim: { staff: scope.where(null) } },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      event: row.event,
      detail: row.detail,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actor: row.actor.fullName,
      at: row.createdAt.toISOString(),
    }));
  }

  private async event(
    tx: AdminTx,
    staffClaimId: string,
    actorStaffId: string,
    data: { event: string; detail?: string | null; fromStatus?: StaffClaimStatus; toStatus?: StaffClaimStatus },
  ) {
    await tx.staffClaimEvent.create({
      data: {
        tenantId: currentTenantId(),
        staffClaimId,
        event: data.event,
        detail: data.detail ?? null,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus ?? null,
        actorStaffId,
      },
    });
  }
}
