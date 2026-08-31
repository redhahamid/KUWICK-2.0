import { Inject, Injectable } from '@nestjs/common';
import { ClaimLineStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from './admin-actor';
import { fromCents, toCents } from './money';
import { AgingBucket, accumulateAging, computeClaimBalance, daysBetween, emptyAging } from './financial-invariants';
import {
  FeeEvidenceState,
  feeEvidence,
  panelBillingPosition,
  panelFeeCost,
  reconcileWithholding,
  rollUpPanelFeeCost,
} from './panel-money';

/**
 * A claim line still OCCUPYING its invoice. Kept identical to
 * `clinical/claim-batch.service.ts`'s `ACTIVE_LINE_STATUSES`, because "has this
 * invoice been claimed" must mean the same thing on both sides of the join: if
 * Finance counted a rejected claim as claimed, the invoice would look claimed
 * while the panel module correctly offered it for re-claiming, and the money
 * would sit in the gap between two screens.
 */
const ACTIVE_LINE_STATUSES: ClaimLineStatus[] = [
  ClaimLineStatus.PENDING,
  ClaimLineStatus.ACCEPTED,
  ClaimLineStatus.PAID,
];

/**
 * PANEL MONEY, FROM THE FINANCE SIDE.
 *
 * The panel workspace is a work queue: it shows claims that exist. This service
 * answers the three questions a work queue structurally cannot, because each
 * one is about something that is MISSING or about money that has already left:
 *
 *   1. BILLED BUT NEVER CLAIMED. The clinic reconciles this monthly by hand,
 *      exporting the billing system and comparing it against the claim workbook
 *      (docs/PANEL_LEGACY_WORKFLOW_AUDIT.md §7). An invoice whose panel share
 *      was never claimed appears in no claim listing anywhere — it is invisible
 *      by construction, and it is real money.
 *
 *   2. WHAT THE ADMIN FEE COSTS. Established as withheld on 2026-08-31 (D-112):
 *      the clinic bills RM100 and banks RM92. That RM8 is a cost of doing panel
 *      business and appeared in no ledger.
 *
 *   3. WHAT THE PANELS ACTUALLY BANKED, and whether what they kept matches the
 *      fees we expected. A remittance is cash into the bank account; before
 *      this it was recorded only inside the panel module, so a person
 *      reconciling the bank statement in Finance found lines Kuwick could not
 *      explain.
 *
 * Every claim figure comes from `computeClaimBalance`; every classification
 * from the pure functions in `panel-money.ts`. No second formula.
 */
@Injectable()
export class PanelMoneyService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * THE POSITION: billed, claimed, banked, and what the fee cost.
   *
   * `from`/`to` bound the INVOICE date, not the claim date — the question is
   * "of what we billed panels in August, how much did we claim", and dating it
   * by the claim would make an unclaimed invoice fall outside its own period.
   * Remittances and fee costs are dated by their own events and reported
   * against the same window.
   */
  async position(params: { from?: string; to?: string; clinicId?: string; panelClinicId?: string } = {}) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = params.from ? new Date(`${params.from}T00:00:00.000Z`) : undefined;
    const to = params.to ? new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86_400_000) : undefined;
    const asOf = new Date();

    // --- Side 1: what was BILLED to panels, and what was claimed against it ---
    //
    // PAID invoices only, and that is not a filter of convenience: an invoice
    // becomes claimable at settlement, when `panelCoveredAmount` is snapshotted
    // (clinical/invoice.service.ts). An unsettled invoice has no claimable
    // figure yet, so counting it as "billed but unclaimed" would report as
    // missing money that is not yet askable.
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        panelCoveredAmount: { gt: 0 },
        ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        ...(clinicId ? { visit: { clinicId } } : {}),
        ...(params.panelClinicId ? { visit: { panelClinicId: params.panelClinicId } } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        paidAt: true,
        createdAt: true,
        panelCoveredAmount: true,
        visit: {
          select: {
            visitNumber: true,
            clinic: { select: { name: true } },
            panelClinic: { select: { id: true, name: true } },
          },
        },
        claimBatchLines: {
          select: { claimedAmount: true, status: true, claimStatus: true },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    const unclaimedAging: Record<AgingBucket, number> = emptyAging();
    const unclaimedRows: Array<{
      invoiceId: string;
      invoiceNumber: string;
      visitNumber: string | null;
      clinicName: string | null;
      panelClinicId: string | null;
      panelName: string | null;
      settledAt: string | null;
      billed: number;
      claimed: number;
      unclaimed: number;
      state: string;
      ageDays: number;
    }> = [];

    let billedCents = 0;
    let claimedAgainstBillingCents = 0;
    let unclaimedCents = 0;
    let overClaimedCents = 0;
    let unclaimedInvoices = 0;
    let overClaimedInvoices = 0;

    const byPanel = new Map<
      string,
      {
        name: string;
        billedCents: number;
        claimedCents: number;
        unclaimedCents: number;
        unclaimedInvoices: number;
        bankedCents: number;
        withheldCents: number;
        feeBorneCents: number;
        feeExpectedCents: number;
      }
    >();
    const bucketFor = (id: string | null, name: string | null) => {
      const key = id ?? 'UNASSIGNED';
      const bucket = byPanel.get(key) ?? {
        name: name ?? 'No panel on the visit',
        billedCents: 0,
        claimedCents: 0,
        unclaimedCents: 0,
        unclaimedInvoices: 0,
        bankedCents: 0,
        withheldCents: 0,
        feeBorneCents: 0,
        feeExpectedCents: 0,
      };
      byPanel.set(key, bucket);
      return bucket;
    };

    for (const invoice of invoices) {
      const active = invoice.claimBatchLines.filter((line) => ACTIVE_LINE_STATUSES.includes(line.status));
      const activeClaimedCents = active.reduce((total, line) => total + toCents(line.claimedAmount), 0);
      const position = panelBillingPosition({
        panelCoveredAmount: invoice.panelCoveredAmount,
        activeClaimedAmount: fromCents(activeClaimedCents),
      });

      billedCents += position.billedCents;
      claimedAgainstBillingCents += position.claimedCents;
      unclaimedCents += position.unclaimedCents;
      overClaimedCents += position.overClaimedCents;

      const panel = invoice.visit?.panelClinic ?? null;
      const bucket = bucketFor(panel?.id ?? null, panel?.name ?? null);
      bucket.billedCents += position.billedCents;
      bucket.claimedCents += position.claimedCents;
      bucket.unclaimedCents += position.unclaimedCents;

      if (position.overClaimedCents > 0) overClaimedInvoices += 1;
      if (position.unclaimedCents > 0) {
        unclaimedInvoices += 1;
        bucket.unclaimedInvoices += 1;
        // Aged from SETTLEMENT — the moment the money became claimable. Kuwick
        // does NOT invent a submission deadline here: no panel in the workbook
        // states one, and the two-month rule in the register is about
        // RE-claiming a rejection. The age is reported; the judgement is the
        // owner's.
        const age = daysBetween(invoice.paidAt ?? invoice.createdAt, asOf);
        accumulateAging(unclaimedAging, age, position.unclaimedCents);
        unclaimedRows.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          visitNumber: invoice.visit?.visitNumber ?? null,
          clinicName: invoice.visit?.clinic?.name ?? null,
          panelClinicId: panel?.id ?? null,
          panelName: panel?.name ?? null,
          settledAt: (invoice.paidAt ?? invoice.createdAt).toISOString().slice(0, 10),
          billed: fromCents(position.billedCents),
          claimed: fromCents(position.claimedCents),
          unclaimed: fromCents(position.unclaimedCents),
          state: position.state,
          ageDays: age,
        });
      }
    }

    // --- Side 2: what the fee costs, across every claim in the window --------
    const claimLines = await this.prisma.claimBatchLine.findMany({
      where: {
        ...(params.panelClinicId ? { claimBatch: { panelClinicId: params.panelClinicId } } : {}),
        ...(clinicId ? { invoice: { visit: { clinicId } } } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
          : {}),
      },
      select: {
        claimedAmount: true,
        feeAmount: true,
        feeTreatment: true,
        approvedAmount: true,
        rejectedAmount: true,
        paidAmount: true,
        writtenOffAmount: true,
        claimBatch: { select: { panelClinicId: true, panelClinic: { select: { name: true } } } },
        invoice: { select: { invoiceNumber: true } },
      },
    });

    const feeFacts = claimLines.map((line) => {
      const balance = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        feeTreatment: line.feeTreatment,
        approvedAmount: line.approvedAmount,
        rejectedAmount: line.rejectedAmount,
        receivedAmount: line.paidAmount,
        writtenOffAmount: line.writtenOffAmount,
      });
      return {
        feeAmount: line.feeAmount,
        feeTreatment: line.feeTreatment,
        receivedAmount: line.paidAmount,
        outstandingCents: balance.outstandingCents,
        claimedCents: balance.claimedCents,
        expectedReceivableCents: balance.expectedReceivableCents,
        receivedCents: balance.receivedCents,
        panelClinicId: line.claimBatch.panelClinicId,
        panelName: line.claimBatch.panelClinic.name,
        invoiceNumber: line.invoice?.invoiceNumber ?? null,
      };
    });
    const feeRoll = rollUpPanelFeeCost(feeFacts);

    // THE EXCEPTIONS, FOUND WITHOUT ANYBODY LOOKING.
    //
    // The owner asked for the workbook's two full-amount payments to be
    // investigated rather than averaged away. This is that investigation, run
    // continuously: every settled claim is compared against what its own fee
    // rule says should have arrived.
    const evidenceCounts: Record<FeeEvidenceState, number> = {
      TAKEN: 0,
      NOT_TAKEN: 0,
      OVERPAID: 0,
      PENDING: 0,
      NOT_PAID: 0,
      INCONCLUSIVE: 0,
      NOT_APPLICABLE: 0,
    };
    let feeNotTakenCents = 0;
    let overpaidCents = 0;
    const exceptionRows: Array<{
      panelClinicId: string;
      panelName: string;
      invoiceNumber: string | null;
      state: FeeEvidenceState;
      claimed: number;
      expected: number;
      received: number;
      difference: number;
    }> = [];

    for (const fact of feeFacts) {
      const bucket = bucketFor(fact.panelClinicId, fact.panelName);
      const cost = panelFeeCost(fact);
      if (cost.state === 'BORNE') bucket.feeBorneCents += cost.costCents;
      else if (cost.state === 'EXPECTED') bucket.feeExpectedCents += cost.costCents;

      const evidence = feeEvidence(fact);
      evidenceCounts[evidence.state] += 1;
      if (evidence.state === 'NOT_TAKEN') feeNotTakenCents += evidence.differenceCents;
      if (evidence.state === 'OVERPAID') overpaidCents += evidence.differenceCents;
      if (evidence.state === 'NOT_TAKEN' || evidence.state === 'OVERPAID') {
        exceptionRows.push({
          panelClinicId: fact.panelClinicId,
          panelName: fact.panelName,
          invoiceNumber: fact.invoiceNumber,
          state: evidence.state,
          claimed: fromCents(fact.claimedCents),
          expected: fromCents(fact.expectedReceivableCents),
          received: fromCents(fact.receivedCents),
          difference: fromCents(evidence.differenceCents),
        });
      }
    }

    // --- Side 3: what the panels actually banked ----------------------------
    const remittances = await this.prisma.panelRemittance.findMany({
      where: {
        ...(params.panelClinicId ? { panelClinicId: params.panelClinicId } : {}),
        ...(from || to
          ? { receivedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
          : {}),
      },
      select: {
        id: true,
        receivedAt: true,
        remittanceRef: true,
        grossAmount: true,
        withheldAmount: true,
        netAmount: true,
        panelClinic: { select: { id: true, name: true } },
        allocations: {
          select: {
            amount: true,
            claimLine: { select: { feeAmount: true, feeTreatment: true } },
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });

    let grossBankedCents = 0;
    let netBankedCents = 0;
    let withheldCents = 0;
    let unexplainedWithholdingCents = 0;
    let remittancesThatDisagree = 0;

    const remittanceRows = remittances.map((remittance) => {
      // The fees Kuwick expected on the claims this payment settled. Only
      // WITHHELD fees can explain a deduction: a fee the panel ADDS to the
      // receivable is not something they then keep.
      const expectedFeeCents = remittance.allocations.reduce(
        (total, allocation) =>
          allocation.claimLine.feeTreatment === 'WITHHELD_FROM_CLAIM'
            ? total + toCents(allocation.claimLine.feeAmount)
            : total,
        0,
      );
      const check = reconcileWithholding({
        withheldAmount: remittance.withheldAmount,
        expectedFeeCents,
      });

      grossBankedCents += toCents(remittance.grossAmount);
      netBankedCents += toCents(remittance.netAmount);
      withheldCents += check.withheldCents;
      unexplainedWithholdingCents += check.unexplainedCents;
      if (check.applicable && !check.agrees) remittancesThatDisagree += 1;

      const bucket = bucketFor(remittance.panelClinic.id, remittance.panelClinic.name);
      bucket.bankedCents += toCents(remittance.netAmount);
      bucket.withheldCents += check.withheldCents;

      return {
        remittanceId: remittance.id,
        panelClinicId: remittance.panelClinic.id,
        panelName: remittance.panelClinic.name,
        receivedAt: remittance.receivedAt.toISOString().slice(0, 10),
        reference: remittance.remittanceRef,
        claims: remittance.allocations.length,
        gross: Number(remittance.grossAmount),
        withheld: fromCents(check.withheldCents),
        net: Number(remittance.netAmount),
        expectedFee: fromCents(check.expectedFeeCents),
        unexplained: fromCents(check.unexplainedCents),
        /** FALSE where the remittance was keyed net and there is nothing to check. */
        withholdingChecked: check.applicable,
        agrees: check.agrees,
      };
    });

    return {
      period: {
        from: params.from ?? null,
        to: params.to ?? null,
        asOf: asOf.toISOString().slice(0, 10),
      },
      billing: {
        invoices: invoices.length,
        billed: fromCents(billedCents),
        claimed: fromCents(claimedAgainstBillingCents),
        /** BILLED AND NEVER ASKED FOR. The number this screen exists for. */
        unclaimed: fromCents(unclaimedCents),
        unclaimedInvoices,
        /** Claimed beyond the bill. A rejection waiting to happen. */
        overClaimed: fromCents(overClaimedCents),
        overClaimedInvoices,
        claimedRate:
          billedCents === 0 ? null : Math.round((claimedAgainstBillingCents / billedCents) * 1000) / 10,
        aging: {
          current: fromCents(unclaimedAging.CURRENT),
          d31_60: fromCents(unclaimedAging.D31_60),
          d61_90: fromCents(unclaimedAging.D61_90),
          d90_plus: fromCents(unclaimedAging.D90_PLUS),
        },
      },
      feeCost: {
        /** Fees on claims that settled with money. Money the clinic has spent. */
        borne: fromCents(feeRoll.borneCents),
        /** Fees on claims still owed. Will be spent when the panel pays. */
        expected: fromCents(feeRoll.expectedCents),
        /**
         * Claims whose fee direction nobody configured. Their fee is in neither
         * figure above, so both are understated by this much.
         */
        unresolvedClaims: feeRoll.unresolvedCount,
        unresolvedFee: fromCents(feeRoll.unresolvedFeeCents),
      },
      banked: {
        remittances: remittances.length,
        gross: fromCents(grossBankedCents),
        withheld: fromCents(withheldCents),
        net: fromCents(netBankedCents),
        /** Kept beyond the fees Kuwick expected. Somebody has to ask why. */
        unexplained: fromCents(unexplainedWithholdingCents),
        remittancesThatDisagree,
      },
      /**
       * WHERE THE FEE RULE AND THE MONEY DISAGREE — the standing version of the
       * forensic pass that found the workbook's two exceptions.
       */
      feeEvidence: {
        taken: evidenceCounts.TAKEN,
        notTaken: evidenceCounts.NOT_TAKEN,
        notTakenAmount: fromCents(feeNotTakenCents),
        overpaid: evidenceCounts.OVERPAID,
        overpaidAmount: fromCents(overpaidCents),
        pending: evidenceCounts.PENDING,
        /** Closed with no money: rejected or written off. Nothing to test. */
        notPaid: evidenceCounts.NOT_PAID,
        /** Settled below the expectation: the shortfall cannot be attributed. */
        inconclusive: evidenceCounts.INCONCLUSIVE,
      },
      exceptionRows,
      byPanel: [...byPanel.entries()]
        .map(([id, bucket]) => ({
          panelClinicId: id === 'UNASSIGNED' ? null : id,
          panelName: bucket.name,
          billed: fromCents(bucket.billedCents),
          claimed: fromCents(bucket.claimedCents),
          unclaimed: fromCents(bucket.unclaimedCents),
          unclaimedInvoices: bucket.unclaimedInvoices,
          banked: fromCents(bucket.bankedCents),
          withheld: fromCents(bucket.withheldCents),
          feeBorne: fromCents(bucket.feeBorneCents),
          feeExpected: fromCents(bucket.feeExpectedCents),
        }))
        .sort((a, b) => b.unclaimed - a.unclaimed || b.billed - a.billed),
      unclaimedInvoiceRows: unclaimedRows.sort((a, b) => b.ageDays - a.ageDays),
      remittanceRows,
    };
  }
}
