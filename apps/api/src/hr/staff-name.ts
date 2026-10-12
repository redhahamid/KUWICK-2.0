import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AdminTx } from '../finance/admin-actor';
import type { ActingStaff } from '../clinical/clinical-actor';
import { recordAudit } from '../finance/admin-audit';

/** A display name as typed, with its spaces tidied; refused when empty or absurd. */
export function cleanDisplayName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2) throw new BadRequestException('Type the name, at least two letters.');
  if (name.length > 120) throw new BadRequestException('That name is longer than 120 characters.');
  return name;
}

/**
 * A PERSON'S DISPLAY NAME (owner, 12 October 2026): editable by the person in
 * My Kuwick and by the owner for anybody, and logged either way. The `before`
 * of each row is what a payslip approved before the change reads its
 * Prepared/Approved names from, so the row is written on every rename.
 */
export async function renameStaff(tx: AdminTx, actor: ActingStaff, staffId: string, fullName: unknown, source: string) {
  const name = cleanDisplayName(fullName);
  const staff = await tx.staff.findUnique({ where: { id: staffId }, select: { id: true, fullName: true } });
  if (!staff) throw new NotFoundException('That person is not on this clinic’s staff list.');
  if (staff.fullName === name) return { id: staff.id, fullName: staff.fullName };
  const saved = await tx.staff.update({ where: { id: staffId }, data: { fullName: name }, select: { id: true, fullName: true } });
  await recordAudit(tx, actor, {
    action: 'staff.renamed',
    entityType: 'Staff',
    entityId: staffId,
    reason: `${actor.id === staffId ? 'Changed their own name' : 'Renamed'} from "${staff.fullName}" to "${name}"`,
    before: { fullName: staff.fullName },
    after: { fullName: name },
    source,
  });
  return saved;
}
