/**
 * THE EXCEPTION CATALOGUE.
 *
 * Exceptions were a `Json?` column holding `{ staffId, name, issue }`. They
 * could not be queried, counted by severity, overridden individually or
 * audited, and every one of them blocked approval — so a purely informational
 * observation had the same force as an unpayable employee.
 *
 * Each entry now carries the three things the best warning found in the
 * competitor audit carries, and which almost none of its others do: the
 * CONDITION, the CONSEQUENCE, and the REMEDY. Naming the consequence is what
 * turns "PCB is missing" into something a clinic manager can act on.
 */

export type ExceptionSeverity = 'BLOCKING' | 'WARNING' | 'INFO';

export interface ExceptionTemplate {
  code: string;
  severity: ExceptionSeverity;
  /** Whether a permitted actor may pass it with a recorded reason. */
  overridable: boolean;
  cause: (ctx: Record<string, string | number>) => string;
  /**
   * What follows from it. A STRING for the overwhelming majority; a builder
   * where the consequence is only meaningful with the month's own figures in
   * it — the employer-selected EPF basis has to state gross, the assessment,
   * the selection and the difference, and a reader cannot check a shortfall
   * that is described in the abstract.
   */
  consequence: string | ((ctx: Record<string, string | number>) => string);
  remediation: string;
  deepLink?: (ctx: Record<string, string | number>) => string;
}

/*
 * A NOTE ON `deepLink`, after the Stage 1 + 2 visual UAT.
 *
 * Every link in this catalogue used to point at a route nobody had mounted:
 * `/admin/hr/employees/:id/salary`, `/admin/hr/timesheet`,
 * `/admin/hr/pay-components`, `/admin/hr/payroll/:id/inputs`,
 * `/admin/hr/statutory`. The remedy sentence beside each exception told a
 * clinic manager exactly what to do, and the link under it took them to a
 * blank page — on the one screen whose whole job is getting blockers resolved.
 *
 * These now name routes that exist. `?staffId=` opens that person's record
 * directly, so an employee link lands on the employee rather than on a
 * directory to search. PCB_MISSING keeps a link for completeness, but the
 * exception centre offers a button instead: its remedy is a keystroke on the
 * screen the reader is already looking at.
 */
export const EXCEPTION_CATALOGUE: Record<string, ExceptionTemplate> = {
  NO_SALARY: {
    code: 'NO_SALARY',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Salary setup is incomplete.',
    consequence: 'They have no salary on file for this month, so they are left out of the totals entirely rather than paid a figure nobody chose.',
    remediation: 'Set their monthly salary from the date it starts.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NO_DOB: {
    code: 'NO_DOB',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Date of birth is missing.',
    consequence:
      'EPF, SOCSO and EIS all change at 60, so without a date of birth every statutory figure for this person would be a guess.',
    remediation: 'Add their date of birth to their employee record.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NO_LEGAL_EMPLOYER: {
    code: 'NO_LEGAL_EMPLOYER',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'No employing company is recorded.',
    consequence:
      'Nothing could be filed for them: EPF, SOCSO, EIS and monthly tax are all submitted by a company, and this person is not attached to one.',
    remediation: 'Set the company that employs them on their employee record.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  PCB_MISSING: {
    code: 'PCB_MISSING',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Monthly tax (PCB) is missing.',
    consequence:
      'Their payslip would show more take-home pay than they are really owed, and the clinic would pay LHDN too little for this month.',
    // "Kuwick does not work out monthly tax for you" survived here after the
    // MTD engine shipped — a false statement raised on the exact screen where
    // somebody decides what to do about the missing figure. The truthful remedy
    // comes first: complete the tax profile and the figure is CALCULATED.
    remediation:
      'Record their tax residence and MTD category so the figure is calculated from HASiL’s specification, enter the month’s PCB by hand, or record them as not paying PCB if that is genuinely their situation.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * SOMEBODY LEFT THIS MONTH, AND THEIR UNTAKEN LEAVE IS STILL OWED.
   *
   * The part-month itself was never the problem: `prorationFor` has always cut
   * a leaver's last month to the days served, inclusive of the last day worked.
   * What nothing did was SAY that the annual leave they never took is a debt
   * the clinic still owes them. A leaver simply stopped appearing, the month
   * footed correctly without them, and the payout was remembered or it was not.
   *
   * So this names them on the run, with the whole leave ledger — entitled,
   * carried in, adjusted, taken, left — and BLOCKS until somebody says what
   * happened to it. The days are arithmetic from the ledger and are certain.
   * WHAT THEY ARE WORTH IS NOT COMPUTED: how s.60E(3) values untaken leave on a
   * resignation, and whether days carried forward by clinic policy are valued
   * the same way as the Act's own entitlement, are questions the product does
   * not get to guess at. The breakdown is printed so whoever answers them can
   * apply the answer.
   *
   * Overridable, because the override IS the record: a clinic that has paid the
   * leave, or owes none, says so by name and the month closes.
   */
  LEAVER_UNTAKEN_LEAVE: {
    code: 'LEAVER_UNTAKEN_LEAVE',
    severity: 'BLOCKING',
    overridable: true,
    cause: (c) =>
      `${c.name} left on ${c.lastDay} with ${c.remaining} ${Number(c.remaining) === 1 ? 'day' : 'days'} of annual leave ` +
      `untaken: ${c.entitled} entitled${Number(c.carriedIn) > 0 ? `, ${c.carriedIn} carried in` : ''}` +
      `${Number(c.adjustment) !== 0 ? `, ${c.adjustment} adjusted` : ''}, ${c.taken} taken.`,
    consequence:
      'Their last month is already cut to the days they served, and that part is right. The untaken leave is a separate ' +
      'amount the clinic still owes and Kuwick does not work it out — so a month closed now is short by whatever those ' +
      'days are worth, and the payslip looks complete.',
    remediation:
      'Work out what the untaken days are worth, add it as a payroll input on this run so it appears on the payslip with ' +
      'a reason, then override this with what was paid. Override with the reason if there is genuinely nothing owed.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  UNAPPROVED_OVERTIME: {
    code: 'UNAPPROVED_OVERTIME',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.hours} hours of overtime need approval.`,
    consequence: 'The hours were clocked but nobody has approved them, so they will be paid less than they claimed.',
    remediation: 'Approve or reject the overtime on their timesheet.',
    deepLink: (c) => `/admin/hr/attendance?staffId=${c.staffId}`,
  },
  MISSING_PUNCH: {
    code: 'MISSING_PUNCH',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.days} ${Number(c.days) === 1 ? 'day has' : 'days have'} no clock-in or clock-out.`,
    consequence: 'Hours for those days are incomplete, so any overtime or attendance-based pay may be understated.',
    remediation: 'Correct those days on their timesheet.',
    deepLink: (c) => `/admin/hr/attendance?staffId=${c.staffId}`,
  },
  UNKNOWN_COMPONENT: {
    code: 'UNKNOWN_COMPONENT',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `Payroll input "${c.componentCode}" is not a known pay component.`,
    consequence: 'The amount was NOT included, so somebody is being paid less than was entered for them.',
    remediation: 'Add the component to the catalogue, or correct the input.',
    deepLink: () => '/admin/hr/employers',
  },
  NO_BANK_DETAILS: {
    code: 'NO_BANK_DETAILS',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'No bank account is recorded for this employee.',
    consequence: 'They cannot be included in a bank payment file and will have to be paid by another means.',
    remediation: 'Record the bank name, account number and account name.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NEGATIVE_NET: {
    code: 'NEGATIVE_NET',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `Deductions exceed earnings; net pay would be ${c.net}.`,
    consequence: 'A negative payslip cannot be paid, and would mean the employee owes the clinic money this month.',
    remediation: 'Reduce a deduction, or spread the recovery across periods.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * BLOCKING, and deliberately not overridable.
   *
   * This was a WARNING that let the run proceed on "the rate in force at the
   * period end", which silently pays the new salary for days worked at the old
   * one. Whether a mid-period change is prorated, paid forward or paid back is
   * a policy this clinic has not decided, and Malaysian practice does not
   * decide it for them. A prorated figure and a wrong one look identical on a
   * payslip, so the run stops and asks.
   */
  SALARY_CHANGED_MID_PERIOD: {
    code: 'SALARY_CHANGED_MID_PERIOD',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) =>
      `Salary changed from ${c.previousAmount} to ${c.nextAmount} on ${c.changedOn}, part-way through ${c.periodLabel}.`,
    consequence:
      'How a mid-period change is paid has not been decided for this clinic, so payroll will not assume one. ' +
      'This employee is left out of the run totals rather than paid a figure nobody chose.',
    remediation:
      'Decide the treatment for this employee: date the change from the start of a period, or split the run. ' +
      'Kuwick does not prorate a mid-period salary change.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  /*
   * The calculation models a MONTHLY salary. A daily or hourly rate needs a day
   * or hour count for the period, and where that count comes from — roster,
   * timesheet, or a contract minimum — is not settled. Paying a daily-rate
   * employee a monthly figure would be a silent, plausible-looking error.
   */
  SALARY_BASIS_UNSUPPORTED: {
    code: 'SALARY_BASIS_UNSUPPORTED',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `This employee is on a ${c.basis} rate, and this build calculates monthly salaries only.`,
    consequence: 'They are left out of the run rather than paid a monthly figure derived from a daily or hourly rate.',
    remediation:
      'Record a monthly salary for this employee, or leave them out of payroll until daily and hourly pay is implemented.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  STATUTORY_UNVERIFIED: {
    code: 'STATUTORY_UNVERIFIED',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'The EPF, SOCSO and EIS rates have not been checked.',
    consequence:
      'Every statutory figure in this run rests on tables nobody has confirmed against KWSP and PERKESO, and the payslip says so on its face.',
    remediation:
      'Check the rates in Payroll settings, or carry on knowing this run is provisional and must not be used to pay staff or file.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * INFO, and deliberately not a warning.
   *
   * A contractor is not an employee who cannot be paid — they are somebody this
   * run is not about. Their fee is a payable. Raising a blocker for every locum
   * every month would train the owner to click past blockers, which is how a
   * real one eventually gets clicked past too. It is recorded so the run can
   * account for everybody the clinic pays, not only everybody it payrolls.
   */
  CONTRACTOR_EXCLUDED: {
    code: 'CONTRACTOR_EXCLUDED',
    severity: 'INFO',
    overridable: false,
    cause: (c) => `${c.name} is engaged as a contractor, not an employee.`,
    consequence:
      'They are paid for their sessions as a professional fee through Finance, so they are not on this payroll ' +
      'and no EPF, SOCSO or EIS is contributed for them.',
    remediation:
      'Nothing to do, unless this person should in fact be an employee — in which case change their engagement.',
    deepLink: () => '/admin/hr/locum',
  },
  /*
   * AN EMPLOYEE-SPECIFIC STATUTORY UNKNOWN — the fail-safe, and the one
   * exception that must never become overridable.
   *
   * It used to fire only when a note matched /incomplete|outside every
   * configured/, which was a regex over prose and therefore a gate that any
   * rewording could open. It is now raised from the figures themselves: if EPF,
   * SOCSO or EIS came back NULL for this employee, this is raised, whatever the
   * reason and whatever the wording.
   *
   * Distinct from a run-level gap ("no schedule is in force for this period"),
   * which `statutoryStatus` carries.
   */
  /*
   * s.18A — a part-month, stated rather than silent.
   *
   * INFO, deliberately. A joiner or a leaver is an ordinary event and blocking
   * on one would train somebody to click past blockers. What is not acceptable
   * is a prorated figure appearing with nothing on screen saying why it is
   * smaller than the contract, which is indistinguishable from a bug.
   */
  /*
   * s.59 — no designated rest day, and somebody worked.
   *
   * BLOCKING, because the alternative is pricing a rest day as an ordinary
   * working day: 1.5× the hourly rate where the Act owes half a day or a whole
   * day at the ordinary rate, plus 2× beyond normal hours. That is an
   * underpayment, and an underpayment is the employer's liability rather than
   * a discrepancy somebody notices later.
   */
  /*
   * Above the First Schedule limit, with nothing recorded about what the
   * employer undertook.
   *
   * BLOCKING, and NOT because the employee is owed something — they may well
   * not be. It blocks because nobody has decided, and paying nil by default is
   * as much a decision as paying 1.5×. An employer that does not pay overtime
   * to senior staff says so once and never sees this again.
   */
  OVERTIME_ENTITLEMENT_UNRECORDED: {
    code: 'OVERTIME_ENTITLEMENT_UNRECORDED',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) =>
      `They worked extra hours, and on wages of ${String(c.wages)} a month the Employment Act's overtime provisions do not reach them.`,
    consequence:
      'The First Schedule limits ss.60, 60A and 60D to wages of RM4,000 a month or less, so nothing is owed ' +
      'statutorily. Whether they are paid anything is what the employer undertook, and nothing is recorded.',
    remediation:
      'Say on their employee record whether overtime is paid as a company benefit or not paid at all. Either answer settles it; leaving it blank does not.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /*
   * A RULE SET PAYING BELOW THE ACT, for somebody the Act reaches.
   *
   * Settings lets a rule set price a public-holiday shift at RM500, an hour of
   * overtime at RM40, or overtime at a multiplier the clinic chose. For an
   * employee within the First Schedule (wages of RM4,000 or less) ss.60, 60A
   * and 60D set minimums under all of it.
   *
   * THIS USED TO BLOCK, AND USED TO PAY THE ACT'S FIGURE INSTEAD. Both are
   * gone. Overruling the clinic put a number on a payslip nobody in the clinic
   * had chosen, and blocking treated a decision an employer is entitled to
   * take as an error to be corrected. The clinic's figure is paid; the rule
   * set carries a named, dated acknowledgement of what it is doing; and this
   * says, per employee and per month, who is affected and by how much.
   *
   * WARNING rather than BLOCKING, and not overridable — there is nothing to
   * override. It is not an obstacle, it is the record: the run goes through
   * and this stays on it, so the month can be read back later by somebody
   * asking who was paid under the Act and what was said about it at the time.
   */
  CLINIC_RATE_BELOW_STATUTORY: {
    code: 'CLINIC_RATE_BELOW_STATUTORY',
    severity: 'WARNING',
    overridable: false,
    cause: (c) =>
      `The "${String(c.ruleSet)}" rule set pays ${String(c.days)} day${Number(c.days) === 1 ? '' : 's'} of extra work at ` +
      `${String(c.clinic)} where the Employment Act requires ${String(c.statutory)}, on wages of ${String(c.wages)} a month.`,
    consequence:
      'Wages of RM4,000 a month or less are within the First Schedule, so ss.60, 60A and 60D apply. The clinic set these ' +
      'rates and acknowledged that they are under the Act, so they are what is paid. This employee receives less than the ' +
      'Act requires for these days, and the clinic owes the difference if it is ever claimed.',
    remediation:
      'Nothing is required to finish this run. To stop it recurring, raise the rate to the Act’s figure in Settings, or ' +
      'put this employee on a rule set that is at or above it.',
    deepLink: () => '/admin/hr/settings/payroll',
  },
  /*
   * LINDUNG 24 JAM with no participation recorded.
   *
   * BLOCKING, and the reason is the distinction the scheme itself turns on:
   * "declined" and "nobody asked" are different answers, and only the first is
   * a fact. Paying nil for the second is a guess that happens to be cheap for
   * the clinic and wrong for a foreign worker, for whom it is mandatory.
   *
   * Never inferred. Foreign-worker status is a PERKESO classification, not EPF
   * membership, tax residence or a nationality typed into a text box.
   */
  /**
   * THE EMPLOYER'S OWN STANDING, unrecorded. Run-level (no staffId): the levy
   * is 1% or 0.5% of every leviable wage in the month, so the gap belongs to
   * the run, not to a person — and repeating it per employee would bury the
   * real per-person exceptions under one fact.
   *
   * A WARNING, not a blocker: a clinic below the s.14 headcount that never
   * registered owes nothing, and stopping its payroll to say so would punish
   * the common case. The consequence is stated instead: if the employer IS
   * registered, the month's cost is understated and the levy still falls due.
   */
  /**
   * A branch-scoped run pays its branch. An employee whose STAFF record has
   * no home branch is therefore in NO branch's run — not this one, not any
   * other — and without this warning their absence was silent: the run
   * simply had one line fewer, month after month, and the register footed
   * perfectly around the person it was missing.
   */
  EMPLOYEE_IN_NO_BRANCH: {
    code: 'EMPLOYEE_IN_NO_BRANCH',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'This employee has no home branch on their staff record, and this payroll run covers one branch.',
    consequence:
      'A branch payroll pays the people of its branch, so somebody with no branch is in NO branch’s run — this ' +
      'month and every month — and nothing else would say so. They will not be paid through Kuwick until this ' +
      'is resolved.',
    remediation:
      'Set their home branch on the staff record so their branch’s run picks them up, or run payroll for every ' +
      'branch at once (a run with no branch selected), which pays everybody regardless.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  HRD_REGISTRATION_UNRECORDED: {
    code: 'HRD_REGISTRATION_UNRECORDED',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `Whether ${String(c.employerName)} is registered with HRD Corp is not recorded.`,
    consequence:
      'The HRD levy is not included in this month’s employer cost. If the employer is registered, the cost is ' +
      'understated and the levy still falls due to HRD Corp.',
    remediation:
      'Record the employer’s HRD Corp registration class — mandatory under s.14, optional under s.15, or not ' +
      'registered — on the legal employer, then recalculate. "Not registered" is an answer; leaving it blank is not.',
    deepLink: () => '/admin/hr/employers',
  },
  /*
   * THE EMPLOYER'S SELECTED EPF BASIS IS LOWER THAN KUWICK'S ASSESSMENT.
   *
   * ADVISORY, not blocking — a deliberate product decision. The employer is
   * entitled to run their payroll on the basis they have explicitly chosen,
   * recorded, dated and signed; Kuwick's job is to compute it faithfully, say
   * plainly and permanently how it differs from the Act as Kuwick reads it,
   * and let the month proceed. A missing FACT still blocks (see the codes
   * above): the distinction is a deliberate difference versus an unknown.
   *
   * What this must never do is call the selection compliant. The consequence
   * below states the shortfall in ringgit and says whose liability it remains,
   * in the same breath as letting the run continue — that is the honest
   * version of owner control, and the exception survives into the approved
   * snapshot so the statement cannot be lost afterwards.
   */
  EPF_BASIS_DISCREPANCY: {
    code: 'EPF_BASIS_DISCREPANCY',
    severity: 'WARNING',
    overridable: true,
    cause: (c) =>
      `EPF is being contributed on the employer-selected basis of RM${String(c.selectedBasis)}, ` +
      `RM${String(c.difference)} below the wages Kuwick assesses as EPF-liable.`,
    consequence: (c) =>
      `Gross earnings RM${String(c.gross)}. Kuwick assesses EPF wages of RM${String(c.assessedBasis)}; the ` +
      `employer-selected contribution basis is RM${String(c.selectedBasis)}, a difference of RM${String(c.difference)} ` +
      `— excluding ${String(c.components)}. Selected from ${String(c.effectiveFrom)} by ${String(c.selectedBy)}: ` +
      `“${String(c.selectionReason)}”. Both the employee's share and the clinic's are calculated on the ` +
      'selected basis, so they are lower than Kuwick assesses as due. This is the employer’s decision and it is ' +
      'recorded as one: Kuwick does not treat it as meeting the Act, and any shortfall against the Act stays the ' +
      'employer’s to make good.',
    remediation:
      'Nothing is required — the month can be approved as it stands. If the difference was not intended, tick the ' +
      'component into the EPF basis (or set the basis to “All applicable earnings”) and recalculate. If the ' +
      'component genuinely sits outside EPF wages, that is a fact about the COMPONENT rather than about this ' +
      'employee: correct its statutory treatment in the pay-component catalogue, with the authority reference, and ' +
      'Kuwick’s assessment follows.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /** Mirrors a mid-month salary change: either figure looks correct. */
  EPF_BASIS_CHANGED_MID_PERIOD: {
    code: 'EPF_BASIS_CHANGED_MID_PERIOD',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `The EPF contribution basis changed on ${String(c.changedOn)}, part-way through this period.`,
    consequence:
      'The month’s EPF would look correct computed on either selection, and nothing decides which one the month ' +
      'should follow.',
    remediation:
      'Set the change to take effect from the first day of a month — the recorded date can be corrected on the ' +
      'employee’s EPF basis history — then recalculate.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /** Mirrors a mid-month classification change: either figure looks correct. */
  HRD_REGISTRATION_CHANGED_MID_PERIOD: {
    code: 'HRD_REGISTRATION_CHANGED_MID_PERIOD',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) =>
      `${String(c.employerName)}’s HRD Corp registration class changed on ${String(c.changedOn)}, part-way through this period.`,
    consequence:
      'Nothing decides whether the month’s levy follows the old class or the new one, and both figures would look ' +
      'correct on the employer cost.',
    remediation:
      'Set the change to take effect from the first day of a month — the recorded date can be corrected on the ' +
      'legal employer’s statutory profile — then recalculate.',
    deepLink: () => '/admin/hr/employers',
  },
  LINDUNG_PARTICIPATION_UNRECORDED: {
    code: 'LINDUNG_PARTICIPATION_UNRECORDED',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'It is not recorded whether this employee is in LINDUNG 24 JAM.',
    consequence:
      'The Non-Employment Injury Scheme is voluntary for local employees and mandatory for foreign workers, and ' +
      'the contribution is borne by the employee. Without knowing which they are, the deduction cannot be worked out.',
    remediation:
      'Record their LINDUNG 24 JAM participation on the employee record — foreign worker, opted in, or not participating.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /**
   * NOTHING SAYS WHAT THIS PERSON'S STATUTORY STANDING WAS THAT MONTH.
   *
   * Distinct from a MISSING classification field. EPF membership unrecorded is
   * one unknown answer inside a standing that exists; this is no standing on
   * record at all for the period — usually somebody hired after the last
   * version was written, or a period before their first version starts.
   */
  /**
   * THE RUN IS SCOPED TO AN EMPLOYING COMPANY; THE BRANCH IS NOT THE COMPANY.
   *
   * Raised where somebody works at this run's branch but is employed by a
   * different entity. Excluded, and said out loud: a missing payslip is only
   * safe if the person can be told which run they are in.
   */
  EMPLOYED_BY_ANOTHER_COMPANY: {
    code: 'EMPLOYED_BY_ANOTHER_COMPANY',
    severity: 'INFO',
    overridable: false,
    cause: (c) => `Employed by ${c.employerName}, not ${c.runEmployerName}.`,
    consequence:
      'EPF, SOCSO, EIS and monthly tax are filed by the employing entity, so they are paid in that company’s ' +
      'run and left out of this one. Nothing is owed to them here.',
    remediation:
      'Nothing, if that is right. If they moved company, change the employing company on their employee record ' +
      'before this month is calculated.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /**
   * An off-cycle run pays what was keyed for the period and nothing else. Most
   * of the workforce will have nothing in a bonus round, and that is normal —
   * INFO, so it is visible without burying the rows that need attention.
   */
  NOTHING_TO_PAY_OFF_CYCLE: {
    code: 'NOTHING_TO_PAY_OFF_CYCLE',
    severity: 'INFO',
    overridable: false,
    cause: (c) => `Nothing is keyed for this employee in ${c.periodLabel}.`,
    consequence:
      'An off-cycle run pays only what was entered for it, so there is no payslip to produce for them. A zero ' +
      'payslip would sit in the register looking like a payment that failed.',
    remediation: 'Nothing, unless they were meant to be included — then enter their amount and recalculate.',
    deepLink: () => '/admin/hr/payroll',
  },
  NO_STATUTORY_CLASSIFICATION: {
    code: 'NO_STATUTORY_CLASSIFICATION',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `No statutory classification is on record for this employee for ${c.periodLabel}.`,
    consequence:
      'EPF, SOCSO, EIS, LINDUNG and PCB all turn on classifications that are recorded from a date. With none in ' +
      'force for this month there is nothing to compute from, and a payslip would be contributing on assumptions.',
    remediation:
      'Record their statutory classification from a date on or before the start of this period, on the employee record.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /**
   * The classification analogue of SALARY_CHANGED_MID_PERIOD, and refused for
   * the same reason: two lawful answers, no rule choosing between them, and
   * both look like a correct figure on a payslip.
   */
  STATUTORY_CLASSIFICATION_CHANGED_MID_PERIOD: {
    code: 'STATUTORY_CLASSIFICATION_CHANGED_MID_PERIOD',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) =>
      `This employee's statutory classification changed on ${c.changedOn}, part-way through ${c.periodLabel} (${c.changed}).`,
    consequence:
      'A contribution is worked out for a whole wage period, and nothing decides whether the month follows the ' +
      'old standing or the new one. Kuwick will not pick, so this employee is left out of the run totals.',
    remediation:
      'Date the change from the start of a period, or split the run. Kuwick does not apportion a mid-period ' +
      'classification change across two rates.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  NO_REST_DAY: {
    code: 'NO_REST_DAY',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'No rest day is designated for this employee.',
    consequence:
      'Work on a rest day is paid in days at the ordinary rate under s.60(3), not as hours of overtime, so ' +
      'without knowing which day it is their extra hours cannot be priced correctly.',
    remediation:
      'Set the rest day on their employee record. The Employment Act requires one a week, chosen by the employer and told to the employee.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  PART_MONTH: {
    code: 'PART_MONTH',
    severity: 'INFO',
    overridable: false,
    cause: (c) => String(c.note),
    consequence:
      'Their basic pay is worked out under s.18A of the Employment Act — the monthly wage divided by the days ' +
      'in this month, times the days they served. Overtime is still priced on their full monthly wage.',
    remediation: 'Nothing to do, unless the start or end date on their record is wrong.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /*
   * Somebody the run would otherwise have paid a whole month, who was not
   * employed for a single day of it. Almost always a leaver whose record is
   * still marked ACTIVE, which is a data problem rather than a pay problem —
   * so they are excluded and named, not paid nought and listed.
   */
  NOT_EMPLOYED_IN_PERIOD: {
    code: 'NOT_EMPLOYED_IN_PERIOD',
    severity: 'WARNING',
    overridable: true,
    cause: (c) =>
      `They were not employed during this month${c.endDate ? ` — they left on ${String(c.endDate)}` : c.startDate ? ` — they start on ${String(c.startDate)}` : ''}.`,
    consequence: 'They are left off this payroll entirely rather than paid a part-month of nought.',
    remediation:
      'If that is right, nothing to do. If they did work this month, correct their start or end date and recalculate.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  STATUTORY_UNKNOWN: {
    code: 'STATUTORY_UNKNOWN',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => String(c.note),
    consequence:
      'A statutory figure for this employee could not be worked out, so their payslip is incomplete and the ' +
      'contribution that would be filed for them is unknown — not nil.',
    remediation: 'Record what is missing on the employee, then recalculate the run.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  VARIANCE_OUTSIDE_THRESHOLD: {
    code: 'VARIANCE_OUTSIDE_THRESHOLD',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `Take-home pay moved ${c.percent}% against last month.`,
    consequence: 'A change this size is usually a mistake in the month rather than a real one.',
    remediation: 'Open them and check their hours, salary and anything added this month.',
    deepLink: () => '/admin/hr/payroll',
  },
};

export interface BuiltException {
  code: string;
  severity: ExceptionSeverity;
  staffId: string | null;
  cause: string;
  consequence: string;
  remediation: string;
  deepLink: string | null;
  overridable: boolean;
}

export function buildException(
  code: keyof typeof EXCEPTION_CATALOGUE,
  staffId: string | null,
  ctx: Record<string, string | number> = {},
): BuiltException {
  const t = EXCEPTION_CATALOGUE[code];
  if (!t) throw new Error(`Unknown payroll exception code: ${code}`);
  return {
    code: t.code,
    severity: t.severity,
    staffId,
    cause: t.cause(ctx),
    consequence: typeof t.consequence === 'function' ? t.consequence(ctx) : t.consequence,
    remediation: t.remediation,
    deepLink: t.deepLink ? t.deepLink(ctx) : null,
    overridable: t.overridable,
  };
}

/**
 * Whether a run may be approved.
 *
 * BLOCKING gates approval. WARNING does not — that distinction is the whole
 * point of having severities, and it is what stops a purely informational
 * observation from making a run unapprovable. An overridden blocking exception
 * only counts as resolved if it was overridable in the first place, which the
 * database also enforces.
 */
export interface ExceptionGate {
  canApprove: boolean;
  /** Every exception row on the run, whatever its severity or override state. */
  total: number;
  /** BLOCKING rows that are still standing. These, and only these, stop approval. */
  blocking: number;
  warnings: number;
  info: number;
  overridden: number;
  reason: string;
}

/**
 * THE ONE PLACE EXCEPTION STATE IS COUNTED.
 *
 * Every surface that says anything about a run's exceptions — the banner, the
 * run table's column, the exception centre, the approval button, the approval
 * confirmation — takes its numbers from this function, applied to the
 * `payroll_exceptions` ROWS. It returns the whole vocabulary those surfaces
 * need rather than just the gate, so that none of them has to count anything
 * for itself.
 *
 * That is not tidiness. The run's legacy `exceptions` JSON blob and the rows
 * are two stores of the same fact, and while the banner read one and the gate
 * read the other, a run could say "5 exceptions must be resolved" beside an
 * enabled Approve button and an exception centre reading "No exceptions". A
 * payroll screen that contradicts itself about who cannot be paid is worse
 * than one that says nothing.
 */
export function approvalGate(
  exceptions: { severity: ExceptionSeverity; overridable: boolean; overriddenByStaffId: string | null }[],
): ExceptionGate {
  const blockingRows = exceptions.filter(
    (e) => e.severity === 'BLOCKING' && !(e.overridable && e.overriddenByStaffId),
  );
  const warnings = exceptions.filter((e) => e.severity === 'WARNING').length;
  const info = exceptions.filter((e) => e.severity === 'INFO').length;
  const overridden = exceptions.filter((e) => e.overriddenByStaffId).length;
  return {
    canApprove: blockingRows.length === 0,
    total: exceptions.length,
    blocking: blockingRows.length,
    warnings,
    info,
    overridden,
    reason:
      blockingRows.length === 0
        ? warnings > 0
          ? `${warnings} warning(s) noted; none of them prevents approval.`
          : 'No exceptions.'
        : `${blockingRows.length} blocking exception(s) must be resolved before this run can be approved.`,
  };
}
