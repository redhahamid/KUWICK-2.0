import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SystemRole } from '@prisma/client';
import { RoleAccessService } from './role-access.service';

class SetRolesDto {
  @IsArray()
  @IsIn(['DOCTOR', 'CLINICAL_STAFF', 'ADMINISTRATOR', 'OWNER'], { each: true })
  roles!: SystemRole[];

  @IsArray()
  @IsString({ each: true })
  customRoleIds!: string[];
}

class GrantDto {
  @IsString()
  permission!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

class CustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

class UpdateCustomRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

/**
 * FINAL-UAT — the role-management surface. Every route is service-gated on
 * `users.manage` (owner), same pattern as the rest of the app: authorization
 * lives in the service inside the tenant transaction, not in a decorator.
 */
@Controller('staff-access')
export class RoleAccessController {
  constructor(private readonly access: RoleAccessService) {}

  @Get('custom-roles')
  listCustomRoles() {
    return this.access.listCustomRoles();
  }

  @Get('custom-roles/catalogue')
  catalogue() {
    return this.access.customRolePermissionCatalogue();
  }

  @Post('custom-roles')
  createCustomRole(@Body() dto: CustomRoleDto) {
    return this.access.createCustomRole(dto);
  }

  @Patch('custom-roles/:id')
  updateCustomRole(@Param('id') id: string, @Body() dto: UpdateCustomRoleDto) {
    return this.access.updateCustomRole(id, dto);
  }

  @Delete('custom-roles/:id')
  deleteCustomRole(@Param('id') id: string) {
    return this.access.deleteCustomRole(id);
  }

  @Get(':staffId')
  accessOf(@Param('staffId') staffId: string) {
    return this.access.accessOf(staffId);
  }

  @Put(':staffId/roles')
  setRoles(@Param('staffId') staffId: string, @Body() dto: SetRolesDto) {
    return this.access.setRoles(staffId, dto);
  }

  @Post(':staffId/grants')
  grant(@Param('staffId') staffId: string, @Body() dto: GrantDto) {
    return this.access.grant(staffId, dto);
  }
}
