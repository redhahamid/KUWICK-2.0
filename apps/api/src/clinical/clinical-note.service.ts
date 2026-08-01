import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClinicalNoteType, Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { AmendClinicalNoteDto } from './dto/amend-clinical-note.dto';
import { SignClinicalNoteDto } from './dto/sign-clinical-note.dto';
import { UpsertClinicalNoteDto } from './dto/upsert-clinical-note.dto';
import {
  BranchAccessContext,
  assertBranchAccess,
  assertCanAuthor,
  canEditDraft,
  canSignClinicalNotes,
  snapshotOf,
} from './clinical-authorization';
import { hashNoteContent, noteContentSnapshot } from './canonical-content-hash';

// BMI is derived here, never persisted — docs/DATABASE_ARCHITECTURE.md §3:
// storing it would let it go stale the moment weight or height is edited
// without the other. Reads the FROZEN legacy vitals columns only; live vitals
// moved to VisitObservation in C0.
function computeBmi(weight: unknown, height: unknown): number | null {
  if (weight === null || weight === undefined || height === null || height === undefined) {
    return null;
  }
  const weightKg = Number(weight);
  const heightM = Number(height) / 100;
  if (!heightM) {
    return null;
  }
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

type Tx = Prisma.TransactionClient;

// C0 (D-051) — clinical-note authorship, signing and amendment.
//
// Uses the RAW PrismaService rather than the tenant-scoped extension: that
// extension wraps each individual query in its own transaction, and signing
// must be atomic across several writes ("Do not permit a partially signed
// state"). Every operation therefore opens ONE interactive transaction and
// sets app.tenant_id inside it first — the same pattern auth.service.ts uses.
@Injectable()
export class ClinicalNoteService {
  constructor(private readonly prisma: PrismaService) {}

  private async withTenantTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tenantId = currentTenantId();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  // The authenticated staff member, from the verified JWT claim only. Never
  // from a request body — authorship must not be spoofable.
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

  // Fail-closed branch context: a null home branch grants nothing unless the
  // tenant genuinely has a single branch or explicit access exists.
  private async branchContext(tx: Tx, staff: Staff): Promise<BranchAccessContext> {
    const tenantBranchCount = await tx.clinic.count({ where: { tenantId: currentTenantId() } });
    const access = staff.userId
      ? await tx.userClinicAccess.findMany({ where: { userId: staff.userId }, select: { clinicId: true } })
      : [];
    return { tenantBranchCount, authorisedClinicIds: access.map((a) => a.clinicId) };
  }

  private async writeRevision(
    tx: Tx,
    note: { id: string; version: number; status: 'DRAFT' | 'SIGNED' },
    content: Record<string, unknown>,
    changeType: 'CREATED' | 'UPDATED' | 'SIGNED',
    previousStatus: 'DRAFT' | 'SIGNED' | null,
    editor: Staff,
    reason?: string | null,
  ) {
    // A content hash is recorded on SIGNED revisions so the exact signed
    // snapshot can be verified later; hashSchemaVersion travels with it so
    // the canonicalisation rules can evolve without invalidating history.
    const hash = changeType === 'SIGNED' ? hashNoteContent(content) : null;
    const snap = snapshotOf(editor);
    await tx.clinicalNoteRevision.create({
      data: {
        tenantId: currentTenantId(),
        noteId: note.id,
        versionNo: note.version,
        contentSnapshot: noteContentSnapshot(content) as Prisma.InputJsonValue,
        contentHash: hash?.contentHash ?? null,
        hashSchemaVersion: hash?.hashSchemaVersion ?? null,
        changeType,
        previousStatus,
        newStatus: note.status,
        editedByStaffId: snap.staffId,
        editorNameSnapshot: snap.nameSnapshot,
        editorRoleSnapshot: snap.roleSnapshot,
        editorDesignationSnapshot: snap.designationSnapshot,
        reason: reason ?? null,
      },
    });
  }

  async listByVisitId(visitId: string) {
    return this.withTenantTx(async (tx) => {
      const notes = await tx.clinicalNote.findMany({
        where: { visitId },
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, fullName: true, role: true } },
          signedBy: { select: { id: true, fullName: true, role: true } },
          amendments: { select: { id: true, createdAt: true, status: true } },
        },
      });
      return notes.map((note) => ({
        ...note,
        bmi: computeBmi(note.weight, note.height),
        // "Amended" is DERIVED, never stored — the signed original is never
        // mutated out of SIGNED.
        hasAmendment: note.amendments.length > 0,
        isLateEntry: note.clinicalEntryAt != null,
      }));
    });
  }

  async listRevisions(noteId: string) {
    return this.withTenantTx(async (tx) => {
      const note = await tx.clinicalNote.findUnique({ where: { id: noteId } });
      if (!note) {
        throw new NotFoundException('Clinical note not found');
      }
      const actor = await this.requireActor(tx);
      assertBranchAccess(actor, note.clinicId!, await this.branchContext(tx, actor));
      return tx.clinicalNoteRevision.findMany({ where: { noteId }, orderBy: { versionNo: 'asc' } });
    });
  }

  async create(visitId: string, dto: UpsertClinicalNoteDto) {
    return this.withTenantTx(async (tx) => {
      const actor = await this.requireActor(tx);
      const noteType: ClinicalNoteType = dto.noteType ?? 'DOCTOR_NARRATIVE';
      assertCanAuthor(actor, noteType);

      const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { id: true, clinicId: true } });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      assertBranchAccess(actor, visit.clinicId, await this.branchContext(tx, actor));

      if (dto.clinicalEntryAt && !dto.lateEntryReason?.trim()) {
        throw new BadRequestException('A late entry requires a reason');
      }

      const snap = snapshotOf(actor);
      const note = await tx.clinicalNote.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: visit.clinicId,
          visitId,
          noteType,
          notes: dto.notes ?? null,
          noteLanguage: dto.noteLanguage ?? 'EN',
          clinicalEntryAt: dto.clinicalEntryAt ?? null,
          lateEntryReason: dto.lateEntryReason ?? null,
          status: 'DRAFT',
          entryType: 'STANDARD',
          version: 1,
          authorStaffId: snap.staffId,
          authorNameSnapshot: snap.nameSnapshot,
          authorRoleSnapshot: snap.roleSnapshot,
          authorDesignationSnapshot: snap.designationSnapshot,
          legacyAuthorUnknown: false,
        },
      });
      await this.writeRevision(tx, note, note as unknown as Record<string, unknown>, 'CREATED', null, actor);
      return { ...note, bmi: null, hasAmendment: false, isLateEntry: note.clinicalEntryAt != null };
    });
  }

  async update(id: string, dto: UpsertClinicalNoteDto) {
    return this.withTenantTx(async (tx) => {
      const existing = await tx.clinicalNote.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Clinical note not found');
      }
      const actor = await this.requireActor(tx);

      // A signed note is permanently immutable — corrections go through an
      // amendment, which is a new linked record.
      if (existing.status === 'SIGNED') {
        throw new ConflictException('This note is signed and cannot be edited. Add an amendment instead.');
      }
      // C0 closure — a legacy note predates authorship tracking, so editing it
      // would silently attribute someone else's historical text to whoever is
      // logged in now. It is permanently read-only; a correction must be a new
      // attributed amendment linked to it.
      if (existing.legacyAuthorUnknown) {
        throw new ConflictException(
          'This is a legacy note with no recorded author and is read-only. Add an amendment instead.',
        );
      }
      if (!canEditDraft(actor, existing)) {
        throw new ForbiddenException('You may not edit this draft');
      }
      assertBranchAccess(actor, existing.clinicId!, await this.branchContext(tx, actor));
      this.assertVersion(dto.expectedVersion, existing.version);

      if (dto.clinicalEntryAt && !dto.lateEntryReason?.trim() && !existing.lateEntryReason) {
        throw new BadRequestException('A late entry requires a reason');
      }

      const note = await tx.clinicalNote.update({
        where: { id },
        data: {
          notes: dto.notes ?? existing.notes,
          noteLanguage: dto.noteLanguage ?? existing.noteLanguage,
          clinicalEntryAt: dto.clinicalEntryAt ?? existing.clinicalEntryAt,
          lateEntryReason: dto.lateEntryReason ?? existing.lateEntryReason,
          version: { increment: 1 },
        },
      });
      await this.writeRevision(
        tx,
        note,
        note as unknown as Record<string, unknown>,
        'UPDATED',
        existing.status,
        actor,
      );
      return { ...note, bmi: computeBmi(note.weight, note.height), isLateEntry: note.clinicalEntryAt != null };
    });
  }

  // Signing is one atomic step: verify identity, eligibility, branch, state
  // and version; write the final revision with its content hash; flip to
  // SIGNED with the signer's identity snapshot. Any failure rolls the whole
  // thing back — there is no partially-signed state.
  async sign(id: string, dto: SignClinicalNoteDto) {
    return this.withTenantTx(async (tx) => {
      const existing = await tx.clinicalNote.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Clinical note not found');
      }
      const actor = await this.requireActor(tx);

      if (existing.noteType === 'STAFF_REMARK') {
        throw new ForbiddenException('A staff remark is not a clinical note and cannot be signed');
      }
      if (!canSignClinicalNotes(actor)) {
        throw new ForbiddenException(
          'You are not authorised to sign clinical notes. A recorded professional verification and enabled signing permission are required.',
        );
      }
      if (existing.status === 'SIGNED') {
        throw new ConflictException('This note is already signed');
      }
      assertBranchAccess(actor, existing.clinicId!, await this.branchContext(tx, actor));
      this.assertVersion(dto.expectedVersion, existing.version);

      // The signer is ALWAYS the authenticated caller — never a body field.
      // This makes signing under another doctor's identity structurally
      // impossible, while still allowing a doctor to countersign a note
      // authored by someone else.
      const snap = snapshotOf(actor);
      const note = await tx.clinicalNote.update({
        where: { id },
        data: {
          status: 'SIGNED',
          signedByStaffId: snap.staffId,
          signerNameSnapshot: snap.nameSnapshot,
          signerRoleSnapshot: snap.roleSnapshot,
          signerDesignationSnapshot: snap.designationSnapshot,
          signedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.writeRevision(
        tx,
        note,
        note as unknown as Record<string, unknown>,
        'SIGNED',
        existing.status,
        actor,
      );
      return { ...note, bmi: computeBmi(note.weight, note.height), isLateEntry: note.clinicalEntryAt != null };
    });
  }

  // An amendment is a NEW note linked to the signed original. The original is
  // never rewritten — it stays byte-for-byte SIGNED, and "amended" is derived
  // from the existence of this link.
  async amend(id: string, dto: AmendClinicalNoteDto) {
    return this.withTenantTx(async (tx) => {
      const original = await tx.clinicalNote.findUnique({ where: { id } });
      if (!original) {
        throw new NotFoundException('Clinical note not found');
      }
      const actor = await this.requireActor(tx);

      // A signed note is amendable because it's locked; a LEGACY note is
      // amendable for the same reason — it's read-only and cannot be
      // corrected in place. Everything else is still an editable draft.
      if (original.status !== 'SIGNED' && !original.legacyAuthorUnknown) {
        throw new ConflictException('Only a signed or legacy note can be amended. Edit the draft instead.');
      }
      if (!canSignClinicalNotes(actor)) {
        throw new ForbiddenException('Only an authorised doctor may amend a signed clinical note');
      }
      if (!dto.amendmentReason?.trim()) {
        throw new BadRequestException('An amendment requires a reason');
      }
      assertBranchAccess(actor, original.clinicId!, await this.branchContext(tx, actor));

      const snap = snapshotOf(actor);
      const amendment = await tx.clinicalNote.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: original.clinicId,
          visitId: original.visitId,
          noteType: 'DOCTOR_NARRATIVE',
          notes: dto.notes ?? null,
          noteLanguage: dto.noteLanguage ?? original.noteLanguage,
          status: 'DRAFT',
          entryType: 'AMENDMENT',
          supersedesNoteId: original.id,
          amendmentReason: dto.amendmentReason.trim(),
          clinicalEntryAt: dto.clinicalEntryAt ?? null,
          lateEntryReason: dto.lateEntryReason ?? null,
          version: 1,
          authorStaffId: snap.staffId,
          authorNameSnapshot: snap.nameSnapshot,
          authorRoleSnapshot: snap.roleSnapshot,
          authorDesignationSnapshot: snap.designationSnapshot,
          legacyAuthorUnknown: false,
        },
      });
      await this.writeRevision(
        tx,
        amendment,
        amendment as unknown as Record<string, unknown>,
        'CREATED',
        null,
        actor,
        dto.amendmentReason.trim(),
      );
      return { ...amendment, bmi: null, hasAmendment: false, isLateEntry: amendment.clinicalEntryAt != null };
    });
  }

  // Optimistic concurrency: a caller must send the version it read. If
  // another save landed first, it gets a 409 rather than silently
  // overwriting newer clinical content.
  private assertVersion(expected: number | undefined, actual: number) {
    if (expected === undefined) {
      throw new BadRequestException('expectedVersion is required');
    }
    if (expected !== actual) {
      throw new ConflictException(
        `This note was changed by someone else (your version ${expected}, current ${actual}). Reload before saving.`,
      );
    }
  }
}
