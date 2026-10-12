import { PayrollPayslipService } from './payroll-payslip.service';
import type { SnapshotEmployer, SnapshotPayload } from './payroll-snapshot';

/*
 * THE EMPLOYER AS IT STOOD AT APPROVAL (owner, 12 October 2026: "Payslips are
 * historical documents"). A record approved before the details were frozen
 * with it is rebuilt from the audit trail. Demo employer only.
 */
const today = {
  id: 'emp-1',
  name: 'Demo Klinik Baharu Sdn Bhd',
  registrationNo: '209999999999',
  epfEmployerNo: 'EPF-NEW',
  socsoEmployerNo: null,
  lhdnEmployerNo: null,
  addressLine1: 'No. 9, Jalan Baharu',
  addressLine2: null,
  postcode: '43000',
  city: 'Kajang',
  state: 'Selangor',
};
const atApproval = { ...today, name: 'Demo Klinik Sdn Bhd', registrationNo: '202601012345', epfEmployerNo: 'EPF-OLD', addressLine1: 'No. 1, Jalan Lama' };

const serviceWith = (auditBefores: unknown[]) => {
  const findMany = jest.fn(async () => auditBefores.map((before) => ({ before })));
  const service = new PayrollPayslipService({ auditLog: { findMany } } as never, {} as never);
  const asApproved = (payload: Partial<SnapshotPayload>) =>
    (service as unknown as { employerAsApproved: (p: unknown, c: unknown, at: Date) => Promise<SnapshotEmployer | null> }).employerAsApproved(
      payload,
      today,
      new Date('2026-02-01T00:00:00.000Z'),
    );
  return { asApproved, findMany };
};

describe('the employer on a payslip', () => {
  it('reads a record that froze the employer, and asks nothing else', async () => {
    const frozen: SnapshotEmployer = { ...atApproval, socsoEmployerNo: null, lhdnEmployerNo: null };
    const { asApproved, findMany } = serviceWith([]);
    expect(await asApproved({ legalEmployerName: 'Demo Klinik Sdn Bhd', legalEmployer: frozen })).toBe(frozen);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rebuilds an older record from the first change made after its approval', async () => {
    // A logo change first (no details in it), then the rename that holds the old details.
    const { asApproved } = serviceWith([{ logoMediaId: null }, atApproval, { ...atApproval, name: 'Something in between' }]);
    expect(await asApproved({ legalEmployerName: 'Demo Klinik Sdn Bhd' })).toMatchObject({
      name: 'Demo Klinik Sdn Bhd',
      registrationNo: '202601012345',
      epfEmployerNo: 'EPF-OLD',
      addressLine1: 'No. 1, Jalan Lama',
    });
  });

  it('uses today’s record when nothing has changed since the approval', async () => {
    const { asApproved } = serviceWith([]);
    expect(await asApproved({ legalEmployerName: 'Demo Klinik Baharu Sdn Bhd' })).toMatchObject({ registrationNo: '209999999999', addressLine1: 'No. 9, Jalan Baharu' });
  });
});
