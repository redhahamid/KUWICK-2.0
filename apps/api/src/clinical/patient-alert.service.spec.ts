import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PatientAlertService } from './patient-alert.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// A2 — patient alerts: the TYPE-AWARE boundary, held as tests.
//
// The owner's table:                MEDICAL   ACCESS.  COMM.  ADMIN.
//   DOCTOR                             ✓         ✓       ✓      ✓
//   CLINICAL_STAFF                     ✓         ✓       ✓      ✓
//   ADMINISTRATOR (front counter)      —         ✓       ✓      ✓
//
// One permission cannot express "all types except MEDICAL", hence the split
// (patient.alert.write / patient.alert.medical.write). Deactivation follows
// the SAME table — an account that may not record a MEDICAL standing fact
// may not retire one either — and is audited in place, never deleted.
// ===========================================================================

type Actor = { id: string; tenantId: string; role: string; active: boolean; assigned: string[] };

const doctor: Actor = { id: 'staff-dr', tenantId: 't1', role: 'DOCTOR_RESIDENT', active: true, assigned: ['DOCTOR'] };
const nurse: Actor = { id: 'staff-cs', tenantId: 't1', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, assigned: ['CLINICAL_STAFF'] };
const counter: Actor = { id: 'staff-fd', tenantId: 't1', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, assigned: ['ADMINISTRATOR'] };
const ownerOnly: Actor = { id: 'staff-ow', tenantId: 't1', role: 'OWNER_ADMIN', active: true, assigned: ['OWNER'] };

const STORED_ALERT = {
  id: 'alert-1',
  tenantId: 't1',
  patientId: 'p1',
  type: 'MEDICAL',
  label: 'On Warfarin',
  note: null,
  active: true,
  createdByStaffId: 'staff-dr',
};

function createService(actor: Actor) {
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor), findMany: jest.fn().mockResolvedValue([]) },
    staffRoleAssignment: { findMany: jest.fn().mockResolvedValue(actor.assigned.map((role) => ({ role }))) },
    patient: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', deletedAt: null }) },
    patientAlert: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(STORED_ALERT),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'alert-new', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...STORED_ALERT, ...data })),
    },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return { service: new PatientAlertService(rawPrisma), tx };
}

function asActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 't1', staffId: actor.id }, fn);
}

describe('the type-aware boundary on ADD', () => {
  it('a doctor records a MEDICAL alert', async () => {
    const { service, tx } = createService(doctor);
    await asActor(doctor, () => service.create('p1', { type: 'MEDICAL', label: 'Pregnant' }));
    expect(tx.patientAlert.create).toHaveBeenCalled();
  });

  it('clinical staff record a MEDICAL alert — a nurse noting "On Warfarin" is the workflow', async () => {
    const { service, tx } = createService(nurse);
    await asActor(nurse, () => service.create('p1', { type: 'MEDICAL', label: 'On Warfarin' }));
    expect(tx.patientAlert.create).toHaveBeenCalled();
  });

  it('front counter records the wheelchair — ACCESSIBILITY is theirs', async () => {
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.create('p1', { type: 'ACCESSIBILITY', label: 'Wheelchair' }));
    expect(tx.patientAlert.create).toHaveBeenCalled();
  });

  it('front counter is REFUSED a MEDICAL alert, and told who to ask', async () => {
    const { service, tx } = createService(counter);
    await expect(
      asActor(counter, () => service.create('p1', { type: 'MEDICAL', label: 'Pregnant' })),
    ).rejects.toThrow(/ask a doctor or clinical staff/i);
    expect(tx.patientAlert.create).not.toHaveBeenCalled();
  });

  it('OWNER alone records nothing — ownership is not a clinical or counter capability', async () => {
    const { service } = createService(ownerOnly);
    await expect(
      asActor(ownerOnly, () => service.create('p1', { type: 'ADMINISTRATIVE', label: 'VIP' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('deactivate — same table, audited, never deleted', () => {
  it('retiring a MEDICAL alert follows the MEDICAL rule: front counter is refused', async () => {
    const { service, tx } = createService(counter);
    await expect(asActor(counter, () => service.deactivate('alert-1'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.patientAlert.update).not.toHaveBeenCalled();
  });

  it('front counter MAY retire a COMMUNICATION alert', async () => {
    const { service, tx } = createService(counter);
    tx.patientAlert.findUnique.mockResolvedValue({ ...STORED_ALERT, type: 'COMMUNICATION', label: 'Bahasa only' });
    await asActor(counter, () => service.deactivate('alert-1'));
    expect(tx.patientAlert.update).toHaveBeenCalled();
  });

  it('deactivation is an audited update in place — who and when, active=false', async () => {
    const { service, tx } = createService(doctor);
    await asActor(doctor, () => service.deactivate('alert-1'));
    const { data } = tx.patientAlert.update.mock.calls[0][0];
    expect(data.active).toBe(false);
    expect(data.deactivatedByStaffId).toBe('staff-dr');
    expect(data.deactivatedAt).toBeInstanceOf(Date);
  });

  it('an already-inactive alert cannot be retired twice', async () => {
    const { service, tx } = createService(doctor);
    tx.patientAlert.findUnique.mockResolvedValue({ ...STORED_ALERT, active: false });
    await expect(asActor(doctor, () => service.deactivate('alert-1'))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('what gets written', () => {
  it('attribution comes from the SESSION — the actor is the author, nothing in the DTO says so', async () => {
    const { service, tx } = createService(doctor);
    await asActor(doctor, () => service.create('p1', { type: 'MEDICAL', label: 'G6PD' }));
    expect(tx.patientAlert.create.mock.calls[0][0].data.createdByStaffId).toBe('staff-dr');
  });

  it('the label is trimmed, and whitespace alone is not a label', async () => {
    const { service } = createService(doctor);
    await expect(
      asActor(doctor, () => service.create('p1', { type: 'MEDICAL', label: '   ' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a missing or archived patient is NotFound before anything is written', async () => {
    const { service, tx } = createService(doctor);
    tx.patient.findUnique.mockResolvedValue(null);
    await expect(
      asActor(doctor, () => service.create('p1', { type: 'MEDICAL', label: 'Asthma' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.patientAlert.create).not.toHaveBeenCalled();
  });
});
