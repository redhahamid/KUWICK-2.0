import { Role } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { UpsertEmployeeDto } from './upsert-employee.dto';

/**
 * ADDING SOMEBODY, IN ONE ACT.
 *
 * Three records can be created here and they are three different facts:
 *
 *   - the STAFF row — this person exists and works at this branch
 *   - the EMPLOYMENT PROFILE — their employment terms
 *   - optionally a LOGIN — they can sign in
 *
 * Kuwick keeps those separate internally and always will: a locum with no
 * login is legitimate, and so is a manager who has an account before HR has
 * finished their paperwork. What was missing was a single door, so an owner
 * did not have to know the separation existed to hire somebody.
 *
 * Salary and statutory classification are DELIBERATELY not here. Both are
 * effective-dated and are recorded with the date they take effect from, at
 * their own endpoints. Accepting them in a create would mean inventing "from
 * today", which is the guess the effective-dated tables exist to remove.
 */
export class CreateEmployeeDto extends UpsertEmployeeDto {
  /** How the person is known on screen. Required — everything else can wait. */
  @IsString() @Length(2, 160) fullName!: string;

  /** The administrative job title. Decides their default capabilities. */
  @IsEnum(Role) role!: Role;

  /** Where they work. A branchless staff row is a group-level account. */
  @IsOptional() @IsUUID() clinicId?: string;

  /**
   * Give them a login now, or later.
   *
   * Both or neither: an email with no password is an account nobody can use,
   * and the service refuses the half-made version rather than creating it.
   */
  @IsOptional() @IsEmail() @MaxLength(160) loginEmail?: string;
  @IsOptional() @IsString() @Length(8, 200) loginPassword?: string;

  /**
   * CLINICAL IDENTITY, and only when it is real.
   *
   * A registration number is what makes somebody a provider; without one they
   * are an employee who happens to have a clinical job title. Not inferred
   * from the role, because "every doctor can sign" is how an unregistered
   * locum ends up signing notes.
   */
  @IsOptional() @IsString() @MaxLength(60) medicalRegistrationNo?: string;
  @IsOptional() @IsBoolean() bookable?: boolean;
}
