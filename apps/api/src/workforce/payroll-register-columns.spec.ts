import { columnItems, itemAppliesTo, placeOnRegister } from './payroll-register-columns';

/**
 * WHO AN ITEM IS FOR, decided once for the grid, the drawer, the save route
 * and the month start. An item is for everybody unless it names its people;
 * then it is for them alone, and somebody else's line for it is still paid,
 * in Other income, rather than in a column that is not theirs.
 */
const item = (over: Record<string, unknown> = {}) => ({
  code: 'DIRECTOR_FEE',
  name: "Director's fee",
  type: 'ADDITION',
  includeIn: 'GROSS_AND_NET',
  gridColumn: true,
  carryForward: true,
  active: true,
  ...over,
});

describe('who a payroll item is for', () => {
  it('is everybody when the item names nobody, or when nobody is asking', () => {
    expect(itemAppliesTo(undefined, 'staff-a')).toBe(true);
    expect(itemAppliesTo({ appliesTo: 'EVERYONE', appliesToStaffIds: [] }, 'staff-a')).toBe(true);
    expect(itemAppliesTo({ appliesTo: 'SELECTED', appliesToStaffIds: ['staff-b'] }, undefined)).toBe(true);
  });

  it('is the named people alone once the item names them', () => {
    const audience = { appliesTo: 'SELECTED', appliesToStaffIds: ['staff-a', 'staff-c'] };
    expect(itemAppliesTo(audience, 'staff-a')).toBe(true);
    expect(itemAppliesTo(audience, 'staff-b')).toBe(false);
    expect(itemAppliesTo({ appliesTo: 'SELECTED' }, 'staff-a')).toBe(false);
  });

  it('is carried on the column the grid reads, defaulting to everybody', () => {
    const [everyone] = columnItems([item()]);
    const [selected] = columnItems([item({ appliesTo: 'SELECTED', appliesToStaffIds: ['staff-a'] })]);
    expect(everyone.appliesTo).toBe('EVERYONE');
    expect(selected.appliesTo).toBe('SELECTED');
  });

  it("places a stranger's line in Other income, and one of the named people's in the column", () => {
    const selected = item({ appliesTo: 'SELECTED', appliesToStaffIds: ['staff-a'] });
    expect(placeOnRegister({ componentCode: 'DIRECTOR_FEE', source: 'MANUAL', staffId: 'staff-a' }, selected)).toEqual({ bucket: 'OWN_COLUMN', column: "Director's fee" });
    expect(placeOnRegister({ componentCode: 'DIRECTOR_FEE', source: 'MANUAL', staffId: 'staff-b' }, selected)).toEqual({ bucket: 'OTHER_INCOME', column: 'Other income' });
    // A reader with no person in mind gets the column: the item does have one.
    expect(placeOnRegister({ componentCode: 'DIRECTOR_FEE', source: 'MANUAL' }, selected)).toEqual({ bucket: 'OWN_COLUMN', column: "Director's fee" });
  });
});
