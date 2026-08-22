import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { validateClinicalAttachment } from '../clinical/attachment-validation';

/** The two things a public-page image is allowed to BE. */
export const MEDIA_KINDS = ['SERVICE_PHOTO', 'CLINIC_LOGO'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

/**
 * The reference a media upload hands back, stored verbatim in the existing
 * URL columns (ServiceCatalog.bookingPhotoUrl, ClinicBookingPage.logoUrl).
 * One scheme everywhere: `media://<id>`. An http(s) URL in the same column
 * keeps meaning "hosted elsewhere" — the Advanced fallback stays real.
 */
export function mediaRef(id: string): string {
  return `media://${id}`;
}

export function mediaIdOf(ref: string | null | undefined): string | null {
  if (!ref?.startsWith('media://')) return null;
  const id = ref.slice('media://'.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * PHASE 6 — UPLOADED PUBLIC-PAGE MEDIA.
 *
 * Bytes in Postgres (see the migration for why not the container disk), image
 * types only, proven by MAGIC BYTES through the same validator the clinical
 * attachments use — a declared MIME type is a claim, the leading bytes are a
 * fact. Writes need the CONFIGURE permission, the same one that governs every
 * other booking-surface setting.
 */
@Injectable()
export class MediaService {
  constructor(private readonly rawPrisma: PrismaService) {}

  async upload(kind: string, file: { originalname?: string; mimetype?: string; buffer?: Buffer; size?: number }) {
    if (!(MEDIA_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('kind must be SERVICE_PHOTO or CLINIC_LOGO.');
    }
    const buffer = file?.buffer;
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('No file arrived. Attach the image as the "file" field.');
    }
    if (buffer.length > MAX_MEDIA_BYTES) {
      throw new BadRequestException('That image is over 2 MB. Please use a smaller one.');
    }
    const validated = validateClinicalAttachment(file);
    if (!validated.mimeType.startsWith('image/')) {
      // The shared validator also admits PDF for clinical records; a booking
      // page renders pictures.
      throw new BadRequestException('Only JPG, PNG or WebP images can be shown on the booking page.');
    }

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');
      const row = await tx.mediaAsset.create({
        data: {
          tenantId: currentTenantId(),
          kind,
          contentType: validated.mimeType,
          byteSize: buffer.length,
          // Prisma 7's Bytes is a plain Uint8Array; hand it exactly that.
          data: new Uint8Array(buffer),
          createdByStaffId: currentStaffId() ?? null,
        },
        select: { id: true, kind: true, contentType: true, byteSize: true, createdAt: true },
      });
      return { ...row, ref: mediaRef(row.id) };
    });
  }

  /** The bytes, for an AUTHENTICATED admin preview (tenant-scoped by RLS). */
  async read(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      await requireActor(tx);
      const row = await tx.mediaAsset.findUnique({
        where: { id },
        select: { contentType: true, data: true },
      });
      if (!row) throw new NotFoundException('Image not found');
      return row;
    });
  }

  async remove(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');
      const result = await tx.mediaAsset.deleteMany({ where: { id } });
      if (result.count === 0) throw new NotFoundException('Image not found');
      return { removed: true };
    });
  }
}
