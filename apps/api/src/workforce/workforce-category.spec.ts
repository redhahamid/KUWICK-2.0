import { ProfessionalType, Role } from '@prisma/client';
import { isBookableProvider, isRosterableRole, workforceCategoryOf } from './workforce-category';

describe('workforceCategoryOf', () => {
  it('puts both kinds of doctor with the doctors', () => {
    expect(workforceCategoryOf({ role: Role.DOCTOR_RESIDENT })).toBe('DOCTOR');
    expect(workforceCategoryOf({ role: Role.DOCTOR_LOCUM })).toBe('DOCTOR');
  });

  it('tells a nurse from a receptionist on the one role that covers both', () => {
    // FRONT_DESK_CLINICAL_STAFF records vitals AND registers patients; the
    // permission model keeps that together on purpose. The roster still has to
    // show them in different sections.
    expect(
      workforceCategoryOf({ role: Role.FRONT_DESK_CLINICAL_STAFF, professionalType: ProfessionalType.MEDICAL_DOCTOR }),
    ).toBe('CLINICAL');
    expect(
      workforceCategoryOf({ role: Role.FRONT_DESK_CLINICAL_STAFF, professionalType: ProfessionalType.NON_CLINICAL }),
    ).toBe('ADMIN');
    expect(workforceCategoryOf({ role: Role.FRONT_DESK_CLINICAL_STAFF })).toBe('ADMIN');
  });

  it('groups the owner with finance, because both are management', () => {
    expect(workforceCategoryOf({ role: Role.OWNER_ADMIN })).toBe('MANAGEMENT');
    expect(workforceCategoryOf({ role: Role.FINANCE_STAFF })).toBe('MANAGEMENT');
  });

  it('does not invent a category for the back-office roles', () => {
    for (const role of [Role.HR_STAFF, Role.STOCK_STAFF, Role.PANEL_STAFF]) {
      expect(workforceCategoryOf({ role })).toBe('OTHER');
    }
  });
});

describe('isBookableProvider', () => {
  it('is the doctors, and only the doctors', () => {
    expect(isBookableProvider({ role: Role.DOCTOR_RESIDENT })).toBe(true);
    expect(isBookableProvider({ role: Role.DOCTOR_LOCUM })).toBe(true);
  });

  it('is NOT everybody the roster now contains', () => {
    // The roster widening must not widen what the availability engine offers.
    // A receptionist's shift is a real shift and not a bookable slot.
    for (const role of [Role.FRONT_DESK_CLINICAL_STAFF, Role.FINANCE_STAFF, Role.OWNER_ADMIN, Role.STOCK_STAFF]) {
      expect(isBookableProvider({ role })).toBe(false);
    }
  });

  it('is not a deactivated doctor', () => {
    expect(isBookableProvider({ role: Role.DOCTOR_RESIDENT, active: false })).toBe(false);
  });
});

describe('isRosterableRole', () => {
  it('excludes the patient portal, which is not a member of staff', () => {
    expect(isRosterableRole(Role.PATIENT_PORTAL)).toBe(false);
  });

  it('includes every actual staff role', () => {
    const staffRoles = Object.values(Role).filter((role) => role !== Role.PATIENT_PORTAL);
    for (const role of staffRoles) expect(isRosterableRole(role)).toBe(true);
  });
});
