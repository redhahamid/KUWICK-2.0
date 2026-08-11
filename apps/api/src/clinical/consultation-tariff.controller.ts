import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ConsultationTariffService } from './consultation-tariff.service';
import { UpsertConsultationTariffRuleDto } from './dto/upsert-consultation-tariff-rule.dto';

// G4.5d3c-3b2 (D-094) — Clinic Settings → Consultation Tariffs.
@Controller('consultation-tariff-rules')
export class ConsultationTariffController {
  constructor(private readonly rules: ConsultationTariffService) {}

  @Get()
  findAll(@Query('clinicId') clinicId?: string) {
    return this.rules.findAll(clinicId);
  }

  @Post()
  create(@Body() dto: UpsertConsultationTariffRuleDto) {
    return this.rules.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpsertConsultationTariffRuleDto) {
    return this.rules.update(id, dto);
  }

  // Deactivation, not deletion: the rule is referenced by the charges it
  // produced, and that history must survive.
  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.rules.deactivate(id);
  }
}
