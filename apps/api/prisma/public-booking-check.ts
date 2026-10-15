/**
 * ONE-OFF: CAN A PATIENT STILL BOOK ONLINE ON STAGING? (owner's decision 6,
 * 15 October 2026).
 *
 * Does what a patient's browser does, against the running API: opens a
 * clinic's public booking page, picks its first service and the first free
 * time in the next 14 days, books it as a made-up test patient, then cancels
 * it through the patient's own manage link, so the day's real schedule is left
 * as it was (the booking stays on record as CANCELLED).
 *
 * Only pages of tenants whose name says UAT, Contoh or Demo are used: a real
 * clinic's page is never booked into. Prints no personal data.
 *
 * Environment: DATABASE_URL (to find the page slugs), API_URL,
 * BOOKING_APPLY=true to book and cancel (else it stops before booking).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const SYNTHETIC = /uat|contoh|demo/i;

async function json<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }
  return { status: res.status, body: body as T };
}

async function main() {
  const url = process.env.DATABASE_URL;
  const api = (process.env.API_URL ?? '').replace(/\/$/, '');
  const apply = process.env.BOOKING_APPLY === 'true';
  if (!url || !api) throw new Error('DATABASE_URL and API_URL are required.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const pages = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRaw<{ slug: string; tenant: string; active: boolean }[]>`
      SELECT p.slug, t.name AS tenant, p.active FROM clinic_booking_pages p JOIN tenants t ON t.id = p.tenant_id ORDER BY t.name`;
  });
  await prisma.$disconnect();
  console.log(`Booking pages on this database: ${pages.length} (${pages.filter((p) => p.active).length} turned on).`);
  const usable = pages.filter((p) => p.active && SYNTHETIC.test(p.tenant));
  console.log(`Synthetic pages that are turned on: ${usable.map((p) => `${p.tenant} → /book/${p.slug}`).join('; ') || 'none'}`);
  if (usable.length === 0) throw new Error('No synthetic booking page is turned on, so there is nothing safe to book into.');

  for (const page of usable) {
    const opened = await json<{ services?: { id: string; name: string; durationMinutes?: number | null }[] }>(`${api}/public/booking/${page.slug}`);
    console.log(`\n${page.tenant}: page answered ${opened.status}, ${opened.body.services?.length ?? 0} service(s) offered.`);
    const service = opened.body.services?.[0];
    if (opened.status !== 200 || !service) continue;
    let slot: { start: string; staffId: string } | null = null;
    for (let day = 1; day <= 14 && !slot; day += 1) {
      const date = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
      const found = await json<{ slots?: { start: string; staffId: string }[] }>(`${api}/public/booking/${page.slug}/availability?serviceId=${service.id}&date=${date}`);
      if (found.status === 200 && found.body.slots?.length) slot = found.body.slots[0];
    }
    if (!slot) {
      console.log(`  No free time in the next 14 days for "${service.name}". Booking cannot be tested on this page.`);
      continue;
    }
    console.log(`  First free time for "${service.name}": ${slot.start}.`);
    if (!apply) {
      console.log('  DRY RUN: stopping before booking.');
      return;
    }
    const start = new Date(slot.start);
    const end = new Date(start.getTime() + (service.durationMinutes ?? 15) * 60_000);
    const booked = await json<{ appointmentId?: string; manageToken?: string | null; message?: unknown }>(`${api}/public/booking/${page.slug}/book`, {
      method: 'POST',
      body: JSON.stringify({
        serviceId: service.id,
        staffId: slot.staffId,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        name: 'Ujian Tempahan Kuwick (Synthetic)',
        phone: '0190000000',
        reason: 'Automated booking check; cancelled straight away',
        idempotencyKey: `booking-check-${Date.now()}`,
      }),
    });
    console.log(`  Booking answered ${booked.status}${booked.body.manageToken ? ', with a manage link' : ''}.`);
    if (booked.status >= 300) {
      console.log(`  Refused: ${JSON.stringify(booked.body.message ?? booked.body).slice(0, 300)}`);
      throw new Error('A patient could not book online.');
    }
    if (booked.body.manageToken) {
      const cancelled = await json(`${api}/public/booking/${page.slug}/manage/${booked.body.manageToken}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Automated booking check' }),
      });
      console.log(`  Cancelled through the manage link: ${cancelled.status}.`);
    } else {
      console.log('  No manage link came back, so it was not cancelled: cancel it at the front desk.');
    }
    console.log('RESULT: online booking works on this server.');
    return;
  }
  throw new Error('No synthetic page offered a bookable time, so online booking could not be tested.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
