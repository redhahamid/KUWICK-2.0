import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpsertTemplateDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(80) name!: string;
  /** Supports {{name}}, {{firstName}} and {{clinic}}. */
  @IsString() @MaxLength(2000) body!: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
