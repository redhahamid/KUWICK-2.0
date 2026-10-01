import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { PlatformStatutoryTableService } from "./platform-statutory-table.service";
import { CreateStatutoryTableVersionDto } from "./dto/create-statutory-table-version.dto";

// Excluded from TenantContextMiddleware (AppModule's `platform/(.*)`) and
// guarded by PlatformAuthGuard: the register of statutory editions belongs to
// the platform, not to any clinic.
@Controller("platform/statutory-tables")
@UseGuards(PlatformAuthGuard)
export class PlatformStatutoryTableController {
  constructor(private readonly tables: PlatformStatutoryTableService) {}

  @Get()
  list() {
    return this.tables.list();
  }

  @Post()
  create(
    @Body() dto: CreateStatutoryTableVersionDto,
    @Req() request: Request & { platformAdminId: string },
  ) {
    return this.tables.create(dto, request.platformAdminId);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.tables.remove(id);
  }
}
