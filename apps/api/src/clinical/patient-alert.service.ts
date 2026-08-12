import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { assertCanWritePatientAlert } from './clinical-authorization';
import { requireActor, withTenantTx } from './clinical-actor';
import { CreatePatientAlertDto } from './dto/create-patient-alert.dto';

/**
 * A2 — PATIENT ALERTS (owner spec).
 *
 * Standing facts about a person, structured by type, visible to the whole
 * team. Three rules this service holds:
 *
 *  1. TYPE-AWARE authorisation, server-side. Front counter may record the
 *     wheelchair, the language, the VIP note; a MEDICAL standing fact joins
 *     the allergy strip and bears on prescribing, so it needs
 *     `patient.alert.medical.write` — the split lives in the policy module
 *     and is asserted here, never only hidden in the browser.
 *  2. DEACTIVATE, NEVER DELETE — audited in place (who, when), and the
 *     migration writes no DELETE policy, so PostgreSQL refuses a hard delete
 *     outright. Deactivating follows the same type table as adding: an
 *     account that may not record a MEDICAL alert may not retire one either.
 *  3. Attribution comes from the SESSION. There is no staffId in any DTO.
 */
@Injectable()
export class PatientAlertService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The full list, active and retired — the profile shows history, and every
   * placement surface filters `active` itself. Names are resolved for the
   * audit line ("recorded by …", "retired by …").
   */
  listByPatient(patientId: string) {
    return withTenantTx(this.prisma, async (tx) => {
      const alerts = await tx.patientAlert.findMany({
        where: { patientId },
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
      });
      const staffIds = [
        ...new Set(alerts.flatMap((alert) => [alert.createdByStaffId, alert.deactivatedByStaffId]).filter(Boolean)),
      ] as string[];
      const staff = staffIds.length
        ? await tx.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } })
        : [];
      const nameOf = new Map(staff.map((member) => [member.id, member.fullName]));
      return alerts.map((alert) => ({
        ...alert,
        createdByName: nameOf.get(alert.createdByStaffId) ?? null,
        deactivatedByName: alert.deactivatedByStaffId ? (nameOf.get(alert.deactivatedByStaffId) ?? null) : null,
      }));
    });
  }

  create(patientId: string, dto: CreatePatientAlertDto) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanWritePatientAlert(actor, dto.type);

      const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, deletedAt: true } });
      if (!patient || patient.deletedAt) throw new NotFoundException('Patient not found');

      const label = dto.label.trim();
      if (!label) throw new ConflictException('An alert needs a label.');

      return tx.patientAlert.create({
        data: {
          tenantId: actor.tenantId,
          patientId,
          type: dto.type,
          label,
          note: dto.note?.trim() || null,
          createdByStaffId: actor.id,
        },
      });
    });
  }

  deactivate(alertId: string) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);

      const alert = await tx.patientAlert.findUnique({ where: { id: alertId } });
      if (!alert) throw new NotFoundException('Alert not found');
      // The type table applies to retiring exactly as to recording.
      assertCanWritePatientAlert(actor, alert.type);
      if (!alert.active) {
        throw new ConflictException('This alert is already inactive.');
      }

      return tx.patientAlert.update({
        where: { id: alertId },
        data: { active: false, deactivatedByStaffId: actor.id, deactivatedAt: new Date() },
      });
    });
  }
}
