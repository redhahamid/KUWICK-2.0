import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import * as path from 'path';

// Local disk storage (Phase A3, docs/DECISIONS.md) — no object storage
// service in this environment yet. Files are namespaced by tenant + owning
// record so cross-tenant access is impossible even if a path leaked; the
// tenantId/ownerId segments are always our own UUIDs, never user input, so
// only the original filename needs sanitizing against traversal.
const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'file';
}

export async function saveUploadedFile(
  tenantId: string,
  ownerId: string,
  buffer: Buffer,
  originalName: string,
): Promise<{ relativePath: string }> {
  const relativeDir = path.join(tenantId, ownerId);
  const dir = path.join(UPLOADS_ROOT, relativeDir);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}-${sanitizeFileName(originalName)}`;
  const relativePath = path.join(relativeDir, fileName);
  await writeFile(path.join(UPLOADS_ROOT, relativePath), buffer);
  return { relativePath };
}

export function readUploadedFileStream(relativePath: string) {
  return createReadStream(path.join(UPLOADS_ROOT, relativePath));
}

export async function deleteUploadedFile(relativePath: string): Promise<void> {
  await unlink(path.join(UPLOADS_ROOT, relativePath)).catch(() => undefined);
}
