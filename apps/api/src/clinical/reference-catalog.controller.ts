import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ReferenceCatalogName,
  ReferenceCatalogService,
  isReferenceCatalog,
} from './reference-catalog.service';

/**
 * b1 PHASE 1 — `/reference-catalogs/:catalog`.
 *
 * One route family for the five prescription catalogues. The catalogue name is a
 * path segment and is validated against a closed list, so an unknown name is a
 * 400 naming what is available rather than a 500 from an undefined delegate.
 */
@Controller('reference-catalogs')
export class ReferenceCatalogController {
  constructor(private readonly catalogs: ReferenceCatalogService) {}

  private parse(catalog: string): ReferenceCatalogName {
    if (!isReferenceCatalog(catalog)) {
      throw new BadRequestException(
        'Unknown catalogue. Available: frequencies, dosage-units, consumption-methods, indications, stock-units.',
      );
    }
    return catalog;
  }

  @Get(':catalog')
  list(@Param('catalog') catalog: string, @Query('includeRetired') includeRetired?: string) {
    return this.catalogs.list(this.parse(catalog), includeRetired === 'true');
  }

  @Post(':catalog')
  create(@Param('catalog') catalog: string, @Body() body: Record<string, unknown>) {
    return this.catalogs.create(this.parse(catalog), body ?? {});
  }

  @Patch(':catalog/:id')
  update(
    @Param('catalog') catalog: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.catalogs.update(this.parse(catalog), id, body ?? {});
  }

  /**
   * Retire or restore. A separate route from `update` because it is a different
   * decision — and because DELETE is not offered at all: these rows are
   * referenced by prescriptions already printed, and the database refuses to
   * remove them regardless of what any route asks for.
   */
  @Patch(':catalog/:id/active')
  setActive(
    @Param('catalog') catalog: string,
    @Param('id') id: string,
    @Body() body: { active?: unknown },
  ) {
    if (typeof body?.active !== 'boolean') {
      throw new BadRequestException('active must be true or false.');
    }
    return this.catalogs.setActive(this.parse(catalog), id, body.active);
  }
}
