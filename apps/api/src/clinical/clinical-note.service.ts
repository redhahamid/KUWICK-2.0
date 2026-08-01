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

// D-044: many-per-visit — a single consultation can carry several notes
// (e.g. triage vitals, then a reassessment note after a nebuliser), so this
// is now list/create/update rather than find/upsert-by-visit.
@Injectable()
export class ClinicalNoteService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async listByVisitId(visitId: string) {
    const notes = await this.prisma.clinicalNote.findMany({
      where: { visitId },
      orderBy: { createdAt: 'desc' },
    });
    return notes.map((note) => ({ ...note, bmi: computeBmi(note.weight, note.height) }));
  }

  async create(visitId: string, dto: UpsertClinicalNoteDto) {
    const note = await this.prisma.clinicalNote.create({
      data: { tenantId: currentTenantId(), visitId, ...dto },
    });
    return { ...note, bmi: computeBmi(note.weight, note.height) };
  }

  async update(id: string, dto: UpsertClinicalNoteDto) {
    const note = await this.prisma.clinicalNote.update({ where: { id }, data: dto });
    return { ...note, bmi: computeBmi(note.weight, note.height) };
  }
}
