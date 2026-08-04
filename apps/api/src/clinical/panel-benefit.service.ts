import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PanelCopaymentType,
  PanelCoverageType,
  PanelVerificationStatus,
  Prisma,
  Role,
  Staff,
} from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { ClinicalTx, assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { RecordPanelVerificationDto } from './dto/record-panel-verification.dto';
import { OverridePanelBenefitDto } from './dto/override-panel-benefit.dto';

/**
 * G4.5d3c-3b1a (D-092) — the visit-specific panel benefit snapshot.
 *
 * Two operations, deliberately asymmetric:
 *
 * VERIFICATION is registration/counter work — the staff member looked at the
 * panel's portal and records what it said, terms included. It writes the
 * working terms AND, exactly once, the ORIGINAL terms: the record of what
 * verification actually reported is append-only even though the working
 * terms are not.
 *
 * OVERRIDE is a financial correction — replacing the working terms with
 * something verification did not say. It is held to the financial-correction
 * standard (D-066's CANCEL_INVOICE tier): owner/finance only, mandatory
 * reason, actor and timestamp recorded, originals preserved.
 *
 * NOTHING here computes money. The terms captured are inputs to the 3b1b
 * calculation engine; capturing them wrong is recoverable precisely because
 * every capture is attributed and the original is retained.
 */
const MAY_VERIFY: Role[] = ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'FINANCE_STAFF'];
const MAY_OVERRIDE: Role[] = ['OWNER_ADMIN', 'FINANCE_STAFF'];

interface BenefitTerms {
  coverageType: PanelCoverageType | null;
  visitLimitAmount: number | null;
  copaymentType: PanelCopaymentType | null;
  copaymentValue: number | null;
}

@Injectable()
export class PanelBenefitService {
  constructor(private readonly rawPrisma: PrismaService) {}

  async recordVerification(visitId: string, dto: RecordPanelVerificationDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertRole(actor, MAY_VERIFY, 'record a panel verification');
      await assertMayTouchVisit(tx, visitId, actor);
      const visit = await loadPanelVisit(tx, visitId);

      const terms: BenefitTerms =
        dto.status === PanelVerificationStatus.VERIFIED
          ? validateTerms({
              coverageType: dto.coverageType ?? null,
              visitLimitAmount: dto.visitLimitAmount ?? null,
              copaymentType: dto.copaymentType ?? null,
              copaymentValue: dto.copaymentValue ?? null,
            })
          : // A FAILED verification captures no terms: recording benefit
            // figures the portal refused to confirm would launder a guess
            // into a snapshot.
            { coverageType: null, visitLimitAmount: null, copaymentType: null, copaymentValue: null };

      const now = new Date();
      return tx.visit.update({
        where: { id: visitId },
        data: {
          panelVerificationStatus: dto.status,
          panelVerifiedAt: now,
          panelVerifiedByStaffId: actor.id,
          panelMemberReference: dto.memberReference ?? visit.panelMemberReference,
          panelVerificationReference: dto.verificationReference ?? null,
          panelCoverageType: terms.coverageType,
          panelVisitLimitAmount: terms.visitLimitAmount,
          panelCopaymentType: terms.copaymentType,
          panelCopaymentValue: terms.copaymentValue,
          // The append-only record: written on the FIRST capture only. A
          // re-verification updates the working terms; what verification
          // first said stays said.
          ...(visit.panelOriginalVerificationStatus === null
            ? {
                panelOriginalVerificationStatus: dto.status,
                panelOriginalCoverageType: terms.coverageType,
                panelOriginalVisitLimitAmount: terms.visitLimitAmount,
                panelOriginalCopaymentType: terms.copaymentType,
                panelOriginalCopaymentValue: terms.copaymentValue,
              }
            : {}),
        },
        select: BENEFIT_SELECT,
      });
    });
  }

  async overrideBenefit(visitId: string, dto: OverridePanelBenefitDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertRole(actor, MAY_OVERRIDE, 'override panel benefit terms');
      await assertMayTouchVisit(tx, visitId, actor);
      const visit = await loadPanelVisit(tx, visitId);

      const terms = validateTerms({
        coverageType: dto.coverageType,
        visitLimitAmount: dto.visitLimitAmount ?? null,
        copaymentType: dto.copaymentType,
        copaymentValue: dto.copaymentValue ?? null,
      });

      return tx.visit.update({
        where: { id: visitId },
        data: {
          panelVerificationStatus: PanelVerificationStatus.OVERRIDDEN,
          panelCoverageType: terms.coverageType,
          panelVisitLimitAmount: terms.visitLimitAmount,
          panelCopaymentType: terms.copaymentType,
          panelCopaymentValue: terms.copaymentValue,
          panelBenefitOverrideReason: dto.reason.trim(),
          panelBenefitOverriddenAt: new Date(),
          panelBenefitOverriddenByStaffId: actor.id,
          // If nothing was ever verified, the original record is the honest
          // pre-override state: PENDING with no terms. Never the override's
          // own values — that would erase the fact that nobody verified.
          ...(visit.panelOriginalVerificationStatus === null
            ? {
                panelOriginalVerificationStatus:
                  visit.panelVerificationStatus ?? PanelVerificationStatus.PENDING_VERIFICATION,
                panelOriginalCoverageType: visit.panelCoverageType,
                panelOriginalVisitLimitAmount: visit.panelVisitLimitAmount,
                panelOriginalCopaymentType: visit.panelCopaymentType,
                panelOriginalCopaymentValue: visit.panelCopaymentValue,
              }
            : {}),
        },
        select: BENEFIT_SELECT,
      });
    });
  }
}

const BENEFIT_SELECT = {
  id: true,
  panelClinicId: true,
  panelMemberReference: true,
  panelVerificationStatus: true,
  panelVerifiedAt: true,
  panelVerifiedByStaffId: true,
  panelVerificationReference: true,
  panelCoverageType: true,
  panelVisitLimitAmount: true,
  panelCopaymentType: true,
  panelCopaymentValue: true,
  panelOriginalVerificationStatus: true,
  panelOriginalCoverageType: true,
  panelOriginalVisitLimitAmount: true,
  panelOriginalCopaymentType: true,
  panelOriginalCopaymentValue: true,
  panelBenefitOverrideReason: true,
  panelBenefitOverriddenAt: true,
  panelBenefitOverriddenByStaffId: true,
} satisfies Prisma.VisitSelect;

function assertRole(actor: Staff, allowed: Role[], action: string): void {
  if (!actor.active || !allowed.includes(actor.role)) {
    throw new ForbiddenException(`Your role is not permitted to ${action}.`);
  }
}

async function loadPanelVisit(tx: ClinicalTx, visitId: string) {
  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      panelClinicId: true,
      checkOutAt: true,
      panelMemberReference: true,
      panelVerificationStatus: true,
      panelCoverageType: true,
      panelVisitLimitAmount: true,
      panelCopaymentType: true,
      panelCopaymentValue: true,
      panelOriginalVerificationStatus: true,
      panelOriginalVisitLimitAmount: true,
      panelOriginalCopaymentType: true,
      panelOriginalCopaymentValue: true,
    },
  });
  if (!visit) {
    throw new NotFoundException('Visit not found');
  }
  if (!visit.panelClinicId) {
    throw new BadRequestException('This visit has no panel, so there are no benefit terms to record.');
  }
  if (visit.checkOutAt) {
    // A completed visit's snapshot is history. Correcting a closed visit's
    // billing is a financial-adjustment workflow (credit note territory),
    // not a quiet edit to the terms it was settled under.
    throw new BadRequestException('This visit is already completed; its benefit terms can no longer be changed.');
  }
  return visit;
}

/**
 * The combinations that make sense, and only those. Every rule fails closed:
 * a VISIT_LIMIT with no limit, an UNLIMITED with one, a FIXED copay with no
 * value, a percentage outside (0, 100] — each is refused rather than stored
 * as something the calculation engine would have to reinterpret.
 */
function validateTerms(terms: BenefitTerms): BenefitTerms {
  const { coverageType, visitLimitAmount, copaymentType, copaymentValue } = terms;

  if (!coverageType) {
    throw new BadRequestException('A verified panel needs a coverage type: unlimited, or a visit limit.');
  }
  if (coverageType === PanelCoverageType.VISIT_LIMIT) {
    if (visitLimitAmount == null || visitLimitAmount <= 0) {
      throw new BadRequestException('A visit-limit coverage needs the limit amount.');
    }
  } else if (visitLimitAmount != null) {
    throw new BadRequestException('Unlimited coverage cannot carry a visit limit amount.');
  }

  const copay = copaymentType ?? PanelCopaymentType.NONE;
  if (copay === PanelCopaymentType.NONE) {
    if (copaymentValue != null) {
      throw new BadRequestException('No-copayment terms cannot carry a copayment value.');
    }
  } else if (copaymentValue == null || copaymentValue <= 0) {
    throw new BadRequestException('This copayment type needs a copayment value.');
  } else if (copay === PanelCopaymentType.PERCENTAGE && copaymentValue > 100) {
    throw new BadRequestException('A percentage copayment cannot exceed 100.');
  }

  return {
    coverageType,
    visitLimitAmount: coverageType === PanelCoverageType.VISIT_LIMIT ? visitLimitAmount : null,
    copaymentType: copay,
    copaymentValue: copay === PanelCopaymentType.NONE ? null : copaymentValue,
  };
}
