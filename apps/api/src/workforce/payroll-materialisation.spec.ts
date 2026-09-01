import {
  ExistingInput,
  MaterialisedInput,
  materialiseClaim,
  materialiseIncentives,
  materialiseOvertime,
  materialiseUnpaidLeave,
  planMaterialisation,
} from './payroll-materialisation';

const SEP = new Date('2026-09-01T00:00:00.000Z');

describe('materialising overtime', () => {
  it('carries approved minutes at the hourly rate times the multiplier', () => {
    const out = materialiseOvertime({
      staffId: 's1',
      approvedOvertimeMinutes: 330, // 5.5 hours
      overtimeHourlyCents: 1641,
      multiplier: 1.5,
      sourceRecordIds: ['att-1'],
      approverName: 'Dr Aisyah Rahman',
    });
    expect(out).not.toBeNull();
    // 1641 x 1.5 = 2462 (rounded before multiplying by hours, as the clinic's
    // own workbook does), x 5.5 = 13541
    expect(out!.amountCents).toBe(13541);
    expect(out!.source).toBe('ATTENDANCE');
    expect(out!.sourceRecordId).toBe('att-1');
  });

  it('says where the figure came from, in words, including the approver', () => {
    const out = materialiseOvertime({
      staffId: 's1', approvedOvertimeMinutes: 330, overtimeHourlyCents: 1641,
      multiplier: 1.5, sourceRecordIds: ['a', 'b'], approverName: 'Dr Aisyah Rahman',
    });
    expect(out!.provenance).toMatch(/5\.5 approved hours from the timesheet/);
    expect(out!.provenance).toMatch(/approved by Dr Aisyah Rahman/);
    // Many rows behind one figure: the id is not a single row's.
    expect(out!.sourceRecordId).toBeNull();
  });

  it('carries NOTHING when no overtime was approved — unapproved hours are not paid', () => {
    expect(
      materialiseOvertime({
        staffId: 's1', approvedOvertimeMinutes: 0, overtimeHourlyCents: 1641,
        multiplier: 1.5, sourceRecordIds: [], approverName: null,
      }),
    ).toBeNull();
  });
});

describe('materialising unpaid leave', () => {
  const leave = (over = {}) => ({
    staffId: 's1', leaveRequestId: 'lv-1', leaveType: 'UNPAID', unpaidDays: 1,
    dailyRateCents: 14000, approverName: 'Dr Aisyah Rahman',
    startDate: SEP, endDate: SEP, ...over,
  });

  it('deducts approved unpaid days at the policy daily rate', () => {
    const out = materialiseUnpaidLeave([leave()]);
    expect(out!.amountCents).toBe(14000);
    expect(out!.componentCode).toBe('UNPAID_LEAVE');
    expect(out!.source).toBe('LEAVE');
    expect(out!.sourceRecordId).toBe('lv-1');
  });

  it('produces nothing for paid leave — no payroll effect, no row to explain', () => {
    expect(materialiseUnpaidLeave([leave({ unpaidDays: 0 })])).toBeNull();
    expect(materialiseUnpaidLeave([])).toBeNull();
  });

  it('names the leave record and the approver so the owner never re-keys the days', () => {
    const out = materialiseUnpaidLeave([leave()]);
    expect(out!.provenance).toMatch(/1 approved unpaid day from the leave record/);
    expect(out!.provenance).toMatch(/approved by Dr Aisyah Rahman/);
  });
});

describe('materialising incentives', () => {
  it('takes the APPROVED amount and does not recompute it', () => {
    const out = materialiseIncentives([
      { staffId: 's1', incentiveResultId: 'ir-1', incentiveRunId: 'run-1', amountCents: 26000, earnedPeriod: SEP, approverName: 'Dr Aisyah Rahman' },
    ]);
    expect(out!.amountCents).toBe(26000);
    expect(out!.earnedPeriod).toEqual(SEP);
    expect(out!.provenance).toMatch(/from the 2026-09 incentive run/);
  });
});

describe('materialising claims', () => {
  it('carries the approved amount with the claim id behind it', () => {
    const out = materialiseClaim({
      staffId: 's1', claimId: 'cl-1', category: 'MEDICAL', amountCents: 8640,
      claimDate: new Date('2026-09-14T00:00:00.000Z'), approverName: 'Chandra Devi',
    });
    expect(out!.amountCents).toBe(8640);
    expect(out!.sourceRecordId).toBe('cl-1');
    expect(out!.label).toBe('Medical claim');
    expect(out!.earnedPeriod).toEqual(SEP);
  });
});

describe('the materialisation plan is idempotent', () => {
  const input = (over: Partial<MaterialisedInput> = {}): MaterialisedInput => ({
    staffId: 's1', componentCode: 'OVERTIME', label: 'Overtime', amountCents: 13541,
    source: 'ATTENDANCE', sourceRecordId: 'att-1', earnedPeriod: null,
    provenance: '5.5 approved hours', approvedBy: null, ...over,
  });
  const existing = (over: Partial<ExistingInput> = {}): ExistingInput => ({
    id: 'in-1', componentCode: 'OVERTIME', source: 'ATTENDANCE',
    amountCents: 13541, sourceRecordId: 'att-1', ...over,
  });

  it('creates what is missing', () => {
    const plan = planMaterialisation([input()], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
  });

  it('RECALCULATING CHANGES NOTHING when the upstream fact has not moved', () => {
    const plan = planMaterialisation([input()], [existing()]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.remove).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it('updates in place when the amount moved — never creates a second row', () => {
    const plan = planMaterialisation([input({ amountCents: 20000 })], [existing()]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toEqual([{ id: 'in-1', input: input({ amountCents: 20000 }) }]);
    expect(plan.remove).toHaveLength(0);
  });

  it('removes a derived input whose upstream fact is gone — rejected overtime stops being paid', () => {
    const plan = planMaterialisation([], [existing()]);
    expect(plan.remove).toEqual(['in-1']);
  });

  it('NEVER touches a manual input — a hand-entered PCB figure survives recalculation', () => {
    const plan = planMaterialisation([], [existing({ id: 'pcb-1', componentCode: 'PCB', source: 'MANUAL', sourceRecordId: null })]);
    expect(plan.remove).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it('keeps two claims in one month apart instead of letting the second overwrite the first', () => {
    const claimA = input({ componentCode: 'CLAIM_REIMBURSEMENT', sourceRecordId: 'cl-1', amountCents: 8640, source: 'CLAIM' });
    const claimB = input({ componentCode: 'CLAIM_REIMBURSEMENT', sourceRecordId: 'cl-2', amountCents: 12000, source: 'CLAIM' });
    const plan = planMaterialisation([claimA, claimB], []);
    expect(plan.create).toHaveLength(2);

    // And a second calculation leaves both alone.
    const settled = planMaterialisation(
      [claimA, claimB],
      [
        existing({ id: 'a', componentCode: 'CLAIM_REIMBURSEMENT', source: 'CLAIM', sourceRecordId: 'cl-1', amountCents: 8640 }),
        existing({ id: 'b', componentCode: 'CLAIM_REIMBURSEMENT', source: 'CLAIM', sourceRecordId: 'cl-2', amountCents: 12000 }),
      ],
    );
    expect(settled.unchanged).toBe(2);
    expect(settled.create).toHaveLength(0);
    expect(settled.remove).toHaveLength(0);
  });

  it('removes only the claim that was withdrawn, leaving the other paid', () => {
    const claimA = input({ componentCode: 'CLAIM_REIMBURSEMENT', sourceRecordId: 'cl-1', amountCents: 8640, source: 'CLAIM' });
    const plan = planMaterialisation(
      [claimA],
      [
        existing({ id: 'a', componentCode: 'CLAIM_REIMBURSEMENT', source: 'CLAIM', sourceRecordId: 'cl-1', amountCents: 8640 }),
        existing({ id: 'b', componentCode: 'CLAIM_REIMBURSEMENT', source: 'CLAIM', sourceRecordId: 'cl-2', amountCents: 12000 }),
      ],
    );
    expect(plan.remove).toEqual(['b']);
    expect(plan.unchanged).toBe(1);
  });
});
