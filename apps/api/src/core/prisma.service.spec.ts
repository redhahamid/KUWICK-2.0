import { assertNotSuperuser } from './prisma.service';

// ===========================================================================
// PHASE 0 — THE BOOT CHECK THAT KEEPS RLS MEANINGFUL.
//
// Row-level security does not apply to a superuser, and does not apply to a
// role with BYPASSRLS. So every tenant-isolation policy in this schema, and
// every append-only claim resting on one, is worth nothing if the application
// connects as either — which was the actual state of this project in every
// environment until it was measured.
//
// The check refuses to start rather than warning, because a warning here means
// one clinic's patient data is reachable from another and nobody finds out.
// ===========================================================================

const role = (over: Partial<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }> = {}) => [
  { rolname: 'kuwick_app', rolsuper: false, rolbypassrls: false, ...over },
];

const query = (rows: ReturnType<typeof role>) => jest.fn().mockResolvedValue(rows);

describe('the database role the application connects as', () => {
  it('accepts an ordinary role — the one RLS actually applies to', async () => {
    await expect(assertNotSuperuser(query(role()), false)).resolves.toBeUndefined();
  });

  it('REFUSES to start as a superuser', async () => {
    await expect(assertNotSuperuser(query(role({ rolsuper: true })), false)).rejects.toThrow(
      /connected as "kuwick_app", which is a SUPERUSER/,
    );
  });

  it('REFUSES to start as a role with BYPASSRLS', async () => {
    // Less obvious than superuser and exactly as fatal: BYPASSRLS is a flag
    // somebody grants for a migration and forgets to remove.
    await expect(assertNotSuperuser(query(role({ rolbypassrls: true })), false)).rejects.toThrow(/has BYPASSRLS/);
  });

  it('says what is broken, and what to do about it', async () => {
    // A refusal that only says "no" gets worked around by widening whatever
    // said no. This one names the consequence and the fix.
    await expect(assertNotSuperuser(query(role({ rolsuper: true })), false)).rejects.toThrow(
      /tenant isolation and every append-only guarantee in this schema are unenforced/,
    );
    await expect(assertNotSuperuser(query(role({ rolsuper: true })), false)).rejects.toThrow(
      /NOSUPERUSER NOBYPASSRLS/,
    );
  });

  it('the escape hatch works, and says what it costs', async () => {
    const warn = jest.fn();
    await expect(assertNotSuperuser(query(role({ rolsuper: true })), true, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('KUWICK_ALLOW_SUPERUSER_DB=yes'));
    expect(warn.mock.calls[0][0]).toMatch(/unenforced/);
  });

  it('an unreadable role is reported but does not block boot', async () => {
    // pg_roles is world-readable, so an empty result means something else is
    // wrong. Refusing to start would turn a diagnostic problem into an outage;
    // staying silent would let "unverified" read as "verified".
    const warn = jest.fn();
    await expect(assertNotSuperuser(query([]), false, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('RLS enforcement is unverified'));
  });

  it('asks postgres about the CURRENT user, not about a name it was told', async () => {
    // The check must describe the live connection. A configured username could
    // differ from the role actually in use (SET ROLE, a pooler, a connection
    // string somebody else edited).
    const q = query(role());
    await assertNotSuperuser(q, false);
    expect(q).toHaveBeenCalledWith(expect.stringContaining('current_user'));
    expect(q.mock.calls[0][0]).toMatch(/rolsuper/);
    expect(q.mock.calls[0][0]).toMatch(/rolbypassrls/);
  });
});
