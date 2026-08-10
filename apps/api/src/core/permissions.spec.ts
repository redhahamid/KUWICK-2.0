import { ForbiddenException } from '@nestjs/common';
import { Role, Staff, SystemRole } from '@prisma/client';
import {
  LEGACY_ROLE_FALLBACK,
  ROLE_PERMISSIONS,
  assertCan,
  can,
  canHoldDoctorRole,
  effectivePermissions,
  isCredentialedClinician,
  permissionPayload,
  rolesOf,
  wouldRemoveLastOwner,
} from './permissions';

// ===========================================================================
// TASK 1 — the permission policy.
//
// The boundaries in here are the product. Most of these tests assert that
// somebody CANNOT do something, because that is the direction this module
// fails badly in: a permission quietly widened is invisible until it matters.
// ===========================================================================

const staffOf = (over: Partial<Staff> = {}): Staff =>
  ({
    id: 'staff-1',
    active: true,
    role: 'DOCTOR_RESIDENT' as Role,
    fullName: 'Dr A',
    medicalRegistrationNo: 'MMC 48213',
    professionalVerifiedAt: new Date(),
    professionalVerifiedByStaffId: 'owner-1',
    canSignClinicalNotes: true,
    clinicalSigningEnabledAt: new Date(),
    clinicalSigningEnabledByStaffId: 'owner-1',
    ...over,
  }) as Staff;

/** No registration, no verification — an administrator. */
const admin = (over: Partial<Staff> = {}): Staff =>
  staffOf({
    role: 'OWNER_ADMIN' as Role,
    medicalRegistrationNo: null,
    professionalVerifiedAt: null,
    professionalVerifiedByStaffId: null,
    canSignClinicalNotes: false,
    clinicalSigningEnabledAt: null,
    clinicalSigningEnabledByStaffId: null,
    ...over,
  });

describe('OWNER alone is not clinical', () => {
  // The rule most likely to be eroded by convenience, so it gets its own
  // block: an owner is not a doctor because they own the building.
  const CLINICAL = [
    'note.write',
    'note.sign',
    'diagnosis.write',
    'prescription.write',
    'order.write',
    'observation.write',
    'allergy.write',
    'consultation.hold',
    'consultation.complete',
  ] as const;

  it.each(CLINICAL)('an OWNER cannot %s', (permission) => {
    expect(can(admin(), permission, ['OWNER'])).toBe(false);
  });

  it('an OWNER can manage settings, approve discounts and manage users', () => {
    for (const permission of ['settings.manage', 'discount.approve', 'users.manage'] as const) {
      expect(can(admin(), permission, ['OWNER'])).toBe(true);
    }
  });

  it('the OWNER grant list contains nothing clinical at all', () => {
    const clinicalish = ROLE_PERMISSIONS.OWNER.filter((p) =>
      /note|diagnosis|prescription|order|observation|allergy|consultation|dispense/.test(p),
    );
    expect(clinicalish).toEqual([]);
  });
});

describe('the doctor who owns the clinic', () => {
  it('gets BOTH sets from holding both roles — neither role was widened', () => {
    const permissions = effectivePermissions(staffOf({ role: 'OWNER_ADMIN' as Role }), [
      'DOCTOR',
      'OWNER',
    ]);
    expect(permissions.has('note.sign')).toBe(true);
    expect(permissions.has('prescription.write')).toBe(true);
    expect(permissions.has('settings.manage')).toBe(true);
  });

  it('is exactly the union, with no third thing invented', () => {
    const union = new Set([...ROLE_PERMISSIONS.DOCTOR, ...ROLE_PERMISSIONS.OWNER]);
    const actual = effectivePermissions(staffOf({ role: 'OWNER_ADMIN' as Role }), ['DOCTOR', 'OWNER']);
    expect([...actual].sort()).toEqual([...union].sort());
  });
});

describe('CLINICAL STAFF', () => {
  const msX = () =>
    staffOf({
      role: 'FRONT_DESK_CLINICAL_STAFF' as Role,
      medicalRegistrationNo: null,
      canSignClinicalNotes: false,
      professionalVerifiedAt: null,
    });

  it('records vitals and allergies', () => {
    expect(can(msX(), 'observation.write', ['CLINICAL_STAFF'])).toBe(true);
    expect(can(msX(), 'allergy.write', ['CLINICAL_STAFF'])).toBe(true);
  });

  it('cannot write or sign a doctor’s note, or diagnose, or prescribe', () => {
    for (const permission of ['note.write', 'note.sign', 'diagnosis.write', 'prescription.write'] as const) {
      expect(can(msX(), permission, ['CLINICAL_STAFF'])).toBe(false);
    }
  });

  it('has its own voice in the record — a staff remark', () => {
    expect(can(msX(), 'note.staffRemark', ['CLINICAL_STAFF'])).toBe(true);
  });

  it('may RESUME a held consultation but never HOLD one', () => {
    // Holding is a clinical judgement made in a room the counter cannot see
    // into; taking a patient back is ordinary clinic work.
    expect(can(msX(), 'consultation.resume', ['CLINICAL_STAFF'])).toBe(true);
    expect(can(msX(), 'consultation.hold', ['CLINICAL_STAFF'])).toBe(false);
  });
});

describe('ADMINISTRATOR', () => {
  const msY = () => admin({ role: 'FINANCE_STAFF' as Role });

  it('edits demographics and LHDN, runs the queue and billing', () => {
    for (const p of ['patient.demographics.write', 'patient.lhdn.write', 'queue.manage', 'billing.manage'] as const) {
      expect(can(msY(), p, ['ADMINISTRATOR'])).toBe(true);
    }
  });

  it('records NO clinical fact — not even vitals', () => {
    // The boundary the owner asked to be able to demonstrate: Ms Y is blocked
    // from vitals exactly as Ms X is blocked from notes.
    for (const p of ['observation.write', 'allergy.write', 'note.write', 'note.staffRemark'] as const) {
      expect(can(msY(), p, ['ADMINISTRATOR'])).toBe(false);
    }
  });
});

describe('signing needs a credential, not just the role', () => {
  it('a DOCTOR with no verified registration may WRITE but not SIGN', () => {
    const uncredentialed = staffOf({
      medicalRegistrationNo: null,
      professionalVerifiedAt: null,
      canSignClinicalNotes: false,
      clinicalSigningEnabledAt: null,
    });
    expect(can(uncredentialed, 'note.write', ['DOCTOR'])).toBe(true);
    expect(can(uncredentialed, 'note.sign', ['DOCTOR'])).toBe(false);
  });

  it('a fully credentialed doctor may sign', () => {
    expect(can(staffOf(), 'note.sign', ['DOCTOR'])).toBe(true);
    expect(isCredentialedClinician(staffOf())).toBe(true);
  });

  it('every credential field is load-bearing', () => {
    const fields: (keyof Staff)[] = [
      'medicalRegistrationNo',
      'professionalVerifiedAt',
      'professionalVerifiedByStaffId',
      'canSignClinicalNotes',
      'clinicalSigningEnabledAt',
      'clinicalSigningEnabledByStaffId',
    ];
    for (const field of fields) {
      const missing = staffOf({ [field]: field === 'canSignClinicalNotes' ? false : null } as never);
      expect(isCredentialedClinician(missing)).toBe(false);
    }
  });

  it('DOCTOR cannot be ASSIGNED to somebody with no professional identity', () => {
    expect(canHoldDoctorRole(staffOf())).toBe(true);
    expect(canHoldDoctorRole(admin())).toBe(false);
  });
});

describe('a deactivated account', () => {
  it('holds nothing at all, whatever roles it was given', () => {
    // "Deactivated" that only removes the menu item is not deactivated.
    const gone = staffOf({ active: false });
    expect([...effectivePermissions(gone, ['DOCTOR', 'OWNER', 'ADMINISTRATOR'])]).toEqual([]);
  });
});

describe('migrating what already exists', () => {
  it('every legacy role has a mapping — none silently loses its job', () => {
    const legacy = Object.keys(LEGACY_ROLE_FALLBACK) as Role[];
    expect(legacy).toHaveLength(9);
    for (const role of legacy) expect(LEGACY_ROLE_FALLBACK[role]).toBeDefined();
  });

  it('front desk keeps BOTH halves of what it does today', () => {
    // The new split separates vitals from registration; front desk does both,
    // and granting one would quietly remove half of somebody's job.
    const fd = staffOf({ role: 'FRONT_DESK_CLINICAL_STAFF' as Role, canSignClinicalNotes: false });
    const permissions = effectivePermissions(fd);
    expect(permissions.has('observation.write')).toBe(true);
    expect(permissions.has('patient.demographics.write')).toBe(true);
    expect(permissions.has('note.write')).toBe(false);
  });

  it('a legacy OWNER_ADMIN with no registration is owner + administrator, NOT a doctor', () => {
    expect(rolesOf(admin(), undefined)).toEqual(['OWNER', 'ADMINISTRATOR']);
    expect(can(admin(), 'note.write')).toBe(false);
  });

  it('a CREDENTIALED legacy OWNER_ADMIN keeps the clinical ability they had', () => {
    // The owner-doctor has been authoring notes all along. The migration must
    // not take that away on the day roles ship — and an owner who is NOT a
    // clinician gains nothing from this clause, which is its whole point.
    const ownerDoctor = staffOf({ role: 'OWNER_ADMIN' as Role });
    expect(rolesOf(ownerDoctor, undefined)).toContain('DOCTOR');
    expect(can(ownerDoctor, 'note.write')).toBe(true);
    expect(can(ownerDoctor, 'note.sign')).toBe(true);
    expect(can(ownerDoctor, 'settings.manage')).toBe(true);
  });

  it('STOCK_STAFF gets NO patient-record write — not even vitals', () => {
    // Owner decision. Mapping inventory staff to CLINICAL_STAFF would have
    // handed stock control the ability to record a blood pressure.
    expect(LEGACY_ROLE_FALLBACK.STOCK_STAFF).toEqual(['ADMINISTRATOR']);
    const stock = admin({ role: 'STOCK_STAFF' as Role });
    expect(can(stock, 'observation.write')).toBe(false);
    expect(can(stock, 'allergy.write')).toBe(false);
    expect(can(stock, 'note.staffRemark')).toBe(false);
  });

  it('and no dispensing yet either — that is the noted follow-up', () => {
    // `dispense.perform` exists as its own permission, but granting it
    // without a role needs per-staff grants, which is a second axis nobody
    // needs until a real STOCK_STAFF account exists.
    expect(can(admin({ role: 'STOCK_STAFF' as Role }), 'dispense.perform')).toBe(false);
  });

  it('PATIENT_PORTAL is not staff and holds nothing', () => {
    expect(rolesOf(staffOf({ role: 'PATIENT_PORTAL' as Role }), undefined)).toEqual([]);
  });

  it('an EXPLICIT assignment wins outright over the fallback', () => {
    // Somebody deliberately reduced to one role must not have the old one
    // silently added back.
    const reduced = rolesOf(admin({ role: 'OWNER_ADMIN' as Role }), ['ADMINISTRATOR']);
    expect(reduced).toEqual(['ADMINISTRATOR']);
    expect(can(admin(), 'settings.manage', ['ADMINISTRATOR'])).toBe(false);
  });
});

describe('refusals', () => {
  it('say what to do instead, and never name another role', () => {
    try {
      assertCan(admin(), 'note.write', ['ADMINISTRATOR']);
      throw new Error('should have refused');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const message = (error as ForbiddenException).message;
      expect(message).toMatch(/Add Staff Remark/);
      expect(message).not.toMatch(/DOCTOR|OWNER_ADMIN|CLINICAL_STAFF/);
    }
  });

  it('permit silently when the permission is held', () => {
    expect(() => assertCan(staffOf(), 'note.write', ['DOCTOR'])).not.toThrow();
  });
});

describe('the session payload', () => {
  it('is the sorted permission list the browser renders', () => {
    const payload = permissionPayload(staffOf(), ['DOCTOR']);
    expect(payload).toContain('note.write');
    expect([...payload].sort()).toEqual(payload);
  });

  it('a deactivated account publishes an empty list', () => {
    expect(permissionPayload(staffOf({ active: false }), ['DOCTOR'])).toEqual([]);
  });
});

describe('the last owner', () => {
  it('cannot have OWNER removed', () => {
    expect(
      wouldRemoveLastOwner({
        currentOwnerStaffIds: ['owner-1'],
        staffId: 'owner-1',
        rolesAfter: ['ADMINISTRATOR'],
      }),
    ).toBe(true);
  });

  it('may be edited as long as OWNER survives', () => {
    expect(
      wouldRemoveLastOwner({
        currentOwnerStaffIds: ['owner-1'],
        staffId: 'owner-1',
        rolesAfter: ['OWNER', 'DOCTOR'],
      }),
    ).toBe(false);
  });

  it('a second owner makes the first removable', () => {
    expect(
      wouldRemoveLastOwner({
        currentOwnerStaffIds: ['owner-1', 'owner-2'],
        staffId: 'owner-1',
        rolesAfter: ['ADMINISTRATOR'],
      }),
    ).toBe(false);
  });

  it('every SystemRole appears in the grant table', () => {
    const roles: SystemRole[] = ['DOCTOR', 'CLINICAL_STAFF', 'ADMINISTRATOR', 'OWNER'];
    for (const role of roles) expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
  });
});
