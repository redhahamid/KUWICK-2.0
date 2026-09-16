/**
 * BANDING — FOUR REAL AUGUST 2026 PAYSLIPS, RECONCILED AGAINST THE ENGINE.
 *
 *   KUWICK_BANDING_SEED=yes npx tsx prisma/seed-banding-2026-08.ts
 *
 * The account holder supplied four of his clinic's own payslips with the names
 * replaced by neutral labels, and asked for Kuwick's arithmetic to be checked
 * against them to the sen before he starts UAT.
 *
 * THE MONTH IS AUGUST, and that was a correction. The first pass read the
 * payslips as July because the lines say "BOD FEE JULY"; the clinic pays BOD
 * fee, locum and overtime a month in arrears, so July's work is paid in the
 * August wages. Everything here is the August payslip.
 *
 * WHAT THIS DELIBERATELY DOES.
 *
 *   - Puts the four in their OWN CLINIC, so the August run contains only them.
 *     His twelve existing test employees are in Contoh Central and are not
 *     touched, not included, and not recalculated.
 *   - Names them "BANDING A …" through "BANDING D …", so nothing on screen can
 *     be mistaken for his own test data.
 *   - Enters every earning as a PAYROLL INPUT rather than deriving overtime
 *     from attendance. What is under test is the statutory arithmetic on a
 *     known set of earnings; deriving the earnings too would mean a mismatch
 *     could come from either half and prove nothing about either.
 *   - Records the EPF contribution basis as BASIC_ONLY, which is this clinic's
 *     policy and the reason his EPF figures are what they are.
 *   - Imports BANDING C's REAL January–July as opening year-to-date, because
 *     MTD is cumulative and August cannot be computed without it.
 *   - Drives the run through the API, so every figure compared is the figure
 *     the product computes rather than a hand-built copy of it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. A, B and D get NO year-to-date. An earlier
 * pass invented theirs by repeating one month six times; the account holder
 * told us to delete it and put nothing in its place. So A and B are right
 * anyway (neither pays PCB at their wage), and D's PCB is meaningless until he
 * supplies D's real history. The screen will show it; it is not a comparison.
 *
 * Synthetic identities, real money. The figures are his; the people are labels.
 */
import { join } from "node:path";
import { config } from "dotenv";
import { Prisma, PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

config({ path: join(__dirname, "..", ".env") });

const TENANT_NAME = "Klinik Contoh (UAT)";
const CLINIC_NAME = "BANDING (perbandingan Ogos 2026)";
const EMPLOYER_NAME = "Klinik Contoh Sdn Bhd";
const DOMAIN = "admin-uat.kuwick.invalid";
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? "AdminUat!2026";
const API = (process.env.KUWICK_API_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const PERIOD = "2026-08";
const START = "2024-01-01";

type Tx = Prisma.TransactionClient;
type Lindung = "NOT_PARTICIPATING" | "ENROLLED" | "MANDATORY_FOREIGN_WORKER";

interface Person {
  key: string;
  name: string;
  employeeNo: string;
  position: string;
  basic: string;
  lindung: Lindung;
  /** Everything beyond basic, as the clinic's payslip lists it. */
  inputs: { code: string; amount: string; label: string }[];
}

const PEOPLE: Person[] = [
  {
    key: "A",
    name: "BANDING A - Staf Klinikal",
    employeeNo: "BANDING-A",
    position: "Staf klinikal",
    basic: "1850.00",
    lindung: "NOT_PARTICIPATING",
    inputs: [
      { code: "OVERTIME", amount: "277.58", label: "Overtime" },
      {
        code: "ATTENDANCE_ALLOWANCE",
        amount: "50.00",
        label: "Attendance allowance",
      },
      {
        code: "COMMISSION",
        amount: "214.00",
        label: "Commission / other incentives",
      },
    ],
  },
  {
    key: "B",
    name: "BANDING B - Staf Admin",
    employeeNo: "BANDING-B",
    position: "Akauntan",
    basic: "2100.00",
    lindung: "ENROLLED",
    inputs: [{ code: "ALLOWANCE", amount: "100.00", label: "Allowance" }],
  },
  {
    key: "C",
    name: "BANDING C - Doktor & Pengarah",
    employeeNo: "BANDING-C",
    position: "Doktor merangkap pengarah",
    basic: "9750.00",
    lindung: "NOT_PARTICIPATING",
    inputs: [
      { code: "INCENTIVE", amount: "2000.00", label: "Procedure incentives" },
      { code: "DIRECTOR_FEE", amount: "7155.49", label: "BOD fee" },
      {
        code: "COMMISSION",
        amount: "550.00",
        label: "Commission / other incentives",
      },
      { code: "LOCUM_FEE", amount: "2682.20", label: "Locum" },
    ],
  },
  {
    key: "D",
    name: "BANDING D - Doktor Residen",
    employeeNo: "BANDING-D",
    position: "Doktor residen",
    basic: "8500.00",
    lindung: "ENROLLED",
    inputs: [
      { code: "INCENTIVE", amount: "1364.00", label: "Procedure incentives" },
      {
        code: "COMMISSION",
        amount: "1288.90",
        label: "Commission / other incentives",
      },
      { code: "LOCUM_FEE", amount: "1330.00", label: "Locum" },
    ],
  },
];

/**
 * BANDING C's REAL JANUARY–JULY 2026, as the account holder supplied it.
 *
 * MTD IS CUMULATIVE, so August cannot be computed without these. Without them
 * the engine treats August as the first month of the tax year, spreads one
 * month's relief across twelve, and lands thousands of ringgit out.
 *
 * `additional` is the PROCEDURE INCENTIVE only, RM2,000 a month. Of his four
 * non-basic components only INCENTIVE carries `additionalRemuneration` in the
 * catalogue; BOD fee, commission and locum are normal remuneration, and the
 * projection for the rest of the year is built on that distinction.
 *
 * JUNE'S SOCSO IS RM74.40 AND THAT IS NOT A TYPO. SKBBK came into force on
 * 1 June 2026, so June is the first month carrying both the First Category
 * invalidity share (29.75) and the non-employment-injury share (44.65). He
 * then filed the opt-out, which is why July is back to 29.75.
 *
 * Figures in ringgit as printed; converted to cents at the call site.
 */
const C_HISTORY_2026: {
  month: number;
  gross: string;
  additional: string;
  pcb: string;
  socsoEmployee: string;
}[] = [
  {
    month: 1,
    gross: "19647.71",
    additional: "2000.00",
    pcb: "3382.80",
    socsoEmployee: "29.75",
  },
  {
    month: 2,
    gross: "18821.76",
    additional: "2000.00",
    pcb: "3176.30",
    socsoEmployee: "29.75",
  },
  {
    month: 3,
    gross: "18568.01",
    additional: "2000.00",
    pcb: "2987.85",
    socsoEmployee: "29.75",
  },
  {
    month: 4,
    gross: "18251.36",
    additional: "2000.00",
    pcb: "3033.70",
    socsoEmployee: "29.75",
  },
  {
    month: 5,
    gross: "19454.02",
    additional: "2000.00",
    pcb: "3334.35",
    socsoEmployee: "29.75",
  },
  {
    month: 6,
    gross: "20306.28",
    additional: "2000.00",
    pcb: "3547.40",
    socsoEmployee: "74.40",
  },
  {
    month: 7,
    gross: "20648.88",
    additional: "2000.00",
    pcb: "3633.05",
    socsoEmployee: "29.75",
  },
];

/** Every month of his is the same on these; they are printed once, not seven times. */
const C_HISTORY_CONSTANT = {
  epfEmployee: "1078.00",
  epfEmployer: "1176.00",
  socsoEmployer: "104.15",
  eisEmployee: "11.90",
  eisEmployer: "11.90",
};

/** Ringgit as a string to integer cents, without a float ever holding money. */
const cents = (ringgit: string): number => {
  const [whole, frac = ""] = ringgit.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
};

async function login(): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `owner@${DOMAIN}`, password: PASSWORD }),
  });
  if (!res.ok)
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error("No access token.");
  return body.accessToken;
}

async function api(
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (process.env.KUWICK_BANDING_SEED !== "yes") {
    throw new Error("Refusing to run without KUWICK_BANDING_SEED=yes.");
  }
  const url = process.env.ADMIN_UAT_RESET_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is needed.");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  const tenant = await prisma.tenant.findFirst({
    where: { name: TENANT_NAME },
  });
  if (!tenant) throw new Error(`No tenant named ${TENANT_NAME}.`);
  const tenantId = tenant.id;

  const inTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        tenantId,
      );
      return fn(tx);
    });

  const token = await login();

  // The comparison's own clinic. The August run is scoped to it, so his twelve
  // stay in Contoh Central untouched and out of this arithmetic entirely.
  const clinics = (await api(token, "GET", "/clinics")) as {
    id: string;
    name: string;
  }[];
  const clinicId =
    clinics.find((c) => c.name === CLINIC_NAME)?.id ??
    (
      (await api(token, "POST", "/clinics", { name: CLINIC_NAME })) as {
        id: string;
      }
    ).id;

  const employers = (await api(token, "GET", "/workforce/legal-employers")) as {
    id: string;
    name: string;
  }[];
  const legalEmployerId = employers.find((e) => e.name === EMPLOYER_NAME)?.id;
  if (!legalEmployerId)
    throw new Error(`No legal employer named ${EMPLOYER_NAME}.`);

  const ids: Record<string, string> = {};
  for (const person of PEOPLE) {
    const existing = await inTenant((tx) =>
      tx.staff.findFirst({ where: { tenantId, fullName: person.name } }),
    );
    const staff =
      existing ??
      (await inTenant((tx) =>
        tx.staff.create({
          data: {
            tenantId,
            role: "FRONT_DESK_CLINICAL_STAFF" as Role,
            fullName: person.name,
            clinicId,
          },
        }),
      ));
    ids[person.key] = staff.id;

    /*
     * THE PROFILE IS WRITTEN ONCE; THE MONTH'S EARNINGS EVERY TIME.
     *
     * Salary, statutory classification and contribution basis are all
     * EFFECTIVE-DATED: posting them again on a re-run would stack a second
     * version carrying the same figures from the same date, which is noise on
     * a screen whose whole job is to show when something changed. The payroll
     * inputs are the opposite — they upsert on (employee, period, component),
     * so re-posting replaces rather than doubles, and posting them for
     * somebody who already existed is how a second run of this seed still
     * produces the month it promises.
     */
    if (existing) {
      console.log(
        `  ${person.name} already on file — profile left alone, ${PERIOD} earnings refreshed.`,
      );
    } else {
      await api(token, "POST", `/workforce/employees/${staff.id}`, {
        employeeNo: person.employeeNo,
        position: person.position,
        employmentType: "PERMANENT",
        employmentStatus: "ACTIVE",
        startDate: START,
        dateOfBirth: "1990-06-15",
        bankName: "Maybank",
        bankAccountNo: "512345678901",
      });
      await api(
        token,
        "POST",
        `/workforce/employees/${staff.id}/statutory-classification`,
        {
          effectiveFrom: START,
          epfMembership: "MALAYSIAN_CITIZEN",
          taxResidence: "RESIDENT",
          pcbCategory: "CATEGORY_1",
          qualifyingChildren: 0,
          restDayOfWeek: 0,
          lindungParticipation: person.lindung,
          reason: "Recorded for the August 2026 comparison",
        },
      );
      await api(
        token,
        "PATCH",
        `/workforce/employees/${staff.id}/legal-employer`,
        { legalEmployerId },
      );
      await api(token, "POST", `/workforce/employees/${staff.id}/salary`, {
        amount: person.basic,
        basis: "MONTHLY",
        effectiveFrom: START,
        reason: "Basic as printed on the August 2026 payslip",
      });
      // THE CLINIC'S OWN EPF POLICY: basic salary alone, whatever else the month
      // pays. This is why his EPF figures are what they are, and without it the
      // comparison would differ on every line for a reason that is not a defect.
      await api(
        token,
        "POST",
        `/workforce/employees/${staff.id}/contribution-basis`,
        {
          scheme: "EPF",
          mode: "BASIC_ONLY",
          effectiveFrom: START,
          reason: "Clinic policy: EPF is contributed on basic salary only.",
        },
      );
      console.log(`  seeded ${person.name}`);
    }

    for (const input of person.inputs) {
      await api(token, "POST", "/workforce/payroll/inputs", {
        staffId: staff.id,
        period: `${PERIOD}-01`,
        componentCode: input.code,
        amount: input.amount,
        kind: "ADDITIONAL",
        reason: "As printed on the August 2026 payslip",
      });
    }
  }

  /*
   * C's opening year-to-date. Sent every run: the import upserts on
   * (employer, staff, year, month) and refuses to overwrite a month a payroll
   * run actually calculated, so re-running cannot double-count and cannot
   * quietly replace a real August once one has been approved.
   */
  await api(token, "POST", "/workforce/payroll/ytd-opening", {
    legalEmployerId,
    source:
      "BANDING C's own January-July 2026 payslips, supplied by the account holder",
    note: "Seeded for the August 2026 comparison. A, B and D carry no year-to-date by his instruction.",
    months: C_HISTORY_2026.map((row) => ({
      staffId: ids.C,
      taxYear: 2026,
      month: row.month,
      grossCents: cents(row.gross),
      additionalRemunerationCents: cents(row.additional),
      pcbCents: cents(row.pcb),
      epfEmployeeCents: cents(C_HISTORY_CONSTANT.epfEmployee),
      epfEmployerCents: cents(C_HISTORY_CONSTANT.epfEmployer),
      socsoEmployeeCents: cents(row.socsoEmployee),
      socsoEmployerCents: cents(C_HISTORY_CONSTANT.socsoEmployer),
      eisEmployeeCents: cents(C_HISTORY_CONSTANT.eisEmployee),
      eisEmployerCents: cents(C_HISTORY_CONSTANT.eisEmployer),
    })),
  });
  console.log(
    `  imported ${C_HISTORY_2026.length} months of year-to-date for BANDING C`,
  );
  console.log(
    "  A, B and D carry NO year-to-date — D's PCB is therefore not comparable.",
  );

  const run = (await api(token, "POST", "/workforce/payroll/runs", {
    period: PERIOD,
    clinicId,
  })) as { id: string };
  await api(token, "PATCH", `/workforce/payroll/runs/${run.id}/calculate`);
  console.log(`\nRun ${run.id} calculated for ${PERIOD} at "${CLINIC_NAME}".`);
  console.log(JSON.stringify({ runId: run.id, clinicId, staff: ids }, null, 2));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
