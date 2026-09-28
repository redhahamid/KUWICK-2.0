import { Role as SharedRole } from '@kuwick/shared';
import { Role } from '@prisma/client';

/**
 * THE PIN ON A DELIBERATE DUPLICATION. `Role` lives in the Prisma schema
 * (the database's truth) and again in `@kuwick/shared` (what the web types
 * against). CLINIC_MANAGER was added to the schema alone, so for a while the
 * web's `Staff.role` could not name a clinic manager. Nothing checked the two
 * stayed in step; this does.
 */
describe('Role — API/shared parity', () => {
  it('holds exactly the same values', () => {
    expect([...Object.values(SharedRole)].sort()).toEqual([...Object.values(Role)].sort());
  });
});
