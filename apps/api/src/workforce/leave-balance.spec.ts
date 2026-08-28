import { computeLeaveBalance, leaveDays, leaveDaysInYear, proRateEntitlement } from './leave-balance';

describe('leave balance', () => {
  describe('leaveDays', () => {
    it('counts both ends — a one-day leave is one day, not zero', () => {
      expect(leaveDays({ startDate: '2026-08-03', endDate: '2026-08-03' })).toBe(1);
      expect(leaveDays({ startDate: '2026-08-03', endDate: '2026-08-07' })).toBe(5);
    });

    it('is zero for a backwards range rather than negative', () => {
      expect(leaveDays({ startDate: '2026-08-07', endDate: '2026-08-03' })).toBe(0);
    });

    it('splits a leave that spans New Year across two years', () => {
      const range = { startDate: '2026-12-28', endDate: '2027-01-03' };
      expect(leaveDays(range)).toBe(7);
      expect(leaveDaysInYear(range, 2026)).toBe(4);
      expect(leaveDaysInYear(range, 2027)).toBe(3);
      expect(leaveDaysInYear(range, 2026) + leaveDaysInYear(range, 2027)).toBe(leaveDays(range));
    });
  });

  describe('computeLeaveBalance', () => {
    const base = { entitledDays: 14, year: 2026 };

    it('deducts only APPROVED leave, and reports pending separately', () => {
      const balance = computeLeaveBalance({
        ...base,
        requests: [
          { startDate: '2026-03-02', endDate: '2026-03-06', status: 'APPROVED' },
          { startDate: '2026-06-01', endDate: '2026-06-03', status: 'PENDING' },
          { startDate: '2026-07-01', endDate: '2026-07-10', status: 'REJECTED' },
        ],
      });
      expect(balance.taken).toBe(5);
      expect(balance.pending).toBe(3);
      expect(balance.remaining).toBe(9);
      expect(balance.overdrawn).toBe(false);
    });

    it('adds carried-forward days and manual adjustments to what is available', () => {
      const balance = computeLeaveBalance({
        ...base,
        carriedInDays: 3,
        adjustmentDays: -1,
        requests: [],
      });
      expect(balance.available).toBe(16);
      expect(balance.remaining).toBe(16);
    });

    it('reports an overdrawn balance rather than clamping it at zero', () => {
      // A clinic that let somebody take more than they had needs to SEE that,
      // because it becomes an unpaid-leave deduction on the payslip.
      const balance = computeLeaveBalance({
        ...base,
        entitledDays: 5,
        requests: [{ startDate: '2026-03-02', endDate: '2026-03-11', status: 'APPROVED' }],
      });
      expect(balance.taken).toBe(10);
      expect(balance.remaining).toBe(-5);
      expect(balance.overdrawn).toBe(true);
    });

    it('counts only the part of a New Year leave that falls in this year', () => {
      const balance = computeLeaveBalance({
        ...base,
        requests: [{ startDate: '2026-12-28', endDate: '2027-01-03', status: 'APPROVED' }],
      });
      expect(balance.taken).toBe(4);
    });
  });

  describe('proRateEntitlement', () => {
    it('gives a full year to somebody employed all year', () => {
      expect(proRateEntitlement(14, 2026, '2020-01-01', null)).toBe(14);
    });

    it('halves it for a July joiner, to the nearest half day', () => {
      expect(proRateEntitlement(14, 2026, '2026-07-01', null)).toBe(7);
    });

    it('pro-rates a leaver', () => {
      // Jan–Mar of a 365-day year is 90 days: 14 × 90/365 = 3.45 → 3.5
      expect(proRateEntitlement(14, 2026, '2020-01-01', '2026-03-31')).toBe(3.5);
    });

    it('is zero for somebody who left before the year began', () => {
      expect(proRateEntitlement(14, 2026, '2020-01-01', '2025-12-31')).toBe(0);
    });
  });
});
