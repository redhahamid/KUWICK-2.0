import {
  CLASSIFICATION_FIELDS,
  storedChangedFields,
  ClassificationField,
  StatutoryClassificationRow,
  classificationDiff,
  resolveClassificationForPayroll,
  resolveEmployerProfileForPayroll,
} from './statutory-classification';

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function row(
  id: string,
  effectiveFrom: string,
  effectiveTo: string | null,
  over: Partial<StatutoryClassificationRow> = {},
): StatutoryClassificationRow {
  return {
    id,
    effectiveFrom: D(effectiveFrom),
    effectiveTo: effectiveTo ? D(effectiveTo) : null,
    epfApplicable: true,
    epfMembership: 'MALAYSIAN_CITIZEN',
    epfEmployeeRate: 11,
    socsoApplicable: true,
    eisApplicable: true,
    lindungParticipation: 'NOT_PARTICIPATING',
    pcbApplicable: true,
    taxResidence: 'RESIDENT',
    pcbCategory: 'CATEGORY_1',
    qualifyingChildren: 0,
    disabledSelf: false,
    disabledSpouse: false,
    restDayOfWeek: 0,
    restDayVaries: false,
    restDayFollowsRoster: false,
    additionalPcbCents: 0,
    additionalPcbNote: null,
    overtimeContractPolicy: null,
    ...over,
  };
}

const MARCH_START = D('2026-03-01');
const MARCH_END = D('2026-03-31');

describe('the field list is the whole standing', () => {
  /*
   * THE ONE TEST THAT KEEPS THE FAIL-SAFE HONEST.
   *
   * A classification added to the row but not to CLASSIFICATION_FIELDS could
   * change mid-period WITHOUT stopping the run: `classificationDiff` would not
   * see it, two overlapping versions would look identical, and the resolver
   * would quietly take the later one. This asserts the two never drift.
   */
  it('names every field on the row except its identity and dates', () => {
    const sample = row('a', '2026-01-01', null);
    const rowKeys = Object.keys(sample).filter((key) => !['id', 'effectiveFrom', 'effectiveTo'].includes(key));
    expect(Object.keys(CLASSIFICATION_FIELDS).sort()).toEqual(rowKeys.sort());
  });

  it('gives every field words a person reads', () => {
    for (const [key, label] of Object.entries(CLASSIFICATION_FIELDS)) {
      expect(label.length).toBeGreaterThan(3);
      expect(label).not.toBe(key);
    }
  });
});

describe('classificationDiff', () => {
  it('is empty for two identical standings recorded on different days', () => {
    expect(classificationDiff(row('a', '2026-01-01', '2026-02-28'), row('b', '2026-03-01', null))).toEqual([]);
  });

  it('names exactly what moved', () => {
    const before = row('a', '2026-01-01', '2026-02-28');
    const after = row('b', '2026-03-01', null, { epfMembership: 'PERMANENT_RESIDENT', qualifyingChildren: 2 });
    expect(classificationDiff(before, after).sort()).toEqual(
      (['epfMembership', 'qualifyingChildren'] as ClassificationField[]).sort(),
    );
  });
});

describe('resolveClassificationForPayroll', () => {
  it('takes the version in force at the period end', () => {
    const out = resolveClassificationForPayroll(
      [row('old', '2024-01-01', '2026-02-28'), row('now', '2026-03-01', null, { qualifyingChildren: 3 })],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind !== 'RESOLVED') return;
    expect(out.row.id).toBe('now');
  });

  it('refuses when the standing changed part-way through the month', () => {
    const out = resolveClassificationForPayroll(
      [
        row('a', '2024-01-01', '2026-03-14'),
        row('b', '2026-03-15', null, { epfMembership: 'PERMANENT_RESIDENT' }),
      ],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('CHANGED_MID_PERIOD');
    if (out.kind !== 'CHANGED_MID_PERIOD') return;
    expect(out.changed).toEqual(['epfMembership']);
    expect(out.changedOn).toEqual(D('2026-03-15'));
    expect(out.reason).toContain('EPF Third Schedule Part');
  });

  it('names every field that moved, not only the first', () => {
    const out = resolveClassificationForPayroll(
      [
        row('a', '2024-01-01', '2026-03-09'),
        row('b', '2026-03-10', null, {
          lindungParticipation: 'ENROLLED',
          restDayOfWeek: 5,
          disabledSpouse: true,
        }),
      ],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('CHANGED_MID_PERIOD');
    if (out.kind !== 'CHANGED_MID_PERIOD') return;
    expect(out.changed.sort()).toEqual(['disabledSpouse', 'lindungParticipation', 'restDayOfWeek']);
  });

  /*
   * The block exists because the MONEY is ambiguous. A version re-recorded
   * mid-month that moved nothing is not ambiguous, and refusing it would stop
   * a payroll over a corrected note.
   */
  it('resolves rather than refuses when two overlapping versions change no figure', () => {
    const out = resolveClassificationForPayroll(
      [row('a', '2024-01-01', '2026-03-14'), row('b', '2026-03-15', null)],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind !== 'RESOLVED') return;
    expect(out.row.id).toBe('b');
    expect(out.reason).toContain('nothing to decide');
  });

  it('says nothing is on record rather than assuming a default', () => {
    const out = resolveClassificationForPayroll([], MARCH_START, MARCH_END);
    expect(out.kind).toBe('NONE_ON_RECORD');
  });

  it('says nothing is on record for a period before the first version starts', () => {
    const out = resolveClassificationForPayroll([row('a', '2026-06-01', null)], MARCH_START, MARCH_END);
    expect(out.kind).toBe('NONE_ON_RECORD');
    expect(out.reason).toContain('No statutory classification');
  });

  it('says so when a version covers part of the month but none covers its end', () => {
    const out = resolveClassificationForPayroll([row('a', '2024-01-01', '2026-03-20')], MARCH_START, MARCH_END);
    expect(out.kind).toBe('NONE_ON_RECORD');
    expect(out.reason).toContain('none was in force at the period end');
  });

  it('treats effectiveFrom and effectiveTo as inclusive days', () => {
    const exactly = resolveClassificationForPayroll(
      [row('a', '2026-03-31', null)],
      MARCH_START,
      MARCH_END,
    );
    expect(exactly.kind).toBe('RESOLVED');

    const endsOnTheLastDay = resolveClassificationForPayroll(
      [row('a', '2024-01-01', '2026-03-31')],
      MARCH_START,
      MARCH_END,
    );
    expect(endsOnTheLastDay.kind).toBe('RESOLVED');
  });

  it('ignores a version that closed before the month began', () => {
    const out = resolveClassificationForPayroll(
      [row('old', '2024-01-01', '2026-02-28'), row('now', '2026-03-01', null)],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind !== 'RESOLVED') return;
    expect(out.row.id).toBe('now');
  });

  it('is not confused by rows arriving out of order', () => {
    const out = resolveClassificationForPayroll(
      [row('now', '2026-03-01', null), row('old', '2024-01-01', '2026-02-28')],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind !== 'RESOLVED') return;
    expect(out.row.id).toBe('now');
  });

  it('refuses across three overlapping versions, naming the last as the change', () => {
    const out = resolveClassificationForPayroll(
      [
        row('a', '2024-01-01', '2026-03-09'),
        row('b', '2026-03-10', '2026-03-19', { qualifyingChildren: 1 }),
        row('c', '2026-03-20', null, { qualifyingChildren: 2 }),
      ],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('CHANGED_MID_PERIOD');
    if (out.kind !== 'CHANGED_MID_PERIOD') return;
    expect(out.overlapping).toHaveLength(3);
    expect(out.next.id).toBe('c');
    expect(out.changedOn).toEqual(D('2026-03-20'));
  });

  /* A 9% election is a real answer, and 0 is not the same as "not recorded". */
  it('keeps an EPF rate election of 0 distinct from an unrecorded one', () => {
    const zero = resolveClassificationForPayroll([row('a', '2024-01-01', null, { epfEmployeeRate: 0 })], MARCH_START, MARCH_END);
    const none = resolveClassificationForPayroll([row('a', '2024-01-01', null, { epfEmployeeRate: null })], MARCH_START, MARCH_END);
    expect(zero.kind).toBe('RESOLVED');
    expect(none.kind).toBe('RESOLVED');
    if (zero.kind !== 'RESOLVED' || none.kind !== 'RESOLVED') return;
    expect(zero.row.epfEmployeeRate).toBe(0);
    expect(none.row.epfEmployeeRate).toBeNull();
  });
});

describe('resolveEmployerProfileForPayroll', () => {
  const employer = (id: string, from: string, to: string | null, hrd: 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED') => ({
    id,
    effectiveFrom: D(from),
    effectiveTo: to ? D(to) : null,
    hrdRegistration: hrd,
  });

  it('takes the class in force at the period end', () => {
    const out = resolveEmployerProfileForPayroll(
      [employer('a', '2024-01-01', '2026-02-28', 'OPTIONAL_SECTION_15'), employer('b', '2026-03-01', null, 'MANDATORY_SECTION_14')],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind !== 'RESOLVED') return;
    expect(out.row.hrdRegistration).toBe('MANDATORY_SECTION_14');
  });

  it('refuses a class that changed part-way through the month', () => {
    const out = resolveEmployerProfileForPayroll(
      [employer('a', '2024-01-01', '2026-03-14', 'OPTIONAL_SECTION_15'), employer('b', '2026-03-15', null, 'MANDATORY_SECTION_14')],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('CHANGED_MID_PERIOD');
  });

  it('does not refuse two overlapping versions in the same class', () => {
    const out = resolveEmployerProfileForPayroll(
      [employer('a', '2024-01-01', '2026-03-14', 'MANDATORY_SECTION_14'), employer('b', '2026-03-15', null, 'MANDATORY_SECTION_14')],
      MARCH_START,
      MARCH_END,
    );
    expect(out.kind).toBe('RESOLVED');
  });

  it('says nothing is on record rather than assuming NOT_REGISTERED', () => {
    expect(resolveEmployerProfileForPayroll([], MARCH_START, MARCH_END).kind).toBe('NONE_ON_RECORD');
  });
});

describe('storedChangedFields', () => {
  it('reads back a list of known field keys, including the empty list of a first version', () => {
    expect(storedChangedFields(['lindungParticipation', 'restDayOfWeek'])).toEqual(['lindungParticipation', 'restDayOfWeek']);
    expect(storedChangedFields([])).toEqual([]);
  });

  it('is null for a row written before the column existed, or for anything but a list of field keys', () => {
    expect(storedChangedFields(null)).toBeNull();
    expect(storedChangedFields(undefined)).toBeNull();
    expect(storedChangedFields('lindungParticipation')).toBeNull();
    expect(storedChangedFields(['lindungParticipation', 'notAField'])).toBeNull();
    expect(storedChangedFields([1])).toBeNull();
  });
});
