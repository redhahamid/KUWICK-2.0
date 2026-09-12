/**
 * WHERE THE PHONE SAID IT WAS, AGAINST WHERE THE BRANCH IS.
 *
 * Phase 1 of portal clock-in (prompt §7): the punch carries the phone's
 * position; the attendance policy carries the branch's point and a radius.
 * Outside the radius the record is still saved — a person who is late to a
 * home visit is not a person who did not work — and the manager sees the
 * flag on the timesheet. No point on the policy means nothing is judged.
 *
 * Haversine on a spherical earth: accurate to well under a metre at the
 * distances a geofence is about, which is the accuracy of the phone anyway.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface GeofenceVerdict {
  /** Metres from the branch's point; null when either side is unknown. */
  distanceMetres: number | null;
  /** True only when both sides were known and the punch lay beyond the radius. */
  outside: boolean;
}

export function judgeGeofence(
  punch: GeoPoint | null | undefined,
  fence: { lat: number | null | undefined; lng: number | null | undefined; radiusMetres: number } | null | undefined,
): GeofenceVerdict {
  if (!punch || !fence || fence.lat === null || fence.lat === undefined || fence.lng === null || fence.lng === undefined) {
    return { distanceMetres: null, outside: false };
  }
  const distance = distanceMetres(punch, { lat: Number(fence.lat), lng: Number(fence.lng) });
  return { distanceMetres: distance, outside: distance > fence.radiusMetres };
}

/** A latitude/longitude pair the phone can plausibly have reported. */
export function isPlausiblePoint(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}
