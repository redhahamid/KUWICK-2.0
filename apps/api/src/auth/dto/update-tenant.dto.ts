import { IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug may only contain lowercase letters, numbers, and hyphens' })
  slug?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: string;

  @IsOptional()
  @IsString()
  registrationNo?: string;

  // D-049 — contact details live on the tenant's first Clinic row; the
  // console's Edit Clinic modal writes them through this same endpoint.
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}
