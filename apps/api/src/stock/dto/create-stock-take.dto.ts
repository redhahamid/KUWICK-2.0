import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateStockTakeDto {
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  /** Free text: "Cold room", "Front shelf 3". Enough to split a count in two. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Count only these items. Omit for everything the branch holds. */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  itemIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  counterStaffIds?: string[];
}
