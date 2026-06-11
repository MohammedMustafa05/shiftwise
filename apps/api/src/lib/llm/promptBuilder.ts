import type { LLMPlannerInput } from "@shiftagent/shared";
import { peakPredictionsForPrompt } from "../../services/llmInput.js";
import { buildHistoricalStylePromptLines } from "../../services/historicalScheduleStyle.js";

export function buildSystemPrompt(): string {
  return `You are a scheduling assistant for a restaurant. Your job is to SUGGEST a weekly staff schedule.

CRITICAL RULES:
- Each availability window is the OUTER bounds for that day — the employee is available anytime inside it, not only for the full window.
  Example: availability 10:00–16:00 allows shifts 10:00–14:00, 13:00–16:00, 10:00–12:00, etc. Do NOT default to filling the entire window unless demand requires it.
- Every shift must be fully contained in an availability window (shift start >= window start AND shift end <= window end).
- You never exceed max weekly hours per employee. This is tracked in hours_scheduled_so_far and max.
- Assign each shift role (COOK, CASHIER, PACKLINER) to an employee who can work that role. Use the employee's roles[] list when present (multi-role staff).
- HARD HOURLY ROLE MIX: every operating hour needs at least 1 COOK + 1 CASHIER + 1 PACKLINER on the floor. When workers_needed allows more than 3, add extras in order PACKLINER → CASHIER (cook stays 1 unless manager prefs say otherwise). Role caps: max 1 cook, 3 cashiers, 3 packliners per hour.
- Shift length must be between 3 and 14 hours inclusive.
- Prefer Milton LSL historical patterns when provided: open crew 10:00–17:00, close crew 17:00–22:00, full-day anchors 10:00–22:00 for veterans — overlap crews to satisfy hourly 1+1+1 without truncating everyone to 10:00–16:00.
- If you cannot fill a slot, list it in unfilled_slots with a reason. Never invent employees or employee IDs.
- Output ONLY valid JSON matching the schema below. No prose before or after. No markdown code fences.
- Do not refuse or analyze the request — assign shifts for the target week using availability and demand.
- LABOUR CAP (hard): formula_headcount = max(3, round((hourly sales × 0.20) ÷ 20)). Mandatory floor is ALWAYS 3 (1 cook + 1 cash + 1 pack) — floor runs first, formula only adds extras above 3. When adding workers above floor, prioritize Packliners first, then Cashiers. Never add a second Cook unless staffing_requirements explicitly require it.
- workers_needed in the user message shows formula_headcount and extra_workers. Never schedule fewer than the floor. Never let formula reduce role coverage below 1+1+1.

OPTIMIZATION PRIORITIES (in order):
1. Meet hourly role targets in workers_needed (1 cook + 1 cash + 1 pack minimum every hour; scale extras pack → cash within caps)
2. Stay within workers_needed hourly and daily headcount caps (hard — drop shifts rather than exceed)
3. Fill minimum staffing_requirements per day only if caps allow
3. Apply ML peak window recommendations within caps
3. Prioritize high rush_hour_suitability employees during peak windows (when rush_hour_priority is true)
4. Apply manager preference patterns (treat as strong hints, not absolute rules)
5. DO NOT REPEAT AI MISTAKES listed in the user message — avoid those patterns entirely
6. Respect preferred_shift_type where possible
7. Distribute hours fairly, respecting min_hours_guaranteed floors
8. Maximize reliability_score and performance_level as tiebreakers

All employee scores (rush_hour_suitability, performance_level, reliability_score) are on a 0.0-1.0 scale where 1.0 is best.

Omit "reasoning" on shifts unless needed (saves tokens). If included, max 8 words.

OUTPUT SCHEMA (return this exact structure, no markdown, no code blocks):
{
  "shifts": [
    {
      "employee_id": "uuid",
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "role": "COOK|CASHIER|PACKLINER",
      "reasoning": "One sentence explaining why this person was assigned here.",
      "confidence": 0.85
    }
  ],
  "unfilled_slots": [
    {
      "date": "YYYY-MM-DD",
      "role": "COOK|CASHIER|PACKLINER",
      "required_start": "HH:MM",
      "required_end": "HH:MM",
      "reason": "No available COOK employee for this window."
    }
  ],
  "summary": "2-3 sentence overview of the schedule for the manager.",
  "warnings": ["Any soft constraint notes the manager should know about."]
}`;
}

const DOW_TO_DAY_KEY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Map day-of-week (0=Sun) to YYYY-MM-DD within the schedule week starting Monday. */
export function scheduleDateForDay(weekStart: string, dayOfWeek: number): string {
  const monday = new Date(`${weekStart}T12:00:00Z`);
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  monday.setUTCDate(monday.getUTCDate() + offset);
  return monday.toISOString().slice(0, 10);
}

function appendFloorContext(lines: string[], input: LLMPlannerInput, scheduleDate?: string): void {
  const assignments = (input.floor_assignments ?? []).filter(
    (a) => !scheduleDate || a.date === scheduleDate
  );
  const gaps = (input.floor_gaps ?? []).filter((g) => !scheduleDate || g.date === scheduleDate);

  if (assignments.length === 0 && gaps.length === 0) return;

  lines.push("MANDATORY FLOOR ASSIGNMENTS (already locked — do NOT contradict or remove):");
  if (assignments.length === 0) {
    lines.push("  (none for this day)");
  } else {
    for (const a of assignments) {
      lines.push(
        `  - ${a.date} ${a.start_time}-${a.end_time} ${a.role} employee_id=${a.employee_id}`
      );
    }
  }
  lines.push("");

  if (gaps.length > 0) {
    lines.push("UNFILLABLE FLOOR GAPS (no eligible staff — do not attempt to override):");
    for (const g of gaps) {
      lines.push(`  - ${g.detail}`);
    }
    lines.push("");
  }

  lines.push(
    "Your job is to add demand extras ABOVE the floor assignments only. Never reassign locked floor shifts."
  );
  lines.push("");
}

export function buildUserMessageForDay(
  input: LLMPlannerInput,
  scheduleDate: string,
  dayOfWeek: number,
  hoursScheduledSoFar: Map<string, number>
): string {
  const dayKey = DOW_TO_DAY_KEY[dayOfWeek] ?? "monday";
  const dayStaffing = input.scheduling_preferences.staffing_requirements[dayKey];

  const employees = input.employees
    .map((emp) => {
      const dayAvail = emp.availability.filter((a) => a.day_of_week === dayOfWeek);
      if (dayAvail.length === 0) return null;
      return {
        ...emp,
        availability: dayAvail,
        hours_scheduled_so_far: hoursScheduledSoFar.get(emp.id) ?? 0,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const dayPeaks = peakPredictionsForPrompt(
    input.ml_predictions.filter((p) => p.date === scheduleDate),
    16
  );

  const lines: string[] = [];
  lines.push(`SCHEDULE THIS DAY ONLY: ${scheduleDate} (${dayName(dayOfWeek)})`);
  lines.push(`Week context: ${input.week_start} through ${getWeekEnd(input.week_start)}`);
  lines.push("Every shift in your JSON must use this exact date.");
  lines.push("");

  appendFloorContext(lines, input, scheduleDate);

  const dayCap = input.workers_needed.byDay.find((d) => d.date === scheduleDate);
  lines.push("LABOUR CAPS (mandatory floor=3 always; formula adds extras only):");
  lines.push(`  Daily formula max on ${scheduleDate}: ${dayCap?.workers ?? 3} workers (floor 3 + ${Math.max(0, (dayCap?.workers ?? 3) - 3)} extras)`);
  const hourCaps = input.workers_needed.byHour.filter((h) => h.date === scheduleDate);
  if (hourCaps.length > 0) {
    const peakHours = [...hourCaps].sort((a, b) => b.workers - a.workers).slice(0, 12);
    for (const h of peakHours) {
      const roles = h.roles ?? { COOK: 1, CASHIER: 1, PACKLINER: 1 };
      lines.push(
        `  ${String(h.hour).padStart(2, "0")}:00 — max ${h.workers} concurrent | need cook:${roles.COOK} cash:${roles.CASHIER} pack:${roles.PACKLINER} (sales ${h.sales.toFixed(0)})`
      );
    }
  }
  lines.push("Every hour 10:00–21:59 must have all three roles covered when staff are available.");
  lines.push("");

  lines.push("STAFFING MINIMUMS (this day only, only if within labour caps):");
  lines.push(JSON.stringify(dayStaffing ?? {}, null, 2));
  lines.push("");

  lines.push("LABOR RULES:");
  lines.push(`- Max weekly hours per employee: ${input.scheduling_preferences.max_weekly_hours}`);
  lines.push(`- Already scheduled earlier this week is in hours_scheduled_so_far`);
  lines.push(`- Rush hour priority: ${input.scheduling_preferences.rush_hour_priority}`);
  lines.push("");

  if (dayPeaks.length > 0) {
    lines.push("ML PEAK WINDOWS (this day, from last week's sales pattern):");
    for (const p of dayPeaks) {
      lines.push(
        `  ${String(p.hour).padStart(2, "0")}:00-${String(p.hour + 1).padStart(2, "0")}:00 — ${p.traffic_multiplier.toFixed(1)}x — cook:${p.recommended.cook} cash:${p.recommended.cash} pack:${p.recommended.pack}`
      );
    }
    lines.push("");
  }

  lines.push(`EMPLOYEES AVAILABLE ON ${dayName(dayOfWeek)} (${employees.length}):`);
  for (const emp of employees) {
    const avail = emp.availability
      .map((a) => `${a.start_time}-${a.end_time}`)
      .join(", ");
    const roleList = emp.roles?.length ? emp.roles.join("/") : emp.role;
    lines.push(`- ID: ${emp.id} | ${emp.name} | roles: ${roleList} | avail: ${avail}`);
    lines.push(
      `  rush=${emp.rush_hour_suitability.toFixed(2)} hrs_so_far=${emp.hours_scheduled_so_far} max=${emp.max_hours}`
    );
  }
  lines.push("");

  if (input.manager_preferences.length > 0) {
    lines.push("MANAGER PREFERENCES (apply when relevant):");
    for (const pref of input.manager_preferences.slice(0, 8)) {
      lines.push(`  - ${pref.description}`);
    }
    lines.push("");
  }

  if (input.ai_mistake_patterns.length > 0) {
    lines.push("AVOID THESE AI MISTAKES:");
    for (const pref of input.ai_mistake_patterns.slice(0, 8)) {
      lines.push(`  - ${pref.description}`);
    }
    lines.push("");
  }

  const historical = buildHistoricalStylePromptLines(employees.map((e) => e.name));
  if (historical.length > 0) {
    for (const line of historical) lines.push(line);
    lines.push("");
  }

  appendMlSchedulingPrior(lines, input.scheduling_prior);

  lines.push("Generate shifts for this day only. Return only the JSON object.");
  return lines.join("\n");
}

export function buildUserMessage(input: LLMPlannerInput): string {
  const lines: string[] = [];

  lines.push(`TARGET SCHEDULE WEEK: ${input.week_start} (Monday) through ${getWeekEnd(input.week_start)} (Sunday)`);
  lines.push("All shift dates you assign MUST fall within this week.");
  lines.push("WORKPLACE TIMEZONE: all times below are in workplace local time.");
  lines.push("");

  appendFloorContext(lines, input);

  lines.push("LABOUR CAPS (hard — from sales × 20% ÷ $20 wage, min 3 workers):");
  for (const d of input.workers_needed.byDay) {
    lines.push(`  ${d.date}: max ${d.workers} distinct employees (day sales ${d.sales.toFixed(0)})`);
  }
  lines.push("");

  lines.push("STAFFING REQUIREMENTS (minimum staff per role, per day — only if within labour caps):");
  lines.push(JSON.stringify(input.scheduling_preferences.staffing_requirements, null, 2));
  lines.push("");

  lines.push("LABOR RULES:");
  lines.push(`- Max weekly hours per employee: ${input.scheduling_preferences.max_weekly_hours}`);
  lines.push(`- Overtime threshold: ${input.scheduling_preferences.overtime_threshold}h`);
  lines.push(`- Rush hour priority enabled: ${input.scheduling_preferences.rush_hour_priority}`);
  lines.push("");

  const peakWindows = peakPredictionsForPrompt(input.ml_predictions);
  if (peakWindows.length > 0) {
    lines.push(
      "ML PEAK WINDOWS (from last week's sales, already mapped to THIS schedule week — use these dates/hours):"
    );
    for (const p of peakWindows) {
      lines.push(
        `  ${p.date} ${String(p.hour).padStart(2, "0")}:00-${String(p.hour + 1).padStart(2, "0")}:00 — multiplier ${p.traffic_multiplier.toFixed(1)}x — recommended: cook:${p.recommended.cook} cash:${p.recommended.cash} pack:${p.recommended.pack}`
      );
    }
    lines.push("");
  }

  lines.push("EMPLOYEES:");
  for (const emp of input.employees) {
    const avail = emp.availability
      .map((a) => `${dayName(a.day_of_week)} ${a.start_time}-${a.end_time}`)
      .join(", ");

    lines.push(`- ID: ${emp.id}`);
    lines.push(`  Name: ${emp.name} | Role: ${emp.role} | Preferred: ${emp.preferred_shift_type}`);
    lines.push(
      `  Scores: rush_suitability=${emp.rush_hour_suitability.toFixed(2)} performance=${emp.performance_level.toFixed(2)} reliability=${emp.reliability_score.toFixed(2)}`
    );
    lines.push(
      `  Hours: min_guaranteed=${emp.min_hours_guaranteed}h already_scheduled=${emp.hours_scheduled_so_far}h max=${emp.max_hours}h`
    );
    lines.push(`  Availability: ${avail || "none provided"}`);
  }
  lines.push("");

  if (input.manager_preferences.length > 0) {
    lines.push("LEARNED MANAGER PREFERENCES (consistent patterns from past weeks — apply these):");
    for (const pref of input.manager_preferences) {
      lines.push(`  - [confidence: ${pref.confidence_score.toFixed(2)}] ${pref.description}`);
    }
    lines.push("");
  }

  if (input.ai_mistake_patterns.length > 0) {
    lines.push("DO NOT REPEAT AI MISTAKES (manager flagged these as wrong in past weeks):");
    for (const pref of input.ai_mistake_patterns) {
      lines.push(`  - [confidence: ${pref.confidence_score.toFixed(2)}] ${pref.description}`);
    }
    lines.push("");
  }

  const normalWeeks = input.recent_schedules.filter((w) => !w.was_exception_week);
  if (normalWeeks.length > 0) {
    lines.push("RECENT SCHEDULE CONTEXT (normal weeks only, exceptions excluded):");
    for (const w of normalWeeks.slice(-4)) {
      lines.push(`  Week of ${w.week_start}: manager made ${w.manager_edits_count} edits`);
      for (const p of w.key_patterns) lines.push(`    → ${p}`);
    }
    lines.push("");
  }

  const historical = buildHistoricalStylePromptLines(input.employees.map((e) => e.name));
  if (historical.length > 0) {
    for (const line of historical) lines.push(line);
    lines.push("");
  }

  appendMlSchedulingPrior(lines, input.scheduling_prior);

  lines.push("Generate the schedule now. Return only the JSON object.");

  return lines.join("\n");
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}

function dayName(dayOfWeek: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek] ?? "Mon";
}

function appendMlSchedulingPrior(lines: string[], prior: Record<string, unknown> | undefined): void {
  if (!prior || Object.keys(prior).length === 0) return;
  const weeks = prior.weeks_trained;
  const shifts = prior.shifts_learned;
  lines.push(
    `ML-LEARNED SCHEDULING PRIOR (${weeks ?? "?"} historical weeks, ${shifts ?? "?"} shifts — statistical shape, do NOT copy verbatim):`
  );
  for (const g of (prior.guidance as string[] | undefined) ?? []) {
    lines.push(`  - ${g}`);
  }
  const templates = prior.shift_templates as Array<{ start: string; end: string; weight: number }> | undefined;
  if (templates?.length) {
    lines.push("  Learned shift templates (use as building blocks):");
    for (const t of templates.slice(0, 6)) {
      lines.push(`    • ${t.start}–${t.end} (${(t.weight * 100).toFixed(0)}% of historical shifts)`);
    }
  }
  const dowMult = prior.dow_multiplier as Record<string, number> | undefined;
  if (dowMult) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const parts = Object.entries(dowMult)
      .map(([d, m]) => `${names[Number(d)] ?? d}×${m.toFixed(2)}`)
      .join(", ");
    lines.push(`  Learned day-of-week staffing shape: ${parts}`);
  }
  lines.push("");
}
