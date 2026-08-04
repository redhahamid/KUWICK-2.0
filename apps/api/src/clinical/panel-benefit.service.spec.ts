import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PanelBenefitService } from './panel-benefit.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-3b1a (D-092) — THE VISIT-SPECIFIC PANEL BENEFIT SNAPSHOT
//
// Two rules carry this checkpoint:
//   selecting a panel is NOT verifying it, and
//   an override replaces the working terms, never the record of what
//   verification actually said.
// ===========================================================================

const OWNER = { id: 'own-1', fullName: 'Owner', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' };
const FRONT_DESK = { id: 'fd-1', fullName: 'Amy', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-1', userId: 'u2' };
const FINANCE = { id: 'fin-1', fullName: 'Faiz', role: 'FINANCE_STAFF', active: true, clinicId: 'clinic-1', userId: 'u3' };
const DOCTOR = { id: 'dr-1', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u4' };

const PANEL_VISIT = {
  id: 'visit-1',
  panelClinicId: 'panel-aia',
  checkOutAt: null,
  panelMemberReference: null,
  panelVerificationStatus: 'PENDING_VERIFICATION',
  panelCoverageType: null,
  panelVisitLimitAmount: null,
  panelCopaymentType: null,
  panelCopaymentValue: null,
  panelOriginalVerificationStatus: null,
  panelOriginalVisitLimitAmount: null,
  panelOriginalCopaymentType: null,
  panelOriginalCopaymentValue: null,
};

function build(actor: Record<string, unknown> | null, world: { visit?: Record<string, unknown> | null; branchCount?: number } = {}) {
  const { visit = { ...PANEL_VISIT }, branchCount = 1 } = world;
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : null)) },
    clinic: { count: jest.fn().mockResolvedValue(branchCount) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: {
      findUnique: jest.fn(async ({ select }: any) =>
        // assertMayTouchVisit asks for clinicId only; the service asks wider.
        visit === null ? null : select?.clinicId && !select?.panelClinicId ? { clinicId: 'clinic-1' } : visit,
      ),
      update: jest.fn(async ({ data }: any) => ({ id: 'visit-1', ...data })),
    },
  };
  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as never;
  return { service: new PanelBenefitService(rawPrisma), tx, actorId: (actor?.id as string) ?? undefined };
}

const runVerify = (ctx: ReturnType<typeof build>, dto: Record<string, unknown>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.recordVerification('visit-1', dto as never),
  );

const runOverride = (ctx: ReturnType<typeof build>, dto: Record<string, unknown>) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.overrideBenefit('visit-1', dto as never),
  );

const VERIFIED_LIMITED = {
  status: 'VERIFIED',
  coverageType: 'VISIT_LIMIT',
  visitLimitAmount: 200,
  copaymentType: 'FIXED_AMOUNT',
  copaymentValue: 10,
  memberReference: 'AIA-889123',
  verificationReference: 'PORTAL-2026-0803-17',
};

describe('who may record and who may override', () => {
  it.each([
    ['owner', OWNER],
    ['front desk', FRONT_DESK],
    ['finance', FINANCE],
  ])('%s may record a verification', async (_n, actor) => {
    await expect(runVerify(build(actor), VERIFIED_LIMITED)).resolves.toMatchObject({
      panelVerificationStatus: 'VERIFIED',
    });
  });

  it('a doctor may not record a verification — it is counter work', async () => {
    const ctx = build(DOCTOR);
    await expect(runVerify(ctx, VERIFIED_LIMITED)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it.each([
    ['front desk', FRONT_DESK],
    ['doctor', DOCTOR],
  ])('%s may not override benefit terms — that is a financial correction', async (_n, actor) => {
    const ctx = build(actor);
    await expect(
      runOverride(ctx, { coverageType: 'UNLIMITED', copaymentType: 'NONE', reason: 'HR confirmed by phone' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('anonymous and inactive actors are refused', async () => {
    await expect(runVerify(build(null), VERIFIED_LIMITED)).rejects.toThrow(ForbiddenException);
    await expect(runVerify(build({ ...FRONT_DESK, active: false }), VERIFIED_LIMITED)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('cross-branch access is refused', async () => {
    const ctx = build({ ...FRONT_DESK, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(runVerify(ctx, VERIFIED_LIMITED)).rejects.toThrow(ForbiddenException);
  });

  it('a foreign tenant visit reads as the same 404 as a missing one', async () => {
    await expect(runVerify(build(FRONT_DESK, { visit: null }), VERIFIED_LIMITED)).rejects.toThrow(NotFoundException);
  });
});

describe('what can be recorded', () => {
  it('a VERIFIED result stores the working terms AND the original terms, once', async () => {
    const ctx = build(FRONT_DESK);
    await runVerify(ctx, VERIFIED_LIMITED);
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({
      panelVerificationStatus: 'VERIFIED',
      panelVerifiedByStaffId: FRONT_DESK.id,
      panelMemberReference: 'AIA-889123',
      panelVerificationReference: 'PORTAL-2026-0803-17',
      panelCoverageType: 'VISIT_LIMIT',
      panelVisitLimitAmount: 200,
      panelCopaymentType: 'FIXED_AMOUNT',
      panelCopaymentValue: 10,
      panelOriginalVerificationStatus: 'VERIFIED',
      panelOriginalVisitLimitAmount: 200,
      panelOriginalCopaymentType: 'FIXED_AMOUNT',
      panelOriginalCopaymentValue: 10,
    });
    expect(data.panelVerifiedAt).toBeInstanceOf(Date);
  });

  it('a RE-verification updates working terms but never rewrites the originals', async () => {
    const ctx = build(FRONT_DESK, {
      visit: {
        ...PANEL_VISIT,
        panelVerificationStatus: 'VERIFIED',
        panelOriginalVerificationStatus: 'VERIFIED',
        panelOriginalVisitLimitAmount: 200,
      },
    });
    await runVerify(ctx, { ...VERIFIED_LIMITED, visitLimitAmount: 250 });
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data.panelVisitLimitAmount).toBe(250);
    expect(data).not.toHaveProperty('panelOriginalVisitLimitAmount');
    expect(data).not.toHaveProperty('panelOriginalVerificationStatus');
  });

  it('a FAILED verification stores the outcome and NO terms', async () => {
    const ctx = build(FRONT_DESK);
    await runVerify(ctx, { status: 'FAILED', verificationReference: 'Portal timeout' });
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data.panelVerificationStatus).toBe('FAILED');
    expect(data.panelCoverageType).toBeNull();
    expect(data.panelVisitLimitAmount).toBeNull();
    expect(data.panelCopaymentType).toBeNull();
  });

  it('a visit with no panel is refused', async () => {
    const ctx = build(FRONT_DESK, { visit: { ...PANEL_VISIT, panelClinicId: null } });
    await expect(runVerify(ctx, VERIFIED_LIMITED)).rejects.toThrow(/no panel/i);
  });

  it('a completed visit is locked — its snapshot is history', async () => {
    const ctx = build(FRONT_DESK, { visit: { ...PANEL_VISIT, checkOutAt: new Date() } });
    await expect(runVerify(ctx, VERIFIED_LIMITED)).rejects.toThrow(/already completed/i);
  });
});

describe('term validation fails closed', () => {
  const verified = (over: Record<string, unknown>) => ({ status: 'VERIFIED', ...over });

  it.each([
    ['VERIFIED without a coverage type', verified({})],
    ['VISIT_LIMIT without a limit', verified({ coverageType: 'VISIT_LIMIT' })],
    ['VISIT_LIMIT with a zero limit', verified({ coverageType: 'VISIT_LIMIT', visitLimitAmount: 0 })],
    ['UNLIMITED carrying a limit', verified({ coverageType: 'UNLIMITED', visitLimitAmount: 100 })],
    ['FIXED_AMOUNT copay without a value', verified({ coverageType: 'UNLIMITED', copaymentType: 'FIXED_AMOUNT' })],
    ['NONE copay carrying a value', verified({ coverageType: 'UNLIMITED', copaymentType: 'NONE', copaymentValue: 5 })],
    [
      'percentage copay above 100',
      verified({ coverageType: 'UNLIMITED', copaymentType: 'PERCENTAGE', copaymentValue: 120 }),
    ],
  ])('%s is refused', async (_n, dto) => {
    const ctx = build(FRONT_DESK);
    await expect(runVerify(ctx, dto)).rejects.toThrow(BadRequestException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('an omitted copayment type is stored as NONE, explicitly', async () => {
    const ctx = build(FRONT_DESK);
    await runVerify(ctx, { status: 'VERIFIED', coverageType: 'UNLIMITED' });
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data.panelCopaymentType).toBe('NONE');
    expect(data.panelCopaymentValue).toBeNull();
  });

  it('a percentage copay within (0, 100] is accepted', async () => {
    const ctx = build(FINANCE);
    await runVerify(ctx, {
      status: 'VERIFIED',
      coverageType: 'UNLIMITED',
      copaymentType: 'PERCENTAGE',
      copaymentValue: 10,
    });
    expect((ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data.panelCopaymentValue).toBe(10);
  });
});

describe('override preserves the record', () => {
  it('an override on an unverified visit records PENDING as the original truth', async () => {
    // Nobody verified anything; the override must not invent a verification.
    const ctx = build(FINANCE);
    await runOverride(ctx, {
      coverageType: 'VISIT_LIMIT',
      visitLimitAmount: 150,
      copaymentType: 'NONE',
      reason: 'Panel HR confirmed terms by phone; portal is down',
    });
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({
      panelVerificationStatus: 'OVERRIDDEN',
      panelVisitLimitAmount: 150,
      panelBenefitOverriddenByStaffId: FINANCE.id,
      panelBenefitOverrideReason: 'Panel HR confirmed terms by phone; portal is down',
      panelOriginalVerificationStatus: 'PENDING_VERIFICATION',
      panelOriginalVisitLimitAmount: null,
    });
    expect(data.panelBenefitOverriddenAt).toBeInstanceOf(Date);
  });

  it('an override after verification keeps the verified originals untouched', async () => {
    const ctx = build(OWNER, {
      visit: {
        ...PANEL_VISIT,
        panelVerificationStatus: 'VERIFIED',
        panelVisitLimitAmount: 200,
        panelOriginalVerificationStatus: 'VERIFIED',
        panelOriginalVisitLimitAmount: 200,
      },
    });
    await runOverride(ctx, {
      coverageType: 'VISIT_LIMIT',
      visitLimitAmount: 300,
      copaymentType: 'NONE',
      reason: 'GL letter raises this visit to RM300',
    });
    const data = (ctx.tx.visit.update as jest.Mock).mock.calls[0][0].data;
    expect(data.panelVisitLimitAmount).toBe(300);
    expect(data).not.toHaveProperty('panelOriginalVisitLimitAmount');
  });

  it('override terms are validated by the same fail-closed rules', async () => {
    const ctx = build(FINANCE);
    await expect(
      runOverride(ctx, { coverageType: 'VISIT_LIMIT', copaymentType: 'NONE', reason: 'missing the limit' }),
    ).rejects.toThrow(BadRequestException);
  });
});
