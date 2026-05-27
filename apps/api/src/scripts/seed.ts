import bcrypt from "bcryptjs";
import pg from "pg";
import { config, assertDatabaseConfigured } from "../config.js";
import { encrypt } from "../utils/crypto.js";
import { addDays, formatDate, getWeekStart } from "../utils/dates.js";

async function seed() {
  assertDatabaseConfigured();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  const wp = await client.query(
    `INSERT INTO workplaces (name, slug, timezone, clearview_store_code, preferences)
     VALUES ('Demo Restaurant', 'demo-restaurant', 'America/Toronto', 'STORE-001',
             '{"labourCostPct":0.2,"avgHourlyWage":18.5,"constraints":{}}')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const workplaceId = wp.rows[0].id;

  await client.query(
    `INSERT INTO workplace_invites (workplace_id, slug) VALUES ($1, 'demo')
     ON CONFLICT (slug) DO NOTHING`,
    [workplaceId]
  );

  const employerHash = await bcrypt.hash("password123", 10);
  const employer = await client.query(
    `INSERT INTO users (email, password_hash, role, workplace_id, name)
     VALUES ('employer@demo.com', $1, 'EMPLOYER', $2, 'Demo Manager')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
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

  const employees = [
    { email: "alice@demo.com", name: "Alice Cook", role: "COOK", num: "E001" },
    { email: "bob@demo.com", name: "Bob Cashier", role: "CASHIER", num: "E002" },
    { email: "carol@demo.com", name: "Carol Staff", role: "STAFF", num: "E003" },
  ];

  const employeeIds: string[] = [];
  for (const e of employees) {
    const hash = await bcrypt.hash("password123", 10);
    const u = await client.query(
      `INSERT INTO users (email, password_hash, role, workplace_id, name)
       VALUES ($1, $2, 'EMPLOYEE', $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [e.email, hash, workplaceId, e.name]
    );
    employeeIds.push(u.rows[0].id);
    await client.query(
      `INSERT INTO employee_profiles (user_id, workplace_id, role, employee_number, payroll_department, job_code)
       VALUES ($1, $2, $3, $4, 'DEPT01', $3)
       ON CONFLICT (user_id) DO UPDATE SET employee_number = EXCLUDED.employee_number`,
      [u.rows[0].id, workplaceId, e.role, e.num]
    );
    await client.query(`DELETE FROM employee_availability WHERE user_id = $1`, [u.rows[0].id]);
    for (let dow = 0; dow < 7; dow++) {
      await client.query(
        `INSERT INTO employee_availability (user_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, '09:00', '17:00')`,
        [u.rows[0].id, dow]
      );
    }
  }

  const weekStart = getWeekStart(new Date());
  for (let d = 0; d < 7; d++) {
    const date = formatDate(addDays(weekStart, d - 7));
    for (let hour = 0; hour < 24; hour++) {
      const sales = hour >= 11 && hour <= 20 ? 200 + hour * 50 : 50;
      await client.query(
        `INSERT INTO hourly_sales_data (workplace_id, sale_date, hour, sales_amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET sales_amount = EXCLUDED.sales_amount`,
        [workplaceId, date, hour, sales]
      );
    }
  }

  console.log("Seed complete");
  console.log({ workplaceId, employerId: employer.rows[0].id, employeeIds });
  console.log("Login: employer@demo.com / password123");

  await client.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
