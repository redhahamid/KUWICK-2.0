import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { UpsertClinicalNoteDto } from './dto/upsert-clinical-note.dto';

// BMI is derived here, never persisted — docs/DATABASE_ARCHITECTURE.md §3:
// storing it would let it go stale the moment weight or height is edited
// without the other.
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

@Injectable()
export class ClinicalNoteService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async findByVisitId(visitId: string) {
    const note = await this.prisma.clinicalNote.findUnique({ where: { visitId } });
    if (!note) {
      return null;
    }
    return { ...note, bmi: computeBmi(note.weight, note.height) };
  }

  // Lazily created on first save (docs/DECISIONS.md, Clinical 2a) rather
  // than alongside the Visit, since most of these fields aren't known yet
  // at check-in time.
  async upsert(visitId: string, dto: UpsertClinicalNoteDto) {
    const tenantId = currentTenantId();
    const note = await this.prisma.clinicalNote.upsert({
      where: { visitId },
      create: { tenantId, visitId, ...dto },
      update: dto,
    });
    return { ...note, bmi: computeBmi(note.weight, note.height) };
  }
}
