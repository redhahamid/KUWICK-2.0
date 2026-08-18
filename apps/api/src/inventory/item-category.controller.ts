import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ItemCategoryService } from './item-category.service';
import { catalogueCategories } from './item-catalogue';

@Controller('item-categories')
export class ItemCategoryController {
  constructor(private readonly categories: ItemCategoryService) {}

  @Get()
  async list() {
    const { registry, itemCategories } = await this.categories.list();
    return catalogueCategories(registry, itemCategories);
  }

  @Post()
  create(@Body() body: { name?: string }) {
    return this.categories.create(body?.name ?? '');
  }

  @Post('adopt')
  adopt(@Body() body: { name?: string }) {
    return this.categories.adopt(body?.name ?? '');
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { name?: string }) {
    return this.categories.rename(id, body?.name ?? '');
  }

  // The ONE delete in this package, and it is a delete of a NAME, never of an
  // item. D3: an inventory row is deactivated, because prescriptions and
  // invoice lines point at it.
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
