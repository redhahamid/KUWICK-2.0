import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { OrderServiceService } from './order-service.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import * as fileStorage from '../core/file-storage';

jest.mock('../core/file-storage');

const DOCTOR: Record<string, unknown> = {
  id: 'staff-1',
  fullName: 'Dr. Amira Rahman',
  role: 'DOCTOR_RESIDENT',
  active: true,
  clinicId: 'clinic-1',
  userId: 'user-1',
  professionalType: null,
  professionalActive: false,
};

const FRONT_DESK = { ...DOCTOR, role: 'FRONT_DESK_CLINICAL_STAFF' };

function createService(actor: Record<string, unknown> = DOCTOR) {
  const prisma = {
    orderService: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    serviceCatalog: { findUnique: jest.fn() },
    attachment: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    formTemplate: { findUnique: jest.fn() },
    // G4.5s (D-073) — cancel refuses a service that is already charged.
    invoiceLine: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as TenantScopedPrismaClient;

  // G3a — audited result removal runs through an interactive transaction.
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor) },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    orderService: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
    // S2 (D-074) — creation resolves the visit and the catalogue entry inside
    // the tenant transaction, behind the central branch guard.
    visit: { findUnique: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 'staff-1' }) },
    serviceCatalog: { findUnique: jest.fn() },
    attachment: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'att-1' }), delete: jest.fn() },
    // b2 PHASE E — the room a task order is sent to, checked against THIS
    // clinic's active rooms before the order is written.
    room: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new OrderServiceService(prisma, rawPrisma), prisma, tx };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

const SAVED_RESULT = {
  id: 'att-1',
  orderServiceId: 'o1',
  fileName: 'fbc-report.pdf',
  filePath: 'tenant-a/o1/uuid-scan.png',
  mimeType: 'application/pdf',
  uploadedByStaffId: 'staff-9',
  recordStatus: 'ACTIVE',
  version: 1,
};

describe('OrderServiceService', () => {
  it('create snapshots code/procedureName/orderType and defaults requestedByStaffId to the visit doctor', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue({
      id: 'cat-1',
      code: 'XRAYCHEST',
      name: 'Chest X-Ray',
      orderType: ServiceOrderType.TASK_ORDER,
    });
    (prisma.orderService.create as jest.Mock).mockResolvedValue({ id: 'order-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1', instruction: 'PA VIEW' }));

    expect(prisma.orderService.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        visitId: 'visit-1',
        serviceCatalogId: 'cat-1',
        code: 'XRAYCHEST',
        procedureName: 'Chest X-Ray',
        orderType: ServiceOrderType.TASK_ORDER,
        instruction: 'PA VIEW',
        // b2 PHASE E — a task order carries no room or urgency unless one was
        // chosen, and is always one piece of work whatever a client sends.
        roomId: undefined,
        urgency: undefined,
        quantity: 1,
        requestedByStaffId: 'staff-1',
      },
    });
  });

  it('create throws NotFoundException for an unknown serviceCatalogId', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(null);

    await expect(
      withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'missing' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('procedureQueue filters to TASK_ORDER only', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findMany as jest.Mock).mockResolvedValue([]);

    await service.procedureQueue({ clinicId: 'clinic-1' });

    expect(prisma.orderService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderType: ServiceOrderType.TASK_ORDER, clinicId: 'clinic-1', status: undefined },
      }),
    );
  });

  it('start moves PENDING to IN_PROGRESS', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({ id: 'o1', orderType: ServiceOrderType.TASK_ORDER, status: OrderServiceStatus.PENDING });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.IN_PROGRESS });

    await service.start('o1');

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: OrderServiceStatus.IN_PROGRESS },
    });
  });

  it('start rejects an order that is not PENDING', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      orderType: ServiceOrderType.TASK_ORDER,
      status: OrderServiceStatus.IN_PROGRESS,
    });
    await expect(service.start('o1')).rejects.toThrow(BadRequestException);
  });

  it('complete moves IN_PROGRESS to COMPLETED and records the result', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      orderType: ServiceOrderType.TASK_ORDER,
      status: OrderServiceStatus.IN_PROGRESS,
    });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.COMPLETED });

    await service.complete('o1', { result: 'Clear' });

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: {
        status: OrderServiceStatus.COMPLETED,
        result: 'Clear',
        formTemplateId: undefined,
        formData: undefined,
        completedAt: expect.any(Date),
      },
    });
  });

  it('complete derives a plain-text result summary from formData when no free-text result is given', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      orderType: ServiceOrderType.TASK_ORDER,
      status: OrderServiceStatus.IN_PROGRESS,
    });
    (prisma.formTemplate.findUnique as jest.Mock).mockResolvedValue({
      id: 'ft-1',
      fields: [
        { id: 'f1', label: 'Hemoglobin', unit: 'g/dL' },
        { id: 'f2', label: 'WBC', unit: 'x10^9/L' },
      ],
    });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.COMPLETED });

    await service.complete('o1', { formTemplateId: 'ft-1', formData: { f1: 13.5, f2: 7.2 } });

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: {
        status: OrderServiceStatus.COMPLETED,
        result: 'Hemoglobin: 13.5 g/dL\nWBC: 7.2 x10^9/L',
        formTemplateId: 'ft-1',
        formData: { f1: 13.5, f2: 7.2 },
        completedAt: expect.any(Date),
      },
    });
  });

  it('cancel rejects an order that is already completed or cancelled', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      orderType: ServiceOrderType.TASK_ORDER,
      status: OrderServiceStatus.COMPLETED,
    });
    await expect(service.cancel('o1', {})).rejects.toThrow(BadRequestException);
  });

  it('addAttachment saves the file to disk and defaults uploadedByStaffId to the order requester', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      requestedByStaffId: 'staff-1',
    });
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'tenant-a/o1/uuid-scan.png' });
    (prisma.attachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });
    // G4.5d3c-3c1 — a real PNG signature. The allow-list reads the leading
    // bytes, so a fixture claiming to be a PNG has to be one.
    const file = {
      originalname: 'scan.png',
      mimetype: 'image/png',
      size: 1234,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
    } as Express.Multer.File;

    await withTenant(() => service.addAttachment('o1', file));

    expect(fileStorage.saveUploadedFile).toHaveBeenCalledWith('test-tenant', 'o1', file.buffer, 'scan.png');
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        orderServiceId: 'o1',
        fileName: 'scan.png',
        filePath: 'tenant-a/o1/uuid-scan.png',
        mimeType: 'image/png',
        fileSize: 1234,
        uploadedByStaffId: 'staff-1',
      },
    });
  });

  it('findAttachment throws NotFoundException when the attachment belongs to a different order', async () => {
    const { service, prisma } = createService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({ id: 'att-1', orderServiceId: 'other-order' });
    await expect(service.findAttachment('o1', 'att-1')).rejects.toThrow(NotFoundException);
  });

  // G3a (D-062) — an investigation result is clinical evidence. The hard
  // delete is gone; removal is audited and the file stays on disk so an
  // authorised history request can still retrieve the original report.
  it('no longer exposes a hard-delete method for results', () => {
    const { service } = createService();
    expect((service as unknown as Record<string, unknown>).deleteAttachment).toBeUndefined();
  });

  it('removal marks the result REMOVED_IN_ERROR instead of deleting it', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'Uploaded to the wrong order' }));

    expect(tx.attachment.update.mock.calls[0][0].data.recordStatus).toBe('REMOVED_IN_ERROR');
    expect(tx.attachment.delete).not.toHaveBeenCalled();
  });

  it('does NOT delete the underlying result file', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'Wrong order' }));

    expect(fileStorage.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it('preserves filename, path, MIME type and uploader on removal', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'Wrong order' }));

    const data = tx.attachment.update.mock.calls[0][0].data;
    expect(data.fileName).toBeUndefined();
    expect(data.filePath).toBeUndefined();
    expect(data.mimeType).toBeUndefined();
    expect(data.uploadedByStaffId).toBeUndefined();
  });

  it('requires a removal reason', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await expect(
      withTenant(() => service.removeAttachment('o1', 'att-1', { reason: '   ' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('records the remover from the session, not the request', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await withTenant(() =>
      service.removeAttachment('o1', 'att-1', { reason: 'Wrong order', removedByStaffId: 'attacker' } as never),
    );

    const data = tx.attachment.update.mock.calls[0][0].data;
    expect(data.removedByStaffId).toBe('staff-1');
    expect(data.removedByNameSnapshot).toBe('Dr. Amira Rahman');
    expect(data.removedByRoleSnapshot).toBe('DOCTOR_RESIDENT');
  });

  it('removal throws NotFoundException when the result belongs to a different order', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue({ ...SAVED_RESULT, orderServiceId: 'other-order' });

    await expect(
      withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'wrong' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('re-removing an already removed result is a conflict', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue({ ...SAVED_RESULT, recordStatus: 'REMOVED_IN_ERROR' });

    await expect(
      withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'again' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await expect(
      withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'stale', expectedVersion: 99 })),
    ).rejects.toThrow(ConflictException);
  });

  it('front-desk staff may not remove an investigation result', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await expect(
      withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'nope' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('the active result list excludes removed results by default', async () => {
    const { service, prisma } = createService();
    (prisma.attachment.findMany as jest.Mock).mockResolvedValue([]);

    await service.listAttachments('o1');

    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderServiceId: 'o1', recordStatus: 'ACTIVE' } }),
    );
  });

  it('history includes removed results', async () => {
    const { service, prisma } = createService();
    (prisma.attachment.findMany as jest.Mock).mockResolvedValue([]);

    await service.listAttachments('o1', true);

    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderServiceId: 'o1' } }),
    );
  });

  it('removing a result does not change the order status', async () => {
    const { service, prisma, tx } = createService();
    tx.attachment.findUnique.mockResolvedValue(SAVED_RESULT);

    await withTenant(() => service.removeAttachment('o1', 'att-1', { reason: 'Wrong order' }));

    expect(prisma.orderService.update).not.toHaveBeenCalled();
  });
});

// =============================================================================
// G4.5s (D-073) — the two order types mean different things, and the server is
// what says so. The Canvas already hid Start and Complete on a direct service;
// these assert the RULE, which hiding a button never was.
// =============================================================================
describe('direct services vs task orders', () => {
  const catalog = (orderType: ServiceOrderType) => ({
    id: 'svc-1',
    code: 'CONS',
    name: 'General Consultation',
    orderType,
  });

  const arrangeCreate = (orderType: ServiceOrderType) => {
    const ctx = createService();
    // S2 (D-074) — both are resolved on the tenant transaction now.
    ctx.tx.visit.findUnique.mockResolvedValue({
      id: 'visit-1',
      clinicId: 'clinic-1',
      staffId: 'staff-doctor',
    });
    ctx.tx.serviceCatalog.findUnique.mockResolvedValue(catalog(orderType));
    (ctx.prisma.orderService.create as jest.Mock).mockResolvedValue({ id: 'o1' });
    return ctx;
  };

  const createdData = (prisma: TenantScopedPrismaClient) =>
    (prisma.orderService.create as jest.Mock).mock.calls[0][0].data;

  it('adding a TASK_ORDER still creates it PENDING, with no completion time', async () => {
    const { service, prisma } = arrangeCreate(ServiceOrderType.TASK_ORDER);

    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'svc-1' }));

    // Left to the schema default rather than set explicitly — the point is
    // that create() does not touch the task lifecycle at all.
    expect(createdData(prisma).status).toBeUndefined();
    expect(createdData(prisma).completedAt).toBeUndefined();
  });

  it('adding a STANDARD_SERVICE creates it in its final operational state', async () => {
    const { service, prisma } = arrangeCreate(ServiceOrderType.STANDARD_SERVICE);

    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'svc-1' }));

    const data = createdData(prisma);
    expect(data.status).toBe(OrderServiceStatus.COMPLETED);
    expect(data.completedAt).toBeInstanceOf(Date);
    // Visit and branch survive the change.
    expect(data.visitId).toBe('visit-1');
    // D-085 — the requester is the AUTHENTICATED clinician who ordered it,
    // not the visit's attending doctor ('staff-doctor'). Ordering is a
    // clinical decision and belongs to whoever made it.
    expect(data.requestedByStaffId).toBe('staff-1');
    expect(data.clinicId).toBe('clinic-1');
  });

  // The catalogue's stored orderType decides, never the service's name — a
  // "General Consultation" configured as a TASK_ORDER is still a task.
  it('the decision follows the stored orderType, not the service name', async () => {
    const { service, prisma } = arrangeCreate(ServiceOrderType.TASK_ORDER);

    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'svc-1' }));

    expect(createdData(prisma).procedureName).toBe('General Consultation');
    expect(createdData(prisma).status).toBeUndefined();
  });

  const directService = (status: OrderServiceStatus) => ({
    id: 'o1',
    orderType: ServiceOrderType.STANDARD_SERVICE,
    status,
  });

  it('a direct service cannot be started', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.COMPLETED),
    );

    await expect(service.start('o1')).rejects.toThrow(BadRequestException);
    expect(prisma.orderService.update).not.toHaveBeenCalled();
  });

  it('a direct service cannot be completed', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.COMPLETED),
    );

    await expect(service.complete('o1', { result: 'x' })).rejects.toThrow(BadRequestException);
    expect(prisma.orderService.update).not.toHaveBeenCalled();
  });

  // Legacy rows sit at PENDING (see the D-073 audit). They must not become
  // startable just because their status happens to match the old rule.
  it('a legacy PENDING direct service still cannot be started', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.PENDING),
    );

    await expect(service.start('o1')).rejects.toThrow(BadRequestException);
  });

  it('the Procedure Queue asks for TASK_ORDER only', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findMany as jest.Mock).mockResolvedValue([]);

    await service.procedureQueue({});

    expect(prisma.orderService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderType: ServiceOrderType.TASK_ORDER }),
      }),
    );
  });

  // A direct service is created COMPLETED, so the old "nothing completed may
  // be cancelled" rule would have made it permanently uncancellable.
  it('a completed direct service can still be cancelled', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.COMPLETED),
    );
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1' });

    await service.cancel('o1', { cancelReason: 'Added to the wrong visit' });

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: expect.objectContaining({
        status: OrderServiceStatus.CANCELLED,
        cancelReason: 'Added to the wrong visit',
      }),
    });
  });

  it('a completed TASK_ORDER still cannot be cancelled', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      orderType: ServiceOrderType.TASK_ORDER,
      status: OrderServiceStatus.COMPLETED,
    });

    await expect(service.cancel('o1', {})).rejects.toThrow(BadRequestException);
  });

  // Money: cancelling must never leave a charge behind for something that is
  // no longer on the record, and must never silently edit an invoice.
  it('a charged service refuses cancellation and names the invoice', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.COMPLETED),
    );
    (prisma.invoiceLine.findFirst as jest.Mock).mockResolvedValue({
      invoice: { invoiceNumber: 'INV-000042', status: 'PAID' },
    });

    await expect(service.cancel('o1', { cancelReason: 'oops' })).rejects.toThrow(/INV-000042/);
    expect(prisma.orderService.update).not.toHaveBeenCalled();
  });

  it('cancelling preserves the row instead of deleting it', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.COMPLETED),
    );
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1' });

    await service.cancel('o1', { cancelReason: 'x' });

    expect(prisma.orderService.update).toHaveBeenCalled();
    expect((prisma.orderService as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it('cancelling an already-cancelled service is refused', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(
      directService(OrderServiceStatus.CANCELLED),
    );

    await expect(service.cancel('o1', {})).rejects.toThrow(BadRequestException);
  });
});

// =============================================================================
// S2 (D-074) — branch integrity on order/service creation.
//
// RLS already stopped cross-TENANT creation, because a foreign visit reads
// back empty. Nothing checked the BRANCH: a staff member authorised only for
// Branch A could add an order — or a chargeable direct service — to a Branch B
// visit by naming its id. This is the same gap D-069 closed for visits and
// D-070 for appointments, on the last endpoint that still had it.
// =============================================================================
describe('order/service creation branch integrity', () => {
  const CATALOG = (orderType: ServiceOrderType) => ({
    id: 'cat-1',
    code: 'CONS',
    name: 'General Consultation',
    orderType,
  });

  // A multi-branch tenant: the actor is homed at clinic-1 with no extra
  // grants, and the visit under test lives wherever the test says.
  const arrange = (visitClinicId: string, orderType: ServiceOrderType = ServiceOrderType.TASK_ORDER) => {
    const ctx = createService();
    ctx.tx.clinic.count.mockResolvedValue(3);
    ctx.tx.visit.findUnique.mockResolvedValue({
      id: 'visit-1',
      clinicId: visitClinicId,
      staffId: 'staff-1',
    });
    ctx.tx.serviceCatalog.findUnique.mockResolvedValue(CATALOG(orderType));
    (ctx.prisma.orderService.create as jest.Mock).mockResolvedValue({ id: 'o1' });
    return ctx;
  };

  const add = (ctx: ReturnType<typeof createService>) =>
    withTenant(() => ctx.service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1' }));

  it('1. a TASK_ORDER on an authorised branch succeeds', async () => {
    const ctx = arrange('clinic-1', ServiceOrderType.TASK_ORDER);

    await expect(add(ctx)).resolves.toBeDefined();
    expect(ctx.prisma.orderService.create).toHaveBeenCalled();
  });

  it('2. a STANDARD_SERVICE on an authorised branch succeeds', async () => {
    const ctx = arrange('clinic-1', ServiceOrderType.STANDARD_SERVICE);

    await expect(add(ctx)).resolves.toBeDefined();
    const data = (ctx.prisma.orderService.create as jest.Mock).mock.calls[0][0].data;
    // e4ae300's behaviour is unchanged by the new gate.
    expect(data.status).toBe(OrderServiceStatus.COMPLETED);
  });

  it('3. an unauthorised branch is refused', async () => {
    const ctx = arrange('clinic-OTHER');

    await expect(add(ctx)).rejects.toThrow(ForbiddenException);
  });

  // Both types, because a direct service is chargeable — "it is only a
  // service" is a reason for more care, not less.
  it('3b. an unauthorised branch is refused for a direct service too', async () => {
    const ctx = arrange('clinic-OTHER', ServiceOrderType.STANDARD_SERVICE);

    await expect(add(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('4. a foreign or unknown visit is a non-disclosing 404', async () => {
    const ctx = createService();
    // RLS makes another tenant's visit genuinely absent, so this is the same
    // response an id that never existed gets.
    ctx.tx.visit.findUnique.mockResolvedValue(null);

    await expect(add(ctx)).rejects.toThrow(NotFoundException);
  });

  it('5. a foreign or unknown service catalogue entry is refused', async () => {
    const ctx = arrange('clinic-1');
    ctx.tx.serviceCatalog.findUnique.mockResolvedValue(null);

    await expect(add(ctx)).rejects.toThrow(NotFoundException);
  });

  it('6. no OrderService survives a rejected request', async () => {
    for (const ctx of [arrange('clinic-OTHER'), arrange('clinic-OTHER', ServiceOrderType.STANDARD_SERVICE)]) {
      await expect(add(ctx)).rejects.toThrow();
      expect(ctx.prisma.orderService.create).not.toHaveBeenCalled();
    }

    const unknownVisit = createService();
    unknownVisit.tx.visit.findUnique.mockResolvedValue(null);
    await expect(add(unknownVisit)).rejects.toThrow();
    expect(unknownVisit.prisma.orderService.create).not.toHaveBeenCalled();

    const unknownService = arrange('clinic-1');
    unknownService.tx.serviceCatalog.findUnique.mockResolvedValue(null);
    await expect(add(unknownService)).rejects.toThrow();
    expect(unknownService.prisma.orderService.create).not.toHaveBeenCalled();
  });

  // The whole gate runs BEFORE the write, so a rejection cannot leave a
  // half-made record behind for a later step to pick up.
  it('7. validation happens before any write', async () => {
    const ctx = arrange('clinic-OTHER');

    await expect(add(ctx)).rejects.toThrow(ForbiddenException);

    expect(ctx.prisma.orderService.create).not.toHaveBeenCalled();
    expect(ctx.prisma.orderService.update).not.toHaveBeenCalled();
    expect(ctx.prisma.attachment.create).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller cannot create anything', async () => {
    const ctx = arrange('clinic-1');
    ctx.tx.staff.findUnique.mockResolvedValue(null);

    await expect(add(ctx)).rejects.toThrow();
    expect(ctx.prisma.orderService.create).not.toHaveBeenCalled();
  });

  // The row is built from the RESOLVED visit, never from anything the caller
  // could have supplied.
  it('the stored row takes its branch from the visit, not the request', async () => {
    const ctx = arrange('clinic-1');

    await add(ctx);

    const data = (ctx.prisma.orderService.create as jest.Mock).mock.calls[0][0].data;
    expect(data.clinicId).toBe('clinic-1');
    expect(data.requestedByStaffId).toBe('staff-1');
    expect(data.orderType).toBe(ServiceOrderType.TASK_ORDER);
  });

  it('the branch check reads the visit’s own stored clinic', async () => {
    const ctx = arrange('clinic-1');

    await add(ctx);

    expect(ctx.tx.visit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'visit-1' } }),
    );
  });
});

// ===========================================================================
// b2 PHASE E — WHERE, HOW URGENTLY, AND HOW MANY.
//
// The two order types ask for different things and the SERVER decides which
// fields apply, keyed on the stored `orderType` rather than on the name. What
// is worth pinning is the asymmetry — a quantity on a task order is
// meaningless, a room on a consultation fee is meaningless — and the room
// check, which the foreign key cannot do.
// ===========================================================================

const TASK_CATALOG = { id: 'cat-1', code: 'DRESS', name: 'Wound dressing', orderType: ServiceOrderType.TASK_ORDER };
const SERVICE_CATALOG = {
  id: 'cat-2',
  code: null,
  name: 'Consultation',
  orderType: ServiceOrderType.STANDARD_SERVICE,
};

const written = (prisma: TenantScopedPrismaClient) =>
  ((prisma.orderService.create as unknown as jest.Mock).mock.calls[0][0] as { data: Record<string, unknown> }).data;

describe('a task order records where and how urgently', () => {
  it('stores the room, the urgency and the instruction', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(TASK_CATALOG);
    await withTenant(() =>
      service.create({
        visitId: 'visit-1',
        serviceCatalogId: 'cat-1',
        roomId: 'room-1',
        urgency: 'URGENT',
        instruction: 'Left forearm',
      }),
    );
    expect(written(prisma)).toMatchObject({
      roomId: 'room-1',
      urgency: 'URGENT',
      instruction: 'Left forearm',
    });
    // No status written at all: a task order takes the schema default of
    // PENDING and joins the queue, unlike a standard service which is created
    // COMPLETED because adding it IS the delivery.
    expect(written(prisma)).not.toHaveProperty('status');
  });

  it('is always ONE piece of work, whatever quantity a client sends', async () => {
    // Three dressings is three orders, each with its own room and result —
    // not one order with a 3 in it that nobody can complete separately.
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(TASK_CATALOG);
    await withTenant(() =>
      service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1', quantity: 3 }),
    );
    expect(written(prisma).quantity).toBe(1);
  });

  it('refuses another clinic\'s room before writing anything', async () => {
    // The foreign key would ACCEPT it — PostgreSQL checks FKs through internal
    // triggers that RLS does not apply to — and the task would then sit in a
    // room nobody can see, with no error anywhere.
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(TASK_CATALOG);
    tx.room.findFirst.mockResolvedValue(null);
    await expect(
      withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1', roomId: 'room-x' })),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.orderService.create).not.toHaveBeenCalled();
  });

  it('says where to fix a bad room', async () => {
    const { service, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(TASK_CATALOG);
    tx.room.findFirst.mockResolvedValue(null);
    await expect(
      withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1', roomId: 'room-x' })),
    ).rejects.toThrow(/Settings › Rooms & Stations/);
  });

  it('does not look for a room that was not chosen', async () => {
    const { service, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(TASK_CATALOG);
    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1' }));
    expect(tx.room.findFirst).not.toHaveBeenCalled();
  });
});

describe('a standard service records how many', () => {
  it('stores the quantity the invoice will multiply by', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(SERVICE_CATALOG);
    await withTenant(() =>
      service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-2', quantity: 3 }),
    );
    expect(written(prisma).quantity).toBe(3);
  });

  it('defaults to one rather than to nothing', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(SERVICE_CATALOG);
    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-2' }));
    expect(written(prisma).quantity).toBe(1);
  });

  it('carries no room or urgency — nobody is waiting on a consultation fee', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(SERVICE_CATALOG);
    await withTenant(() =>
      service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-2', roomId: 'room-1', urgency: 'URGENT' }),
    );
    expect(written(prisma).roomId).toBeUndefined();
    expect(written(prisma).urgency).toBeUndefined();
  });

  it('is still created COMPLETED — adding it IS the delivery', async () => {
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue(SERVICE_CATALOG);
    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-2' }));
    expect(written(prisma).status).toBe(OrderServiceStatus.COMPLETED);
  });

  it('decides on the STORED order type, never on the name', async () => {
    // A catalogue entry named "X-Ray" that is configured as a standard service
    // is a standard service. The name is what a clinic types; the type is what
    // it configured.
    const { service, prisma, tx } = createService();
    tx.serviceCatalog.findUnique.mockResolvedValue({ ...SERVICE_CATALOG, name: 'Chest X-Ray' });
    await withTenant(() =>
      service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-2', quantity: 2 }),
    );
    expect(written(prisma).quantity).toBe(2);
    expect(written(prisma).status).toBe(OrderServiceStatus.COMPLETED);
  });
});
