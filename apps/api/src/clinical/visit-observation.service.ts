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
import { computeBmi } from './vitals-bmi';

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

/**
 * G4.5d3c-3c — how recently an IDENTICAL reading by the SAME person counts as
 * the same submission rather than a repeat measurement.
 *
 * A repeat BP after treatment is a real and common clinical act, and this
 * service exists partly to make it possible — so the window has to be short
 * enough that it never swallows one. Sixty seconds is chosen because taking a
 * second full set of observations, and getting every one of eleven values
 * identical to the last decimal place, inside a minute, is not something that
 * happens at a clinic; a stuck Enter key and a slow network is.
 *
 * Longer would risk discarding a genuine reading. Shorter would let an
 * ordinary retry through. If a repeat within the window is genuinely wanted,
 * changing any single value records it — nothing is refused, only exact
 * re-submission is.
 */
const DUPLICATE_WINDOW_MS = 60_000;

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
  //
  // G4.5d3c-3c — with server-side duplicate protection. See
  // `findRecentIdenticalObservation` below for what is refused and why; the
  // short version is that this endpoint used to create a row every single time
  // it was called, with nothing anywhere in the stack stopping the same
  // reading being stored twice.
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

      // --- Duplicate protection, part 1: serialise writes for this visit ----
      //
      // The check below reads the most recent observation and then decides
      // whether to insert. Under READ COMMITTED two concurrent requests would
      // BOTH read the state before either insert, both find nothing to match,
      // and both write — which is precisely the double-submit this is meant to
      // stop. There is no row to claim atomically here (D-087's pattern needs
      // an existing row), so the transaction takes an advisory lock keyed on
      // the visit instead: the second request waits, then re-reads after the
      // first has committed and sees its row.
      //
      // Scoped to ONE visit, so concurrent vitals for different patients never
      // contend, and released automatically at commit or rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`visit-observation:${visitId}`}))`;

      // --- Duplicate protection, part 2: is this the same reading again? ----
      const duplicate = await findRecentIdenticalObservation(tx, visitId, actor.id, {
        ...vitals,
        source: dto.source ?? 'MANUAL',
      });
      if (duplicate) {
        // Deliberately NOT an error. The caller asked for this reading to be
        // on the record, and it is — theirs, attributed to them, at the time
        // they took it. Returning the existing row makes a retry safe, which
        // is the behaviour a nurse on a slow connection actually needs.
        return { ...this.decorate(duplicate), deduplicated: true as const };
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
      // `deduplicated` is present on BOTH branches so a caller never has to
      // tell "false" apart from "this build does not report it".
      return { ...this.decorate(observation), deduplicated: false as const };
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
      // U1 — the reason is OPTIONAL on a vital.
      //
      // Owner decision: vitals change routinely mid-consultation. A repeat BP
      // after the patient has sat down, a re-weigh on a better scale, a typo
      // in a pulse — none of those are events anybody wants to write a
      // sentence about, and a mandatory field in front of them teaches staff
      // to type "correction" and move on, which is a worse record than no
      // sentence at all.
      //
      // WHAT DOES NOT CHANGE: the immutable revision below still snapshots
      // the previous values, the editor, their role and the time. The audit
      // trail is unbroken; only the prose is now the editor's choice.
      //
      // This applies to OBSERVATIONS ONLY. A signed clinical note still
      // requires a reason to amend — that one is a medicolegal record of what
      // a clinician asserted, not a measurement that was taken again.

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
          correctionReason: dto.correctionReason?.trim() || null,
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

/**
 * G4.5d3c-3c — THE root-cause fix for duplicate vitals.
 *
 * The owner reported the same set of observations appearing twice on a visit.
 * The cause was not rendering and not query invalidation: `record()` inserted
 * unconditionally, on every call, and NOTHING in the request path — not the
 * controller, not the service, not a database constraint — asked whether that
 * reading was already there. Any repeated submission produced a second row,
 * and the two everyday ways to produce one both went unguarded:
 *
 *   1. the entry form submits on Enter, which bypasses the Save button's
 *      `loading` state entirely (fixed separately, in the browser);
 *   2. an ordinary network retry — the client resends, the first request had
 *      already committed.
 *
 * A fix that only hid the second row would have left the record itself
 * carrying two readings, which is worse than showing them: an export, a
 * document merge field or an audit would still find both, and the clinical
 * record would say the patient's BP was taken twice when it was taken once.
 * So the duplicate is prevented, not concealed.
 *
 * "Identical" is judged by the SAME canonical content hash the revision trail
 * already uses (C0/D-051), so 36.5 and 36.50 are one reading and the decision
 * cannot drift from how the record hashes itself. Three conditions must all
 * hold, and each excludes a legitimate case:
 *
 *   - same visit          — different visits are different patients or days
 *   - same recorder       — a second nurse independently confirming a reading
 *                           is a real, separate, separately attributed act
 *   - within the window   — a genuine repeat measurement later in the visit
 *                           stays a new row, however identical
 *
 * Only the most recent observation is compared, not the whole visit: readings
 * further back are the ones a repeat is legitimately being compared against.
 */
async function findRecentIdenticalObservation(
  tx: Tx,
  visitId: string,
  recordedByStaffId: string,
  incoming: Record<string, unknown>,
) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const latest = await tx.visitObservation.findFirst({
    where: { visitId, recordedByStaffId, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'desc' },
  });
  if (!latest) {
    return null;
  }
  const incomingHash = hashObservationContent(incoming);
  const latestHash = hashObservationContent(latest as unknown as Record<string, unknown>);
  return incomingHash.contentHash === latestHash.contentHash ? latest : null;
}
