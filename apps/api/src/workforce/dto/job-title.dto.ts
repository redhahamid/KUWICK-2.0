import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/** A job the clinic has, in its own words. */
export class CreateJobTitleDto {
  @IsString() @Length(2, 80) name!: string;
}

export class UpdateJobTitleDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  /** Retired titles stay on the people who hold them and are offered to nobody new. */
  @IsOptional() @IsBoolean() active?: boolean;
}
