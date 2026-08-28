import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';

export class SegmentRuleDto {
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsUUID() serviceCatalogId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsString() @MaxLength(120) itemCategory?: string;
  @IsOptional() @IsString() @MaxLength(120) serviceCategory?: string;
  @IsOptional() @IsString() @MaxLength(120) descriptionMatch?: string;
}

export class UpsertSegmentDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(80) name!: string;
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, { message: 'A segment code is uppercase letters, digits, hyphens and underscores.' })
  code!: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) colour?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  /** Replaced wholesale — a mapping rule set is read as an ordered whole. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SegmentRuleDto)
  rules?: SegmentRuleDto[];
}
