import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * ASKING FOR AN ITEM THAT DOES NOT EXIST YET.
 *
 * The clinic runs this as five columns with the approval as a text note in the
 * fourth. What the fields below add is a state, an actor, a date, and a check
 * against the catalogue before anything is created.
 */
export class RaiseNewItemRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  requestedName!: string;

  /**
   * Why. Mandatory and at least a sentence — the stock admin deciding this is
   * not the person who saw the patient, and "we ran out" and "a consultant asked
   * for it by name" lead to different answers.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;

  @IsOptional()
  @IsUUID()
  clinicId?: string;

  @IsOptional()
  @IsUUID()
  suggestedSupplierId?: string;

  /** Pack size in the requester's own words. Structured on approval, not now. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  packSizeNote?: string;

  @IsOptional()
  @Matches(MONEY)
  indicativeCost?: string;

  @IsOptional()
  @Matches(MONEY)
  indicativePrice?: string;
}

/**
 * APPROVING ONE INTO EXISTENCE.
 *
 * The approval is what turns prose into a catalogue entry: a name, a cost, a
 * selling price and a pack unit as FIELDS. The clinic's sheet cannot do this,
 * which is why its price list holds pack sizes as sentences and unit costs as
 * hardcoded arithmetic.
 */
export class ApproveNewItemRequestDto {
  /** The canonical name. Defaults to what was asked for. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  /** The packaging unit — "Box", "Strip", "Bottle". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  unitOfMeasure?: string;

  @Matches(MONEY)
  sellPrice!: string;

  @IsOptional()
  @Matches(MONEY)
  cost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionNote?: string;

  /**
   * Create the item even though the catalogue already has something that looks
   * like it. Requires a deliberate act, because a duplicate item means two
   * stock levels, two costs and a count that never reconciles.
   */
  @IsOptional()
  acknowledgeDuplicate?: boolean;
}

export class RejectNewItemRequestDto {
  /** Mandatory. The person who asked will want to know why, and so will the next person who asks. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  decisionNote!: string;
}
