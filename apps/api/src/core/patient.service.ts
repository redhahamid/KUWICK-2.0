import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Patient, PatientIdentifierType } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';
import { PrismaService } from './prisma.service';
import { assertCan } from './permissions';
import { ClinicalTx, requireActor, withTenantTx } from '../clinical/clinical-actor';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@Injectable()
export class PatientService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    // The unwrapped client, for the one path that needs a transaction of its
    // own: an identity correction and the row recording it must land together
    // or not at all, and the scoped extension opens a fresh transaction per
    // query.
    private readonly raw: PrismaService,
  ) {}

  create(dto: CreatePatientDto) {
    return this.prisma.patient.create({
      data: {
        tenantId: currentTenantId(),
        identifierType: dto.identifierType,
        identifierValue: dto.identifierValue,
        name: dto.name,
        dob: dto.dob ? new Date(dto.dob) : undefined,
        gender: dto.gender,
        race: dto.race,
        phone: dto.phone,
        address: dto.address,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
      },
    });
  }

  // "Enter patient name, NRIC or phone number" — the combined search field
  // pattern from the audited Add Appointment wizard's Patient step.
  findAll(search?: string) {
    return this.prisma.patient.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { identifierValue: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id } });
    if (!patient || patient.deletedAt) {
      throw new NotFoundException('Patient not found');
    }
    return patient;
  }

  /**
   * What a correction to this patient's identity would reach.
   *
   * Read BEFORE saving, so the confirmation names what is attached rather than
   * asking "are you sure?" about an unknown quantity. A patient with no visits
   * is a registration typo; a patient with fourteen visits and six invoices is
   * a records decision, and the person making it should be told which one they
   * are looking at.
   */
  async identityImpact(id: string) {
    await this.findById(id);
    const [visits, invoices, documents] = await Promise.all([
      this.prisma.visit.count({ where: { patientId: id } }),
      this.prisma.invoice.count({ where: { visit: { patientId: id } } }),
      this.prisma.document.count({ where: { visit: { patientId: id } } }),
    ]);
    return { visits, invoices, documents };
  }

  /** The corrections already made, newest first. */
  identityHistory(id: string) {
    return this.prisma.patientIdentityChange.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdatePatientDto) {
    const before = await this.findById(id);
    const changes = identityDelta(before, dto);

    // A phone number, an address, an emergency contact: unchanged path, no
    // actor lookup, no permission, no record. Only the identifier and the date
    // of birth carry the weight that earns all three.
    if (changes.length === 0) {
      return this.prisma.patient.update({
        where: { id },
        data: { ...dto, dob: dto.dob ? new Date(dto.dob) : undefined },
      });
    }

    return withTenantTx(this.raw, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'patient.identity.write', actor.assignedRoles);

      const nextType = dto.identifierType ?? before.identifierType;
      const nextValue = dto.identifierValue ?? before.identifierValue;
      await assertNoOtherPatientHolds(tx, id, nextType, nextValue);

      const patient = await tx.patient.update({
        where: { id },
        data: { ...dto, dob: dto.dob ? new Date(dto.dob) : undefined },
      });

      // In the SAME transaction as the change it records. A correction that
      // lands while its record fails to would be exactly the silent edit this
      // table exists to prevent.
      await tx.patientIdentityChange.createMany({
        data: changes.map((change) => ({
          tenantId: actor.tenantId,
          patientId: id,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedByStaffId: actor.id,
          changedByNameSnapshot: actor.fullName,
          changedByRoleSnapshot: actor.role,
        })),
      });

      return patient;
    });
  }

  // Soft delete (Patient.deletedAt) — visits/invoices/documents reference
  // patients by FK, so a hard delete would either cascade-destroy clinical
  // history or fail outright; deactivating keeps the record intact for any
  // existing visit while removing it from the active Patients list.
  async remove(id: string) {
    await this.findById(id);
    return this.prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

// ---------------------------------------------------------------------------
// Identity corrections
// ---------------------------------------------------------------------------

/** One field that moved, in the shape the record stores. */
interface IdentityChange {
  field: 'identifierType' | 'identifierValue' | 'dob';
  oldValue: string | null;
  newValue: string | null;
}

/** A date of birth reads as a date, not as an instant in some timezone. */
function dobKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Which identity fields this update actually MOVES.
 *
 * Compared by value, not by presence in the DTO. The profile form submits every
 * field it holds, so "the IC is in the payload" says nothing — a save that only
 * changed a phone number would otherwise demand the identity permission and
 * write a record saying the IC changed from 900101145566 to 900101145566.
 */
function identityDelta(before: Patient, dto: UpdatePatientDto): IdentityChange[] {
  const changes: IdentityChange[] = [];

  if (dto.identifierType !== undefined && dto.identifierType !== before.identifierType) {
    changes.push({
      field: 'identifierType',
      oldValue: before.identifierType,
      newValue: dto.identifierType,
    });
  }
  if (dto.identifierValue !== undefined && dto.identifierValue !== before.identifierValue) {
    changes.push({
      field: 'identifierValue',
      oldValue: before.identifierValue,
      newValue: dto.identifierValue,
    });
  }
  const nextDob = dobKey(dto.dob);
  if (dto.dob !== undefined && nextDob !== dobKey(before.dob)) {
    changes.push({ field: 'dob', oldValue: dobKey(before.dob), newValue: nextDob });
  }

  return changes;
}

/**
 * TWO RECORDS UNDER ONE IC IS THE FAILURE THIS FIX EXISTS TO PREVENT.
 *
 * The database already refuses it — `@@unique([tenantId, identifierType,
 * identifierValue])` — but a unique-violation surfaces as a 500 and a stack
 * trace, which tells the counter nothing and invites them to try again with a
 * slightly different spelling. Checked explicitly so the refusal is a sentence.
 *
 * Soft-deleted patients are checked too, and named as such: they still hold the
 * constraint, so "there is nothing on that IC" would be a lie that the save
 * then contradicts.
 */
async function assertNoOtherPatientHolds(
  tx: ClinicalTx,
  patientId: string,
  identifierType: PatientIdentifierType,
  identifierValue: string,
): Promise<void> {
  const clash = await tx.patient.findFirst({
    where: { identifierType, identifierValue, id: { not: patientId } },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!clash) return;

  throw new ConflictException(
    clash.deletedAt
      ? `A deactivated patient record (${clash.name}) already uses this ${identifierType}. Restore and merge that record instead of putting the same identifier on two files.`
      : `${clash.name} is already registered under this ${identifierType}. Two records under one identifier is what this correction is meant to prevent — check whether these are the same person.`,
  );
}
