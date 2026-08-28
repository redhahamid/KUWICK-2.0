import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { OperationsService, PeriodPreset } from './operations.service';
import { SegmentService } from './segment.service';
import { ProgrammeService } from './programme.service';
import { MarketingService } from './marketing.service';
import { UpsertSegmentDto } from './dto/upsert-segment.dto';
import { UpsertProgrammeDto } from './dto/upsert-programme.dto';
import { EnrolPatientDto } from './dto/enrol-patient.dto';
import { BuildAudienceDto } from './dto/build-audience.dto';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { PrepareDispatchDto } from './dto/prepare-dispatch.dto';
import { OptionalDateParam, RequiredDateParam } from '../core/date-param.pipe';
import { assertDateOrder } from '../core/query-dates';

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly segments: SegmentService,
    private readonly programmes: ProgrammeService,
    private readonly marketing: MarketingService,
  ) {}

  @Get('overview')
  overview(
    @Query('clinicId') clinicId?: string,
    @Query('preset') preset?: PeriodPreset,
    @Query('from', OptionalDateParam) from?: string,
    @Query('to', OptionalDateParam) to?: string,
  ) {
    assertDateOrder(from, to);
    return this.operations.overview({ clinicId, preset, from, to });
  }

  // --- Segments -------------------------------------------------------------

  @Get('segments')
  listSegments() {
    return this.segments.listSegments();
  }

  @Post('segments')
  upsertSegment(@Body() dto: UpsertSegmentDto) {
    return this.segments.upsertSegment(dto);
  }

  @Get('segments/profit-and-loss')
  segmentPl(@Query('from', RequiredDateParam) from: string, @Query('to', RequiredDateParam) to: string, @Query('clinicId') clinicId?: string) {
    assertDateOrder(from, to);
    return this.segments.profitAndLoss({ from, to, clinicId });
  }

  @Get('segments/:id/lines')
  segmentLines(
    @Param('id') id: string,
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
  ) {
    assertDateOrder(from, to);
    return this.segments.segmentDetail(id, { from, to, clinicId });
  }

  // --- Programmes -----------------------------------------------------------

  @Get('programmes')
  listProgrammes() {
    return this.programmes.list();
  }

  @Post('programmes')
  upsertProgramme(@Body() dto: UpsertProgrammeDto) {
    return this.programmes.upsert(dto);
  }

  @Post('programmes/enrol')
  enrol(@Body() dto: EnrolPatientDto) {
    return this.programmes.enrol(dto);
  }

  @Get('programmes/:id/dashboard')
  programmeDashboard(
    @Param('id') id: string,
    @Query('from', RequiredDateParam) from: string,
    @Query('to', RequiredDateParam) to: string,
    @Query('clinicId') clinicId?: string,
  ) {
    assertDateOrder(from, to);
    return this.programmes.dashboard(id, { from, to, clinicId });
  }

  // --- Marketing ------------------------------------------------------------

  @Get('marketing/audience')
  buildAudience(@Query() dto: BuildAudienceDto) {
    return this.marketing.buildAudience(dto);
  }

  @Get('marketing/templates')
  templates() {
    return this.marketing.listTemplates();
  }

  @Post('marketing/templates')
  upsertTemplate(@Body() dto: UpsertTemplateDto) {
    return this.marketing.upsertTemplate(dto);
  }

  @Post('marketing/prepare')
  prepare(@Body() dto: PrepareDispatchDto) {
    return this.marketing.prepare(dto);
  }

  @Patch('marketing/dispatches/:id/opened')
  markOpened(@Param('id') id: string) {
    return this.marketing.markOpened(id);
  }

  @Get('marketing/history')
  history(@Query('from', OptionalDateParam) from?: string, @Query('to', OptionalDateParam) to?: string) {
    assertDateOrder(from, to);
    return this.marketing.history({ from, to });
  }
}
