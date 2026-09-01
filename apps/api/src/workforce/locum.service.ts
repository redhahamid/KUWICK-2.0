import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import {
  ApproveLocumSessionDto,
  RecordLocumSessionDto,
  SettleLocumSessionDto,
  UpdateLocumSessionDto,
} from './dto/locum-session.dto';

/**
 * LOCUM SESSIONS — paying somebody who is not an employee.
 *
 * The clinic's locum was carried into payroll runs as though they were staff.
 * That is not a classification nicety: it applies EPF, SOCSO and EIS treatment
 * to a person who is not a member of those schemes, and it puts a professional
 * fee on a payslip.
 *
 * A session here is the canonical record of work done under a contract FOR
 * services. It ends in a payable that Finance settles. It can never become a
 * payroll input — the route is fixed at FINANCE by a database check constraint,
 * not merely by this service declining to do it.
 *
 * WHAT THIS DOES NOT DO. It does not post to a general ledger. Kuwick has a
 * supplier payables ledger and no generic counterparty payable, and inventing
 * a posting without an agreed account mapping would be exactly the disposable
 * shortcut this stage is meant to avoid. The session carries its own payout
 * status and invoice reference, and the Finance posting is a named gap.
 */
@Injectable()
export class LocumService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Hours x rate, or the flat fee. Never both, and never a guess. */
  private computedFeeCents(row: {
    hours: unknown;
    hourlyRate: unknown;
    sessionFee: unknown;
  }): number | null {
    if (row.sessionFee !== null && row.sessionFee !== undefined) return toCents(row.sessionFee as never);
    if (
      row.hours !== null && row.hours !== undefined &&
      row.hourlyRate !== null && row.hourlyRate !== undefined
    ) {
      return Math.round(Number(row.hours) * toCents(row.hourlyRate as never));
    }
    return null;
  }

  async list(params: { from?: string; to?: string; staffId?: string; status?: string } = {}) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const where: Record<string, unknown> = {};
    if (params.staffId) where.staffId = params.staffId;
    if (params.status) where.status = params.status;
    if (params.from || params.to) {
      where.sessionDate = {
        ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
        ...(params.to ? { lte: new Date(`${params.to}T00:00:00.000Z`) } : {}),
      };
    }

    const rows = await this.prisma.locumSession.findMany({
      where,
      orderBy: [{ sessionDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        staff: { select: { fullName: true } },
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
      },
    });

    return rows.map((row) => {
      const computed = this.computedFeeCents(row);
      return {
        id: row.id,
        staffId: row.staffId,
        staffName: row.staff.fullName,
        clinicId: row.clinicId,
        clinicName: row.clinic.name,
        sessionDate: row.sessionDate.toISOString().slice(0, 10),
        label: row.label,
        hours: row.hours === null ? null : Number(row.hours),
        hourlyRate: row.hourlyRate === null ? null : formatCents(toCents(row.hourlyRate)),
        sessionFee: row.sessionFee === null ? null : formatCents(toCents(row.sessionFee)),
        computedFee: computed === null ? null : formatCents(computed),
        status: row.status,
        approvedAmount: row.approvedAmount === null ? null : formatCents(toCents(row.approvedAmount)),
        approvedBy: row.approvedBy?.fullName ?? null,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        // Stated on every row so no reader has to infer it from the absence of
        // a payslip.
        paymentRoute: row.paymentRoute,
        payoutStatus: row.payoutStatus,
        invoiceReference: row.invoiceReference,
        paidAt: row.paidAt?.toISOString() ?? null,
        note: row.note,
      };
    });
  }

  /**
   * A session may only be recorded against somebody engaged as a CONTRACTOR.
   * Recording one for an employee would create a second, parallel way to pay
   * them — the exact double-payment route this stage exists to close.
   */
  async record(dto: RecordLocumSessionDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const profile = await tx.employeeProfile.findFirst({
        where: { staffId: dto.staffId },
        include: { staff: { select: { fullName: true } } },
      });
      if (!profile) throw new NotFoundException('No employment record for this person.');
      if (profile.engagement !== 'CONTRACTOR') {
        throw new ConflictException(
          `${profile.staff.fullName} is engaged as an employee, so their work is paid through payroll. ` +
            'Recording a locum session for them would create a second way to pay the same hours. ' +
            'Change their engagement to contractor first if that is genuinely what they are.',
        );
      }

      if (dto.sessionFee === undefined && (dto.hours === undefined || dto.hourlyRate === undefined)) {
        throw new BadRequestException(
          'A session needs either a flat session fee, or both hours and an hourly rate. ' +
            'Kuwick will not infer one from the other.',
        );
      }
      if (dto.sessionFee !== undefined && dto.hourlyRate !== undefined) {
        throw new BadRequestException(
          'A session is priced as a flat fee OR by the hour, not both. Two prices on one session is two answers ' +
            'to what the clinic owes.',
        );
      }

      const saved = await tx.locumSession.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId,
          staffId: dto.staffId,
          sessionDate: new Date(`${dto.sessionDate}T00:00:00.000Z`),
          label: dto.label ?? null,
          hours: dto.hours ?? null,
          hourlyRate: dto.hourlyRate ?? null,
          sessionFee: dto.sessionFee ?? null,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'locumSession.recorded',
        entityType: 'LocumSession',
        entityId: saved.id,
        reason: `Locum session on ${dto.sessionDate}`,
        after: { staffId: dto.staffId, sessionDate: dto.sessionDate, label: dto.label ?? null },
        source: 'hr.locum',
      });

      return saved;
    });
  }

  async update(id: string, dto: UpdateLocumSessionDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const row = await tx.locumSession.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Locum session not found');
      if (row.status === 'APPROVED') {
        throw new ConflictException(
          'This session is approved and owed. Correcting an approved fee is a deliberate act: withdraw the ' +
            'approval first, or record the correction against the payment.',
        );
      }

      const updated = await tx.locumSession.update({
        where: { id },
        data: {
          ...(dto.sessionDate ? { sessionDate: new Date(`${dto.sessionDate}T00:00:00.000Z`) } : {}),
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.hours !== undefined ? { hours: dto.hours } : {}),
          ...(dto.hourlyRate !== undefined ? { hourlyRate: dto.hourlyRate } : {}),
          ...(dto.sessionFee !== undefined ? { sessionFee: dto.sessionFee } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });

      await recordAudit(tx, actor, {
        action: 'locumSession.updated',
        entityType: 'LocumSession',
        entityId: id,
        before: { status: row.status, sessionDate: row.sessionDate.toISOString().slice(0, 10) },
        after: { status: updated.status, sessionDate: updated.sessionDate.toISOString().slice(0, 10) },
        source: 'hr.locum',
      });

      return updated;
    });
  }

  /**
   * Approve a fee. The approver names the amount rather than confirming a
   * computed one, because "approved" should mean somebody decided.
   */
  async approve(id: string, dto: ApproveLocumSessionDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const row = await tx.locumSession.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Locum session not found');
      if (row.status === 'CANCELLED') throw new ConflictException('A cancelled session cannot be approved.');
      if (row.status === 'APPROVED') throw new ConflictException('This session is already approved.');
      if (row.status !== 'COMPLETED') {
        throw new ConflictException(
          'Only a completed session can be approved. Mark the session completed once the work has been done — ' +
            'approving a planned session pays for work that may not happen.',
        );
      }

      const approvedCents = toCents(dto.approvedAmount);
      if (approvedCents <= 0) throw new BadRequestException('An approved amount must be more than nothing.');

      const updated = await tx.locumSession.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAmount: dto.approvedAmount,
          approvedByStaffId: actor.id,
          approvedAt: new Date(),
          note: dto.note ?? row.note,
        },
      });

      const computed = this.computedFeeCents(row);
      await recordAudit(tx, actor, {
        action: 'locumSession.approved',
        entityType: 'LocumSession',
        entityId: id,
        reason: `Approved ${formatCents(approvedCents)} for the session on ${row.sessionDate.toISOString().slice(0, 10)}`,
        before: { computedFee: computed === null ? null : formatCents(computed) },
        after: { approvedAmount: formatCents(approvedCents) },
        source: 'hr.locum',
      });

      return updated;
    });
  }

  /** Finance has settled it. The reference is required: "paid" with no trace is not a record. */
  async settle(id: string, dto: SettleLocumSessionDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const row = await tx.locumSession.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Locum session not found');
      if (row.status !== 'APPROVED') {
        throw new ConflictException('Only an approved session can be settled. Approve the fee first.');
      }
      if (row.payoutStatus === 'PAID') {
        throw new ConflictException(
          `This session was already settled${row.invoiceReference ? ` under ${row.invoiceReference}` : ''}. ` +
            'Paying it again is the failure this record exists to prevent.',
        );
      }

      const updated = await tx.locumSession.update({
        where: { id },
        data: {
          payoutStatus: 'PAID',
          invoiceReference: dto.invoiceReference,
          paidAt: dto.paidOn ? new Date(`${dto.paidOn}T00:00:00.000Z`) : new Date(),
        },
      });

      await recordAudit(tx, actor, {
        action: 'locumSession.settled',
        entityType: 'LocumSession',
        entityId: id,
        reason: `Settled under ${dto.invoiceReference}`,
        after: { invoiceReference: dto.invoiceReference, payoutStatus: 'PAID' },
        source: 'hr.locum',
      });

      return updated;
    });
  }

  /**
   * What the clinic owes its contractors, and what it has settled. This is the
   * locum equivalent of a payroll run summary — the thing an owner looks at to
   * answer "who else am I paying this month".
   */
  async payableSummary(from: string, to: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.locumSession.findMany({
      where: {
        sessionDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        status: { in: ['COMPLETED', 'APPROVED'] },
      },
      include: { staff: { select: { fullName: true } } },
      orderBy: [{ staffId: 'asc' }, { sessionDate: 'asc' }],
    });

    const byStaff = new Map<string, { staffId: string; name: string; sessions: number; approvedCents: number; awaitingApproval: number; outstandingCents: number }>();
    for (const row of rows) {
      const entry = byStaff.get(row.staffId) ?? {
        staffId: row.staffId,
        name: row.staff.fullName,
        sessions: 0,
        approvedCents: 0,
        awaitingApproval: 0,
        outstandingCents: 0,
      };
      entry.sessions += 1;
      if (row.status === 'APPROVED' && row.approvedAmount !== null) {
        const cents = toCents(row.approvedAmount);
        entry.approvedCents += cents;
        if (row.payoutStatus !== 'PAID') entry.outstandingCents += cents;
      } else {
        entry.awaitingApproval += 1;
      }
      byStaff.set(row.staffId, entry);
    }

    const people = [...byStaff.values()];
    return {
      from,
      to,
      // Named so nobody reads this as a payroll figure.
      route: 'FINANCE' as const,
      people: people.map((p) => ({
        staffId: p.staffId,
        name: p.name,
        sessions: p.sessions,
        awaitingApproval: p.awaitingApproval,
        approved: formatCents(p.approvedCents),
        outstanding: formatCents(p.outstandingCents),
      })),
      totalApproved: formatCents(people.reduce((sum, p) => sum + p.approvedCents, 0)),
      totalOutstanding: formatCents(people.reduce((sum, p) => sum + p.outstandingCents, 0)),
      sessionsAwaitingApproval: people.reduce((sum, p) => sum + p.awaitingApproval, 0),
    };
  }
}
