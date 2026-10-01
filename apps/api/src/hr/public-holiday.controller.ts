import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PublicHolidayService } from './public-holiday.service';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';

@Controller('public-holidays')
export class PublicHolidayController {
  constructor(private readonly publicHolidays: PublicHolidayService) {}

  @Get()
  findAll() {
    return this.publicHolidays.findAll();
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
