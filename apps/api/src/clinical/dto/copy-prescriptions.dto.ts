import { IsString } from 'class-validator';

export class CopyPrescriptionsDto {
  @IsString()
  sourceVisitId!: string;

  @IsString()
  targetVisitId!: string;
}
