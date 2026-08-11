import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ItemService } from './item.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

@Controller('items')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  create(@Body() dto: CreateItemDto) {
    return this.itemService.create(dto);
  }

  @Get()
  findAll(
    @Query('activeOnly') activeOnly?: string,
    @Query('search') search?: string,
    @Query('take') take?: string,
  ) {
    const parsed = take ? Number(take) : undefined;
    return this.itemService.findAll(
      activeOnly === 'true',
      search,
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.itemService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.itemService.update(id, dto);
  }
}
