import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StaffFileKind } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { ActingStaff, requireActor, withTenantTx } from '../clinical/clinical-actor';
import { AdminTx, requirePermission, withScopedAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';

/**
 * WHAT AN EMPLOYEE HANDS IN THROUGH THE PORTAL — a receipt, an MC, a
 * clock-in selfie. Bytes in the row, like MediaAsset, with two differences
 * that are the whole point:
 *
 *   - a file belongs to a person. It is served to that person and to HR
 *     (`hr.view`), never on a public route, never by guessing an id.
 *   - a selfie is proof that somebody stood at the clinic at that minute.
 *     It is kept as an image and nothing else is done with it — no
 *     recognition, no matching. The consent asked once before the first
 *     one says exactly that.
 *
 * 8 MB is a phone photograph with room to spare; images and PDFs only.
 */
export const MAX_STAFF_FILE_BYTES = 8 * 1024 * 1024;
export const STAFF_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const STAFF_FILE_KINDS: readonly StaffFileKind[] = ['RECEIPT', 'MEDICAL_CERTIFICATE', 'SELFIE', 'BANK_PROOF'];

export interface UploadedStaffFile {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
  size?: number;
}

/** The path a stored file is reachable at, by its owner. */
export function staffFilePath(id: string): string {
  return `/me/files/${id}`;
}

interface CheckedUpload {
  kind: StaffFileKind;
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

/** The rules a handed-in file has to meet, whoever hands it in. */
function validateUpload(kindInput: string, file: UploadedStaffFile | undefined): CheckedUpload {
  if (!(STAFF_FILE_KINDS as readonly string[]).includes(kindInput)) {
    throw new BadRequestException('kind must be RECEIPT, MEDICAL_CERTIFICATE or SELFIE.');
  }
  const kind = kindInput as StaffFileKind;
  const buffer = file?.buffer;
  if (!file || !buffer || buffer.length === 0) {
    throw new BadRequestException('No file arrived. Attach it as the "file" field.');
  }
  if (buffer.length > MAX_STAFF_FILE_BYTES) {
    throw new BadRequestException('That file is over 8 MB. Please use a smaller one.');
  }
  const contentType = (file.mimetype ?? '').toLowerCase();
  if (!(STAFF_FILE_TYPES as readonly string[]).includes(contentType)) {
    throw new BadRequestException('Only JPG, PNG, WebP or PDF files can be handed in.');
  }
  if (kind === 'SELFIE' && contentType === 'application/pdf') {
    throw new BadRequestException('A clock-in selfie is a photograph.');
  }
  return { kind, buffer, contentType, fileName: (file.originalname ?? `${kind.toLowerCase()}.bin`).slice(0, 200) };
}

@Injectable()
export class StaffFileService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Store a file for the signed-in person. Returns its id and path, never the bytes. */
  async upload(kindInput: string, file: UploadedStaffFile | undefined) {
    const checked = validateUpload(kindInput, file);
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      return this.store(tx, actor, actor.id, checked, 'me.files');
    });
  }

  /**
   * A FILE HR HANDS IN FOR SOMEBODY — the paper receipt behind a claim entered
   * on their behalf. Stored as the employee's own file, so the claim names it
   * exactly as a portal claim does and the employee can read it back; the
   * audit row says who uploaded it and for whom. The person has to be in a
   * branch this account manages. Never a selfie: a clock-in photograph is the
   * person's own act.
   */
  async uploadFor(staffId: string, kindInput: string, file: UploadedStaffFile | undefined) {
    const checked = validateUpload(kindInput, file);
    if (checked.kind === 'SELFIE') {
      throw new BadRequestException('A clock-in selfie can only be handed in by the person themselves.');
    }
    return withScopedAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor, scope) => {
      const person = await tx.staff.findFirst({ where: { id: staffId, ...scope.where(null) }, select: { id: true } });
      if (!person) throw new NotFoundException('No such employee in the branches you manage.');
      return this.store(tx, actor, staffId, checked, 'hr.files');
    });
  }

  private async store(tx: AdminTx, actor: ActingStaff, staffId: string, checked: CheckedUpload, source: string) {
    const { kind, buffer, contentType, fileName } = checked;
    const row = await tx.staffFile.create({
      data: {
        tenantId: currentTenantId(),
        staffId,
        kind,
        fileName,
        contentType,
        byteSize: buffer.length,
        data: new Uint8Array(buffer),
      },
      select: { id: true, kind: true, fileName: true, contentType: true, byteSize: true, createdAt: true },
    });
    await recordAudit(tx, actor, {
      action: 'staffFile.uploaded',
      entityType: 'StaffFile',
      entityId: row.id,
      after: {
        kind,
        fileName: row.fileName,
        contentType,
        byteSize: buffer.length,
        ...(staffId !== actor.id ? { onBehalfOf: staffId } : {}),
      },
      source,
    });
    return { ...row, path: staffFilePath(row.id) };
  }

  /** The file, for its owner. Anybody else's file is not found — not forbidden, not found. */
  async readOwn(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const row = await tx.staffFile.findFirst({
        where: { id, staffId: actor.id },
        select: { fileName: true, contentType: true, data: true },
      });
      if (!row) throw new NotFoundException('File not found.');
      return row;
    });
  }

  /** The file, for HR (`hr.view`) — the timesheet's thumbnail, the claims drawer's receipt. */
  async readForHr(id: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    const row = await this.prisma.staffFile.findUnique({
      where: { id },
      select: { fileName: true, contentType: true, data: true },
    });
    if (!row) throw new NotFoundException('File not found.');
    return row;
  }

  /**
   * A file the signed-in person is about to attach to something: theirs, and
   * of the kind the thing expects. Returns the metadata to copy onto the
   * attachment row.
   */
  async claimOwn(tx: Prisma.TransactionClient, staffId: string, id: string, kind: StaffFileKind) {
    const row = await tx.staffFile.findFirst({
      where: { id, staffId },
      select: { id: true, kind: true, fileName: true, contentType: true, byteSize: true },
    });
    if (!row) throw new NotFoundException('That file is not yours, or does not exist.');
    if (row.kind !== kind) {
      throw new ForbiddenException(`That file was handed in as ${row.kind.toLowerCase().replace('_', ' ')}, not ${kind.toLowerCase().replace('_', ' ')}.`);
    }
    return { fileName: row.fileName, mimeType: row.contentType, fileSize: row.byteSize, filePath: staffFilePath(row.id) };
  }
}
