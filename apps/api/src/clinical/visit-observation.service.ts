import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { CorrectObservationDto, RecordObservationDto } from './dto/visit-observation.dto';
import {
  BranchAccessContext,
  assertBranchAccess,
  canRecordObservations,
  snapshotOf,
} from './clinical-authorization';
import { hashObservationContent, observationContentSnapshot } from './canonical-content-hash';

type Tx = Prisma.TransactionClient;

const VITAL_FIELDS = [
  'bpSystolic',
  'bpDiastolic',
  'pulse',
  'temperature',
  'spo2',
  'respRate',
  'painScore',
  'weight',
  'height',
  'headCircumference',
  'glucose',
] as const;

function computeBmi(weight: unknown, height: unknown): number | null {
  if (weight === null || weight === undefined || height === null || height === undefined) {
    return null;
  }
  const heightM = Number(height) / 100;
  if (!heightM) {
    return null;
  }
  return Math.round((Number(weight) / (heightM * heightM)) * 10) / 10;
}

// C0 (D-051) — vitals/anthropometry/point-of-care, attributed to whoever
// actually recorded them.
//
// Split out of ClinicalNote so a front-desk member recording BP can never
// become the author of a doctor's narrative (owner: "A staff member
// recording vitals must not become the author of the doctor's narrative").
//
// Two distinct operations, deliberately not the same thing:
//   record()  — a NEW reading (BP at 10:00, repeat BP at 10:30 after
//               treatment). Creates another row; nothing is overwritten.
//   correct() — fixing an inaccurate entry. Updates the row, requires a
//               reason, and writes an immutable revision preserving the
//               PREVIOUS values.
@Injectable()
export class VisitObservationService {
  constructor(private readonly prisma: PrismaService) {}

  private async withTenantTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = currentTenantId();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  private async requireActor(tx: Tx): Promise<Staff> {
    const staffId = currentStaffId();
    if (!staffId) {
      throw new ForbiddenException('No authenticated staff member on this session');
    }
    const staff = await tx.staff.findUnique({ where: { id: staffId } });
    if (!staff || !staff.active) {
      throw new ForbiddenException('Your staff account is inactive');
    }
    if (!canRecordObservations(staff)) {
      throw new ForbiddenException('This account may not record clinical observations');
    }
    return staff;
  }

  private async branchContext(tx: Tx, staff: Staff): Promise<BranchAccessContext> {
    const tenantBranchCount = await tx.clinic.count({ where: { tenantId: currentTenantId() } });
    const access = staff.userId
      ? await tx.userClinicAccess.findMany({ where: { userId: staff.userId }, select: { clinicId: true } })
      : [];
    return { tenantBranchCount, authorisedClinicIds: access.map((a) => a.clinicId) };
  }

  private decorate<T extends { weight: unknown; height: unknown }>(observation: T) {
    return { ...observation, bmi: computeBmi(observation.weight, observation.height) };
  }

  async listByVisitId(visitId: string) {
    return this.withTenantTx(async (tx) => {
      const observations = await tx.visitObservation.findMany({
        where: { visitId },
        orderBy: { recordedAt: 'desc' },
        include: {
          recordedBy: { select: { id: true, fullName: true, role: true } },
          updatedBy: { select: { id: true, fullName: true, role: true } },
        },
      });
      return observations.map((observation) => this.decorate(observation));
    });
  }

  async listRevisions(observationId: string) {
    return this.withTenantTx(async (tx) => {
      const observation = await tx.visitObservation.findUnique({ where: { id: observationId } });
      if (!observation) {
        throw new NotFoundException('Observation not found');
      }
      const actor = await this.requireActor(tx);
      assertBranchAccess(actor, observation.clinicId, await this.branchContext(tx, actor));
      return tx.visitObservationRevision.findMany({
        where: { observationId },
        orderBy: { versionNo: 'asc' },
      });
    });
  }

  private vitalsFrom(dto: RecordObservationDto | CorrectObservationDto) {
    return Object.fromEntries(VITAL_FIELDS.map((f) => [f, dto[f] ?? null]));
  }

  // A NEW reading. Never overwrites an earlier set — repeated observations
  // during one visit are separate, independently attributed rows.
  async record(visitId: string, dto: RecordObservationDto) {
    return this.withTenantTx(async (tx) => {
      const actor = await this.requireActor(tx);
      const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { id: true, clinicId: true } });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      assertBranchAccess(actor, visit.clinicId, await this.branchContext(tx, actor));

      const vitals = this.vitalsFrom(dto);
      if (VITAL_FIELDS.every((f) => vitals[f] === null)) {
        throw new BadRequestException('Record at least one observation value');
      }

      const snap = snapshotOf(actor);
      const observation = await tx.visitObservation.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: visit.clinicId,
          visitId,
          ...vitals,
          source: dto.source ?? 'MANUAL',
          version: 1,
          recordedByStaffId: snap.staffId,
          recorderNameSnapshot: snap.nameSnapshot,
          recorderRoleSnapshot: snap.roleSnapshot,
          recorderDesignationSnapshot: snap.designationSnapshot,
          legacyRecorderUnknown: false,
        },
      });

      const hash = hashObservationContent(observation as unknown as Record<string, unknown>);
      await tx.visitObservationRevision.create({
        data: {
          tenantId: currentTenantId(),
          observationId: observation.id,
          versionNo: observation.version,
          contentSnapshot: observationContentSnapshot(
            observation as unknown as Record<string, unknown>,
          ) as Prisma.InputJsonValue,
          contentHash: hash.contentHash,
          hashSchemaVersion: hash.hashSchemaVersion,
          changeType: 'CREATED',
          editedByStaffId: snap.staffId,
          editorNameSnapshot: snap.nameSnapshot,
          editorRoleSnapshot: snap.roleSnapshot,
          editorDesignationSnapshot: snap.designationSnapshot,
        },
      });
      return this.decorate(observation);
    });
  }

  // A CORRECTION of an inaccurate entry. The recorder is never rewritten —
  // the person who originally took the reading stays on the record; the
  // corrector is captured in updatedBy and on the revision.
  async correct(id: string, dto: CorrectObservationDto) {
    return this.withTenantTx(async (tx) => {
      const existing = await tx.visitObservation.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Observation not found');
      }
      const actor = await this.requireActor(tx);
      assertBranchAccess(actor, existing.clinicId, await this.branchContext(tx, actor));

      if (dto.expectedVersion === undefined) {
        throw new BadRequestException('expectedVersion is required');
      }
      if (dto.expectedVersion !== existing.version) {
        throw new ConflictException(
          `These observations were changed by someone else (your version ${dto.expectedVersion}, current ${existing.version}). Reload before saving.`,
        );
      }
      if (!dto.correctionReason?.trim()) {
        throw new BadRequestException('A correction requires a reason');
      }

      // Snapshot the PREVIOUS values before overwriting, so the audit trail
      // preserves what the reading used to say.
      const previousHash = hashObservationContent(existing as unknown as Record<string, unknown>);
      const snap = snapshotOf(actor);

      await tx.visitObservationRevision.create({
        data: {
          tenantId: currentTenantId(),
          observationId: existing.id,
          versionNo: existing.version + 1,
          contentSnapshot: observationContentSnapshot(
            existing as unknown as Record<string, unknown>,
          ) as Prisma.InputJsonValue,
          contentHash: previousHash.contentHash,
          hashSchemaVersion: previousHash.hashSchemaVersion,
          changeType: 'CORRECTED',
          editedByStaffId: snap.staffId,
          editorNameSnapshot: snap.nameSnapshot,
          editorRoleSnapshot: snap.roleSnapshot,
          editorDesignationSnapshot: snap.designationSnapshot,
          correctionReason: dto.correctionReason.trim(),
        },
      });

      const observation = await tx.visitObservation.update({
        where: { id },
        data: {
          ...this.vitalsFrom(dto),
          version: { increment: 1 },
          updatedByStaffId: snap.staffId,
          updaterNameSnapshot: snap.nameSnapshot,
          updaterRoleSnapshot: snap.roleSnapshot,
        },
      });
      return this.decorate(observation);
    });
  }
}
