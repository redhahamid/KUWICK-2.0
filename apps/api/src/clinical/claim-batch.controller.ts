import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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
