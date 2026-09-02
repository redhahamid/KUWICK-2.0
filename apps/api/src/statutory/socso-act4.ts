/**
 * PERKESO — ACT 4 CONTRIBUTIONS, INCLUDING THE NON-EMPLOYMENT INJURY SCHEME.
 *
 * SOURCE (Tier A): Employees' Social Security Act 1969 (Act 4) — New
 * Contribution Rate Including the Non-Employment Injury Security Scheme
 * (SKBBK). Supplied by the account holder as
 * `NewContributionRateIncludingSKBBK.pdf`.
 *
 * "SOCSO" IS NOT ONE THING, and this table is why.
 *
 * The document sets out THREE schemes whose money moves differently:
 *
 *   * Employment Injury — employer only.
 *   * Invalidity — employer and employee, First Category only.
 *   * Non-Employment Injury (SKBBK) — employer and employee, BOTH categories.
 *
 * The employee's share is therefore two separate figures in the First
 * Category and one in the Second, and the document prints them in separate
 * columns. A single `socsoApplicable` boolean cannot represent an employee who
 * is in one scheme and not another, and a single employee-share number cannot
 * be split back out for a submission that reports the schemes separately.
 *
 * CATEGORY is the document's own division:
 *   * First Category  — Employment Injury + Invalidity + Non-Employment Injury.
 *   * Second Category — Employment Injury + Non-Employment Injury.
 *
 * Note what changed with SKBBK: the Second Category employee share used to be
 * nil, and is not any more. An implementation carrying "second category means
 * the employee pays nothing" is now wrong.
 *
 * Bands are in CENTS. The last band has no upper bound: the ceiling is
 * RM6,000 of wages, above which the RM6,000 figures apply unchanged.
 */

/**
 * [fromCents, toCents | null, cat1EmployerCents, cat1EmployeeInvalidityCents,
 *  cat1EmployeeNonInjuryCents, cat2EmployerCents, cat2EmployeeNonInjuryCents]
 *
 * `from` is EXCLUSIVE and `to` INCLUSIVE, matching the document's wording
 * ("Where wages exceed RM30 but do not exceed RM50"). The first band is the
 * exception — "Wages up to RM30" includes its lower end.
 */
export type SocsoBand = readonly [number, number | null, number, number, number, number, number];

/** Wages above this take the last band's figures unchanged. */
export const SOCSO_WAGE_CEILING_CENTS = 600_000;

export const SOCSO_BANDS: readonly SocsoBand[] = [
  [0, 3000, 40, 10, 20, 30, 20],
  [3000, 5000, 70, 20, 30, 50, 30],
  [5000, 7000, 110, 30, 50, 80, 50],
  [7000, 10000, 150, 40, 65, 110, 65],
  [10000, 14000, 210, 60, 90, 150, 90],
  [14000, 20000, 295, 85, 125, 210, 125],
  [20000, 30000, 435, 125, 185, 310, 185],
  [30000, 40000, 615, 175, 265, 440, 265],
  [40000, 50000, 785, 225, 335, 560, 335],
  [50000, 60000, 965, 275, 415, 690, 415],
  [60000, 70000, 1135, 325, 485, 810, 485],
  [70000, 80000, 1315, 375, 565, 940, 565],
  [80000, 90000, 1485, 425, 635, 1060, 635],
  [90000, 100000, 1665, 475, 715, 1190, 715],
  [100000, 110000, 1835, 525, 785, 1310, 785],
  [110000, 120000, 2015, 575, 865, 1440, 865],
  [120000, 130000, 2185, 625, 935, 1560, 935],
  [130000, 140000, 2365, 675, 1015, 1690, 1015],
  [140000, 150000, 2535, 725, 1085, 1810, 1085],
  [150000, 160000, 2715, 775, 1165, 1940, 1165],
  [160000, 170000, 2885, 825, 1235, 2060, 1235],
  [170000, 180000, 3065, 875, 1315, 2190, 1315],
  [180000, 190000, 3235, 925, 1385, 2310, 1385],
  [190000, 200000, 3415, 975, 1465, 2440, 1465],
  [200000, 210000, 3585, 1025, 1535, 2560, 1535],
  [210000, 220000, 3765, 1075, 1615, 2690, 1615],
  [220000, 230000, 3935, 1125, 1685, 2810, 1685],
  [230000, 240000, 4115, 1175, 1765, 2940, 1765],
  [240000, 250000, 4285, 1225, 1835, 3060, 1835],
  [250000, 260000, 4465, 1275, 1915, 3190, 1915],
  [260000, 270000, 4635, 1325, 1985, 3310, 1985],
  [270000, 280000, 4815, 1375, 2065, 3440, 2065],
  [280000, 290000, 4985, 1425, 2135, 3560, 2135],
  [290000, 300000, 5165, 1475, 2215, 3690, 2215],
  [300000, 310000, 5335, 1525, 2285, 3810, 2285],
  [310000, 320000, 5515, 1575, 2365, 3940, 2365],
  [320000, 330000, 5685, 1625, 2435, 4060, 2435],
  [330000, 340000, 5865, 1675, 2515, 4190, 2515],
  [340000, 350000, 6035, 1725, 2585, 4310, 2585],
  [350000, 360000, 6215, 1775, 2665, 4440, 2665],
  [360000, 370000, 6385, 1825, 2735, 4560, 2735],
  [370000, 380000, 6565, 1875, 2815, 4690, 2815],
  [380000, 390000, 6735, 1925, 2885, 4810, 2885],
  [390000, 400000, 6915, 1975, 2965, 4940, 2965],
  [400000, 410000, 7085, 2025, 3035, 5060, 3035],
  [410000, 420000, 7265, 2075, 3115, 5190, 3115],
  [420000, 430000, 7435, 2125, 3185, 5310, 3185],
  [430000, 440000, 7615, 2175, 3265, 5440, 3265],
  [440000, 450000, 7785, 2225, 3335, 5560, 3335],
  [450000, 460000, 7965, 2275, 3415, 5690, 3415],
  [460000, 470000, 8135, 2325, 3485, 5810, 3485],
  [470000, 480000, 8315, 2375, 3565, 5940, 3565],
  [480000, 490000, 8485, 2425, 3635, 6060, 3635],
  [490000, 500000, 8665, 2475, 3715, 6190, 3715],
  [500000, 510000, 8835, 2525, 3785, 6310, 3785],
  [510000, 520000, 9015, 2575, 3865, 6440, 3865],
  [520000, 530000, 9185, 2625, 3935, 6560, 3935],
  [530000, 540000, 9365, 2675, 4015, 6690, 4015],
  [540000, 550000, 9535, 2725, 4085, 6810, 4085],
  [550000, 560000, 9715, 2775, 4165, 6940, 4165],
  [560000, 570000, 9885, 2825, 4235, 7060, 4235],
  [570000, 580000, 10065, 2875, 4315, 7190, 4315],
  [580000, 590000, 10235, 2925, 4385, 7310, 4385],
  [590000, 600000, 10415, 2975, 4465, 7440, 4465],
  [600000, null, 10415, 2975, 4465, 7440, 4465],
] as const;
