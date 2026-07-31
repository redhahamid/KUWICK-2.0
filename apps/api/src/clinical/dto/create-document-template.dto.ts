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
}
