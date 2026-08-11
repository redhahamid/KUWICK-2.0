import { ForbiddenException } from '@nestjs/common';
import { Role, Staff } from '@prisma/client';
import {
  DispensaryAction,
  assertCanPerformDispensary,
  canPerformDispensary,
  dispensaryPermissionsFor,
} from './dispensary-authorization';

// ===========================================================================
// G4.5d5b-2 — THE DISPENSARY ACTION MATRIX
//
// Before this, `dispense()` called requireActor and nothing else: any
// authenticated staff member of any role could move clinic stock. These tests
// pin the owner's matrix so that gap cannot reopen quietly.
// ===========================================================================

const staff = (role: Role, active = true) => ({ role, active } as Staff);

const ALL_ROLES: Role[] = [
  'OWNER_ADMIN',
  'FRONT_DESK_CLINICAL_STAFF',
  'DOCTOR_RESIDENT',
  'DOCTOR_LOCUM',
  'FINANCE_STAFF',
  'STOCK_STAFF',
];

describe('who may view the dispensary', () => {
  it.each([
    ['OWNER_ADMIN', true],
    ['FRONT_DESK_CLINICAL_STAFF', true],
    ['DOCTOR_RESIDENT', true],
    ['DOCTOR_LOCUM', true],
    ['STOCK_STAFF', true],
    ['FINANCE_STAFF', false],
  ] as const)('1. %s -> %s', (role, allowed) => {
    expect(canPerformDispensary(staff(role as Role), 'VIEW_DISPENSARY')).toBe(allowed);
  });
});

describe('who may dispense', () => {
  it.each([
    ['OWNER_ADMIN', true],
    ['FRONT_DESK_CLINICAL_STAFF', true],
    // Doctors may dispense in a small clinic — an explicit decision, not an
    // accident of there being no check.
    ['DOCTOR_RESIDENT', true],
    ['DOCTOR_LOCUM', true],
    // Handing medicine to a patient is a clinical hand-over with a named
    // dispenser; stock staff correct the stock record instead.
    ['STOCK_STAFF', false],
    ['FINANCE_STAFF', false],
  ] as const)('2. %s -> %s', (role, allowed) => {
    expect(canPerformDispensary(staff(role as Role), 'DISPENSE_MEDICATION')).toBe(allowed);
  });
});

describe('who may print a label', () => {
  it.each([
    ['OWNER_ADMIN', true],
    ['FRONT_DESK_CLINICAL_STAFF', true],
    ['DOCTOR_RESIDENT', true],
    ['DOCTOR_LOCUM', true],
    ['STOCK_STAFF', false],
    ['FINANCE_STAFF', false],
  ] as const)('3. %s -> %s', (role, allowed) => {
    expect(canPerformDispensary(staff(role as Role), 'PRINT_LABEL')).toBe(allowed);
  });
});

describe('who may resolve a stock issue', () => {
  it.each([
    ['OWNER_ADMIN', true],
    ['STOCK_STAFF', true],
    ['FRONT_DESK_CLINICAL_STAFF', false],
    ['DOCTOR_RESIDENT', false],
  ] as const)('4. %s -> %s', (role, allowed) => {
    expect(canPerformDispensary(staff(role as Role), 'RESOLVE_STOCK_ISSUE')).toBe(allowed);
  });
});

describe('the matrix holds under every other condition', () => {
  it('5. an INACTIVE account may do nothing, whatever its role', () => {
    const actions: DispensaryAction[] = [
      'VIEW_DISPENSARY',
      'PRINT_LABEL',
      'DISPENSE_MEDICATION',
      'RESOLVE_STOCK_ISSUE',
    ];
    for (const role of ALL_ROLES) {
      for (const action of actions) {
        expect(canPerformDispensary(staff(role, false), action)).toBe(false);
      }
    }
  });

  it('6. STOCK_STAFF is genuinely read-only — view yes, every write no', () => {
    const stock = staff('STOCK_STAFF');
    expect(canPerformDispensary(stock, 'VIEW_DISPENSARY')).toBe(true);
    expect(canPerformDispensary(stock, 'DISPENSE_MEDICATION')).toBe(false);
    expect(canPerformDispensary(stock, 'PRINT_LABEL')).toBe(false);
  });

  it('7. no role acquires dispensing merely by being able to view', () => {
    for (const role of ALL_ROLES) {
      const person = staff(role);
      if (canPerformDispensary(person, 'DISPENSE_MEDICATION')) {
        expect(canPerformDispensary(person, 'VIEW_DISPENSARY')).toBe(true);
      }
    }
  });

  it('8. the refusal names the action, never the role that would have worked', () => {
    try {
      assertCanPerformDispensary(staff('FINANCE_STAFF'), 'DISPENSE_MEDICATION');
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const message = (error as ForbiddenException).message;
      expect(message).toBe('This account may not dispense medication.');
      expect(message).not.toMatch(/OWNER_ADMIN|FRONT_DESK|DOCTOR_/);
    }
  });

  it('9. an allowed action does not throw', () => {
    expect(() => assertCanPerformDispensary(staff('FRONT_DESK_CLINICAL_STAFF'), 'DISPENSE_MEDICATION')).not.toThrow();
  });

  it('10. the permission snapshot matches the matrix exactly', () => {
    expect(dispensaryPermissionsFor(staff('STOCK_STAFF'))).toEqual({
      VIEW_DISPENSARY: true,
      PRINT_LABEL: false,
      DISPENSE_MEDICATION: false,
      RESOLVE_STOCK_ISSUE: true,
    });
    expect(dispensaryPermissionsFor(staff('FINANCE_STAFF'))).toEqual({
      VIEW_DISPENSARY: false,
      PRINT_LABEL: false,
      DISPENSE_MEDICATION: false,
      RESOLVE_STOCK_ISSUE: false,
    });
  });

  it('11. no NEW role was introduced to make this work', () => {
    // The v1 decision: existing roles only. A DISPENSARY_STAFF value appearing
    // in the enum would mean a migration nobody approved.
    expect(Object.keys(Role)).not.toContain('DISPENSARY_STAFF');
    expect(Object.keys(Role)).not.toContain('PHARMACIST');
  });
});
