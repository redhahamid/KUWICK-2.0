import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PrepareDispatchDto {
  @IsUUID() templateId!: string;

  /**
   * Capped, deliberately. Preparing two thousand messages a staff member must
   * then send by hand is not a workflow, and pretending it is would be the fake
   * automation this module avoids.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  patientIds!: string[];

  @IsOptional() @IsUUID() clinicId?: string;
  @IsOptional() @IsString() @MaxLength(80) audienceName?: string;
}
