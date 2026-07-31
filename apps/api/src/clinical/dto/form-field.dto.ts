import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

// Not a DB enum — `fields` is stored as JSON on FormTemplate (see schema
// comment), validated at the app layer only. Mirrors the owner's audited
// kuwick.com "Result Form Builder" type picker (Short Answer/Paragraph/
// Multiple choice/Checkboxes/Drop-down/Date/Time) plus NUMBER for lab
// values with units — grids, rating, linear scale, file upload, and
// title/description sections from that picker are deferred (file upload
// already exists as a separate Attachment feature; the rest are lower-
// value for v1 and don't require a schema change to add later).
export const FORM_FIELD_TYPES = ['TEXT', 'NUMBER', 'TEXTAREA', 'RADIO', 'CHECKBOX', 'SELECT', 'DATE', 'TIME'] as const;

export class FormFieldDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn(FORM_FIELD_TYPES)
  type!: (typeof FORM_FIELD_TYPES)[number];

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsNumber()
  normalRangeMin?: number;

  @IsOptional()
  @IsNumber()
  normalRangeMax?: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}
