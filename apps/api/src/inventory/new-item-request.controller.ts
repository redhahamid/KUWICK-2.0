import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { NewItemRequestStatus } from '@prisma/client';
import { NewItemRequestService } from './new-item-request.service';
import {
  ApproveNewItemRequestDto,
  RaiseNewItemRequestDto,
  RejectNewItemRequestDto,
} from './dto/new-item-request.dto';

/**
 * Asking for an item that does not exist yet — a different question from
 * `procurement-requests`, which asks for more of one that does.
 */
@Controller('new-item-requests')
export class NewItemRequestController {
  constructor(private readonly requests: NewItemRequestService) {}

  @Get()
  list(@Query('status') status?: NewItemRequestStatus) {
    return this.requests.list({ status });
  }

  @Post()
  raise(@Body() dto: RaiseNewItemRequestDto) {
    return this.requests.raise(dto);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveNewItemRequestDto) {
    return this.requests.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectNewItemRequestDto) {
    return this.requests.reject(id, dto);
  }

  /** An item's whole price history — append-only at the database. */
  @Get('/items/:itemId/price-history')
  priceHistory(@Param('itemId') itemId: string) {
    return this.requests.priceHistory(itemId);
  }
}
