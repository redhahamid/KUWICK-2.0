import {
  ApprovalPolicy,
  approvalsRequired,
  decideApproval,
  describeApprovalMode,
} from './payroll-approval-rule';

const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  mode: 'MAKER_CHECKER',
  allowOwnerSelfApproval: true,
  ...over,
});

const MAKER = 'maker-1';
const CHECKER = 'checker-1';
const THIRD = 'checker-2';

describe('STANDARD — one approval, anybody', () => {
  it('lets the person who ran the payroll approve it', () => {
    const d = decideApproval(policy({ mode: 'STANDARD' }), {
      actorStaffId: MAKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d).toEqual({ outcome: 'APPROVE', sequence: 1, usedOwnerSelfApproval: false });
  });

  it('lets somebody else approve it just the same', () => {
    const d = decideApproval(policy({ mode: 'STANDARD' }), {
      actorStaffId: CHECKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d.outcome).toBe('APPROVE');
  });

  it('needs one approval', () => {
    expect(approvalsRequired('STANDARD')).toBe(1);
  });
});

describe('MAKER_CHECKER — a second pair of eyes', () => {
  it('refuses the person who ran the payroll, and says what to do instead', () => {
    const d = decideApproval(policy(), {
      actorStaffId: MAKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d.outcome).toBe('REFUSE');
    expect((d as { reason: string }).reason).toMatch(/somebody other than the person who ran it/);
    // A refusal that does not say how to get past it is a dead end.
    expect((d as { reason: string }).reason).toMatch(/change the approval rule in Payroll settings/);
  });

  it('accepts a colleague', () => {
    const d = decideApproval(policy(), {
      actorStaffId: CHECKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d).toEqual({ outcome: 'APPROVE', sequence: 1, usedOwnerSelfApproval: false });
  });

  /*
   * THE OWNER EXEMPTION. It was in the code before this module existed and
   * nothing on screen said so. It is a setting now, and an approval that uses
   * it is MARKED, so a run approved by one person can be told apart from a run
   * two people looked at.
   */
  it('lets the owner approve their own run while the exemption is on, and marks that it did', () => {
    const d = decideApproval(policy(), {
      actorStaffId: MAKER,
      actorIsOwner: true,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d).toEqual({ outcome: 'APPROVE', sequence: 1, usedOwnerSelfApproval: true });
  });

  it('refuses even the owner once the exemption is turned off', () => {
    const d = decideApproval(policy({ allowOwnerSelfApproval: false }), {
      actorStaffId: MAKER,
      actorIsOwner: true,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d.outcome).toBe('REFUSE');
  });

  it('does not mark an ordinary approval as having used the exemption', () => {
    const d = decideApproval(policy(), {
      actorStaffId: CHECKER,
      actorIsOwner: true,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d).toMatchObject({ usedOwnerSelfApproval: false });
  });
});

describe('DUAL_APPROVAL — two different people', () => {
  const dual = policy({ mode: 'DUAL_APPROVAL' });

  it('needs two approvals', () => {
    expect(approvalsRequired('DUAL_APPROVAL')).toBe(2);
  });

  it('records the first approval without finishing the run, and says why', () => {
    const d = decideApproval(dual, {
      actorStaffId: CHECKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [],
    });
    expect(d.outcome).toBe('RECORD_AND_WAIT');
    expect((d as { sequence: number }).sequence).toBe(1);
    expect((d as { reason: string }).reason).toMatch(/two approvals/);
  });

  it('finishes the run on the second approval by a different person', () => {
    const d = decideApproval(dual, {
      actorStaffId: THIRD,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [{ staffId: CHECKER }],
    });
    expect(d).toEqual({ outcome: 'APPROVE', sequence: 2, usedOwnerSelfApproval: false });
  });

  /*
   * THE ONE THAT MATTERS. Two approvals from one person is one approval, and a
   * rule that let it through would be theatre.
   */
  it('REFUSES the same person approving twice', () => {
    const d = decideApproval(dual, {
      actorStaffId: CHECKER,
      actorIsOwner: false,
      makerStaffId: MAKER,
      existing: [{ staffId: CHECKER }],
    });
    expect(d.outcome).toBe('REFUSE');
    expect((d as { reason: string }).reason).toMatch(/already approved/);
  });

  it('refuses the same person approving twice even when they are the owner', () => {
    const d = decideApproval(dual, {
      actorStaffId: CHECKER,
      actorIsOwner: true,
      makerStaffId: MAKER,
      existing: [{ staffId: CHECKER }],
    });
    expect(d.outcome).toBe('REFUSE');
  });

  it('still refuses the maker as the second approver', () => {
    const d = decideApproval(policy({ mode: 'DUAL_APPROVAL', allowOwnerSelfApproval: false }), {
      actorStaffId: MAKER,
      actorIsOwner: true,
      makerStaffId: MAKER,
      existing: [{ staffId: CHECKER }],
    });
    expect(d.outcome).toBe('REFUSE');
  });
});

describe('the rule reads as a sentence, not a mode name', () => {
  it('never makes the reader learn the phrase "maker/checker"', () => {
    for (const mode of ['STANDARD', 'MAKER_CHECKER', 'DUAL_APPROVAL'] as const) {
      for (const allowOwnerSelfApproval of [true, false]) {
        const sentence = describeApprovalMode({ mode, allowOwnerSelfApproval });
        expect(sentence).not.toMatch(/maker|checker|MAKER_CHECKER|DUAL_APPROVAL|STANDARD/i);
        expect(sentence.length).toBeGreaterThan(40);
      }
    }
  });

  it('says the owner exemption out loud when it is on, and that it is gone when it is off', () => {
    expect(describeApprovalMode({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: true })).toMatch(
      /account owner is allowed to approve their own run/,
    );
    expect(describeApprovalMode({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: false })).toMatch(
      /including the account owner/,
    );
  });

  it('does not offer an owner exemption on a rule that has none to give', () => {
    expect(describeApprovalMode({ mode: 'STANDARD', allowOwnerSelfApproval: true })).not.toMatch(/owner/);
  });
});
