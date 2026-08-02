import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiagnosisCategory, DiagnosisPriority, DiagnosisRecordStatus, Prisma, Staff } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import {
  assertBranchAccess,
  assertCanModifyDiagnosis,
  snapshotOf,
  type BranchAccessContext,
} from './clinical-authorization';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';
import { CreateCustomDiagnosisDto } from './dto/create-custom-diagnosis.dto';
import { BulkActivateCatalogDto } from './dto/bulk-activate-catalog.dto';
import { SetDiagnosisPriorityDto } from './dto/set-diagnosis-priority.dto';
import { RemoveDiagnosisDto } from './dto/remove-diagnosis.dto';

type Tx = Prisma.TransactionClient;

// Postgres unique-violation. Raised by diagnoses_one_primary_per_visit when
// two requests race to make different diagnoses primary on the same visit.
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class DiagnosisService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    // G2a — the raw client, for operations that must be ATOMIC across several
    // writes (demote the old primary + promote the new one). Same pattern as
    // ClinicalNoteService: the tenant GUC is set inside the transaction.
    private readonly rawPrisma: PrismaService,
  ) {}

  private async withTenantTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = currentTenantId();
    return this.rawPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  // The acting staff member, from the verified JWT claim only. A diagnosis is
  // an attributed clinical entry; who made it must not be spoofable.
  private async requireActor(tx: Tx): Promise<Staff> {
    const staffId = currentStaffId();
    if (!staffId) {
      throw new ForbiddenException('No authenticated staff member on this session');
    }
    const staff = await tx.staff.findUnique({ where: { id: staffId } });
    if (!staff || !staff.active) {
      throw new ForbiddenException('Your staff account is inactive');
    }
    return staff;
  }

  // Fail-closed branch context, identical to C0's rule: a null home branch
  // grants nothing unless the tenant genuinely has one branch or explicit
  // access exists.
  private async branchContext(tx: Tx, staff: Staff): Promise<BranchAccessContext> {
    const tenantBranchCount = await tx.clinic.count({ where: { tenantId: currentTenantId() } });
    const access = staff.userId
      ? await tx.userClinicAccess.findMany({ where: { userId: staff.userId }, select: { clinicId: true } })
      : [];
    return { tenantBranchCount, authorisedClinicIds: access.map((a) => a.clinicId) };
  }

  private async assertMayTouchVisit(tx: Tx, visitId: string, staff: Staff) {
    const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { clinicId: true } });
    if (!visit) {
      throw new NotFoundException('Visit not found');
    }
    assertBranchAccess(staff, visit.clinicId, await this.branchContext(tx, staff));
  }

  // Backs the visit's diagnosis picker's search box. D-027 (docs/DECISIONS.md):
  // Custom/Summarize/Full filters which catalog category is searched, not
  // how the added-diagnosis list displays.
  searchCatalog(query?: string, category?: DiagnosisCategory) {
    return this.prisma.diagnosisCatalog.findMany({
      where: {
        active: true,
        category,
        // G2b — match the ICD-10 code as well as the name. A GP who knows the
        // code ("J06.9") could previously only find it by typing the wording,
        // which is slower than the thing they already had in mind.
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { icd10Code: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  // The Diagnoses Directory admin screen: list + counts per category.
  listCatalog(category?: DiagnosisCategory) {
    return this.prisma.diagnosisCatalog.findMany({
      where: { category },
      orderBy: { name: 'asc' },
    });
  }

  async catalogCounts() {
    const [summarizeTotal, summarizeActive, fullTotal, fullActive] = await Promise.all([
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.SUMMARIZE } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.SUMMARIZE, active: true } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.FULL } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.FULL, active: true } }),
    ]);
    return { summarize: { total: summarizeTotal, active: summarizeActive }, full: { total: fullTotal, active: fullActive } };
  }

  createCustom(dto: CreateCustomDiagnosisDto) {
    const tenantId = currentTenantId();
    return this.prisma.diagnosisCatalog.create({
      data: { tenantId, name: dto.name, icd10Code: dto.icd10Code, category: DiagnosisCategory.CUSTOM },
    });
  }

  async setCatalogActive(id: string, active: boolean) {
    const entry = await this.prisma.diagnosisCatalog.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Diagnosis catalog entry not found');
    }
    return this.prisma.diagnosisCatalog.update({ where: { id }, data: { active } });
  }

  // Bulk-activate/deactivate an entire global category (Summarize or Full)
  // in one action, matching the audited "Bulk Activate Global Categories"
  // toggle cards.
  async bulkActivateCategory(category: DiagnosisCategory, dto: BulkActivateCatalogDto) {
    await this.prisma.diagnosisCatalog.updateMany({
      where: { category },
      data: { active: dto.active },
    });
  }

  // G2a — PRIMARY first, then everything else oldest-first. The clinical
  // reading order, not the insertion order.
  //
  // G2 closure (D-061) — ACTIVE only by default. A removed diagnosis must
  // never appear in the normal clinical view or count; `includeRemoved` is
  // for the audit/history view.
  async findByVisitId(visitId: string, includeRemoved = false) {
    const rows = await this.prisma.diagnosis.findMany({
      where: {
        visitId,
        ...(includeRemoved ? {} : { recordStatus: DiagnosisRecordStatus.ACTIVE }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return [...rows].sort((a, b) => {
      if (a.priority === b.priority) return 0;
      if (a.priority === DiagnosisPriority.PRIMARY) return -1;
      if (b.priority === DiagnosisPriority.PRIMARY) return 1;
      return 0;
    });
  }

  // Resolves an existing catalog entry, or creates one on the fly when the
  // doctor types a diagnosis that isn't in the catalog yet (added as
  // CUSTOM). Either way, the resulting Diagnosis snapshots icd10Code/name
  // so a later catalog rename can't rewrite this visit's historical record.
  async addToVisit(dto: AddDiagnosisDto) {
    const tenantId = currentTenantId();

    return this.withTenantTx(async (tx) => {
      const actor = await this.requireActor(tx);
      assertCanModifyDiagnosis(actor);
      await this.assertMayTouchVisit(tx, dto.visitId, actor);

      let catalogEntry;
      if (dto.diagnosisCatalogId) {
        catalogEntry = await tx.diagnosisCatalog.findUnique({ where: { id: dto.diagnosisCatalogId } });
        if (!catalogEntry) {
          throw new NotFoundException('Diagnosis catalog entry not found');
        }
      } else if (dto.name) {
        catalogEntry = await tx.diagnosisCatalog.upsert({
          where: { tenantId_name: { tenantId, name: dto.name } },
          create: { tenantId, name: dto.name, icd10Code: dto.icd10Code, category: DiagnosisCategory.CUSTOM },
          update: {},
        });
      } else {
        throw new BadRequestException('Either diagnosisCatalogId or name is required');
      }

      // Adding straight in as PRIMARY has to demote the incumbent in the SAME
      // transaction, or the partial unique index rejects the insert.
      if (dto.priority === DiagnosisPriority.PRIMARY) {
        await this.demoteCurrentPrimary(tx, dto.visitId, null);
      }

      const snap = snapshotOf(actor);
      return tx.diagnosis
        .create({
          data: {
            tenantId,
            visitId: dto.visitId,
            diagnosisCatalogId: catalogEntry.id,
            icd10Code: catalogEntry.icd10Code,
            name: catalogEntry.name,
            priority: dto.priority ?? null,
            // Never from the request body — see AddDiagnosisDto.
            addedByStaffId: snap.staffId,
            addedByNameSnapshot: snap.nameSnapshot,
            addedByRoleSnapshot: snap.roleSnapshot,
            legacyAttributionUnknown: false,
          },
        })
        .catch((error) => {
          throw this.translatePrimaryRace(error);
        });
    });
  }

  /**
   * G2a — set (or clear) a diagnosis's priority.
   *
   * The demote-then-promote pair runs in ONE transaction, and the database
   * still has the final say: `diagnoses_one_primary_per_visit` means two
   * concurrent requests cannot both leave a PRIMARY behind. The loser gets a
   * 409 rather than a silently duplicated primary diagnosis.
   */
  async setPriority(id: string, dto: SetDiagnosisPriorityDto) {
    const next = dto.priority ?? null;

    return this.withTenantTx(async (tx) => {
      const actor = await this.requireActor(tx);
      assertCanModifyDiagnosis(actor);
      const diagnosis = await tx.diagnosis.findUnique({ where: { id } });
      if (!diagnosis) {
        throw new NotFoundException('Diagnosis not found');
      }
      await this.assertMayTouchVisit(tx, diagnosis.visitId, actor);
      if (diagnosis.recordStatus === DiagnosisRecordStatus.REMOVED_IN_ERROR) {
        throw new ConflictException('This diagnosis has been removed from the visit and cannot be re-prioritised.');
      }

      if (next === DiagnosisPriority.PRIMARY) {
        await this.demoteCurrentPrimary(tx, diagnosis.visitId, id);
      }

      return tx.diagnosis
        .update({ where: { id }, data: { priority: next } })
        .catch((error) => {
          throw this.translatePrimaryRace(error);
        });
    });
  }

  // The previous primary becomes SECONDARY rather than "not recorded": it was
  // a deliberately prioritised diagnosis, and demoting it to an unrecorded
  // state would lose information the doctor did enter.
  private async demoteCurrentPrimary(tx: Tx, visitId: string, exceptId: string | null) {
    await tx.diagnosis.updateMany({
      where: {
        visitId,
        priority: DiagnosisPriority.PRIMARY,
        // Removed rows keep their historical priority for audit and must not
        // be rewritten by a later demotion.
        recordStatus: DiagnosisRecordStatus.ACTIVE,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { priority: DiagnosisPriority.SECONDARY },
    });
  }

  private translatePrimaryRace(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION &&
      String(error.meta?.target ?? '').includes('primary_per_visit')
    ) {
      return new ConflictException(
        'Another primary diagnosis was set for this visit at the same time. Reload the visit and try again.',
      );
    }
    return error;
  }

  /**
   * G2 closure (D-061) — remove a diagnosis from the ACTIVE visit record.
   *
   * This replaces the hard delete entirely. There is no longer any
   * application path that deletes a saved diagnosis: the row stays, with its
   * content, ICD-10 code, priority and ORIGINAL attribution untouched. Only
   * `recordStatus` changes, plus who removed it, when and why.
   *
   * The removed row keeps its historical `priority` for audit, but the
   * one-primary index is scoped to ACTIVE rows, so removing the primary frees
   * the slot without any diagnosis being silently promoted in its place. A
   * visit may legitimately have no primary until a doctor chooses one.
   */
  async removeFromVisit(id: string, dto: RemoveDiagnosisDto) {
    const reason = dto.removalReason?.trim();
    if (!reason) {
      throw new BadRequestException('A removal reason is required.');
    }

    return this.withTenantTx(async (tx) => {
      const actor = await this.requireActor(tx);
      // Clinical judgement: doctors only. An administrative role does not
      // qualify on its own (D-061).
      assertCanModifyDiagnosis(actor);

      const diagnosis = await tx.diagnosis.findUnique({ where: { id } });
      if (!diagnosis) {
        throw new NotFoundException('Diagnosis not found');
      }
      await this.assertMayTouchVisit(tx, diagnosis.visitId, actor);

      if (diagnosis.recordStatus === DiagnosisRecordStatus.REMOVED_IN_ERROR) {
        throw new ConflictException('This diagnosis has already been removed from the visit.');
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== diagnosis.version) {
        throw new ConflictException(
          'This diagnosis changed since you loaded it. Reload the visit and try again.',
        );
      }

      const snap = snapshotOf(actor);
      return tx.diagnosis.update({
        where: { id },
        data: {
          recordStatus: DiagnosisRecordStatus.REMOVED_IN_ERROR,
          removedAt: new Date(),
          removedByStaffId: snap.staffId,
          removedByNameSnapshot: snap.nameSnapshot,
          removedByRoleSnapshot: snap.roleSnapshot,
          removalReason: reason,
          version: { increment: 1 },
          // priority, name, icd10Code, addedBy* and addedAt are deliberately
          // NOT touched. The original entry has to survive intact.
        },
      });
    });
  }
}
