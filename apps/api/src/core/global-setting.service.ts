import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from './tenant-scoped-prisma.provider';
import { PrismaService } from './prisma.service';
import { currentTenantId } from './tenant-context';
import type { Permission } from './permissions';
import { withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';

/**
 * WHO MAY CHANGE A SETTING (owner's decision, 16 October 2026): only owner,
 * admin and HR roles. Writing used to need nothing but a signed-in account of
 * the clinic, so any staff login could change "Defaults for new staff" or the
 * opening-balances answer. Each key now names the permission its screen
 * already asks for; any key not listed is the owner's (`settings.manage`).
 */
const WRITE_PERMISSION: Record<string, Permission> = {
  // Pay rules → Defaults for new staff: the people who add employees.
  'hr.newStaffDefaults': 'hr.employee.manage',
  // Set up payroll → Opening balances: the people who run payroll.
  'hr.setup.openingBalances': 'hr.payroll.run',
  // Settings → Attendance & leave → part-year leave rules: whoever edits leave types.
  'hr.leaveEntitlements': 'hr.employee.manage',
};

export function writePermissionFor(key: string): Permission {
  return WRITE_PERMISSION[key] ?? 'settings.manage';
}

// Generic per-tenant key/value config (docs/DATABASE_ARCHITECTURE.md §2).
@Injectable()
export class GlobalSettingService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async get(key: string) {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { tenantId_key: { tenantId: currentTenantId(), key } },
    });
    return setting?.value ?? null;
  }

  /** Refused without the key's permission; every change leaves an audit row. */
  set(key: string, value: unknown) {
    return withAdminTx(this.rawPrisma, writePermissionFor(key), async (tx, actor) => {
      const tenantId = currentTenantId();
      const before = await tx.globalSetting.findUnique({ where: { tenantId_key: { tenantId, key } } });
      const saved = await tx.globalSetting.upsert({
        where: { tenantId_key: { tenantId, key } },
        create: { tenantId, key, value: value as never },
        update: { value: value as never },
      });
      await recordAudit(tx, actor, {
        action: 'globalSetting.changed',
        entityType: 'GlobalSetting',
        entityId: saved.id,
        reason: `Setting "${key}" changed`,
        before: before ? { key, value: before.value } : null,
        after: { key, value: saved.value },
        source: 'settings',
      });
      return saved;
    });
  }
}
