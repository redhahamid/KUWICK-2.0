import { ForbiddenException } from '@nestjs/common';
import { Role, Staff, SystemRole } from '@prisma/client';
import {
  INDIVIDUALLY_GRANTABLE,
  type Permission,
  LEGACY_ROLE_FALLBACK,
  LEGACY_ROLE_PERMISSIONS,
  ROLE_PERMISSIONS,
  assertCan,
  can,
  canHoldDoctorRole,
  effectivePermissions,
  isCredentialedClinician,
  isIndividuallyGrantable,
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
    professionalType: 'MEDICAL_DOCTOR',
    professionalActive: true,
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
    // A non-clinician: no professional identity AND no signing paperwork.
    professionalType: undefined,
    professionalActive: false,
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
    for (const p of ['patient.demographics.write', 'patient.lhdn.write', 'queue.manage', 'billing.counter'] as const) {
      expect(can(msY(), p, ['ADMINISTRATOR'])).toBe(true);
    }
  });

  it('does NOT hold billing corrections by role', () => {
    // Owner decision: "financial corrections" is a power, not a job.
    // Discounts and invoice cancellation move money the clinic has earned.
    expect(can(msY(), 'billing.corrections', ['ADMINISTRATOR'])).toBe(false);
  });

  it('but CAN be given corrections individually, without a new role', () => {
    // The trusted senior counter staffer. One capability, not a fifth role.
    expect(can(msY(), 'billing.corrections', ['ADMINISTRATOR'], ['billing.corrections'])).toBe(true);
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
      // The professional identity, not just the signing paperwork. Missing
      // these was the first draft's bug: weaker than canSignClinicalNotes.
      'professionalActive',
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
    const stock = admin({ role: 'STOCK_STAFF' as Role });
    expect(can(stock, 'observation.write')).toBe(false);
    expect(can(stock, 'allergy.write')).toBe(false);
    expect(can(stock, 'note.staffRemark')).toBe(false);
  });

  it('STOCK_STAFF runs the stockroom, and still arrives at no queue and no clinical record', () => {
    // Owner decision (option 1) unchanged: the back-office roles map to a
    // permission SUBSET, never to a system role, so an inventory clerk cannot
    // arrive at ADMINISTRATOR and acquire the queue and the till on the way.
    //
    // ADMIN PROGRAMME widened the subset, because the acts a stock clerk is
    // employed to perform now exist as named permissions. What it must never
    // include is asserted below rather than implied by a short list.
    expect(LEGACY_ROLE_FALLBACK.STOCK_STAFF).toEqual([]);
    const stock = admin({ role: 'STOCK_STAFF' as Role });
    expect(can(stock, 'stock.view')).toBe(true);
    expect(can(stock, 'stock.adjust')).toBe(true);
    expect(can(stock, 'stock.transfer')).toBe(true);
    expect(can(stock, 'stockTake.manage')).toBe(true);
    expect(can(stock, 'dispense.perform')).toBe(true);
    // The person who counts does not approve their own variance, and pricing
    // is a commercial decision rather than a stockroom one.
    expect(can(stock, 'stockTake.approve')).toBe(false);
    expect(can(stock, 'stock.price.manage')).toBe(false);
    // And nothing outside the stockroom.
    expect(can(stock, 'queue.manage')).toBe(false);
    expect(can(stock, 'billing.counter')).toBe(false);
    expect(can(stock, 'note.write')).toBe(false);
    expect(can(stock, 'hr.payroll.view')).toBe(false);
  });

  it('HR_STAFF maintains records — and approves neither leave nor pay', () => {
    const hr = admin({ role: 'HR_STAFF' as Role });
    expect(can(hr, 'hr.view')).toBe(true);
    expect(can(hr, 'hr.employee.manage')).toBe(true);
    expect(can(hr, 'hr.attendance.manage')).toBe(true);
    // A clerk maintaining records is not the person who approves somebody's
    // leave or signs off their pay.
    expect(can(hr, 'hr.leave.approve')).toBe(false);
    expect(can(hr, 'hr.payroll.run')).toBe(false);
    expect(can(hr, 'hr.payroll.approve')).toBe(false);
    expect(can(hr, 'hr.payroll.view')).toBe(false);
    expect(can(hr, 'queue.manage')).toBe(false);
    expect(can(hr, 'billing.counter')).toBe(false);
  });

  it('PANEL_STAFF works claims and the counter till, and abandons no receivable', () => {
    const panel = admin({ role: 'PANEL_STAFF' as Role });
    expect(can(panel, 'billing.counter')).toBe(true);
    expect(can(panel, 'panel.claim.manage')).toBe(true);
    expect(can(panel, 'panel.claim.submit')).toBe(true);
    expect(can(panel, 'panel.receipt.record')).toBe(true);
    // Abandoning a receivable and changing a panel's commercial terms are
    // owner decisions.
    expect(can(panel, 'panel.writeOff')).toBe(false);
    expect(can(panel, 'panel.configure')).toBe(false);
    expect(can(panel, 'queue.consultationFlow')).toBe(false);
    expect(can(panel, 'queue.manage')).toBe(false);
  });

  it('the back-office roles LOSE the queue — the intentional narrowing', () => {
    // Recorded as a loss on purpose. Finance completing a visit asserts that
    // dispensing and payment are done, which is a counter fact.
    for (const role of ['FINANCE_STAFF', 'HR_STAFF', 'STOCK_STAFF', 'PANEL_STAFF'] as Role[]) {
      const staff = admin({ role });
      expect(can(staff, 'queue.manage')).toBe(false);
      expect(can(staff, 'queue.consultationFlow')).toBe(false);
      expect(can(staff, 'patient.demographics.write')).toBe(false);
    }
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

describe('individual permission grants', () => {
  const counterStaff = () =>
    staffOf({
      role: 'FINANCE_STAFF' as Role,
      professionalType: undefined,
      professionalActive: false,
      medicalRegistrationNo: null,
      canSignClinicalNotes: false,
    });

  it('are ADDITIVE only — they never subtract from a role', () => {
    // A grant that could take something away would make "what can this person
    // do" answerable only by replaying two tables in the right order.
    const withGrant = effectivePermissions(staffOf(), ['DOCTOR'], ['billing.corrections']);
    for (const permission of ROLE_PERMISSIONS.DOCTOR) {
      expect(withGrant.has(permission)).toBe(true);
    }
    expect(withGrant.has('billing.corrections')).toBe(true);
  });

  it('only a closed list may be handed out', () => {
    // "Grant anything to anyone" is how a role model becomes decorative.
    expect(INDIVIDUALLY_GRANTABLE).toEqual([
      'billing.corrections',
      'dispense.perform',
      // A senior receptionist or practice manager who is not an owner is
      // exactly who squeezes the extra patient in, and exactly who writes the
      // roster. Granting either by name is safer than widening ADMINISTRATOR
      // for everybody.
      'appointment.override',
      'appointment.manage_roster',
      // ADMIN PROGRAMME — the capabilities an owner most often delegates to
      // one named person without handing over a whole module.
      'payment.reverse',
      'creditNote.create',
      'dayEnd.reopen',
      'stock.adjust',
      'stockTake.approve',
      'stock.price.manage',
      'panel.receipt.record',
      'panel.writeOff',
      // Paying a supplier is money leaving the clinic, so it sits with the
      // other money-moving acts an owner delegates by name rather than by
      // widening a role. RECORDING what a supplier billed is not here: that is
      // clerical, and it belongs to whoever opens the post.
      'supplierPayment.record',
      'hr.leave.approve',
      'hr.payroll.view',
      'analytics.view',
    ]);
    expect(isIndividuallyGrantable('note.write')).toBe(false);
    expect(isIndividuallyGrantable('settings.manage')).toBe(false);
    // The approvals stay out of reach of a staple-on grant: each of these
    // approves money leaving or arriving on somebody's say-so.
    expect(isIndividuallyGrantable('creditNote.approve')).toBe(false);
    expect(isIndividuallyGrantable('hr.payroll.run')).toBe(false);
    expect(isIndividuallyGrantable('hr.payroll.approve')).toBe(false);
    expect(isIndividuallyGrantable('finance.configure')).toBe(false);
    expect(isIndividuallyGrantable('panel.configure')).toBe(false);
    // Entering a supplier invoice comes with the stock role; it is not a
    // staple-on grant, because it is a job rather than an authority.
    expect(isIndividuallyGrantable('supplierInvoice.manage')).toBe(false);
  });

  it('the counter takes money and does not move money it has already taken', () => {
    // ADMIN PROGRAMME. The three acts withheld from ADMINISTRATOR are the ones
    // that alter a record the clinic has already made: reversing a receipt,
    // crediting an invoice, and reopening a day somebody signed off.
    const counter = admin();
    const asCounter = (permission: Permission) => can(counter, permission, ['ADMINISTRATOR']);
    expect(asCounter('payment.record')).toBe(true);
    expect(asCounter('dayEnd.count')).toBe(true);
    expect(asCounter('dayEnd.close')).toBe(true);
    expect(asCounter('payment.reverse')).toBe(false);
    expect(asCounter('creditNote.create')).toBe(false);
    expect(asCounter('creditNote.approve')).toBe(false);
    expect(asCounter('dayEnd.reopen')).toBe(false);
    // And it does not acquire the other four modules by holding the till.
    expect(asCounter('stock.adjust')).toBe(false);
    expect(asCounter('panel.claim.manage')).toBe(false);
    expect(asCounter('hr.view')).toBe(false);
    expect(asCounter('finance.configure')).toBe(false);
  });

  it('the admin programme adds nothing clinical to OWNER', () => {
    // The rule most likely to be eroded by convenience, re-checked against the
    // thirty-odd permissions this programme added: not one of them touches a
    // patient's record.
    const clinical: Permission[] = [
      'note.write',
      'note.sign',
      'diagnosis.write',
      'prescription.write',
      'order.write',
      'observation.write',
      'allergy.write',
      'clinical.void',
      'document.authoriseClinical',
      'patient.alert.medical.write',
    ];
    const owner = effectivePermissions(staffOf({ role: 'OWNER_ADMIN' as Role }), ['OWNER']);
    for (const permission of clinical) {
      expect(owner.has(permission)).toBe(false);
    }
  });

  it('note.sign is NOT grantable — no permission substitutes for a registration', () => {
    expect(isIndividuallyGrantable('note.sign')).toBe(false);
  });

  it('a deactivated account holds nothing, grant or no grant', () => {
    const gone = staffOf({ active: false });
    expect([...effectivePermissions(gone, ['ADMINISTRATOR'], ['billing.corrections'])]).toEqual([]);
  });

  it('FINANCE keeps every billing action it holds today, and gains no queue', () => {
    // Option 1: the fallback is a permission SUBSET, not a role. Finance keeps
    // all seven billing actions and does not arrive at the queue on the way.
    expect(LEGACY_ROLE_PERMISSIONS.FINANCE_STAFF).toContain('billing.counter');
    expect(LEGACY_ROLE_PERMISSIONS.FINANCE_STAFF).toContain('billing.corrections');
    expect(can(counterStaff(), 'billing.corrections')).toBe(true);
    expect(can(counterStaff(), 'billing.counter')).toBe(true);
    expect(can(counterStaff(), 'queue.manage')).toBe(false);
  });

  it('FINANCE runs the finance module and still approves nothing on its own', () => {
    const finance = counterStaff();
    expect(can(finance, 'finance.view')).toBe(true);
    expect(can(finance, 'payment.record')).toBe(true);
    expect(can(finance, 'payment.reverse')).toBe(true);
    expect(can(finance, 'creditNote.create')).toBe(true);
    expect(can(finance, 'dayEnd.close')).toBe(true);
    // A credit note it raised is approved by somebody else, and a day it
    // closed is reopened by somebody else.
    expect(can(finance, 'creditNote.approve')).toBe(false);
    expect(can(finance, 'dayEnd.reopen')).toBe(false);
    expect(can(finance, 'finance.configure')).toBe(false);
    // And it stays out of the clinical record and the stockroom.
    expect(can(finance, 'note.write')).toBe(false);
    expect(can(finance, 'stock.adjust')).toBe(false);
  });

  it('an EXPLICIT role assignment drops the legacy grant — it must be re-granted', () => {
    // Same rule as the role fallback: assigning roles states the whole truth
    // about somebody, and a legacy power silently surviving that would be the
    // widening this model exists to make visible.
    expect(can(counterStaff(), 'billing.corrections', ['ADMINISTRATOR'])).toBe(false);
  });

  it('FRONT DESK keeps counter actions and never gains corrections', () => {
    const frontDesk = staffOf({
      role: 'FRONT_DESK_CLINICAL_STAFF' as Role,
      professionalType: undefined,
      professionalActive: false,
      canSignClinicalNotes: false,
    });
    expect(can(frontDesk, 'billing.counter')).toBe(true);
    expect(can(frontDesk, 'billing.corrections')).toBe(false);
  });
});

describe('the queue split', () => {
  it('a DOCTOR may run the consultation flow for their own patients', () => {
    // Calling the next patient and starting a consultation is what a doctor
    // does all day. Mapping it onto queue.manage alone would have stopped it.
    expect(can(staffOf(), 'queue.consultationFlow', ['DOCTOR'])).toBe(true);
  });

  it('but does NOT manage the queue — completing and cancelling are counter work', () => {
    expect(can(staffOf(), 'queue.manage', ['DOCTOR'])).toBe(false);
  });

  it('an ADMINISTRATOR holds both', () => {
    const msY = staffOf({ role: 'FINANCE_STAFF' as Role, professionalActive: false, professionalType: undefined });
    expect(can(msY, 'queue.consultationFlow', ['ADMINISTRATOR'])).toBe(true);
    expect(can(msY, 'queue.manage', ['ADMINISTRATOR'])).toBe(true);
  });

  it('CLINICAL STAFF runs neither — they resume, they do not call or complete', () => {
    const msX = staffOf({
      role: 'FRONT_DESK_CLINICAL_STAFF' as Role,
      professionalType: undefined,
      professionalActive: false,
    });
    expect(can(msX, 'queue.manage', ['CLINICAL_STAFF'])).toBe(false);
    expect(can(msX, 'consultation.resume', ['CLINICAL_STAFF'])).toBe(true);
  });
});
