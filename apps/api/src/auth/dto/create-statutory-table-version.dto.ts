import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * A LATER EDITION OF ONE SCHEME'S TABLE. The content is the same shape the
 * engines read — checked band by band by `parseContent` before it is stored,
 * so a refused edition names each problem. The source document, the year and
 * the in-force date are what a clinic's rates screen shows beside the table.
 */
export class CreateStatutoryTableVersionDto {
  @IsIn(["EPF", "SOCSO", "EIS", "LINDUNG", "PCB", "HRD_LEVY"]) scheme!:
    | "EPF"
    | "SOCSO"
    | "EIS"
    | "LINDUNG"
    | "PCB"
    | "HRD_LEVY";
  @IsInt() @Min(2020) @Max(2100) year!: number;
  /** YYYY-MM-DD. A period resolves to this edition from this date on. */
  @IsISO8601() inForceFrom!: string;
  @IsString() @Length(3, 300) sourceDocument!: string;
  @IsOptional() @IsString() @MaxLength(500) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsObject() content!: Record<string, unknown>;
}
