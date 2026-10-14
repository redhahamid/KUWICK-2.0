import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ProviderShiftService } from './provider-shift.service';
import { WorkforceCategory } from '../workforce/workforce-category';
import {
  CopyRosterDto,
  CreateLocumSlotDto,
  CreateProviderShiftDto,
  PublishRosterDto,
  SetScheduleModeDto,
  UpdateProviderShiftDto,
} from './dto/provider-shift.dto';

@Controller('provider-shifts')
export class ProviderShiftController {
  constructor(private readonly shifts: ProviderShiftService) {}

  // Literal paths BEFORE `:id`, or Nest reads "month" as an id. The same trap
  // that made `/appointments/dashboard` silently return nothing.
  /** Publish a branch's month to My Kuwick (UAT, 14 October 2026). */
  @Post('publish')
  publish(@Body() dto: PublishRosterDto) {
    return this.shifts.publish(dto);
  }

  /** External locums, by name. */
  @Post('locum-slots')
  createLocumSlots(@Body() dto: CreateLocumSlotDto) {
    return this.shifts.createLocumSlots(dto);
  }

  @Delete('locum-slots/:id')
  removeLocumSlot(@Param('id') id: string) {
    return this.shifts.removeLocumSlot(id);
  }

  /** Seven days from the branch's week start (UAT, 14 October 2026). */
  @Get('week')
  week(
    @Query('clinicId') clinicId: string,
    @Query('start') start: string,
    @Query('category') category?: WorkforceCategory,
  ) {
    return this.shifts.week(clinicId, start, category);
  }

  /** Owner only: who the roster considered for this branch and month, and why anybody is left off. */
  @Get('roster-check')
  rosterCheck(@Query('clinicId') clinicId: string, @Query('month') month: string) {
    return this.shifts.rosterCheck(clinicId, month);
  }

  @Get('month')
  month(
    @Query('clinicId') clinicId: string,
    @Query('month') month: string,
    /** All of them when omitted. The response carries the counts either way. */
    @Query('category') category?: WorkforceCategory,
  ) {
    return this.shifts.month(clinicId, month, category);
  }

  @Get('range')
  range(
    @Query('clinicId') clinicId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.shifts.range(clinicId, from, to);
  }

  @Post()
  create(@Body() dto: CreateProviderShiftDto) {
    return this.shifts.create(dto);
  }

  @Post('copy-month')
  copyMonth(@Body() dto: CopyRosterDto) {
    return this.shifts.copyMonth(dto);
  }

  @Put('schedule-mode')
  setScheduleMode(@Body() dto: SetScheduleModeDto) {
    return this.shifts.setScheduleMode(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProviderShiftDto) {
    return this.shifts.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shifts.remove(id);
  }
}
