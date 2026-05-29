import bcrypt from "bcryptjs";
import fs from "fs";
import pg from "pg";
import { config, assertDatabaseConfigured } from "../config.js";
import { encrypt } from "../utils/crypto.js";
import { addDays, formatDate, getWeekStart } from "../utils/dates.js";
import {
  gridFromSelections,
  matchBlockFromTimes,
  selectionFromBlockInput,
} from "../utils/availabilityBlocks.js";
import { defaultDropChartCsvPath, importSalesCsv } from "../services/csvImportService.js";
import { endPool } from "../db/pool.js";

const PASSWORD = "password123";
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

type AvailBlock = { dayOfWeek: number; startTime: string; endTime: string };

type SeedEmployee = {
  email: string;
  name: string;
  phone: string;
  role: string;
  employeeNumber: string;
  profileData: Record<string, unknown>;
  availability: AvailBlock[];
  submissionStatus: "pending" | "approved" | "rejected" | "none";
};

function blocksToGrid(blocks: AvailBlock[]) {
  const selections = blocks.map((b) => {
    const matched = matchBlockFromTimes(b.dayOfWeek, b.startTime, b.endTime);
    if (matched) return selectionFromBlockInput(b.dayOfWeek, matched);
    return selectionFromBlockInput(b.dayOfWeek, "morning");
  });
  return gridFromSelections(selections);
}

const DEMO_EMPLOYEES: SeedEmployee[] = [
  {
    email: "alice@demo.com",
    name: "Alice Cook",
    phone: "416-555-0101",
    role: "COOK",
    employeeNumber: "E001",
    profileData: {
      roles: ["Cook"],
      experienceLevel: "Veteran",
      shiftTier: "Rush-capable",
      minHours: 24,
      maxHours: 40,
      minShiftsPerWeek: 4,
      maxShiftsPerWeek: 5,
      employeeType: "Full Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 1, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 2, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 3, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 4, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 5, startTime: "08:00", endTime: "16:00" },
    ],
    submissionStatus: "pending",
  },
  {
    email: "bob@demo.com",
    name: "Bob Cashier",
    phone: "416-555-0102",
    role: "CASHIER",
    employeeNumber: "E002",
    profileData: {
      roles: ["Cashier"],
      experienceLevel: "Intermediate",
      shiftTier: "Rush-capable",
      minHours: 20,
      maxHours: 35,
      employeeType: "Part Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 2, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 3, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 4, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 5, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 6, startTime: "11:00", endTime: "19:00" },
    ],
    submissionStatus: "pending",
  },
  {
    email: "carol@demo.com",
    name: "Carol Packliner",
    phone: "416-555-0103",
    role: "PACKLINER",
    employeeNumber: "E003",
    profileData: {
      roles: ["Packliner"],
      experienceLevel: "Intermediate",
      shiftTier: "Light shifts",
      minHours: 16,
      maxHours: 32,
      employeeType: "Part Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 3, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 4, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 5, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 6, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 0, startTime: "10:00", endTime: "18:00" },
    ],
    submissionStatus: "approved",
  },
  {
    email: "dave@demo.com",
    name: "Dave Cook",
    phone: "416-555-0104",
    role: "COOK",
    employeeNumber: "E004",
    profileData: {
      roles: ["Cook"],
      experienceLevel: "Trainee",
      shiftTier: "Light shifts",
      minHours: 12,
      maxHours: 28,
      employeeType: "Part Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 5, startTime: "14:00", endTime: "22:00" },
      { dayOfWeek: 6, startTime: "10:00", endTime: "18:00" },
      { dayOfWeek: 0, startTime: "10:00", endTime: "18:00" },
    ],
    submissionStatus: "pending",
  },
  {
    email: "eva@demo.com",
    name: "Eva Cashier",
    phone: "416-555-0105",
    role: "CASHIER",
    employeeNumber: "E005",
    profileData: {
      roles: ["Cashier"],
      experienceLevel: "Veteran",
      shiftTier: "Rush-capable",
      minHours: 28,
      maxHours: 45,
      employeeType: "Full Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 1, startTime: "14:00", endTime: "22:00" },
      { dayOfWeek: 2, startTime: "14:00", endTime: "22:00" },
      { dayOfWeek: 3, startTime: "14:00", endTime: "22:00" },
      { dayOfWeek: 4, startTime: "14:00", endTime: "22:00" },
    ],
    submissionStatus: "rejected",
  },
  {
    email: "frank@demo.com",
    name: "Frank Multi",
    phone: "416-555-0106",
    role: "CASHIER",
    employeeNumber: "E006",
    profileData: {
      roles: ["Cashier", "Packliner"],
      experienceLevel: "Intermediate",
      shiftTier: "Rush-capable",
      minHours: 20,
      maxHours: 40,
      fullDayCapable: false,
      employeeType: "Part Time",
      pairingAlwaysWith: [],
      pairingNeverWith: [],
    },
    availability: [
      { dayOfWeek: 1, startTime: "10:00", endTime: "22:00" },
      { dayOfWeek: 3, startTime: "10:00", endTime: "14:00" },
      { dayOfWeek: 5, startTime: "16:00", endTime: "22:00" },
    ],
    submissionStatus: "pending",
  },
];

async function seed() {
  assertDatabaseConfigured();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  const preferences = {
    labourCostPct: 0.2,
    avgHourlyWage: 18.5,
    shiftLengthHours: 8,
    constraints: {
      maxConsecutiveDays: 5,
      minAvailabilityHours: 20,
      maxHoursPerWeek: 45,
      roleRequirements: {},
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

  // Reset transactional demo data for a clean test run
  await client.query(
    `DELETE FROM schedule_shifts WHERE schedule_id IN (SELECT id FROM schedules WHERE workplace_id = $1)`,
    [workplaceId]
  );
  await client.query(`DELETE FROM schedules WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM availability_submissions WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM time_off_requests WHERE workplace_id = $1`, [workplaceId]);
  await client.query(`DELETE FROM activity_log WHERE workplace_id = $1`, [workplaceId]);
  await client.query(
    `UPDATE employee_profiles SET first_approval_completed = false WHERE workplace_id = $1`,
    [workplaceId]
  );

  await client.query(
    `INSERT INTO workplace_invites (workplace_id, slug) VALUES ($1, 'demo')
     ON CONFLICT (slug) DO NOTHING`,
    [workplaceId]
  );

  const employerHash = await bcrypt.hash(PASSWORD, 10);
  const employer = await client.query(
    `INSERT INTO users (email, password_hash, role, workplace_id, name, phone)
     VALUES ('employer@demo.com', $1, 'EMPLOYER', $2, 'Demo Manager', '416-555-0100')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
     RETURNING id`,
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
  const nextWeekStart = formatDate(addDays(weekStart, 7));

  const seeded: Array<{ email: string; userId: string; submission: string }> = [];

  for (const e of DEMO_EMPLOYEES) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role, workplace_id, name, phone)
       VALUES ($1, $2, 'EMPLOYEE', $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
       RETURNING id`,
      [e.email, hash, workplaceId, e.name, e.phone]
    );
    const userId = u.rows[0].id;

    await client.query(
      `INSERT INTO employee_profiles (user_id, workplace_id, role, employee_number, payroll_department, job_code, profile_data)
       VALUES ($1, $2, $3, $4, 'DEPT01', $3, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         role = EXCLUDED.role,
         employee_number = EXCLUDED.employee_number,
         profile_data = EXCLUDED.profile_data`,
      [userId, workplaceId, e.role, e.employeeNumber, JSON.stringify(e.profileData)]
    );

    await client.query(`DELETE FROM employee_availability WHERE user_id = $1`, [userId]);

    if (e.submissionStatus !== "none") {
      const grid = blocksToGrid(e.availability);
      await client.query(
        `INSERT INTO availability_submissions (user_id, workplace_id, week_start, availability_grid, status, submitted_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour' * $6)
         ON CONFLICT (user_id, week_start) DO UPDATE SET
           availability_grid = EXCLUDED.availability_grid,
           status = EXCLUDED.status,
           submitted_at = EXCLUDED.submitted_at`,
        [
          userId,
          workplaceId,
          weekStartStr,
          JSON.stringify(grid),
          e.submissionStatus,
          seeded.length + 1,
        ]
      );
    }

    seeded.push({ email: e.email, userId, submission: e.submissionStatus });
  }

  const carolId = seeded.find((s) => s.email === "carol@demo.com")!.userId;
  await client.query(
    `UPDATE employee_profiles SET first_approval_completed = true WHERE user_id = $1 AND workplace_id = $2`,
    [carolId, workplaceId]
  );

  // Time-off requests for approvals tab
  const aliceId = seeded.find((s) => s.email === "alice@demo.com")!.userId;
  const bobId = seeded.find((s) => s.email === "bob@demo.com")!.userId;
  const daveId = seeded.find((s) => s.email === "dave@demo.com")!.userId;

  await client.query(`DELETE FROM time_off_requests WHERE workplace_id = $1`, [workplaceId]);

  await client.query(
    `INSERT INTO time_off_requests (user_id, workplace_id, start_date, end_date, reason, status, submitted_at)
     VALUES
       ($1, $2, $3, $3, 'Family appointment', 'pending', now() - interval '2 hours'),
       ($4, $2, $5, $6, 'Long weekend trip', 'pending', now() - interval '5 hours'),
       ($7, $2, $8, $8, 'Doctor visit (approved earlier)', 'approved', now() - interval '1 day')`,
    [
      aliceId,
      workplaceId,
      formatDate(addDays(weekStart, 10)),
      bobId,
      formatDate(addDays(weekStart, 14)),
      formatDate(addDays(weekStart, 16)),
      daveId,
      formatDate(addDays(weekStart, 3)),
    ]
  );

  // Hourly sales: product drop chart CSV (apps/ml-engine/drop_chart_all_days.csv)
  const dropChartPath = defaultDropChartCsvPath();
  if (fs.existsSync(dropChartPath)) {
    const salesImport = await importSalesCsv(workplaceId, fs.readFileSync(dropChartPath));
    console.log(
      `Sales from ${dropChartPath}: ${salesImport.rowsAccepted} rows (${salesImport.format})`,
      salesImport.dateRange
    );
  } else {
    console.warn("Drop chart CSV not found, using synthetic sales:", dropChartPath);
    for (const weekOffset of [-7, 0, 7]) {
      for (let d = 0; d < 7; d++) {
        const date = formatDate(addDays(weekStart, weekOffset + d));
        for (let hour = 0; hour < 24; hour++) {
          const sales = hour >= 11 && hour <= 20 ? 180 + hour * 45 : 40;
          await client.query(
            `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
            [workplaceId, date, hour, sales]
          );
        }
      }
    }
  }

  // Sample activity for dashboard
  await client.query(`DELETE FROM activity_log WHERE workplace_id = $1`, [workplaceId]);
  await client.query(
    `INSERT INTO activity_log (workplace_id, type, message, actor_name, created_at)
     VALUES
       ($1, 'employee_added', 'Added new employee Eva Cashier', 'employer@demo.com', now() - interval '3 days'),
       ($1, 'schedule_generated', $2, 'employer@demo.com', now() - interval '1 day'),
       ($1, 'employee_approved', 'Approved availability for Carol Packliner', 'employer@demo.com', now() - interval '6 hours')`,
    [workplaceId, `Schedule generated for week of ${weekStartStr}`]
  );

  console.log("\n=== Seed complete ===\n");
  console.log("Workplace:", workplaceId);
  console.log("Week start (availability submissions):", weekStartStr);
  console.log("Next week:", nextWeekStart);
  console.log("\n--- Employer (web app) ---");
  console.log("  employer@demo.com /", PASSWORD);
  console.log("\n--- Employees (mobile app) — all use password:", PASSWORD);
  for (const s of seeded) {
    console.log(`  ${s.email.padEnd(22)} submission: ${s.submission}`);
  }
  console.log("\nApprovals to test:");
  console.log("  • 4 pending availability requests (Alice, Bob, Dave, Frank)");
  console.log("  • 1 approved (Carol), 1 rejected (Eva)");
  console.log("  • 2 pending time-off (Alice, Bob), 1 approved (Dave)");
  console.log("\nSchedule: click Generate on web — uses each employee's availability above.\n");

  await client.end();
  await endPool();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
