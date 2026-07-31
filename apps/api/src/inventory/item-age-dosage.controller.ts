import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ItemAgeDosageService } from './item-age-dosage.service';
import { CreateItemAgeDosageDto } from './dto/create-item-age-dosage.dto';

@Controller('item-age-dosages')
export class ItemAgeDosageController {
  constructor(private readonly ageDosages: ItemAgeDosageService) {}

  @Get()
  findByItem(@Query('itemId') itemId: string) {
    return this.ageDosages.findByItemId(itemId);
  }

  @Post()
  create(@Body() dto: CreateItemAgeDosageDto) {
    return this.ageDosages.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ageDosages.remove(id);
  }
}
