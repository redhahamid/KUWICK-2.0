import { PayrollRunStatus, Prisma } from '@prisma/client';

/**
 * WHEN A PAYSLIP REACHES THE EMPLOYEE: once the salary has gone out.
 *
 * A month paid on one date reads PAID at that moment. A month paid on several
 * — salary on the 30th, a director's fee on the 1st, overtime and claims on
 * the 15th — reads PAID only after its last transfer, but its salary went out
 * on the first, and the payslip goes with the salary. `paymentDate` is written
 * only when the salary transfer is recorded, so an approved month nobody has
 * paid stays out of the portal, as before.
 */
export const PAYSLIP_RELEASED: Prisma.PayrollRunWhereInput = {
  OR: [{ status: PayrollRunStatus.PAID }, { status: PayrollRunStatus.APPROVED, paymentDate: { not: null } }],
};

export function payslipReleased(run: { status: string; paymentDate: Date | null }): boolean {
  return run.status === PayrollRunStatus.PAID || (run.status === PayrollRunStatus.APPROVED && run.paymentDate !== null);
}
