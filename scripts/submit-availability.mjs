#!/usr/bin/env node
/**
 * One-off helper: submit employee availability via the existing API,
 * so the manager can generate a schedule before the employee app exists.
 *
 * NO app code is changed — this only calls the deployed public endpoints
 * POST /api/auth/login  and  PUT /api/employees/me/availability.
 *
 * Usage:
 *   node scripts/submit-availability.mjs availability.json
 *
 * availability.json format:
 * {
 *   "apiUrl": "https://shiftagentapi-production.up.railway.app",
 *   "employees": [
 *     {
 *       "email": "jordan@restaurant.com",
 *       "password": "the-password-the-manager-set",
 *       "days": {
 *         "monday": "full", "tuesday": "morning", "wednesday": "evening",
 *         "thursday": "full", "friday": "full", "saturday": "off", "sunday": "off"
 *       }
 *     }
 *   ]
 * }
 *
 * Each day value is one of: "morning" | "evening" | "full" | "off".
 * (Min 24 total hours/week required by the API, or it rejects the submission.)
 */
import { readFileSync } from "node:fs";

const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

// Block time presets — must match apps/api/src/utils/availabilityBlocks.ts
const WEEKDAY = {
  morning: { startTime: "10:00", endTime: "16:00" },
  evening: { startTime: "16:00", endTime: "22:00" },
  full: { startTime: "10:00", endTime: "22:00" },
};
const WEEKEND = {
  morning: { startTime: "10:00", endTime: "17:00" },
  evening: { startTime: "17:00", endTime: "00:00" },
  full: { startTime: "10:00", endTime: "00:00" },
};

function buildBlocks(days) {
  const blocks = [];
  for (const [dayName, block] of Object.entries(days)) {
    if (block === "off") continue;
    const dow = DOW[dayName.toLowerCase()];
    if (dow === undefined) throw new Error(`Unknown day: ${dayName}`);
    const defs = dow === 5 || dow === 6 ? WEEKEND : WEEKDAY;
    const def = defs[block];
    if (!def) throw new Error(`Unknown block "${block}" for ${dayName} (use morning|evening|full|off)`);
    blocks.push({ dayOfWeek: dow, block, startTime: def.startTime, endTime: def.endTime });
  }
  return blocks;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: node scripts/submit-availability.mjs <availability.json>");
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const apiUrl = cfg.apiUrl.replace(/\/$/, "");

  for (const emp of cfg.employees) {
    try {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emp.email, password: emp.password }),
      });
      if (!loginRes.ok) {
        const t = await loginRes.text();
        console.error(`✗ ${emp.email}: login failed (${loginRes.status}) ${t}`);
        continue;
      }
      const { token } = await loginRes.json();

      const blocks = buildBlocks(emp.days);
      const availRes = await fetch(`${apiUrl}/api/employees/me/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ blocks }),
      });
      if (!availRes.ok) {
        const t = await availRes.text();
        console.error(`✗ ${emp.email}: availability rejected (${availRes.status}) ${t}`);
        continue;
      }
      const out = await availRes.json();
      console.log(`✓ ${emp.email}: submitted ${out.blocks} day-blocks`);
    } catch (e) {
      console.error(`✗ ${emp.email}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("\nDone. Now generate the schedule for the CURRENT week in the web app.");
}

main();
