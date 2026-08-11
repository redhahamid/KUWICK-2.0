import { Staff } from '@prisma/client';
import { canSignClinicalNotes } from '../clinical/clinical-authorization';
import { isCredentialedClinician } from './permissions';
import { CREDENTIAL_FIELDS, credentialedClinicianFields, nonClinicalFields } from './credentialing';

/**
 * The helper and the predicates must agree — in BOTH directions.
 *
 * Agreeing in one direction is what the old seeds already did: they wrote
 * fields that were all necessary, just not all of them, and the result was a
 * doctor advertised as credentialed who could not sign. So this file asserts
 * two things:
 *
 *   1. What the helper writes IS enough (the positive case).
 *   2. EVERY field it writes is load-bearing (the mutation case). If somebody
 *      relaxes a predicate, the now-pointless field fails here and gets
 *      deleted deliberately, instead of lingering as cargo.
 *
 * Between them, the helper cannot drift from the rule in either direction
 * without a red test.
 */
const GRANTER = 'staff-owner-1';

function staffWith(overrides: Partial<Staff>): Staff {
  return {
    id: 'staff-1',
    fullName: 'Dr Test',
    role: 'DOCTOR_RESIDENT',
    active: true,
    ...credentialedClinicianFields({ registrationNo: 'MMC 12345', grantedByStaffId: GRANTER }),
    ...overrides,
  } as unknown as Staff;
}

describe('credentialedClinicianFields', () => {
  it('produces a staff member who satisfies BOTH gates', () => {
    // Two predicates, deliberately kept separate in the codebase: signing a
    // note and being a credentialed clinician are the same bar, and the day
    // they disagree is the day a doctor is told two different things.
    const doctor = staffWith({});
    expect(isCredentialedClinician(doctor)).toBe(true);
    expect(canSignClinicalNotes(doctor)).toBe(true);
  });

  it.each(CREDENTIAL_FIELDS)('%s is load-bearing — clearing it removes signing', (field) => {
    // The regression test for the defect itself: writing all-but-one of these
    // is what both broken seeds did, and each time it produced something that
    // called itself credentialed.
    // Each field is cleared to ITS OWN cleared value, taken from
    // `nonClinicalFields` — `null` for the nullable columns, `false` for the
    // booleans, NON_CLINICAL for the enum. Blanket-nulling would have tested a
    // database state that cannot exist, and passed for the wrong reason.
    const cleared = nonClinicalFields() as Record<string, unknown>;
    const crippled = staffWith({ [field]: cleared[field as string] } as Partial<Staff>);
    expect(isCredentialedClinician(crippled)).toBe(false);
    expect(canSignClinicalNotes(crippled)).toBe(false);
  });

  it('writes exactly the eight fields the rule needs — no more, no fewer', () => {
    // A count, so ADDING a field to the helper without adding it to the rule
    // is visible too. If this number changes, the change was deliberate.
    expect(CREDENTIAL_FIELDS).toHaveLength(8);
  });

  it('a deactivated account cannot sign, however well credentialed', () => {
    expect(isCredentialedClinician(staffWith({ active: false }))).toBe(false);
    expect(canSignClinicalNotes(staffWith({ active: false }))).toBe(false);
  });

  it('refuses to mint a credential with nobody behind it', () => {
    // A credential whose granter is unknown is an assertion, not a credential.
    expect(() => credentialedClinicianFields({ registrationNo: 'MMC 1', grantedByStaffId: '' })).toThrow();
    expect(() => credentialedClinicianFields({ registrationNo: '   ', grantedByStaffId: GRANTER })).toThrow();
  });

  it('the same timestamp is used for verification and for signing authority', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const fields = credentialedClinicianFields({ registrationNo: 'MMC 1', grantedByStaffId: GRANTER, at });
    expect(fields.professionalVerifiedAt).toEqual(at);
    expect(fields.clinicalSigningEnabledAt).toEqual(at);
  });
});

describe('nonClinicalFields', () => {
  it('clears every credential field rather than trusting column defaults', () => {
    // Fixtures REUSE staff rows. "It defaults to false" is only true of a row
    // that has just been created, and a fixture that flips somebody from
    // doctor to clerk has to actually take the credential away.
    const cleared = nonClinicalFields() as Record<string, unknown>;
    for (const field of CREDENTIAL_FIELDS) {
      expect(cleared).toHaveProperty(field as string);
    }
    expect(isCredentialedClinician(staffWith(cleared as Partial<Staff>))).toBe(false);
  });
});
