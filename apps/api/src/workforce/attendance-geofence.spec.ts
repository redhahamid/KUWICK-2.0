import { distanceMetres, isPlausiblePoint, judgeGeofence } from './attendance-geofence';

// Two known points in Kuala Lumpur: KLCC and the Masjid Jamek LRT, about
// 2.1 km apart on the map.
const KLCC = { lat: 3.1579, lng: 101.7116 };
const MASJID_JAMEK = { lat: 3.1494, lng: 101.6963 };

describe('the geofence', () => {
  it('measures the distance between two points in metres', () => {
    const d = distanceMetres(KLCC, MASJID_JAMEK);
    expect(d).toBeGreaterThan(1900);
    expect(d).toBeLessThan(2300);
    expect(distanceMetres(KLCC, KLCC)).toBe(0);
  });

  it('flags a punch beyond the radius, and only then', () => {
    const fence = { lat: KLCC.lat, lng: KLCC.lng, radiusMetres: 150 };
    // 100 m north: inside.
    expect(judgeGeofence({ lat: KLCC.lat + 0.0009, lng: KLCC.lng }, fence)).toEqual({ distanceMetres: 100, outside: false });
    // 2 km away: outside.
    const far = judgeGeofence(MASJID_JAMEK, fence);
    expect(far.outside).toBe(true);
    expect(far.distanceMetres).toBeGreaterThan(1900);
  });

  it('judges nothing when the branch has no point or the phone gave none', () => {
    expect(judgeGeofence(MASJID_JAMEK, { lat: null, lng: null, radiusMetres: 150 })).toEqual({ distanceMetres: null, outside: false });
    expect(judgeGeofence(null, { lat: KLCC.lat, lng: KLCC.lng, radiusMetres: 150 })).toEqual({ distanceMetres: null, outside: false });
    expect(judgeGeofence(MASJID_JAMEK, null)).toEqual({ distanceMetres: null, outside: false });
  });

  it('refuses a position that cannot be on the planet', () => {
    expect(isPlausiblePoint(3.1, 101.7)).toBe(true);
    expect(isPlausiblePoint(91, 0)).toBe(false);
    expect(isPlausiblePoint(Number.NaN, 0)).toBe(false);
    expect(isPlausiblePoint('3.1', 101.7)).toBe(false);
  });
});
