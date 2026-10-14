import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * THE KIOSK CODE (UAT, 14 October 2026): "a QR that changes every 30 s …
 * old/screenshot QR must fail."
 *
 * The code names the branch and a time slot, signed with the server's secret,
 * so nobody can make one and an old one names a slot that has passed. Nothing
 * is stored: the server checks the signature and the slot when it is scanned.
 */
const PREFIX = 'KWK1';
/** A slow phone gets a few seconds after the code on screen has changed. */
export const QR_GRACE_SECONDS = 5;

function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value) throw new Error('JWT_ACCESS_SECRET is not set, so kiosk codes cannot be signed.');
  return `kiosk:${value}`;
}

function signature(clinicId: string, slot: number): string {
  return createHmac('sha256', secret()).update(`${clinicId}.${slot}`).digest('hex').slice(0, 20);
}

export function slotOf(at: Date, periodSeconds: number): number {
  return Math.floor(at.getTime() / 1000 / periodSeconds);
}

/** The code the kiosk shows now, and when it stops being shown. */
export function kioskCode(clinicId: string, at: Date, periodSeconds: number) {
  const slot = slotOf(at, periodSeconds);
  return {
    code: `${PREFIX}.${clinicId}.${slot}.${signature(clinicId, slot)}`,
    expiresAt: new Date((slot + 1) * periodSeconds * 1000).toISOString(),
  };
}

/**
 * The branch a scanned code is for, or why it is refused. Accepted in its own
 * slot, and in the slot just gone for QR_GRACE_SECONDS.
 */
export function readKioskCode(text: string, at: Date, periodSeconds: number): { clinicId: string } | { refused: string } {
  const parts = text.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return { refused: 'That is not a Kuwick attendance code.' };
  const [, clinicId, slotText, sig] = parts;
  const slot = Number(slotText);
  const expected = Buffer.from(signature(clinicId, slot));
  if (!Number.isInteger(slot) || expected.length !== Buffer.from(sig).length || !timingSafeEqual(expected, Buffer.from(sig))) {
    return { refused: 'That code is not genuine. Scan the code on the clinic screen.' };
  }
  const now = slotOf(at, periodSeconds);
  const intoSlot = at.getTime() / 1000 - now * periodSeconds;
  const fresh = slot === now || (slot === now - 1 && intoSlot <= QR_GRACE_SECONDS);
  if (!fresh) return { refused: 'That code has expired. Scan the code on the clinic screen now, not a photo of it.' };
  return { clinicId };
}

/** Whether a request's address is one of the clinic's networks (exact, or a prefix such as "203.106.12."). */
export function onClinicNetwork(ip: string | null | undefined, networks: string[]): boolean {
  if (!ip || networks.length === 0) return false;
  const address = ip.replace(/^::ffff:/, '');
  return networks.some((entry) => (entry.endsWith('.') || entry.endsWith(':') ? address.startsWith(entry) : address === entry));
}

/**
 * The phone's internet address as the clinic's router sees it, for the
 * clinic-WiFi check. Behind the host's proxy that is the first forwarded hop.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.ip || null;
}
