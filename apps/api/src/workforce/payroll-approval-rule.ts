/**
 * WHO IS ALLOWED TO APPROVE A PAYROLL RUN.
 *
 * This was a hard-coded rule with an undocumented exception: the person who
 * ran the payroll could not approve it, unless they held `settings.manage`, in
 * which case they silently could. Two clinics with opposite needs — a group
 * with a finance department, a single-doctor practice where the owner is the
 * only person — got the same rule, and neither could see what it was.
 *
 * The rule is a setting now. It lives here as a pure function so it can be
 * reasoned about and tested without a database, and so the sentence the owner
 * reads on screen and the sentence the server enforces are produced by the
 * same code.
 *
 * WHAT THIS DOES NOT DO, and the payroll settings screen says so:
 *   * It does not notify a checker that a run is waiting. There is no approval
 *     inbox; the second approver finds the run on the payroll list.
 *   * It does not vary by amount. A RM900 correction run and a RM90,000 month
 *     take the same route.
 *   * It governs the PAYROLL RUN only. Claims, leave, overtime and incentives
 *     each carry their own approval rule.
 *   * Both approvers need the same permission, `hr.payroll.approve`. The
 *     permission model has no notion of a senior approver, so DUAL_APPROVAL is
 *     two people of equal authority, not two levels.
 */

export type PayrollApprovalMode = 'STANDARD' | 'MAKER_CHECKER' | 'DUAL_APPROVAL';

export interface ApprovalPolicy {
  mode: PayrollApprovalMode;
  /** When the rule was last changed. Absent on the built-in default. */
  updatedAt?: string;
  /**
   * Whether somebody holding `settings.manage` may approve a run they created
   * under a rule that would otherwise forbid it. True by default because
   * turning it off locks a one-person clinic out of paying anybody — but it is
   * a decision now, and every approval that uses it is marked.
   */
  allowOwnerSelfApproval: boolean;
}

export interface ApprovalRequest {
  actorStaffId: string;
  /** Whether the actor holds `settings.manage`. */
  actorIsOwner: boolean;
  /** Who ran the calculation. */
  makerStaffId: string;
  /** Approvals already recorded, oldest first. */
  existing: { staffId: string }[];
}

export type ApprovalDecision =
  /** Record the approval; the run is now approved. */
  | { outcome: 'APPROVE'; sequence: number; usedOwnerSelfApproval: boolean }
  /** Record the approval; the run still needs another person. */
  | { outcome: 'RECORD_AND_WAIT'; sequence: number; usedOwnerSelfApproval: boolean; reason: string }
  /** Refuse, with a sentence that says who may approve instead. */
  | { outcome: 'REFUSE'; reason: string };

/** How many approvals each mode requires. */
export function approvalsRequired(mode: PayrollApprovalMode): number {
  return mode === 'DUAL_APPROVAL' ? 2 : 1;
}

/**
 * The rule, as one sentence, for the settings screen and the run header.
 * Written for somebody who has never heard the phrase "maker/checker".
 */
export function describeApprovalMode(policy: ApprovalPolicy): string {
  const exemption = policy.allowOwnerSelfApproval
    ? ' The account owner is allowed to approve their own run, because in a small clinic there may be nobody else.'
    : ' This applies to everybody, including the account owner.';
  switch (policy.mode) {
    case 'STANDARD':
      return 'Anybody who can approve payroll may approve it, including the person who ran it. One approval finishes the run.';
    case 'MAKER_CHECKER':
      return `Payroll must be approved by somebody other than the person who ran it. One approval finishes the run.${exemption}`;
    case 'DUAL_APPROVAL':
      return `Payroll needs two approvals, from two different people, and neither of them may be the person who ran it.${exemption}`;
  }
}

/**
 * Decide what this approval attempt does.
 *
 * Returns rather than throws: the caller turns a REFUSE into the HTTP error,
 * and the same function answers "may I approve this?" for a screen deciding
 * whether to show the button.
 */
export function decideApproval(policy: ApprovalPolicy, request: ApprovalRequest): ApprovalDecision {
  const { actorStaffId, actorIsOwner, makerStaffId, existing } = request;

  // ALREADY APPROVED BY THIS PERSON. The unique constraint would refuse the
  // row anyway; refusing here says why in words rather than as a conflict.
  if (existing.some((a) => a.staffId === actorStaffId)) {
    return {
      outcome: 'REFUSE',
      reason:
        'You have already approved this payroll run. A second approval has to come from somebody else — that is the whole point of asking for two.',
    };
  }

  const isMaker = actorStaffId === makerStaffId;
  const separationApplies = policy.mode !== 'STANDARD';
  let usedOwnerSelfApproval = false;

  if (separationApplies && isMaker) {
    if (!(policy.allowOwnerSelfApproval && actorIsOwner)) {
      return {
        outcome: 'REFUSE',
        reason:
          'A payroll run must be approved by somebody other than the person who ran it. ' +
          'Ask a colleague who can approve payroll to review it, or change the approval rule in Payroll settings.',
      };
    }
    usedOwnerSelfApproval = true;
  }

  const sequence = existing.length + 1;
  const required = approvalsRequired(policy.mode);

  if (sequence < required) {
    return {
      outcome: 'RECORD_AND_WAIT',
      sequence,
      usedOwnerSelfApproval,
      reason:
        'Your approval is recorded. This clinic requires two approvals, so the run stays open until a second person approves it.',
    };
  }

  return { outcome: 'APPROVE', sequence, usedOwnerSelfApproval };
}
