import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AppointmentBookingValidator, BookingRequest } from './appointment-booking-validator.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { StaffService } from '../hr/staff.service';
import { parseTimeToDate } from './time.util';

const CLINIC_ID = 'clinic-1';
const STAFF_ID = 'staff-1';
const SERVICE_ID = 'service-1';

function windowOn(dateISO: string, startHHMM: string, endHHMM: string) {
  return {
    start: new Date(`${dateISO}T${startHHMM}:00.000Z`),
    end: new Date(`${dateISO}T${endHHMM}:00.000Z`),
  };
}

function baseRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  const { start, end } = windowOn('2026-08-05', '10:00', '10:30');
  return {
    clinicId: CLINIC_ID,
    staffId: STAFF_ID,
    serviceId: SERVICE_ID,
    scheduledStart: start,
    scheduledEnd: end,
    ...overrides,
  };
}

function createValidator(overrides: {
  qualified?: boolean;
  exception?: { startTime: Date | null; endTime: Date | null } | null;
  schedules?: { startTime: Date; endTime: Date }[];
  overlapping?: unknown | null;
  capacityConfig?: { dailyCapacity: number | null } | null;
  countSameDay?: number;
}) {
  const staffService = {
    assertActiveDoctor: jest.fn().mockResolvedValue(undefined),
  } as unknown as StaffService;

  const prisma = {
    doctorServiceQualification: {
      findFirst: jest.fn().mockResolvedValue(overrides.qualified === false ? null : { id: 'q1' }),
    },
    scheduleException: {
      findFirst: jest.fn().mockResolvedValue(overrides.exception ?? null),
    },
    doctorSchedule: {
      findMany: jest.fn().mockResolvedValue(overrides.schedules ?? []),
    },
    appointment: {
      findFirst: jest.fn().mockResolvedValue(overrides.overlapping ?? null),
      count: jest.fn().mockResolvedValue(overrides.countSameDay ?? 0),
    },
    slotCapacityConfig: {
      findFirst: jest.fn().mockResolvedValue(overrides.capacityConfig ?? null),
    },
  } as unknown as TenantScopedPrismaClient;

  return { validator: new AppointmentBookingValidator(prisma, staffService), prisma, staffService };
}

describe('AppointmentBookingValidator', () => {
  it('rejects a booking when the doctor has no DoctorServiceQualification for the service', async () => {
    const { validator } = createValidator({ qualified: false });
    await expect(validator.validate(baseRequest())).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a booking outside any DoctorSchedule window for that day', async () => {
    const { validator } = createValidator({ schedules: [] });
    await expect(validator.validate(baseRequest())).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a booking on a date covered by a null-window ScheduleException, even if DoctorSchedule would allow it', async () => {
    const { validator, prisma } = createValidator({
      exception: { startTime: null, endTime: null },
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('17:00') }],
    });
    await expect(validator.validate(baseRequest())).rejects.toThrow(UnprocessableEntityException);
    // The exception short-circuits roster resolution — DoctorSchedule must
    // never be consulted once a leave exception is found for that date.
    expect(prisma.doctorSchedule.findMany).not.toHaveBeenCalled();
  });

  it('accepts a booking inside a populated-window ScheduleException even when it falls outside the normal DoctorSchedule', async () => {
    const { validator } = createValidator({
      exception: { startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('12:00') },
      schedules: [],
    });
    await expect(validator.validate(baseRequest())).resolves.toBeUndefined();
  });

  it('accepts a booking that falls within a normal DoctorSchedule window with no exception', async () => {
    const { validator } = createValidator({
      exception: null,
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('17:00') }],
    });
    await expect(validator.validate(baseRequest())).resolves.toBeUndefined();
  });

  it('rejects an overlapping booking for the same doctor', async () => {
    const { validator } = createValidator({
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('17:00') }],
      overlapping: { id: 'existing-appt' },
    });
    await expect(validator.validate(baseRequest())).rejects.toThrow(ConflictException);
  });

  it('rejects a booking once daily capacity for the service is reached', async () => {
    const { validator } = createValidator({
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('17:00') }],
      capacityConfig: { dailyCapacity: 3 },
      countSameDay: 3,
    });
    await expect(validator.validate(baseRequest())).rejects.toThrow(ConflictException);
  });
});
