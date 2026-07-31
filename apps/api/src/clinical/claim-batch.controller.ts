import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ClaimBatchService } from './claim-batch.service';
import { CreateClaimBatchDto } from './dto/create-claim-batch.dto';
import { SubmitClaimBatchDto } from './dto/submit-claim-batch.dto';
import { RecordClaimLinePaymentDto } from './dto/record-claim-line-payment.dto';

@Controller('claim-batches')
export class ClaimBatchController {
  constructor(private readonly claimBatches: ClaimBatchService) {}

  @Get('eligible-invoices')
  findEligibleInvoices(@Query('panelClinicId') panelClinicId: string) {
    return this.claimBatches.findEligibleInvoices(panelClinicId);
  }

  @Get('outstanding')
  listOutstanding() {
    return this.claimBatches.listOutstanding();
  }

  // ------ Panel workbook upgrade (D-041) ------

  @Get('lines')
  listLines(@Query('panelClinicId') panelClinicId: string, @Query('month') month?: string) {
    if (!panelClinicId) {
      throw new BadRequestException('panelClinicId is required');
    }
    return this.claimBatches.listLines(panelClinicId, month);
  }

  @Get('yearly-summary')
  getYearlySummary(@Query('year') year?: string) {
    const parsed = year ? Number(year) : new Date().getFullYear();
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      throw new BadRequestException('year must be a 4-digit year');
    }
    return this.claimBatches.getYearlySummary(parsed);
  }


  @Get()
  listByPanel(@Query('panelClinicId') panelClinicId?: string) {
    return this.claimBatches.listByPanel(panelClinicId);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.claimBatches.findById(id);
  }

  @Post()
  create(@Body() dto: CreateClaimBatchDto) {
    return this.claimBatches.createBatch(dto);
  }

  @Patch(':id/submit')
  submit(@Param('id') id: string, @Body() dto: SubmitClaimBatchDto) {
    return this.claimBatches.submit(id, dto);
  }

  @Patch(':id/lines/:lineId')
  recordLinePayment(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: RecordClaimLinePaymentDto,
  ) {
    return this.claimBatches.recordLinePayment(id, lineId, dto);
  }

  @Patch(':id/reconcile')
  reconcile(@Param('id') id: string) {
    return this.claimBatches.reconcile(id);
  }
}
