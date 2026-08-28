import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { BuildAudienceDto } from './dto/build-audience.dto';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { PrepareDispatchDto } from './dto/prepare-dispatch.dto';

/**
 * MARKETING — an audience builder and a template library.
 *
 * WHAT THIS IS NOT, stated everywhere it could be mistaken for one: a sending
 * integration. Kuwick holds no WhatsApp Business API connection. A staff member
 * copies the message, or opens WhatsApp with it pre-filled, and sends it
 * themselves.
 *
 * SO THERE IS NO "SENT" STATUS. `MarketingDispatch` records PREPARED (the text
 * was generated) and at most OPENED (somebody clicked through). Recording a
 * delivery Kuwick never observed would be exactly the fake automation the brief
 * forbids (§15.5), and a database CHECK keeps the vocabulary honest when
 * somebody later reaches for a friendlier word.
 *
 * MARKETING IS NOT CLINICAL MESSAGING. Nothing here touches appointment
 * reminders or clinical communication, which live in the appointment module
 * with their own consent and audit rules.
 */
@Injectable()
export class MarketingService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Build an audience from live data.
   *
   * COUNTED AND LISTED, never stored as a list: a saved list of patient ids
   * goes stale the moment somebody registers, and a campaign run from a stale
   * list quietly excludes the people who joined since.
   */
  async buildAudience(dto: BuildAudienceDto) {
    await requirePermission(this.rawPrisma, 'marketing.manage');
    const now = new Date();

    const lastVisitFloor = dto.visitedSinceDays
      ? new Date(now.getTime() - dto.visitedSinceDays * 86400000)
      : undefined;
    const lapsedBefore = dto.lapsedForDays ? new Date(now.getTime() - dto.lapsedForDays * 86400000) : undefined;

    const patients = await this.prisma.patient.findMany({
      where: {
        ...(dto.clinicId ? { visits: { some: { clinicId: dto.clinicId } } } : {}),
        ...(dto.panelClinicId ? { visits: { some: { panelClinicId: dto.panelClinicId } } } : {}),
        ...(dto.programmeId
          ? { programmeEnrolments: { some: { programmeId: dto.programmeId, exitedAt: null } } }
          : {}),
        ...(dto.gender ? { gender: dto.gender } : {}),
        ...(lastVisitFloor ? { visits: { some: { createdAt: { gte: lastVisitFloor } } } } : {}),
        ...(lapsedBefore ? { visits: { every: { createdAt: { lt: lapsedBefore } } } } : {}),
        // A patient with no phone number cannot be messaged, so they are not in
        // an audience. Counting them would inflate every campaign figure.
        phone: { not: null },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        dob: true,
        gender: true,
        visits: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: dto.limit ?? 500,
    });

    const withAge = patients
      .map((patient) => ({
        patientId: patient.id,
        name: patient.name,
        phone: patient.phone,
        gender: patient.gender,
        age: patient.dob
          ? Math.floor((now.getTime() - patient.dob.getTime()) / (365.25 * 86400000))
          : null,
        lastVisitAt: patient.visits[0]?.createdAt ?? null,
      }))
      .filter((patient) => {
        if (dto.minAge !== undefined && (patient.age === null || patient.age < dto.minAge)) return false;
        if (dto.maxAge !== undefined && (patient.age === null || patient.age > dto.maxAge)) return false;
        return true;
      });

    return {
      count: withAge.length,
      // Stated in the payload, so a screen cannot present this as a send.
      capability:
        'This is a contact list. Kuwick has no messaging integration: a staff member sends each message themselves and Kuwick records only that the text was prepared.',
      truncated: patients.length === (dto.limit ?? 500),
      patients: withAge,
    };
  }

  async listTemplates() {
    await requirePermission(this.rawPrisma, 'marketing.manage');
    return this.prisma.marketingTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async upsertTemplate(dto: UpsertTemplateDto) {
    return withAdminTx(this.rawPrisma, 'marketing.manage', async (tx, actor) => {
      const placeholders = [...new Set([...dto.body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))];
      const existing = dto.id ? await tx.marketingTemplate.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Template not found');

      return existing
        ? tx.marketingTemplate.update({
            where: { id: existing.id },
            data: { name: dto.name, body: dto.body, category: dto.category, placeholders, active: dto.active ?? true },
          })
        : tx.marketingTemplate.create({
            data: {
              tenantId: currentTenantId(),
              name: dto.name,
              body: dto.body,
              category: dto.category,
              placeholders,
              createdByStaffId: actor.id,
            },
          });
    });
  }

  /**
   * Render a template for patients and record that it was PREPARED.
   *
   * Returns the rendered text and a `wa.me` link per patient. It does NOT open
   * WhatsApp, does not send anything, and the response says so.
   */
  async prepare(dto: PrepareDispatchDto) {
    return withAdminTx(this.rawPrisma, 'marketing.manage', async (tx, actor) => {
      const template = await tx.marketingTemplate.findUnique({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException('Template not found');

      const patients = await tx.patient.findMany({
        where: { id: { in: dto.patientIds } },
        select: { id: true, name: true, phone: true },
      });

      const clinic = dto.clinicId
        ? await tx.clinic.findUnique({ where: { id: dto.clinicId }, select: { name: true } })
        : null;

      const prepared = [];
      for (const patient of patients) {
        if (!patient.phone) continue;
        const body = template.body
          .replace(/\{\{name\}\}/g, patient.name)
          .replace(/\{\{firstName\}\}/g, patient.name.split(' ')[0])
          .replace(/\{\{clinic\}\}/g, clinic?.name ?? '');

        const dispatch = await tx.marketingDispatch.create({
          data: {
            tenantId: currentTenantId(),
            templateId: template.id,
            patientId: patient.id,
            audienceName: dto.audienceName ?? null,
            renderedBody: body,
            status: 'PREPARED',
            preparedByStaffId: actor.id,
          },
        });

        prepared.push({
          dispatchId: dispatch.id,
          patientId: patient.id,
          name: patient.name,
          phone: patient.phone,
          body,
          // A convenience link the staff member clicks. Clicking it is what
          // `markOpened` records — never that the message arrived.
          whatsappUrl: `https://wa.me/${patient.phone.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`,
        });
      }

      return {
        templateName: template.name,
        prepared: prepared.length,
        skippedWithoutPhone: patients.length - prepared.length,
        notice:
          'These messages have been PREPARED, not sent. Kuwick has no WhatsApp integration and receives no delivery confirmation — a staff member must send each one.',
        messages: prepared,
      };
    });
  }

  /** Records that a staff member clicked through to WhatsApp. Nothing more. */
  async markOpened(dispatchId: string) {
    return withAdminTx(this.rawPrisma, 'marketing.manage', async (tx) => {
      const dispatch = await tx.marketingDispatch.findUnique({ where: { id: dispatchId } });
      if (!dispatch) throw new NotFoundException('Dispatch not found');
      return tx.marketingDispatch.update({
        where: { id: dispatchId },
        data: { status: 'OPENED', openedAt: new Date() },
      });
    });
  }

  async history(params: { from?: string; to?: string } = {}) {
    await requirePermission(this.rawPrisma, 'marketing.manage');
    const dispatches = await this.prisma.marketingDispatch.findMany({
      where: {
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
                ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        patient: { select: { name: true, phone: true } },
        template: { select: { name: true } },
        preparedBy: { select: { fullName: true } },
      },
    });

    return {
      // Repeated on the history read, because this is the screen most likely to
      // be mistaken for a delivery report.
      notice:
        'PREPARED means the message text was generated. OPENED means a staff member clicked through to WhatsApp. Neither is confirmation that the patient received anything.',
      rows: dispatches.map((dispatch) => ({
        id: dispatch.id,
        at: dispatch.createdAt,
        patientName: dispatch.patient.name,
        templateName: dispatch.template?.name ?? null,
        audienceName: dispatch.audienceName,
        status: dispatch.status,
        openedAt: dispatch.openedAt,
        preparedBy: dispatch.preparedBy.fullName,
        body: dispatch.renderedBody,
      })),
    };
  }
}
