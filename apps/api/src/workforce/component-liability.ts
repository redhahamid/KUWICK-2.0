import { ComponentKind, ComponentLiability } from './payroll-calculation';

/**
 * WHAT A COMPONENT IS LIABLE TO — from the catalogue, and only from there.
 *
 * Kuwick had TWO answers to this question and used the wrong one. The clinic
 * configures `pay_components` — effective-dated rows with an independent flag
 * per scheme, a verification status and a source reference — and the payroll
 * calculation read a hardcoded TypeScript map instead. So the screen where a
 * clinic records that an allowance is EPF-exempt drove nothing at all.
 *
 * They also disagreed, in eight places, and two of those changed money:
 *
 *  - ALLOWANCE and ATTENDANCE_ALLOWANCE: the map put them in the ordinary-rate
 *    base and the catalogue did not, which prices overtime differently.
 *  - ZAKAT: the map marked it PCB-liable, so the deduction reduced the taxable
 *    base — and the MTD engine ALSO applies zakat as relief against the
 *    month's tax. RM200 of zakat under-deducted PCB by RM38.00 in the month
 *    tested. Under-deducted tax is the employee's bill at assessment.
 *
 * The catalogue wins because it is the one a person can inspect, date and
 * attach a source to. A hardcoded map cannot carry provenance and cannot be
 * corrected without a deploy.
 */

/** The shape both a Prisma row and a seed row satisfy. */
export interface LiabilityFlags {
  readonly pcbLiable: boolean;
  readonly epfLiable: boolean;
  readonly socsoLiable: boolean;
  readonly eisLiable: boolean;
  readonly includeInOrpBase: boolean;
  readonly additionalRemuneration: boolean;
  readonly hrdLiable: boolean;
}

export function liabilityOf(row: LiabilityFlags): ComponentLiability {
  return {
    epf: row.epfLiable,
    socso: row.socsoLiable,
    eis: row.eisLiable,
    pcb: row.pcbLiable,
    ordinaryRateOfPay: row.includeInOrpBase,
    additionalRemuneration: row.additionalRemuneration,
    hrd: row.hrdLiable,
  };
}

/** A catalogue row as the calculation needs it. */
export interface ResolvedComponent {
  readonly code: string;
  readonly label: string;
  readonly kind: ComponentKind;
  readonly liability: ComponentLiability;
  /** How well the statutory treatment above is evidenced. */
  readonly verification: string;
  readonly sourceRef: string | null;
}

export interface CatalogueRow extends LiabilityFlags {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly includeIn: string;
  readonly active: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly verificationStatus: string;
  readonly sourceRef: string | null;
}

/**
 * WHICH COMPONENTS GOVERN A PERIOD.
 *
 * Effective-dated like everything else statutory: a run over March resolves the
 * treatment in force in March, so correcting a component's EPF liability today
 * cannot silently reprice a month that was already paid. An inactive component
 * is left out rather than resolved, because "we stopped using this" and "this
 * never existed" have the same consequence for a run that meets one.
 *
 * The LATEST row in force wins, so a corrected version supersedes its
 * predecessor without either being deleted.
 */
export function catalogueFor(rows: readonly CatalogueRow[], on: Date): Map<string, ResolvedComponent> {
  const byCode = new Map<string, CatalogueRow>();
  for (const row of rows) {
    if (!row.active) continue;
    if (row.effectiveFrom > on) continue;
    if (row.effectiveTo !== null && row.effectiveTo < on) continue;
    const held = byCode.get(row.code);
    if (!held || row.effectiveFrom > held.effectiveFrom) byCode.set(row.code, row);
  }

  const resolved = new Map<string, ResolvedComponent>();
  for (const [code, row] of byCode) {
    resolved.set(code, {
      code,
      label: row.name,
      kind: kindOf(row),
      liability: liabilityOf(row),
      verification: row.verificationStatus,
      sourceRef: row.sourceRef,
    });
  }
  return resolved;
}

/**
 * WHETHER IT REDUCES THE WAGES OR IS WITHHELD FROM THEM.
 *
 * `includeIn` carries this in the catalogue: NET_ONLY means the wages are whole
 * and something comes out of them; a deduction that reaches GROSS is one that
 * makes the wages smaller — which is what s.18A says a day of unpaid leave
 * does.
 */
function kindOf(row: CatalogueRow): ComponentKind {
  if (row.type !== 'DEDUCTION') return 'EARNING';
  return row.includeIn === 'NET_ONLY' ? 'DEDUCTION' : 'WAGE_REDUCTION';
}

/**
 * THE ORDINARY-RATE BASE IS STILL THE CONTRACTUAL MONTHLY WAGE, and this says
 * so out loud rather than letting a flag drift away from the code.
 *
 * s.60I(1A) builds the rate from the monthly wage, not from what this
 * particular month happened to pay — otherwise a joiner's first month of
 * overtime is cheaper than every month after it. The run therefore takes the
 * full monthly salary as the base and does NOT assemble it from component
 * lines.
 *
 * That is only correct while BASIC is the sole component marked
 * `includeInOrpBase`. The moment a clinic marks an allowance as part of the
 * ordinary rate, the base has to be built from the employee's CONTRACTUAL
 * recurring components instead — work this system has not done. Returns the
 * reason it is unsafe, or null.
 */
export function checkOrdinaryRateBase(catalogue: Map<string, ResolvedComponent>): string | null {
  const inBase = [...catalogue.values()]
    .filter((component) => component.liability.ordinaryRateOfPay)
    .map((component) => component.code)
    .sort();
  if (inBase.length === 1 && inBase[0] === 'BASIC') return null;
  return (
    `The ordinary rate of pay is built from the contractual monthly salary alone, but the pay component ` +
    `catalogue marks ${inBase.join(', ') || 'nothing'} as part of that base. Until Kuwick assembles the base from ` +
    `an employee's recurring contractual components, marking anything other than basic pay would price overtime ` +
    `from a figure the run does not actually use.`
  );
}
