import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpsertMessageTemplateDto {
  @IsString()
  clinicId!: string;

  @IsString()
  templateKey!: string;

  @IsString()
  language!: string;

  /**
   * The clinic's wording. Explicit NULL means "forget my wording, go back to
   * the default" — deliberately distinct from absent, so a client cannot
   * reset a template by accident.
   */
  @ValidateIf((dto: UpsertMessageTemplateDto) => dto.body !== null)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string | null;
}
