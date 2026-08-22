import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DEFAULT_MESSAGE_TEMPLATES,
  MESSAGE_LANGUAGES,
  MESSAGE_PLACEHOLDERS,
  MESSAGE_TEMPLATE_KEYS,
  MessageTemplateService,
  placeholdersIn,
} from './message-template.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// PHASE 8 — THE CLINIC'S OWN WORDS, UNDER CONTRACT.
//
// The contract that keeps "appointment at on" dead has three legs: the
// defaults only speak through known placeholders, the server refuses to store
// a placeholder it does not know, and reset-to-default is a DELETE rather
// than a copy. Each leg is a pin here; the renderer's leg is pinned in the
// web suite (appointmentMessages.test.ts).
// ===========================================================================

function build(world: { stored?: Record<string, unknown>[]; role?: string } = {}) {
  const stored = world.stored ?? [];
  const writes: { kind: string; args: unknown }[] = [];

  const tx = {
    staff: {
      findUnique: jest.fn(async () => ({
        id: 'staff-1',
        fullName: 'Sarah',
        role: world.role ?? 'OWNER_ADMIN',
        active: true,
        clinicId: 'clinic-1',
      })),
    },
    staffRoleAssignment: { findMany: jest.fn(async () => []) },
    staffPermissionGrant: { findMany: jest.fn(async () => []) },
    appointmentMessageTemplate: {
      findMany: jest.fn(async () => stored),
      findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const row = stored.find(
          (candidate) =>
            candidate.templateKey === args.where.templateKey &&
            candidate.language === args.where.language,
        );
        return row ?? null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        writes.push({ kind: 'create', args });
        stored.push(args.data);
        return args.data;
      }),
      update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        writes.push({ kind: 'update', args });
        const row = stored[0];
        if (row) Object.assign(row, args.data);
        return args.data;
      }),
      deleteMany: jest.fn(async (args: unknown) => {
        writes.push({ kind: 'delete', args });
        stored.length = 0;
        return { count: 1 };
      }),
    },
    $executeRaw: jest.fn(async () => 1),
  };

  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const service = new MessageTemplateService(rawPrisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-1', userId: 'u1' }, fn);

  return { service, tx, writes, run };
}

describe('the default vocabulary is complete and lawful', () => {
  it('1. every message type exists in both languages, non-empty, and uses only known placeholders', () => {
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      for (const language of MESSAGE_LANGUAGES) {
        const body = DEFAULT_MESSAGE_TEMPLATES[key][language];
        expect(body.trim().length).toBeGreaterThan(0);
        for (const token of placeholdersIn(body)) {
          expect(MESSAGE_PLACEHOLDERS).toContain(token);
        }
      }
    }
  });

  it('2. the two facts that can be absent sit on their own lines in every default that mentions them', () => {
    // The renderer omits a whole LINE when its placeholder has no value. That
    // only reads well if {manage_booking_link} and {clinic_phone} never share
    // a line with anything else the message needs.
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      for (const language of MESSAGE_LANGUAGES) {
        for (const line of DEFAULT_MESSAGE_TEMPLATES[key][language].split('\n')) {
          const optional = placeholdersIn(line).filter(
            (token) => token === 'manage_booking_link' || token === 'clinic_phone',
          );
          if (optional.length > 0) {
            const guaranteed = placeholdersIn(line).filter(
              (token) => token !== 'manage_booking_link' && token !== 'clinic_phone',
            );
            expect(guaranteed).toEqual([]);
          }
        }
      }
    }
  });
});

describe('list merges the clinic over the defaults', () => {
  it('3. an uncustomised clinic gets 18 defaults; a stored row replaces exactly its pair', async () => {
    const ctx = build({
      stored: [
        {
          templateKey: 'REMINDER',
          language: 'en',
          body: 'Salam {patient_name}, see you {appointment_date} {appointment_time}.',
          updatedAt: new Date('2026-08-22T01:00:00.000Z'),
        },
      ],
    });

    const result = await ctx.run(() => ctx.service.list('clinic-1'));

    expect(result.templates).toHaveLength(MESSAGE_TEMPLATE_KEYS.length * MESSAGE_LANGUAGES.length);
    const reminderEn = result.templates.find(
      (row) => row.templateKey === 'REMINDER' && row.language === 'en',
    );
    expect(reminderEn?.isCustom).toBe(true);
    expect(reminderEn?.body).toContain('Salam {patient_name}');
    const reminderMs = result.templates.find(
      (row) => row.templateKey === 'REMINDER' && row.language === 'ms',
    );
    expect(reminderMs?.isCustom).toBe(false);
    expect(reminderMs?.body).toBe(DEFAULT_MESSAGE_TEMPLATES.REMINDER.ms);
    // The screen renders the server's placeholder contract, not its own copy.
    expect(result.placeholders).toEqual(MESSAGE_PLACEHOLDERS);
  });
});

describe('upsert enforces the placeholder contract', () => {
  it('4. an unknown placeholder is refused BY NAME, with the real list offered', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upsert({
          clinicId: 'clinic-1',
          templateKey: 'REMINDER',
          language: 'en',
          body: 'Hi {patient}, reminder for {appointment_date}.',
        }),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: expect.stringContaining('{patient}'),
    });
    expect(ctx.writes).toHaveLength(0);
  });

  it('5. an empty body is refused and points at Reset instead', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upsert({
          clinicId: 'clinic-1',
          templateKey: 'REMINDER',
          language: 'en',
          body: '   ',
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringMatching(/reset to default/i) });
  });

  it('6. a lawful body is stored normalised (CRLF → LF, trimmed) and reported custom', async () => {
    const ctx = build();

    const result = await ctx.run(() =>
      ctx.service.upsert({
        clinicId: 'clinic-1',
        templateKey: 'BOOKING_CONFIRMATION',
        language: 'ms',
        body: '  Hai {patient_name}!\r\nJumpa {appointment_date}.  ',
      }),
    );

    expect(result.isCustom).toBe(true);
    expect(result.body).toBe('Hai {patient_name}!\nJumpa {appointment_date}.');
  });

  it('7. body null DELETES the override — reset is a delete, never a copy of stale text', async () => {
    const ctx = build({
      stored: [
        {
          templateKey: 'REMINDER',
          language: 'en',
          body: 'old custom words',
          updatedAt: new Date(),
        },
      ],
    });

    const result = await ctx.run(() =>
      ctx.service.upsert({
        clinicId: 'clinic-1',
        templateKey: 'REMINDER',
        language: 'en',
        body: null,
      }),
    );

    expect(ctx.writes[0]?.kind).toBe('delete');
    expect(result.isCustom).toBe(false);
    expect(result.body).toBe(DEFAULT_MESSAGE_TEMPLATES.REMINDER.en);
  });
});

describe('who may touch the clinic’s words', () => {
  it('8. the front desk may READ templates (it sends the messages) but not REWRITE them', async () => {
    const reader = build({ role: 'FRONT_DESK_CLINICAL_STAFF' });
    const listed = await reader.run(() => reader.service.list('clinic-1'));
    expect(listed.templates.length).toBeGreaterThan(0);

    const writer = build({ role: 'FRONT_DESK_CLINICAL_STAFF' });
    await expect(
      writer.run(() =>
        writer.service.upsert({
          clinicId: 'clinic-1',
          templateKey: 'REMINDER',
          language: 'en',
          body: 'Hi {patient_name}.',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
