import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';

/**
 * The stable codes an inbox row carries. The WEB owns the human words for
 * each (one dictionary, so the toast, the bell and the list can never
 * disagree); the API stores the code plus a prepared title/body so a row is
 * still readable if a code is retired.
 */
export type StaffNotificationType =
  | 'NEW_BOOKING'
  | 'BOOKING_REQUEST'
  | 'REQUEST_ACCEPTED'
  | 'REQUEST_DECLINED'
  | 'PATIENT_CANCELLED'
  | 'PATIENT_RESCHEDULED'
  | 'WAITLIST_ADDED'
  | 'RESCHEDULE_REQUESTED'
  | 'CANCELLATION_REQUESTED'
  | 'CHANGE_REQUEST_DECIDED';

/** The roles that work the front desk's worklist — see `resolveRecipients`. */
const DESK_ROLES: Role[] = [Role.OWNER_ADMIN, Role.FRONT_DESK_CLINICAL_STAFF];

export interface NotifyInput {
  clinicId: string;
  type: StaffNotificationType;
  /** "New online booking" — short, the toast's headline. */
  title: string;
  /** "Nurul Izzah · GP Consultation · 22 Aug, 10:00 · Dr Priya" */
  body: string;
  appointmentId?: string;
  /**
   * The provider whose diary this touches — always included as a recipient
   * (their list changed) unless they are the actor.
   */
  assignedStaffId?: string;
  /**
   * Whether the front-desk/admin roles of the branch should hear about it.
   * False for ordinary staff-created actions: the desk does not need a toast
   * for the booking a colleague just typed in front of them (§5F) — only the
   * assigned doctor does.
   */
  includeDesk: boolean;
  /** The staff member who did it. NEVER notified about their own action. */
  actorStaffId?: string | null;
}

/**
 * PHASE 5 — WHO IS TOLD, AND WHO IS NOT.
 *
 * Routing is deliberately role-and-branch based, resolved at WRITE time: an
 * inbox row is fanned out to each recipient so "Aisyah has read it" is a fact
 * about Aisyah. Rules:
 *
 *   - desk events go to active OWNER_ADMIN and FRONT_DESK_CLINICAL_STAFF of
 *     THAT branch (tenant-wide staff — clinicId null — hear about every
 *     branch, which is what an owner is);
 *   - the assigned provider is told about their own diary;
 *   - the ACTOR is never told about their own action (§5F);
 *   - visibility is not authority: an inbox row lets somebody SEE that a
 *     request exists — acting on it still goes through the same server-side
 *     permission checks as ever (§5D).
 *
 * Writes are best-effort by design: a notification failure must never roll
 * back the booking it describes, so callers emit AFTER their own transaction
 * and this catches rather than throws.
 */
@Injectable()
export class StaffNotificationService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  async notify(input: NotifyInput): Promise<number> {
    try {
      const recipients = await this.resolveRecipients(input);
      if (recipients.length === 0) return 0;
      const tenantId = currentTenantId();
      await this.prisma.staffNotification.createMany({
        data: recipients.map((recipientStaffId) => ({
          tenantId,
          clinicId: input.clinicId,
          recipientStaffId,
          type: input.type,
          title: input.title,
          body: input.body,
          appointmentId: input.appointmentId ?? null,
        })),
      });
      return recipients.length;
    } catch {
      // Said above: the booking is the record; the inbox is a convenience.
      return 0;
    }
  }

  private async resolveRecipients(input: NotifyInput): Promise<string[]> {
    const ids = new Set<string>();
    if (input.includeDesk) {
      const desk = await this.prisma.staff.findMany({
        where: {
          active: true,
          role: { in: DESK_ROLES },
          OR: [{ clinicId: input.clinicId }, { clinicId: null }],
        },
        select: { id: true },
      });
      for (const row of desk) ids.add(row.id);
    }
    if (input.assignedStaffId) ids.add(input.assignedStaffId);
    if (input.actorStaffId) ids.delete(input.actorStaffId);
    return [...ids];
  }

  /** The signed-in staff member's inbox, newest first. */
  async listMine(options: { unreadOnly?: boolean; take?: number } = {}) {
    const recipientStaffId = currentStaffId();
    if (!recipientStaffId) return { unread: 0, rows: [] };
    const where: Prisma.StaffNotificationWhereInput = {
      recipientStaffId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    };
    const [unread, rows] = await Promise.all([
      this.prisma.staffNotification.count({
        where: { recipientStaffId, readAt: null },
      }),
      this.prisma.staffNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(options.take ?? 30, 100),
        include: { clinic: { select: { name: true } } },
      }),
    ]);
    return {
      unread,
      rows: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        clinicId: row.clinicId,
        clinicName: row.clinic.name,
        appointmentId: row.appointmentId,
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Scoped to the CALLER: an id from somebody else's inbox marks nothing. */
  async markRead(id: string) {
    const recipientStaffId = currentStaffId();
    if (!recipientStaffId) return { updated: 0 };
    const result = await this.prisma.staffNotification.updateMany({
      where: { id, recipientStaffId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async markAllRead() {
    const recipientStaffId = currentStaffId();
    if (!recipientStaffId) return { updated: 0 };
    const result = await this.prisma.staffNotification.updateMany({
      where: { recipientStaffId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}

/**
 * "22 Aug, 10:00" in the CLINIC's wall clock — the body line every emitter
 * uses, so no notification ever reads in server time.
 */
export function notificationWhen(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}
