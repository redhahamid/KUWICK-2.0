import { IsEnum } from 'class-validator';
import { VisitClassification } from '@prisma/client';

// G4.5d3c-3b2 (D-094) — the visit's operational kind for consultation
// billing. An enum, never free text: exemptions are configuration, not prose.
export class SetVisitClassificationDto {
  @IsEnum(VisitClassification)
  classification!: VisitClassification;
}
