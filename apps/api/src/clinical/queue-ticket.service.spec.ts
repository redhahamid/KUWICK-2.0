import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { QueueTicketService, formatDisplayNumber } from './queue-ticket.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    queueTicket: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    room: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const visits = { create: jest.fn(), checkOut: jest.fn() } as unknown as VisitService;
  return { service: new QueueTicketService(prisma, visits), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('formatDisplayNumber', () => {
  it('maps each queue type to its prefix with zero-padding (D-038)', () => {
    expect(formatDisplayNumber(QueueType.APPOINTMENT, 3)).toBe('A003');
    expect(formatDisplayNumber(QueueType.OTC, 12)).toBe('C012');
    expect(formatDisplayNumber(QueueType.WALK_IN, 1)).toBe('W001');
    expect(formatDisplayNumber(QueueType.EMERGENCY, 104)).toBe('E104');
  });
});

describe('QueueTicketService', () => {
  it('addToQueue creates a Visit first, then a ticket numbered from today\'s count of the same queue type', async () => {
    const { service, prisma, visits } = createService();
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1' });
    (prisma.queueTicket.count as jest.Mock).mockResolvedValue(2);
    (prisma.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1', ticketNumber: 3 });

    const result = await withTenant(() =>
      service.addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' }),
    );

    expect(visits.create).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', patientId: 'p1', staffId: 's1' }),
    );
    expect(prisma.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.WALK_IN, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.queueTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visitId: 'visit-1',
          ticketNumber: 3,
          queueType: QueueType.WALK_IN,
          displayNumber: 'W003',
        }),
      }),
    );
    expect(result).toEqual({ id: 'ticket-1', ticketNumber: 3 });
  });

  it('addToQueue numbers the EMERGENCY stream independently', async () => {
    const { service, prisma, visits } = createService();
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1' });
    (prisma.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (prisma.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    await withTenant(() =>
      service.addToQueue({
        clinicId: 'c1',
        patientId: 'p1',
        staffId: 's1',
        billingType: 'Self-pay',
        queueType: QueueType.EMERGENCY,
      }),
    );

    expect(prisma.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.EMERGENCY, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.queueTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ queueType: QueueType.EMERGENCY, displayNumber: 'E001' }),
      }),
    );
  });

  it('call records the room and calledAt', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.WAITING });
    (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 'room-1', active: true });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });

    await service.call('t1', 'room-1');

    expect(prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { calledAt: expect.any(Date), roomId: 'room-1' },
      include: { room: true },
    });
  });

  it('call rejects an inactive room', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.WAITING });
    (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 'room-1', active: false });

    await expect(service.call('t1', 'room-1')).rejects.toThrow(BadRequestException);
  });

  it('findById throws NotFoundException when the ticket does not exist', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('arrived moves WAITING to IN_CONSULTATION', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.WAITING });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.IN_CONSULTATION });

    await service.arrived('t1');

    expect(prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.IN_CONSULTATION },
    });
  });

  it('arrived rejects a ticket that is not WAITING', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      status: QueueTicketStatus.IN_CONSULTATION,
    });
    await expect(service.arrived('t1')).rejects.toThrow(BadRequestException);
  });

  it('cancel rejects a ticket that is already completed or cancelled', async () => {
    const { service, prisma } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      status: QueueTicketStatus.COMPLETED,
    });
    await expect(service.cancel('t1', {})).rejects.toThrow(BadRequestException);
  });

  it('complete checks the visit out and moves DISPENSARY_PAYMENT to COMPLETED', async () => {
    const { service, prisma, visits } = createService();
    (prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.DISPENSARY_PAYMENT,
    });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.COMPLETED });

    await service.complete('t1');

    expect(visits.checkOut).toHaveBeenCalledWith('visit-1');
    expect(prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.COMPLETED },
    });
  });
});
