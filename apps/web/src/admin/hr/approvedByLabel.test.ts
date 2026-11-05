import { describe, expect, it } from 'vitest';
import { approvedByLabel } from './useHrSetup';

/* Payroll A–Z guide, issue 4: the wizard's words match who may really approve. */
describe('who approves payroll, in the wizard', () => {
  it('names the owner exemption when it is on', () => {
    expect(approvedByLabel({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: true, approvers: { total: 3 } })).toBe(
      'Somebody other than the person who ran it; the owner may approve their own',
    );
  });
  it('says plainly that a one-person clinic is approved by the owner alone', () => {
    expect(approvedByLabel({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: true, approvers: { total: 1 } })).toBe(
      'The owner alone (nobody else can approve yet)',
    );
  });
  it('leaves the owner out when the exemption is off', () => {
    expect(approvedByLabel({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: false, approvers: { total: 1 } })).toBe('Somebody other than the person who ran it');
    expect(approvedByLabel({ mode: 'STANDARD', allowOwnerSelfApproval: true })).toBe('One approver, who may be the person who ran it');
  });
});
