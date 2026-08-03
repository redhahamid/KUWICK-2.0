import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DiagnosisRecordStatus, DocumentRecordStatus, Prisma, Staff } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { branchContext, ClinicalTx, requireActor, withTenantTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';

/**
 * G4 (D-067) — read-only clinical history.
 *
 * This service exists so that reviewing a previous visit is a DIFFERENT
 * operation from working on the current one. It has no create, update or
 * delete method and never will: the read-only guarantee the workspace makes
 * to the doctor is enforced by there being nothing here to call.
 *
 * The audit that preceded it found two things the existing path could not
 * satisfy:
 *
 *  1. `GET /visits?patientId=` returns every visit in one unpaginated array
 *     with only `staff` and `queueTicket` joined — no diagnoses, medications
 *     or documents. A previous-visit card cannot be summarised from it, and a
 *     patient with hundreds of visits pays for all of them on first render.
 *
 *  2. Neither `findAll` nor `findById` checks branch access or the
 *     patient/visit relationship. Tenant isolation held (RLS), but any visit
 *     id in the tenant could be read by anyone who knew it.
 *
 * Both endpoints here therefore resolve the actor from the session, filter or
 * refuse by branch, and require the visit to belong to the patient in the URL.
 */

const SUMMARY_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 25;

export interface VisitHistoryQuery {
  limit?: number;
  cursor?: string;
  search?: string;
  from?: string;
  to?: string;
  staffId?: string;
}

@Injectable()
export class VisitHistoryService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Branches this staff member may read, as a Prisma filter. Returning a
   * filter rather than post-filtering means an unauthorised branch's visits
   * are never loaded, never counted and never paged over.
   */
  private async readableClinicFilter(tx: ClinicalTx, actor: Staff): Promise<Prisma.VisitWhereInput> {
    const context = await branchContext(tx, actor);
    if (context.tenantBranchCount <= 1) {
      return {};
    }
    const readable = new Set(context.authorisedClinicIds);
    if (actor.clinicId) {
      readable.add(actor.clinicId);
    }
    // Empty set stays empty: fail closed. `in: []` matches nothing, which is
    // the correct answer for a staff member with no branch at all.
    return { clinicId: { in: [...readable] } };
  }

  /**
   * Paginated visit summaries for one patient, newest first.
   *
   * Search is SERVER-side and covers the whole history, not the page already
   * on screen — a doctor filtering for "amoxicillin" and seeing nothing must
   * be able to trust that the clinic never prescribed it, so the query
   * reaches into diagnoses, medications, documents and the complaint text.
   */
  async listForPatient(patientId: string, query: VisitHistoryQuery) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } });
      if (!patient) {
        throw new NotFoundException('Patient not found');
      }

      const take = Math.min(Math.max(query.limit ?? SUMMARY_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const where: Prisma.VisitWhereInput = {
        patientId,
        ...(await this.readableClinicFilter(tx, actor)),
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.from || query.to
          ? {
              checkInAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.search ? { OR: searchFilter(query.search) } : {}),
      };

      const total = await tx.visit.count({ where });
      const rows = await tx.visit.findMany({
        where,
        orderBy: [{ checkInAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: {
          staff: { select: { id: true, fullName: true, role: true } },
          clinic: { select: { id: true, name: true } },
          queueTicket: { select: { ticketNumber: true, queueType: true } },
          diagnoses: {
            where: { recordStatus: DiagnosisRecordStatus.ACTIVE },
            select: { id: true, name: true, icd10Code: true, priority: true },
          },
          prescriptions: {
            select: { id: true, status: true, item: { select: { name: true, strengthMg: true } } },
            orderBy: { prescribedAt: 'asc' },
          },
          documents: {
            select: {
              id: true,
              type: true,
              title: true,
              startDate: true,
              endDate: true,
              referredTo: true,
              recordStatus: true,
            },
          },
          // G4.5d2 (D-076) — read-only money, for the Last Visit Snapshot.
          // Additive to the existing authorised summary rather than a new
          // endpoint: the branch and patient checks above already cover it,
          // and a second route would be a second place to get them wrong.
          invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
          panelClinic: { select: { id: true, name: true } },
        },
      });

      const hasMore = rows.length > take;
      const page = hasMore ? rows.slice(0, take) : rows;
      return {
        items: page.map(toSummary),
        nextCursor: hasMore ? page[page.length - 1].id : null,
        total,
      };
    });
  }

  /**
   * One historical visit in full, fetched only when the doctor expands it.
   *
   * `patientId` comes from the URL and is checked against the visit's own
   * stored `patientId`: knowing a visit id is not enough to read it under
   * someone else's chart. Mismatch is a 404, not a 403 — a wrong-patient
   * probe learns nothing about whether the visit exists.
   */
  async findForPatient(patientId: string, visitId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const visit = await tx.visit.findUnique({
        where: { id: visitId },
        include: {
          staff: { select: { id: true, fullName: true, role: true } },
          clinic: { select: { id: true, name: true } },
          patient: { select: { id: true, name: true, identifierValue: true } },
          panelClinic: { select: { id: true, name: true } },
          queueTicket: { select: { ticketNumber: true, queueType: true, status: true } },
        },
      });
      if (!visit || visit.patientId !== patientId) {
        throw new NotFoundException('Visit not found for this patient');
      }
      // Branch is checked against the visit's OWN stored clinic, never a
      // clinic id from the request.
      if (!hasBranchAccess(actor, visit.clinicId, await branchContext(tx, actor))) {
        throw new NotFoundException('Visit not found for this patient');
      }

      const [notes, observations, diagnoses, orders, prescriptions, documents, attachments, invoices] =
        await Promise.all([
          tx.clinicalNote.findMany({
            where: { visitId },
            orderBy: { createdAt: 'desc' },
            include: {
              author: { select: { id: true, fullName: true, role: true } },
              signedBy: { select: { id: true, fullName: true, role: true } },
              amendments: { select: { id: true, createdAt: true, status: true } },
            },
          }),
          tx.visitObservation.findMany({ where: { visitId }, orderBy: { recordedAt: 'desc' } }),
          tx.diagnosis.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } }),
          tx.orderService.findMany({
            where: { visitId },
            orderBy: { createdAt: 'asc' },
            include: {
              attachments: { select: { id: true, fileName: true, mimeType: true, recordStatus: true } },
            },
          }),
          tx.prescription.findMany({
            where: { visitId },
            orderBy: { prescribedAt: 'asc' },
            include: {
              item: { select: { id: true, name: true, strengthMg: true, doseUnitDefault: true, unitOfMeasure: true } },
              prescribedBy: { select: { id: true, fullName: true, role: true } },
            },
          }),
          tx.document.findMany({
            where: { visitId },
            orderBy: { createdAt: 'desc' },
            include: {
              issuedBy: { select: { id: true, fullName: true, role: true } },
              signedBy: { select: { id: true, fullName: true, role: true } },
              voidedBy: { select: { id: true, fullName: true, role: true } },
            },
          }),
          tx.visitAttachment.findMany({ where: { visitId }, orderBy: { createdAt: 'desc' } }),
          tx.invoice.findMany({
            where: { visitId },
            orderBy: { createdAt: 'desc' },
            include: {
              lines: true,
              createdBy: { select: { id: true, fullName: true, role: true } },
            },
          }),
        ]);

      return {
        visit,
        notes: notes.map((note) => ({ ...note, hasAmendment: note.amendments.length > 0 })),
        observations,
        diagnoses,
        orders,
        prescriptions,
        documents,
        attachments,
        invoices,
      };
    });
  }
}

function searchFilter(search: string): Prisma.VisitWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { visitNumber: contains },
    { presentingComplaint: contains },
    { billingType: contains },
    { staff: { fullName: contains } },
    { diagnoses: { some: { recordStatus: DiagnosisRecordStatus.ACTIVE, name: contains } } },
    { diagnoses: { some: { recordStatus: DiagnosisRecordStatus.ACTIVE, icd10Code: contains } } },
    { prescriptions: { some: { item: { name: contains } } } },
    { documents: { some: { recordStatus: DocumentRecordStatus.ACTIVE, title: contains } } },
  ];
}

type SummaryRow = Prisma.VisitGetPayload<{
  include: {
    staff: { select: { id: true; fullName: true; role: true } };
    clinic: { select: { id: true; name: true } };
    queueTicket: { select: { ticketNumber: true; queueType: true } };
    diagnoses: { select: { id: true; name: true; icd10Code: true; priority: true } };
    prescriptions: { select: { id: true; status: true; item: { select: { name: true; strengthMg: true } } } };
    documents: {
      select: {
        id: true;
        type: true;
        title: true;
        startDate: true;
        endDate: true;
        referredTo: true;
        recordStatus: true;
      };
    };
    invoices: { select: { id: true; invoiceNumber: true; totalAmount: true; status: true } };
    panelClinic: { select: { id: true; name: true } };
  };
}>;

/**
 * The collapsed card's payload. Deliberately narrow: enough to read a visit
 * in a couple of seconds, not enough to render the whole record. Everything
 * here comes from a stored field — nothing is inferred, and a summary a visit
 * genuinely has no data for is simply absent rather than an empty label.
 */
function toSummary(row: SummaryRow) {
  const active = row.documents.filter((doc) => doc.recordStatus === DocumentRecordStatus.ACTIVE);
  const mc = active.find((doc) => doc.type === 'MC');
  const referral = active.find((doc) => doc.type === 'REFERRAL');
  const primary = row.diagnoses.find((d) => d.priority === 'PRIMARY') ?? row.diagnoses[0];

  return {
    id: row.id,
    visitNumber: row.visitNumber,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    clinicId: row.clinicId,
    clinicName: row.clinic?.name ?? null,
    doctorName: row.staff?.fullName ?? null,
    doctorRole: row.staff?.role ?? null,
    billingType: row.billingType,
    presentingComplaint: row.presentingComplaint,
    queueNumber: row.queueTicket?.ticketNumber ?? null,
    queueType: row.queueTicket?.queueType ?? null,
    primaryDiagnosis: primary
      ? { name: primary.name, icd10Code: primary.icd10Code, isPrimary: primary.priority === 'PRIMARY' }
      : null,
    diagnosisCount: row.diagnoses.length,
    medications: row.prescriptions.slice(0, 3).map((p) => ({
      name: p.item?.name ?? 'Medication',
      strength: p.item?.strengthMg ? String(p.item.strengthMg) : null,
      status: p.status,
    })),
    medicationCount: row.prescriptions.length,
    mc: mc ? { startDate: mc.startDate, endDate: mc.endDate } : null,
    referral: referral ? { referredTo: referral.referredTo, title: referral.title } : null,
    memo: active.some((doc) => doc.type === 'MEMO'),
    documentCount: active.length,
    voidedDocumentCount: row.documents.length - active.length,
    // Totals are NOT combined across several invoices — no visit-level total
    // is stored, and adding them here would invent one.
    invoices: row.invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      totalAmount: String(i.totalAmount),
      status: i.status,
    })),
    panelName: row.panelClinic?.name ?? null,
  };
}
