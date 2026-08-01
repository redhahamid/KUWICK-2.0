import { IsOptional, IsString, MinLength } from 'class-validator';

// D-049 — edit (or belatedly create) a tenant's OWNER_ADMIN login from the
// platform console. Password omitted = unchanged; for a tenant that has no
// owner login yet (created before owner-at-creation existed), all three
// fields are required and the login is created instead.
export class UpdateTenantOwnerDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Owner password must be at least 8 characters' })
  password?: string;
}
