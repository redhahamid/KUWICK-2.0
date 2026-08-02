import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDocumentTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * G3b closure (D-064) — does a document made from this template carry a
   * doctor's clinical opinion? Omitted means TRUE (fail closed): a template
   * nobody has classified is treated as clinical rather than guessed at from
   * its name.
   */
  @IsOptional()
  @IsBoolean()
  requiresClinicalAuthorisation?: boolean;
}

export class UpdateDocumentTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  content?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * G3b closure (D-064) — does a document made from this template carry a
   * doctor's clinical opinion? Omitted means TRUE (fail closed): a template
   * nobody has classified is treated as clinical rather than guessed at from
   * its name.
   */
  @IsOptional()
  @IsBoolean()
  requiresClinicalAuthorisation?: boolean;
}
