import { approvalGate, buildException, EXCEPTION_CATALOGUE, exceptionTitle, isYearPolicy } from './payroll-exception';

const ex = (
  severity: 'BLOCKING' | 'WARNING' | 'INFO',
  overridable = false,
  overriddenByStaffId: string | null = null,
) => ({ severity, overridable, overriddenByStaffId });

describe('payroll exceptions', () => {
  it('every catalogue entry names a cause, a consequence and a remedy', () => {
    for (const [code, t] of Object.entries(EXCEPTION_CATALOGUE)) {
      expect(t.code).toBe(code);
      const ctx = { staffId: 'x', runId: 'r', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X' };
      expect(t.cause(ctx)).toBeTruthy();
      // A consequence may be BUILT from the month's own figures — a shortfall
      // stated in the abstract is one a reader cannot check — so resolve it
      // the way `buildException` does before judging it.
      const consequence = typeof t.consequence === 'function' ? t.consequence(ctx) : t.consequence;
      expect(consequence.length).toBeGreaterThan(20);
      expect(t.remediation.length).toBeGreaterThan(10);
      // A few words for the review card: the long text is behind Details.
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.title.length).toBeLessThanOrEqual(40);
    }
  });

  it('gives each kind a card title, and marks the policy acknowledged for the year', () => {
    expect(exceptionTitle('EPF_BASIS_DISCREPANCY')).toBe('EPF on the employer-selected basis');
    expect(exceptionTitle('EPF_BASIS_ACKNOWLEDGED')).toBe('EPF on the employer-selected basis');
    expect(exceptionTitle('NOT_A_CODE')).toBe('NOT_A_CODE');
    expect(isYearPolicy('EPF_BASIS_DISCREPANCY')).toBe(true);
    expect(isYearPolicy('MISSING_PUNCH')).toBe(false);
    expect(buildException('MISSING_PUNCH', 's1', { staffId: 's1', days: 2 }).title).toBe('Missing clock-in or clock-out');
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
    const ctx = { staffId: 's1', runId: 'r1', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X', name: 'A', basis: 'DAILY', note: 'n', previousAmount: '1.00', nextAmount: '2.00', changedOn: '2026-09-15', periodLabel: 'September 2026', components: 'Allowance RM250.00', gross: '3450.00', assessedBasis: '3450.00', selectedBasis: '3200.00', difference: '250.00', effectiveFrom: '2026-08-01', selectedBy: 'Dr A', selectionReason: 'contract says basic only', employerName: 'A Sdn Bhd' };
    for (const [code, template] of Object.entries(EXCEPTION_CATALOGUE)) {
      const sentences = [
        template.cause(ctx),
        typeof template.consequence === 'function' ? template.consequence(ctx) : template.consequence,
        template.remediation,
      ];
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
      // Piece 3d — the rule sets a clinic-rate floor exception points at.
      '/admin/hr/settings/payroll',
      // s.60E(3) — where the clinic says whether it pays untaken leave out.
      '/admin/hr/settings/attendance-leave',
      // Parameterised routes are listed as PATTERNS, so a link to one person
      // proves the route exists rather than being waved through by a literal.
      '/admin/hr/employees/:staffId',
      '/admin/hr/payroll/:id',
      // One person's payroll page on a run — where a carried line is edited or cleared.
      '/admin/hr/payroll/:id/employees/:staffId',
    ];
    /** `/admin/hr/employees/s1` matches `/admin/hr/employees/:staffId`. */
    const mounted = (path: string) =>
      MOUNTED.some((pattern) => {
        if (!pattern.includes(':')) return pattern === path;
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        if (patternParts.length !== pathParts.length) return false;
        return patternParts.every(
          (part, index) => part.startsWith(':') ? pathParts[index].length > 0 : part === pathParts[index],
        );
      });
    const ctx = { staffId: 's1', runId: 'r1', hours: 1, days: 1, count: 2, percent: 50, net: '-1.00', componentCode: 'X' };
    for (const [code, template] of Object.entries(EXCEPTION_CATALOGUE)) {
      if (!template.deepLink) continue;
      const link = template.deepLink(ctx);
      const path = link.split('?')[0];
      // The code is in the message so a failure names which exception is wrong.
      expect(`${code} → ${mounted(path) ? 'mounted' : path}`).toBe(`${code} → mounted`);
    }
  });

  it('interpolates context into the cause', () => {
    expect(buildException('UNAPPROVED_OVERTIME', 's1', { hours: 7.5, staffId: 's1' }).cause).toContain('7.5');
  });

  it('refuses an unknown code rather than inventing a blank exception', () => {
    expect(() => buildException('NOT_A_CODE' as never, null)).toThrow(/Unknown payroll exception/);
  });

  it('says where a rest day with no fixed day comes from, without changing what it does', () => {
    const roster = buildException('REST_DAY_VARIES', 's1', { staffId: 's1', restDayRule: 'ROSTER' });
    const varies = buildException('REST_DAY_VARIES', 's1', { staffId: 's1', restDayRule: 'VARIES' });
    expect(roster.cause).toContain('rotates with the roster');
    expect(varies.cause).toContain('varies week to week');
    expect(roster.severity).toBe('INFO');
    expect(roster.consequence).toBe(varies.consequence);
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
    expect(gate.reason).toBe('2 need action. None of them blocks approval.');
  });

  it('counts what needs action the way the review does: an acknowledged warning is done, INFO asks nothing', () => {
    const gate = approvalGate([ex('WARNING'), ex('WARNING', true, 'approver-1'), ex('INFO'), ex('BLOCKING', true, 'approver-1')]);
    expect(gate).toMatchObject({ canApprove: true, needAction: 1, reason: '1 needs action. None of them blocks approval.' });
    expect(approvalGate([ex('WARNING', true, 'approver-1'), ex('INFO')])).toMatchObject({ needAction: 0, reason: 'Nothing needs action.' });
    expect(approvalGate([ex('BLOCKING'), ex('WARNING')])).toMatchObject({ canApprove: false, blocking: 1, needAction: 2 });
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
    for (const code of [
      'NO_SALARY',
      'NO_DOB',
      'NO_LEGAL_EMPLOYER',
      'PCB_MISSING',
      'NEGATIVE_NET',
      'UNKNOWN_COMPONENT',
      'STATUTORY_UNKNOWN',
    ]) {
      expect(EXCEPTION_CATALOGUE[code].overridable).toBe(false);
    }
  });

  /*
   * THE FAIL-SAFE, pinned.
   *
   * An unknown statutory figure has to stop the run, and for one release it
   * silently did not: the exception was raised only when a note matched
   * /incomplete|outside every configured/, so rewording an engine message
   * opened the gate. It now fires off the figures themselves, and these tests
   * exist so a future rewording cannot close it again.
   */
  it('treats an unknown statutory figure as blocking and never overridable', () => {
    expect(EXCEPTION_CATALOGUE.STATUTORY_UNKNOWN.severity).toBe('BLOCKING');
    expect(EXCEPTION_CATALOGUE.STATUTORY_UNKNOWN.overridable).toBe(false);
    expect(
      approvalGate([
        {
          severity: EXCEPTION_CATALOGUE.STATUTORY_UNKNOWN.severity,
          overridable: EXCEPTION_CATALOGUE.STATUTORY_UNKNOWN.overridable,
          overriddenByStaffId: 'approver-1',
        },
      ]).canApprove,
    ).toBe(false);
  });

  it('says the contribution is unknown rather than nil, because the difference is the point', () => {
    const built = buildException('STATUTORY_UNKNOWN', 'staff-1', {
      staffId: 'staff-1',
      runId: 'run-1',
      note: 'Their EPF membership has not been recorded.',
    });
    expect(built.cause).toBe('Their EPF membership has not been recorded.');
    expect(built.consequence).toMatch(/unknown — not nil/);
    // And it points at the employee's statutory standing — the panel where the
    // missing fact is recorded — rather than at the top of the record.
    expect(built.deepLink).toBe('/admin/hr/employees/staff-1?tab=statutory&focus=standing');
  });
});
