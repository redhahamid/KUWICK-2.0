import { approvalGate, buildException, EXCEPTION_CATALOGUE } from './payroll-exception';

const ex = (
  severity: 'BLOCKING' | 'WARNING' | 'INFO',
  overridable = false,
  overriddenByStaffId: string | null = null,
) => ({ severity, overridable, overriddenByStaffId });

describe('payroll exceptions', () => {
  it('every catalogue entry names a cause, a consequence and a remedy', () => {
    for (const [code, t] of Object.entries(EXCEPTION_CATALOGUE)) {
      expect(t.code).toBe(code);
      expect(t.cause({ staffId: 'x', runId: 'r', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X' })).toBeTruthy();
      expect(t.consequence.length).toBeGreaterThan(20);
      expect(t.remediation.length).toBeGreaterThan(10);
    }
  });

  it('builds an exception that says what will happen, not just what is wrong', () => {
    const built = buildException('PCB_MISSING', 's1', { runId: 'r1', staffId: 's1' });
    expect(built.severity).toBe('BLOCKING');
    // The CONSEQUENCE, in the owner's terms: what happens to the person and
    // to the clinic, not what the engine failed to do.
    expect(built.consequence).toMatch(/take-home pay/);
    expect(built.consequence).toMatch(/LHDN too little/);
    expect(built.deepLink).toBe('/admin/hr/payroll');
  });

  /**
   * EVERY REMEDY LINK GOES SOMEWHERE THAT EXISTS.
   *
   * The Stage 1 + 2 visual UAT found that all twelve pointed at routes nobody
   * had mounted — `/admin/hr/employees/:id/salary`, `/admin/hr/timesheet`,
   * `/admin/hr/pay-components`, `/admin/hr/payroll/:id/inputs`,
   * `/admin/hr/statutory`. A clinic manager following "Go and fix it" from a
   * blocking exception landed on a blank page, on the one screen whose whole
   * job is getting blockers cleared.
   *
   * This list is the set of admin HR routes mounted in `App.tsx`. A new
   * exception pointing anywhere else fails here rather than in front of
   * somebody trying to pay their staff.
   */
  /**
   * THE OWNER NEVER READS THE ENGINE.
   *
   * Every sentence in this catalogue is shown verbatim on the review screen a
   * clinic owner uses once a month. An exception that says "materialised
   * payroll input" or "verification status" is asking them to understand how
   * Kuwick is built in order to pay five people, which is the thing the whole
   * redesign was rejected for.
   *
   * The exception CODE stays — it is how the system talks about itself — but it
   * is never rendered.
   */
  it('says everything in the owner\'s words, never the engine\'s', () => {
    const ENGINE_WORDS = [
      /materiali[sz]/i,
      /verification (status|state)/i,
      /snapshot/i,
      /liability/i,
      /effective-dated/i,
      /idempot/i,
      /payroll input entry/i,
      /exception (code|catalogue)/i,
      /component code/i,
      /tenant/i,
      /schema/i,
      /endpoint/i,
      /\bnull\b/i,
    ];
    const ctx = { staffId: 's1', runId: 'r1', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X', name: 'A', basis: 'DAILY', note: 'n', previousAmount: '1.00', nextAmount: '2.00', changedOn: '2026-09-15', periodLabel: 'September 2026' };
    for (const [code, template] of Object.entries(EXCEPTION_CATALOGUE)) {
      const sentences = [template.cause(ctx), template.consequence, template.remediation];
      for (const sentence of sentences) {
        for (const word of ENGINE_WORDS) {
          expect(`${code}: ${sentence}`).not.toMatch(word);
        }
      }
    }
  });

  it('links only to routes the application actually mounts', () => {
    const MOUNTED = [
      '/admin/hr',
      '/admin/hr/employees',
      '/admin/hr/attendance',
      '/admin/hr/leave',
      '/admin/hr/roster',
      '/admin/hr/payroll',
      '/admin/hr/employers',
      '/admin/hr/incentives',
      '/admin/hr/benefits',
      '/admin/hr/access',
      // Stage 2.5
      '/admin/hr/claims',
      '/admin/hr/locum',
      '/admin/hr/settings',
    ];
    const ctx = { staffId: 's1', runId: 'r1', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X' };
    for (const [code, template] of Object.entries(EXCEPTION_CATALOGUE)) {
      if (!template.deepLink) continue;
      const link = template.deepLink(ctx);
      const path = link.split('?')[0];
      // The code is in the message so a failure names which exception is wrong.
      expect(`${code} → ${path}`).toBe(`${code} → ${MOUNTED.find((m) => m === path) ?? path}`);
      expect(MOUNTED).toContain(path);
    }
  });

  it('interpolates context into the cause', () => {
    expect(buildException('UNAPPROVED_OVERTIME', 's1', { hours: 7.5, staffId: 's1' }).cause).toContain('7.5');
  });

  it('refuses an unknown code rather than inventing a blank exception', () => {
    expect(() => buildException('NOT_A_CODE' as never, null)).toThrow(/Unknown payroll exception/);
  });

  it('approves a run with no exceptions', () => {
    expect(approvalGate([])).toMatchObject({ canApprove: true, blocking: 0, warnings: 0 });
  });

  it('BLOCKS on a blocking exception', () => {
    const gate = approvalGate([ex('BLOCKING')]);
    expect(gate.canApprove).toBe(false);
    expect(gate.reason).toMatch(/1 blocking exception/);
  });

  it('does NOT block on a warning — the whole reason severities exist', () => {
    const gate = approvalGate([ex('WARNING'), ex('WARNING')]);
    expect(gate.canApprove).toBe(true);
    expect(gate.warnings).toBe(2);
    expect(gate.reason).toMatch(/none of them prevents approval/);
  });

  it('does not block on INFO', () => {
    expect(approvalGate([ex('INFO')]).canApprove).toBe(true);
  });

  it('counts an overridden overridable blocker as resolved', () => {
    const gate = approvalGate([ex('BLOCKING', true, 'approver-1')]);
    expect(gate.canApprove).toBe(true);
    expect(gate.overridden).toBe(1);
  });

  it('still blocks when a NON-overridable blocker carries an override', () => {
    // The database refuses this combination too; the gate does not trust it either.
    expect(approvalGate([ex('BLOCKING', false, 'approver-1')]).canApprove).toBe(false);
  });

  it('blocks on the unresolved one when a run mixes resolved and unresolved blockers', () => {
    const gate = approvalGate([ex('BLOCKING', true, 'a1'), ex('BLOCKING'), ex('WARNING')]);
    expect(gate).toMatchObject({ canApprove: false, blocking: 1, warnings: 1, overridden: 1 });
  });

  it('classifies the exceptions the old JSON blob made indistinguishable', () => {
    // Every one of these blocked approval before, including the informational ones.
    expect(EXCEPTION_CATALOGUE.NO_SALARY.severity).toBe('BLOCKING');
    expect(EXCEPTION_CATALOGUE.UNAPPROVED_OVERTIME.severity).toBe('WARNING');
    expect(EXCEPTION_CATALOGUE.MISSING_PUNCH.severity).toBe('WARNING');
    expect(EXCEPTION_CATALOGUE.STATUTORY_UNVERIFIED.severity).toBe('WARNING');
  });

  it('never marks a data-integrity blocker overridable', () => {
    for (const code of ['NO_SALARY', 'NO_DOB', 'NO_LEGAL_EMPLOYER', 'PCB_MISSING', 'NEGATIVE_NET', 'UNKNOWN_COMPONENT']) {
      expect(EXCEPTION_CATALOGUE[code].overridable).toBe(false);
    }
  });
});
