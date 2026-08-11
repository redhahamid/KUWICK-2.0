import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DispensaryBoardService } from './dispensary-board.service';
import { DispensaryService } from './dispensary.service';
import { LabelPrintService } from './label-print.service';
import { DispenseMedicationDto, PrintLabelDto } from './dto/dispense-medication.dto';

/**
 * G4.5d5b-2 — the dispensary's HTTP surface.
 *
 * Every route below authorises inside its service, against the actor's role
 * AND the visit's branch. There is no route here that a frontend filter is
 * responsible for hiding: the server refuses, and the browser's job is only
 * to avoid offering what would be refused.
 */
@Controller('dispensary')
export class DispensaryController {
  constructor(
    private readonly board: DispensaryBoardService,
    private readonly dispensary: DispensaryService,
    private readonly labels: LabelPrintService,
  ) {}

  /** One read behind the whole workspace — see DispensaryBoardService. */
  @Get('board')
  getBoard(@Query('clinicId') clinicId: string) {
    return this.board.board(clinicId);
  }

  /**
   * Dispense one or more medications from ONE visit.
   *
   * Single and multi share this route because they share the rules. The
   * quantity is never accepted from the caller — it is read from the
   * prescription the doctor wrote.
   */
  @Post('dispense')
  dispense(@Body() dto: DispenseMedicationDto) {
    return this.dispensary.dispense({
      visitId: dto.visitId,
      prescriptionIds: dto.prescriptionIds,
      acknowledgeStockWarning: dto.acknowledgeStockWarning,
    });
  }

  /**
   * G4.5d5b-3 — the label as it WOULD print, without recording a print.
   *
   * A GET, because it writes nothing. The workspace shows the dispenser the
   * assembled label before it goes to the printer, and a preview that landed
   * in the print history would make that history useless: "was this printed"
   * has to mean printed, not looked at.
   */
  @Get('prescriptions/:prescriptionId/label-preview')
  previewLabel(
    @Param('prescriptionId') prescriptionId: string,
    @Query('copies') copies?: string,
  ) {
    return this.labels.preview(prescriptionId, copies ? Number(copies) : 1);
  }

  /**
   * Assemble a label from the RECORD and audit the print.
   *
   * A POST, not a GET, because it writes: the audit row is part of printing,
   * not an optional extra a caller could skip.
   */
  @Post('prescriptions/:prescriptionId/label')
  printLabel(@Param('prescriptionId') prescriptionId: string, @Body() dto: PrintLabelDto) {
    return this.labels.print(prescriptionId, dto.copies ?? 1);
  }

  @Get('prescriptions/:prescriptionId/label-history')
  labelHistory(@Param('prescriptionId') prescriptionId: string) {
    return this.labels.history(prescriptionId);
  }
}
