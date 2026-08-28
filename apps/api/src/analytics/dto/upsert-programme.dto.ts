import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class UpsertProgrammeDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(80) name!: string;
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) serviceCatalogIds?: string[];
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) itemIds?: string[];
  /** Suggests enrolment; never auto-enrols. */
  @IsOptional() @IsArray() @IsString({ each: true }) diagnosisCodes?: string[];
}
