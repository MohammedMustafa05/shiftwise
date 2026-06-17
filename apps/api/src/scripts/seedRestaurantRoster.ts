import bcrypt from "bcryptjs";
import fs from "fs";
import pg from "pg";
import { config, assertDatabaseConfigured } from "../config.js";
import { encrypt } from "../utils/crypto.js";
import { addDays, formatDate, getPreviousWeekRange, getWeekStart } from "../utils/dates.js";
import { gridFromCustomBlocks } from "../utils/availabilityBlocks.js";
import { defaultDropChartCsvPath, importSalesCsv } from "../services/csvImportService.js";
import { endPool } from "../db/pool.js";

const PASSWORD = "password123";

type AvailBlock = { dayOfWeek: number; startTime: string; endTime: string };

type SeedEmployee = {
  email: string;
  name: string;
  phone: string;
  role: string;
  employeeNumber: string;
  profileData: Record<string, unknown>;
  availability: AvailBlock[];
};

const MON_FRI = [1, 2, 3, 4, 5];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SAT_SUN = [6, 0];

// DOW convention: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Fri (5) and Sat (6) are "weekend" operating days with different hours.

function fullDayBlock(dayOfWeek: number): AvailBlock {
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return { dayOfWeek, startTime: "10:00", endTime: "00:00" };
  }
  return { dayOfWeek, startTime: "10:00", endTime: "22:00" };
}

/** Morning block — matches the canonical WEEKDAY_BLOCKS / WEEKEND_BLOCKS morning definition. */
function morningBlock(dayOfWeek: number): AvailBlock {
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return { dayOfWeek, startTime: "10:00", endTime: "17:00" };
  }
  return { dayOfWeek, startTime: "10:00", endTime: "16:00" };
}

/** Evening block — matches the canonical WEEKDAY_BLOCKS / WEEKEND_BLOCKS evening definition. */
function eveningBlock(dayOfWeek: number): AvailBlock {
  if (dayOfWeek === 5 || dayOfWeek === 6) {
    return { dayOfWeek, startTime: "17:00", endTime: "00:00" };
  }
  return { dayOfWeek, startTime: "16:00", endTime: "22:00" };
}

function fullDays(days: number[]): AvailBlock[] {
  return days.map(fullDayBlock);
}

function morningDays(days: number[]): AvailBlock[] {
  return days.map(morningBlock);
}

function eveningDays(days: number[]): AvailBlock[] {
  return days.map(eveningBlock);
}


function profile(
  roles: string[],
  experience: "Veteran" | "Intermediate" | "Trainee",
  maxHours = 45
): Record<string, unknown> {
  return {
    roles,
    experienceLevel: experience,
    shiftTier: experience === "Trainee" ? "Light shifts" : "Rush-capable",
    minHours: 20,
    maxHours,
    minShiftsPerWeek: 3,
    maxShiftsPerWeek: 6,
    employeeType: "Full Time",
    pairingAlwaysWith: [],
    pairingNeverWith: [],
  };
}

const RESTAURANT_EMPLOYEES: SeedEmployee[] = [
  // ── COOKS ──────────────────────────────────────────────────────────────────
  {
    email: "kazim@restaurant.test",
    name: "Kazim",
    phone: "416-555-1001",
    role: "COOK",
    employeeNumber: "E101",
    profileData: profile(["Cook", "Packliner", "Cashier"], "Veteran"),
    // Full week — clean full-day block
    availability: fullDays(ALL_DAYS),
  },
  {
    email: "pankaj@restaurant.test",
    name: "Pankaj",
    phone: "416-555-1002",
    role: "COOK",
    employeeNumber: "E102",
    profileData: profile(["Cook", "Packliner"], "Veteran"),
    // Mon–Fri full day — clean full-day block
    availability: fullDays(MON_FRI),
  },
  {
    email: "mubeen@restaurant.test",
    name: "Mubeen",
    phone: "416-555-1013",
    role: "COOK",
    employeeNumber: "E113",
    profileData: profile(["Cook", "Packliner"], "Veteran"),
    // Mon–Fri full day — clean full-day block
    availability: fullDays(MON_FRI),
  },
  {
    email: "simran@restaurant.test",
    name: "Simran",
    phone: "416-555-1015",
    role: "COOK",
    employeeNumber: "E116",
    profileData: profile(["Cook"], "Veteran"),
    // Sunday only — clean full-day block
    availability: fullDays([0]),
  },
  {
    email: "ayaan@restaurant.test",
    name: "Ayaan",
    phone: "416-555-1019",
    role: "COOK",
    employeeNumber: "E120",
    profileData: profile(["Cook"], "Intermediate"),
    // Mon–Fri 5–10: majority hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },

  // ── PACKLINERS ─────────────────────────────────────────────────────────────
  {
    email: "nafey@restaurant.test",
    name: "Nafey",
    phone: "416-555-1004",
    role: "PACKLINER",
    employeeNumber: "E104",
    profileData: profile(["Packliner"], "Intermediate"),
    // Full week — clean full-day block
    availability: fullDays(ALL_DAYS),
  },
  {
    email: "aleeza@restaurant.test",
    name: "Aleeza",
    phone: "416-555-1005",
    role: "PACKLINER",
    employeeNumber: "E105",
    profileData: profile(["Packliner"], "Veteran"),
    // Mon, Tue, Fri, Sat, Sun full day — clean full-day block
    availability: fullDays([1, 2, 5, 6, 0]),
  },
  {
    email: "ganma@restaurant.test",
    name: "Ganma",
    phone: "416-555-1007",
    role: "PACKLINER",
    employeeNumber: "E107",
    profileData: profile(["Packliner"], "Intermediate"),
    // All days except Thursday — clean full-day block
    availability: fullDays(ALL_DAYS.filter((d) => d !== 4)),
  },
  {
    email: "mehran@restaurant.test",
    name: "Mehran",
    phone: "416-555-1012",
    role: "PACKLINER",
    employeeNumber: "E112",
    profileData: profile(["Packliner"], "Veteran"),
    // Mon + Fri full day; Tue/Wed/Thu/Sat/Sun 10–3: majority hours in morning block → snap to morning
    availability: [
      ...fullDays([1, 5]),
      ...morningDays([2, 3, 4, 6, 0]),
    ],
  },
  {
    email: "rupali@restaurant.test",
    name: "Rupali",
    phone: "416-555-1014",
    role: "PACKLINER",
    employeeNumber: "E115",
    profileData: profile(["Packliner", "Cashier"], "Veteran"),
    // Full week — clean full-day block
    availability: fullDays(ALL_DAYS),
  },
  {
    email: "logan@restaurant.test",
    name: "Logan",
    phone: "416-555-1010",
    role: "PACKLINER",
    employeeNumber: "E110",
    profileData: profile(["Packliner"], "Trainee"),
    // Mon–Fri 5–10: all 5 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },
  {
    email: "ayma@restaurant.test",
    name: "Ayma",
    phone: "416-555-1020",
    role: "PACKLINER",
    employeeNumber: "E121",
    profileData: profile(["Packliner"], "Intermediate"),
    // Mon–Fri 3–10: 6/7 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },

  // ── CASHIERS ───────────────────────────────────────────────────────────────
  {
    email: "hasan@restaurant.test",
    name: "Hasan",
    phone: "416-555-1008",
    role: "CASHIER",
    employeeNumber: "E108",
    profileData: profile(["Cashier", "Packliner"], "Intermediate"),
    // Full week — clean full-day block
    availability: fullDays(ALL_DAYS),
  },
  {
    email: "gazia@restaurant.test",
    name: "Gazia",
    phone: "416-555-1006",
    role: "CASHIER",
    employeeNumber: "E106",
    profileData: profile(["Cashier"], "Intermediate"),
    // Mon–Fri 3–10: 6/7 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },
  {
    email: "inaya@restaurant.test",
    name: "Inaya",
    phone: "416-555-1009",
    role: "CASHIER",
    employeeNumber: "E109",
    profileData: profile(["Cashier"], "Intermediate"),
    // Mon–Fri 3–10: 6/7 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },
  {
    email: "merab@restaurant.test",
    name: "Merab",
    phone: "416-555-1011",
    role: "CASHIER",
    employeeNumber: "E111",
    profileData: profile(["Cashier"], "Veteran"),
    // Mon–Sat 5–10: all 5 hours in evening block → snap to evening
    // (Sun is off — not included)
    availability: eveningDays(MON_SAT),
  },
  {
    email: "sakina@restaurant.test",
    name: "Sakina",
    phone: "416-555-1016",
    role: "CASHIER",
    employeeNumber: "E117",
    profileData: profile(["Cashier"], "Intermediate"),
    // Everyday 10–5: majority hours (6/7 weekdays, 7/7 Fri-Sat) in morning block → snap to morning
    availability: morningDays(ALL_DAYS),
  },
  {
    email: "shahmeer@restaurant.test",
    name: "Shahmeer",
    phone: "416-555-1017",
    role: "CASHIER",
    employeeNumber: "E118",
    profileData: profile(["Cashier"], "Intermediate"),
    // Sat/Sun 10–5: majority hours in morning block → snap to morning
    availability: morningDays(SAT_SUN),
  },
  {
    email: "kanza@restaurant.test",
    name: "Kanza",
    phone: "416-555-1018",
    role: "CASHIER",
    employeeNumber: "E119",
    profileData: profile(["Cashier"], "Trainee"),
    // Mon–Fri 3–10: 6/7 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },
  {
    email: "umrah@restaurant.test",
    name: "Umrah",
    phone: "416-555-1021",
    role: "CASHIER",
    employeeNumber: "E122",
    profileData: profile(["Cashier"], "Veteran"),
    // Mon–Fri 5–10: all 5 hours in evening block → snap to evening
    // Sat/Sun full day
    availability: [
      ...eveningDays(MON_FRI),
      ...fullDays(SAT_SUN),
    ],
  },
];

async function seedSales(client: pg.Client, workplaceId: string) {
  const dropChartPath = defaultDropChartCsvPath();
  if (fs.existsSync(dropChartPath)) {
    const salesImport = await importSalesCsv(workplaceId, fs.readFileSync(dropChartPath));
    console.log(
      `Sales from ${dropChartPath}: ${salesImport.rowsAccepted} rows (${salesImport.format})`,
      salesImport.dateRange
    );
    return;
  }

  console.warn("Drop chart CSV not found, using synthetic sales:", dropChartPath);
  const { weekStart: prevStart } = getPreviousWeekRange();
  const prevMonday = new Date(`${prevStart}T12:00:00Z`);
  for (let d = 0; d < 7; d++) {
    const date = formatDate(addDays(prevMonday, d));
    for (let hour = 0; hour < 24; hour++) {
      const sales = hour >= 11 && hour <= 20 ? 220 + hour * 50 : 45;
      await client.query(
        `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
        [workplaceId, date, hour, sales]
      );
    }
  }
  console.log("Synthetic sales seeded for previous week (used by generate):", prevStart);
}

async function seed() {
  assertDatabaseConfigured();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  const defaultDayBands = [
    { cooks: 1, cashiers: 1, packliners: 1 },
    { cooks: 1, cashiers: 1, packliners: 1 },
    { cooks: 1, cashiers: 1, packliners: 1 },
  ];
  const preferences = {
    labourCostPct: 0.2,
    avgHourlyWage: 20,
    shiftLengthHours: 8,
    constraints: {
      maxConsecutiveDays: 5,
      minAvailabilityHours: 20,
      maxHoursPerWeek: 45,
      roleRequirements: {
        monday: defaultDayBands,
        tuesday: defaultDayBands,
        wednesday: defaultDayBands,
        thursday: defaultDayBands,
        friday: defaultDayBands,
        saturday: defaultDayBands,
        sunday: defaultDayBands,
      },
    },
    jobCodeMapping: {},
  };

  const operatingHours = {
    default: { open: "10:00", close: "22:00" },
    byDay: {},
  };

  const wp = await client.query(
    `INSERT INTO workplaces (name, slug, timezone, clearview_store_code, preferences, operating_hours)
     VALUES ('Demo Restaurant', 'demo-restaurant', 'America/Toronto', 'STORE-001', $1::jsonb, $2::jsonb)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       preferences = EXCLUDED.preferences,
       operating_hours = EXCLUDED.operating_hours
     RETURNING id`,
    [JSON.stringify(preferences), JSON.stringify(operatingHours)]
  );
  const workplaceId = wp.rows[0].id;

  await client.query(
    `DELETE FROM schedule_shifts WHERE schedule_id IN (SELECT id FROM schedules WHERE workplace_id = $1)`,
    [workplaceId]
  );
  await client.query(`DELETE FROM schedules WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM availability_submissions WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM time_off_requests WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM activity_log WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM users WHERE workplace_id = $1 AND role = 'EMPLOYEE'`, [workplaceId]);

  await client.query(
    `INSERT INTO workplace_invites (workplace_id, slug) VALUES ($1, 'demo')
     ON CONFLICT (slug) DO NOTHING`,
    [workplaceId]
  );

  const employerHash = await bcrypt.hash(PASSWORD, 10);
  await client.query(
    `INSERT INTO users (email, password_hash, role, workplace_id, name, phone)
     VALUES ('employer@demo.com', $1, 'EMPLOYER', $2, 'Demo Manager', '416-555-0100')
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       phone = EXCLUDED.phone,
       workplace_id = EXCLUDED.workplace_id`,
    [employerHash, workplaceId]
  );

  await client.query(
    `INSERT INTO clearview_connections
     (workplace_id, store_id, access_token_encrypted, refresh_token_encrypted, last_sales_sync_at)
     VALUES ($1, 'STORE-001', $2, $3, now())
     ON CONFLICT (workplace_id) DO UPDATE SET last_sales_sync_at = now()`,
    [workplaceId, encrypt("mock_access_token"), encrypt("mock_refresh_token")]
  );

  const weekStart = getWeekStart(new Date());
  const weekStartStr = formatDate(weekStart);
  const nextWeekStartStr = formatDate(addDays(weekStart, 7));
  const weekStarts = [weekStartStr, nextWeekStartStr];

  const seeded: Array<{ email: string; name: string }> = [];

  for (const e of RESTAURANT_EMPLOYEES) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role, workplace_id, name, phone)
       VALUES ($1, $2, 'EMPLOYEE', $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         workplace_id = EXCLUDED.workplace_id
       RETURNING id`,
      [e.email, hash, workplaceId, e.name, e.phone]
    );
    const userId = u.rows[0].id;

    await client.query(
      `INSERT INTO employee_profiles (user_id, workplace_id, role, employee_number, payroll_department, job_code, profile_data, first_approval_completed)
       VALUES ($1, $2, $3, $4, 'DEPT01', $3, $5, true)
       ON CONFLICT (user_id) DO UPDATE SET
         role = EXCLUDED.role,
         employee_number = EXCLUDED.employee_number,
         profile_data = EXCLUDED.profile_data,
         first_approval_completed = true`,
      [userId, workplaceId, e.role, e.employeeNumber, JSON.stringify(e.profileData)]
    );

    await client.query(`DELETE FROM employee_availability WHERE user_id = $1`, [userId]);

    const grid = gridFromCustomBlocks(e.availability);
    for (const ws of weekStarts) {
      await client.query(
        `INSERT INTO availability_submissions (user_id, workplace_id, week_start, availability_grid, status, submitted_at)
         VALUES ($1, $2, $3, $4, 'approved', now())
         ON CONFLICT (user_id, week_start) DO UPDATE SET
           availability_grid = EXCLUDED.availability_grid,
           status = 'approved',
           submitted_at = now()`,
        [userId, workplaceId, ws, JSON.stringify(grid)]
      );
    }

    seeded.push({ email: e.email, name: e.name });
  }

  await seedSales(client, workplaceId);

  console.log("\n=== Restaurant roster seed complete ===\n");
  console.log("Workplace:", workplaceId, "(slug: demo-restaurant)");
  console.log("Employees:", seeded.length);
  console.log("Availability weeks:", weekStarts.join(", "));
  console.log("\n--- Employer (web UI) ---");
  console.log("  employer@demo.com /", PASSWORD);
  console.log("\n--- Employees ---");
  console.log("  All use password:", PASSWORD);
  for (const s of seeded) {
    console.log(`  ${s.name.padEnd(10)} ${s.email}`);
  }
  console.log("\nOpen Schedule → week starting", weekStartStr, "→ Generate.");
  console.log("(Re-seeding clears existing schedules for this workplace — click Generate again after seed.)\n");

  await client.end();
  await endPool();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
