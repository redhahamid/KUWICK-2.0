import { AppointmentCommunicationService } from './appointment-communication.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';

// ===========================================================================
// PHASE 8 — THE REMINDER WORKLIST TELLS THE TRUTH.
//
// `due()` is the honest half of "automated reminders": a worklist the counter
// works through by hand, not a claim that anything was sent. What these pin
// is the CLEARING rule — the worklist must stop showing a patient once
// somebody reminded them, whichever button they used, or the counter learns
// to ignore it.
// ===========================================================================

const START = new Date('2026-09-01T02:00:00.000Z'); // 10:00 KL
const NOW = new Date('2026-09-01T01:00:00.000Z'); // one hour before

function build(world: {
  rules?: { offsetMinutes: number; serviceId?: string | null }[];
  communications?: { template: string; sentAt: Date | null }[];
}) {
  const prisma = {
    appointmentReminderRule: {
      findMany: jest.fn(async () =>
        (world.rules ?? [{ offsetMinutes: 120 }]).map((rule, index) => ({
          id: `rule-${index}`,
          offsetMinutes: rule.offsetMinutes,
          serviceId: rule.serviceId ?? null,
          channel: 'WHATSAPP',
          active: true,
        })),
      ),
    },
    appointment: {
      findMany: jest.fn(async () => [
        {
          id: 'appt-1',
          serviceId: 'svc-1',
          scheduledStart: START,
          patient: { id: 'pat-1', name: 'Ahmad', phone: '0123456789' },
          service: { id: 'svc-1', name: 'Consultation', preInstructions: null },
          staff: { fullName: 'Dr Redha' },
          communications: world.communications ?? [],
        },
      ]),
    },
  } as unknown as TenantScopedPrismaClient;

  const service = new AppointmentCommunicationService(prisma, {} as PrismaService);
  return { service };
}

describe('what the worklist clears on', () => {
  it('1. with nothing sent, a due rule surfaces the appointment with its worklist template key', async () => {
    const ctx = build({});

    const rows = await ctx.service.due('clinic-1', NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ appointmentId: 'appt-1', template: 'REMINDER_120' });
  });

  it("2. the worklist's own send clears it (exact template key)", async () => {
    const ctx = build({
      communications: [{ template: 'REMINDER_120', sentAt: new Date('2026-09-01T00:30:00.000Z') }],
    });

    expect(await ctx.service.due('clinic-1', NOW)).toHaveLength(0);
  });

  it('3. a reminder sent from the DRAWER after the rule came due also clears it', async () => {
    // The drawer logs REMINDER (or the legacy REMINDER_MANUAL) — a different
    // key. The patient was still reminded, and showing them on the worklist
    // anyway is how the counter learns the worklist lies.
    const ctx = build({
      communications: [{ template: 'REMINDER', sentAt: new Date('2026-09-01T00:30:00.000Z') }],
    });

    expect(await ctx.service.due('clinic-1', NOW)).toHaveLength(0);
  });

  it('4. a reminder sent DAYS before the window does not clear it — the rule wants a nudge near the time', async () => {
    const ctx = build({
      communications: [{ template: 'REMINDER_MANUAL', sentAt: new Date('2026-08-25T03:00:00.000Z') }],
    });

    const rows = await ctx.service.due('clinic-1', NOW);

    expect(rows).toHaveLength(1);
  });

  it('5. a rule that is not yet due stays off the list entirely', async () => {
    const ctx = build({ rules: [{ offsetMinutes: 30 }] });

    expect(await ctx.service.due('clinic-1', NOW)).toHaveLength(0);
  });

  it('6. a service-specific rule REPLACES the clinic-wide one for that service', async () => {
    const ctx = build({
      rules: [{ offsetMinutes: 120 }, { offsetMinutes: 60, serviceId: 'svc-1' }],
    });

    const rows = await ctx.service.due('clinic-1', NOW);

    // Only the specific 60-minute rule applies, and at NOW (60 min before
    // start… exactly at its boundary) it is due.
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe('REMINDER_60');
  });
});
