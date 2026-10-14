import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';

/**
 * NEW BANK ACCOUNTS ASKED FOR IN MY KUWICK (testing, 15 October 2026).
 *
 * HR checks the proof photo against the new account and approves; only then
 * is the account copied onto the employee record that payroll pays to.
 */
@Injectable()
export class BankChangeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Requests waiting for HR, with the account on file beside the new one. */
  async waiting() {
    await requirePermission(this.rawPrisma, 'hr.employee.manage');
    const rows = await this.prisma.bankChangeRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { staff: { select: { fullName: true, employeeProfile: { select: { bankName: true, bankAccountNo: true, bankAccountName: true } } } } },
    });
    return rows.map((row) => ({
      id: row.id,
      staffId: row.staffId,
      name: row.staff.fullName,
      requestedAt: row.createdAt.toISOString(),
      next: { bankName: row.bankName, bankAccountNo: row.bankAccountNo, bankAccountName: row.bankAccountName },
      current: row.staff.employeeProfile?.bankAccountNo
        ? {
            bankName: row.staff.employeeProfile.bankName,
            bankAccountNo: row.staff.employeeProfile.bankAccountNo,
            bankAccountName: row.staff.employeeProfile.bankAccountName,
          }
        : null,
      proofPath: row.proofFileId ? `/workforce/staff-files/${row.proofFileId}` : null,
    }));
  }

  async decide(id: string, approve: boolean, note?: string) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const row = await tx.bankChangeRequest.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Bank change request not found.');
      if (row.status !== 'PENDING') throw new BadRequestException('That request has already been decided.');
      if (row.staffId === actor.id) throw new BadRequestException('Somebody else has to approve a change to your own bank account.');
      if (!approve && !note?.trim()) throw new BadRequestException('Say why, so the employee knows what to fix.');
      if (approve) {
        await tx.employeeProfile.update({
          where: { staffId: row.staffId },
          data: { bankName: row.bankName, bankAccountNo: row.bankAccountNo, bankAccountName: row.bankAccountName },
        });
      }
      const saved = await tx.bankChangeRequest.update({
        where: { id },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedByStaffId: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
      });
      await recordAudit(tx, actor, {
        action: 'bankChange.decided',
        entityType: 'BankChangeRequest',
        entityId: id,
        reason: note?.trim() || undefined,
        after: { status: saved.status, staffId: row.staffId, bankName: row.bankName, lastFour: row.bankAccountNo.slice(-4) },
        source: 'hr.employees',
      });
      return { id, status: saved.status };
    });
  }
}
