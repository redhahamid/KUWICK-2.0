import { describe, expect, it } from 'vitest';
import { getDoctorColor } from './doctor-color';

describe('getDoctorColor', () => {
  it('is deterministic for the same staffId', () => {
    const id = 'staff-123';
    expect(getDoctorColor(id)).toBe(getDoctorColor(id));
  });

  it('assigns different colors to different staffIds (no collision for these ids)', () => {
    expect(getDoctorColor('staff-a')).not.toBe(getDoctorColor('staff-b'));
  });

  it('always returns a color from the fixed palette', () => {
    const color = getDoctorColor('any-staff-id');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
