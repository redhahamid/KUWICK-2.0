import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PublicHolidayService } from './public-holiday.service';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { LoadHolidayPresetsDto } from './dto/load-holiday-presets.dto';

@Controller('public-holidays')
export class PublicHolidayController {
  constructor(private readonly publicHolidays: PublicHolidayService) {}

  @Get()
  findAll() {
    return this.publicHolidays.findAll();
  }

  /** The year's federal and state holidays for one state, to tick before loading. */
  @Get('presets')
  presets(@Query('year') year: string, @Query('state') state: string) {
    return this.publicHolidays.presets(Number(year), state);
  }

  @Post('presets')
  loadPresets(@Body() dto: LoadHolidayPresetsDto) {
    return this.publicHolidays.loadPresets(dto);
  }

  @Post()
  create(@Body() dto: CreatePublicHolidayDto) {
    return this.publicHolidays.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePublicHolidayDto) {
    return this.publicHolidays.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.publicHolidays.remove(id);
  }
}
