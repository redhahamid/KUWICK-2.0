/**
 * PERKESO — EMPLOYMENT INSURANCE SYSTEM (ACT 800).
 *
 * SOURCE (Tier A): Rate of Contribution — Employment Insurance System
 * (Act 800). Supplied by the account holder as
 * `151124Rate_Contribution_ACT_800.pdf`.
 *
 * A SEPARATE ACT AND A SEPARATE ELIGIBILITY TEST.
 *
 * EIS is not a limb of SOCSO. It has its own Act, its own schedule and its own
 * eligibility, and an employee inside Act 4 is not automatically inside Act
 * 800. They are modelled apart for that reason, not for tidiness.
 *
 * Employer and employee pay the SAME amount in every band. That is a property
 * of this schedule, and the tests assert it rather than the code assuming it.
 *
 * Bands are in CENTS, `from` exclusive and `to` inclusive, matching the
 * document's wording. The first band ("Wages up to RM30") includes its lower
 * end. The ceiling is RM6,000: above it, the RM6,000 figures apply unchanged.
 */

/** [fromCents, toCents | null, employerCents, employeeCents] */
export type EisBand = readonly [number, number | null, number, number];

/** Wages above this take the last band's figures unchanged. */
export const EIS_WAGE_CEILING_CENTS = 600_000;

export const EIS_BANDS: readonly EisBand[] = [
  [0, 3000, 5, 5],
  [3000, 5000, 10, 10],
  [5000, 7000, 15, 15],
  [7000, 10000, 20, 20],
  [10000, 14000, 25, 25],
  [14000, 20000, 35, 35],
  [20000, 30000, 50, 50],
  [30000, 40000, 70, 70],
  [40000, 50000, 90, 90],
  [50000, 60000, 110, 110],
  [60000, 70000, 130, 130],
  [70000, 80000, 150, 150],
  [80000, 90000, 170, 170],
  [90000, 100000, 190, 190],
  [100000, 110000, 210, 210],
  [110000, 120000, 230, 230],
  [120000, 130000, 250, 250],
  [130000, 140000, 270, 270],
  [140000, 150000, 290, 290],
  [150000, 160000, 310, 310],
  [160000, 170000, 330, 330],
  [170000, 180000, 350, 350],
  [180000, 190000, 370, 370],
  [190000, 200000, 390, 390],
  [200000, 210000, 410, 410],
  [210000, 220000, 430, 430],
  [220000, 230000, 450, 450],
  [230000, 240000, 470, 470],
  [240000, 250000, 490, 490],
  [250000, 260000, 510, 510],
  [260000, 270000, 530, 530],
  [270000, 280000, 550, 550],
  [280000, 290000, 570, 570],
  [290000, 300000, 590, 590],
  [300000, 310000, 610, 610],
  [310000, 320000, 630, 630],
  [320000, 330000, 650, 650],
  [330000, 340000, 670, 670],
  [340000, 350000, 690, 690],
  [350000, 360000, 710, 710],
  [360000, 370000, 730, 730],
  [370000, 380000, 750, 750],
  [380000, 390000, 770, 770],
  [390000, 400000, 790, 790],
  [400000, 410000, 810, 810],
  [410000, 420000, 830, 830],
  [420000, 430000, 850, 850],
  [430000, 440000, 870, 870],
  [440000, 450000, 890, 890],
  [450000, 460000, 910, 910],
  [460000, 470000, 930, 930],
  [470000, 480000, 950, 950],
  [480000, 490000, 970, 970],
  [490000, 500000, 990, 990],
  [500000, 510000, 1010, 1010],
  [510000, 520000, 1030, 1030],
  [520000, 530000, 1050, 1050],
  [530000, 540000, 1070, 1070],
  [540000, 550000, 1090, 1090],
  [550000, 560000, 1110, 1110],
  [560000, 570000, 1130, 1130],
  [570000, 580000, 1150, 1150],
  [580000, 590000, 1170, 1170],
  [590000, 600000, 1190, 1190],
  [600000, null, 1190, 1190],
] as const;
