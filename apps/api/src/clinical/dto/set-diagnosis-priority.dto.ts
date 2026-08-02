import { IsEnum, IsOptional } from 'class-validator';
import { DiagnosisPriority } from '@prisma/client';

// G2a (D-059) — set or clear a diagnosis's clinical priority.
//
// `priority: null` clears it back to "not recorded", which a doctor must be
// able to do: marking something Primary by mistake should be correctable
// without deleting the clinical record.
export class SetDiagnosisPriorityDto {
  @IsOptional()
  @IsEnum(DiagnosisPriority)
  priority?: DiagnosisPriority | null;
}
