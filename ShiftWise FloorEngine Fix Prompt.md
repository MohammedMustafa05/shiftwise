# ShiftWise — Floor Engine Fix: 7 Specific Bugs to Fix
# Cursor Agent Prompt — Based on Constraint Solver Trace Analysis

> This prompt is based on a full trace of constraintSolver.ts and scheduleService.ts.
> Every fix below is targeted to a specific line range or function.
> Do not refactor anything not listed here. Fix only what is specified.

---

## What the Trace Confirmed

The floor engine DOES run. It ran, failed to fill slots, recorded H1_ROLE_COVERAGE_GAP
flags, and the pipeline continued publishing the broken schedule anyway.

84 violations = floor tried and gave up silently on ~28+ role/hour slots.

There are 7 specific bugs. Fix them in this exact order.

---

## Bug 1 — CRITICAL: LLM runs before floor at the service level

**File:** `scheduleService.ts` lines ~311-371

**Problem:**
```typescript
// CURRENT (broken order):
const llmOutput = await generateScheduleWithLLM(llmInput, scheduleId);  // LLM first
const { shifts, hardFlags } = validateAndFill({
  llmSuggestions: llmOutput.shifts,   // floor runs INSIDE solver, AFTER LLM planned
  ...
});
```

The LLM plans a full week of shifts without knowing what the floor engine
will require. By the time the solver's Phase 2 (floor) runs inside validateAndFill,
the LLM has already decided who works where, and the floor is trying to
patch gaps that the LLM created.

**Fix:** Run a pre-flight floor check BEFORE calling generateScheduleWithLLM.
Pass the floor output into the LLM as locked context.

```typescript
// FIXED order in scheduleService.ts:

// STEP 1: Run floor engine FIRST — get mandatory assignments
const floorAssignments = await runFloorEngineOnly({
  employees,
  availability,
  workersNeeded,
  weekStart,
  scheduleDates,
});

// STEP 2: Build LLM input with floor assignments as locked context
const llmInput: LLMPlannerInput = {
  ...existingLlmInput,
  floor_assignments: floorAssignments.shifts,  // LLM must not contradict these
  floor_gaps: floorAssignments.gaps,           // LLM knows which slots are unfillable
};

// STEP 3: LLM runs AFTER floor — only assigns extras above floor
const llmOutput = await generateScheduleWithLLM(llmInput, scheduleId);

// STEP 4: Solver merges floor + LLM, runs demand phase
const { shifts, hardFlags } = validateAndFill({
  llmSuggestions: llmOutput.shifts,
  baselineShifts: [...floorAssignments.shifts, ...mlResult.shifts],
  ...solverParams,
});
```

**Add this function to constraintSolver.ts:**
```typescript
export function runFloorEngineOnly(params: {
  employees: Employee[];
  availability: AvailabilityMap;
  workersNeeded: WorkersNeeded;
  weekStart: string;
  scheduleDates: string[];
}): { shifts: SolverShift[]; gaps: FloorGap[] } {
  // Run ONLY Phase 2 (floor fill) from validateAndFill
  // Return the shifts it managed to assign + gaps it could not fill
  // This is the same logic as Phase 2 inside validateAndFill,
  // extracted as a standalone function so it can run before the LLM
  const accepted: SolverShift[] = [];
  const demand = workersNeededMaps(params.workersNeeded, params.weekStart);

  for (let pass = 0; pass < 5; pass++) {
    fillRoleGaps({
      accepted,
      demand,
      empById: buildEmpMap(params.employees),
      availByUser: buildAvailMap(params.availability),
      hoursByUser: new Map(),
      phase: 'floor',
      scheduleDates: params.scheduleDates,
    });
  }

  const gaps = auditFloorHardFlags(accepted, params.scheduleDates);
  return { shifts: accepted, gaps };
}
```

---

## Bug 2 — CRITICAL: `if (!assigned) break` silently gives up

**File:** `constraintSolver.ts` lines ~531-634, inside `fillRoleGaps()`

**Problem:**
```typescript
while (concurrentRoleCounts(accepted, date, hour)[role] < required && guard < 32) {
  // ... try to assign ...
  if (!assigned) break;  // ← SILENT FAILURE — gives up, no log, no flag yet
}
```

When no candidate can be found for a role/hour, the loop breaks silently.
The hard flag only appears AFTER all 5 passes complete via `auditFloorHardFlags`.
By then, the pipeline has moved on. There is no early signal to the LLM.

**Fix:** Add diagnostic logging when floor gives up, and count failures:
```typescript
if (!assigned) {
  // Log WHY it failed — this is critical for debugging
  const roleCount = concurrentRoleCounts(accepted, date, hour)[role];
  if (phase === 'floor') {
    console.warn(
      `[FloorEngine] FLOOR GAP: ${date} hour=${hour} role=${role} ` +
      `current=${roleCount} required=${required} ` +
      `candidates_checked=${candidates.length} ` +
      `reason=no_eligible_employee_could_be_assigned`
    );
  }
  break;
}
```

This logging must include WHY each candidate failed. Add a rejection tracker:
```typescript
const rejections: string[] = [];

for (const emp of candidates) {
  const blocks = (availByUser.get(emp.user_id) ?? []).filter((b) => b.day_of_week === dow);

  if (blocks.length === 0) {
    rejections.push(`${emp.user_id}: no availability blocks for DOW ${dow}`);
    continue;
  }
  if (hasTimeOff(emp.user_id, date)) {
    rejections.push(`${emp.user_id}: time off`);
    continue;
  }

  const win = bestOperatingShiftWindow(/* ... */);
  if (!win) {
    rejections.push(`${emp.user_id}: no valid window (avail < 3h or outside operating hours)`);
    continue;
  }
  if (shiftsOverlap(/* ... */)) {
    rejections.push(`${emp.user_id}: already has shift this day`);
    continue;
  }
  if (total > maxHoursFor(emp)) {
    rejections.push(`${emp.user_id}: would exceed max hours (${total}h > ${maxHoursFor(emp)}h)`);
    continue;
  }
  // ... etc
}

if (!assigned && phase === 'floor') {
  console.warn(
    `[FloorEngine] FLOOR GAP ${date} ${hour}:00 ${role}\n` +
    rejections.map(r => `  - ${r}`).join('\n')
  );
}
```

**Run one schedule generation after adding this logging and paste the output.**
The rejection reasons will tell you exactly which of the remaining bugs is
causing each specific gap (Friday zero cooks, Wednesday 1 person, Sunday 2).

---

## Bug 3 — HIGH: `demand null` skips the entire floor engine

**File:** `constraintSolver.ts` lines ~751, ~898-985

**Problem:**
```typescript
const demand = workersNeeded ? workersNeededMaps(workersNeeded, weekStart) : null;

// ...later:
if (demand) {
  // Phase 2: floor engine runs ← ONLY if demand is truthy
} else {
  // NO FLOOR AT ALL — LLM suggestions only ← this is the silent bypass
  for (const s of llmSuggestions) { tryAcceptShift(s, false); }
}
```

If `workersNeeded` is null/undefined/empty when `validateAndFill` is called,
the ENTIRE floor engine is skipped. The schedule gets built from LLM suggestions
only — with no role coverage enforcement at all.

**Fix:** Make `workersNeeded` mandatory. Never allow the solver to run without it:
```typescript
// At the top of validateAndFill():
if (!workersNeeded || Object.keys(workersNeeded).length === 0) {
  throw new Error(
    '[ConstraintSolver] workersNeeded is required. ' +
    'Cannot run schedule generation without demand data. ' +
    'Ensure the ML service has been called and returned predictions before invoking validateAndFill.'
  );
}

// Remove the null branch entirely:
const demand = workersNeededMaps(workersNeeded, weekStart);
// No more `if (demand) { ... } else { ... }` — demand is always present
```

Also verify in `scheduleService.ts` that `workersNeeded` is always built before
calling `validateAndFill`. Add a guard:
```typescript
if (!mlResult?.workersNeeded || Object.keys(mlResult.workersNeeded).length === 0) {
  // Build a minimal workersNeeded from operating hours alone (floor-only mode)
  mlResult.workersNeeded = buildMinimalWorkersNeeded(scheduleDates, operatingHours);
}
```

Where `buildMinimalWorkersNeeded` creates the floor-only demand structure
(3 workers per hour, 1 cook + 1 pack + 1 cash) from just the operating hours —
no ML predictions needed.

---

## Bug 4 — HIGH: Role caps applied during floor fill can block valid assignments

**File:** `constraintSolver.ts` lines ~285-305, `exceedsLabourCap()`

**Problem:**
```typescript
function exceedsLabourCap(/* ... */ options?: { coreFillOnly?: boolean }): boolean {
  if (exceedsRoleCapAtAnyHour(/* ... */)) return true;  // ALWAYS checked, even in floor
  if (options?.coreFillOnly) {
    return false;  // headcount cap bypassed — but role cap already rejected above
  }
}
```

During floor phase, the headcount cap is correctly bypassed. But
`exceedsRoleCapAtAnyHour` (which enforces max 1 cook, max 3 pack, max 3 cash
per hour) runs FIRST and returns `true` before the `coreFillOnly` bypass fires.

This means: if somehow 2 people are already counted as cook for an hour
(e.g. from a baseline shift + a floor attempt), the floor cannot assign a
third person as cook even if the floor requirement says it must.

For floor phase (coreFillOnly=true), role caps should be minimum-checking only:

**Fix:**
```typescript
function exceedsLabourCap(
  /* ... */
  options?: { coreFillOnly?: boolean }
): boolean {
  if (options?.coreFillOnly) {
    // During floor phase: ONLY check that we're not scheduling an employee
    // beyond their personal max_hours. Role composition caps do NOT apply.
    // The floor MUST place 1 cook even if 2 cooks are somehow already present.
    return exceedsPersonalHoursCap(/* ... */);
  }
  // Demand phase: full cap checking
  if (exceedsRoleCapAtAnyHour(/* ... */)) return true;
  if (exceedsTotalHeadcountCap(/* ... */)) return true;
  return false;
}
```

---

## Bug 5 — MEDIUM: H1 flags not re-audited after Phase 5 (prune)

**File:** `constraintSolver.ts` lines ~939, ~981

**Problem:**
```typescript
// Phase 2 ends:
hardFlags.push(...auditFloorHardFlags(accepted, demand.scheduleDates));  // line ~939

// Phase 3: LLM suggestions added
// Phase 4: Demand extras added
// Phase 5: Prune (can REMOVE shifts, potentially creating new H1 gaps)
violationsFixed += pruneOverScheduling(accepted, demand, empById);

// H1 audit NOT called again after prune
hardFlags.push(...auditLateNightHardFlags(/* ... */));  // only late-night re-audited
```

After pruning, new H1 gaps can be created (prune removes an overstaffed
shift that was also the only shift covering a role at some hours).
These post-prune gaps are captured in `roleCoverageGaps` (line ~981)
but NOT in `hardFlags`, so they don't block publishing.

**Fix:** Re-run auditFloorHardFlags after prune and merge:
```typescript
// After Phase 5 (prune):
violationsFixed += pruneOverScheduling(accepted, demand, empById);

// Re-audit H1 after prune — prune may have created new gaps
const postPruneHardFlags = auditFloorHardFlags(accepted, demand.scheduleDates);
hardFlags.push(...postPruneHardFlags);

// De-duplicate (same slot may have been flagged twice)
const uniqueHardFlags = deduplicateFlags(hardFlags);
```

---

## Bug 6 — MEDIUM: Double validateAndFill inflates flag count

**File:** `scheduleService.ts` lines ~427-428

**Problem:**
```typescript
// First validateAndFill call produces hardFlags
// Then a second validateAndFill runs after trainee hour-caps:
const allHardFlags = [...hardFlags, ...hardFlagsAfterPrefs];  // ← concatenated, not merged
```

The same H1_ROLE_COVERAGE_GAP for the same date/hour/role is added twice.
This inflates flag counts (e.g. 84 flags may actually be ~42 unique violations
reported twice), which can confuse the manager UI.

**Fix:** Deduplicate before returning:
```typescript
function deduplicateFlags(flags: SolverHardFlag[]): SolverHardFlag[] {
  const seen = new Set<string>();
  return flags.filter(f => {
    const key = `${f.code}:${f.date}:${f.hour}:${f.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// In scheduleService.ts:
const allHardFlags = deduplicateFlags([...hardFlags, ...hardFlagsAfterPrefs]);
```

---

## Bug 7 — MEDIUM: bestOperatingShiftWindow silent 3h minimum rejection

**File:** `constraintSolver.ts` lines ~337-361, `bestOperatingShiftWindow()`

**Problem:**
```typescript
if (aE - aS < MIN_SHIFT_HOURS * 60) return null;  // returns null silently
```

An employee may be available from 8PM to 10PM. The store closes at 10PM.
The floor needs a Cook at 9PM. The intersection is 2 hours — below the 3h minimum.
`bestOperatingShiftWindow` returns `null`. The employee is rejected.
No log. No explanation. The floor gap persists.

This is almost certainly a major contributor to Wednesday, Sunday, and
late-night gaps — employees with evening-only availability who can cover
the last 2 hours of operation but get rejected because 2h < 3h minimum.

**Two possible fixes — choose one:**

**Option A (strict — maintain 3h minimum, always):**
Add logging so you can see which employees are being rejected for this reason:
```typescript
if (aE - aS < MIN_SHIFT_HOURS * 60) {
  // Log this — it's a common silent failure
  console.debug(
    `[FloorEngine] ${empId} rejected for ${role} on ${date} hour=${mustIncludeHour}: ` +
    `avail window ${fromMinutes(aS)}-${fromMinutes(aE)} is ${(aE-aS)/60}h < ${MIN_SHIFT_HOURS}h minimum`
  );
  return null;
}
```

**Option B (flexible — allow shorter closing shifts):**
For floor-phase assignments only, allow a 2h minimum if the shift extends
to store closing time (no choice — store closes, shift must be shorter):
```typescript
const isClosingShift = aE >= opEnd;  // shift ends at or after store close
const effectiveMin = (phase === 'floor' && isClosingShift)
  ? 2  // allow 2h minimum for closing floor assignments
  : MIN_SHIFT_HOURS;  // 3h for all others

if (aE - aS < effectiveMin * 60) return null;
```

**Recommendation:** Use Option B. The 3h minimum is a labour rule for
regular shifts. A 2-hour closing shift is better than a hard violation
(NO COOK for the last 2 hours). The manager can always override.

---

## After All 7 Fixes — Run This Verification

```typescript
// Add to scheduleService.ts — run after generation, before returning to client:

function assertFloorCoverage(shifts: SolverShift[], scheduleDates: string[]): void {
  const gaps: string[] = [];

  for (const date of scheduleDates) {
    const { open, close } = operatingHoursForDate(date);
    for (let hour = open; hour < close; hour++) {
      const counts = concurrentRoleCounts(shifts, date, hour);
      if (counts.COOK < 1)       gaps.push(`${date} ${hour}:00 — NO COOK`);
      if (counts.PACKLINER < 1)  gaps.push(`${date} ${hour}:00 — NO PACKLINER`);
      if (counts.CASHIER < 1)    gaps.push(`${date} ${hour}:00 — NO CASHIER`);
    }
  }

  if (gaps.length > 0) {
    console.error(`[ScheduleVerification] Floor coverage gaps after generation:`);
    gaps.forEach(g => console.error(`  ✗ ${g}`));
    // Do NOT throw — still return the schedule with flags
    // But this log tells you immediately if the fixes worked
  } else {
    console.log(`[ScheduleVerification] ✓ Full floor coverage achieved — 0 gaps`);
  }
}

// Call it at the end of generateSchedule():
assertFloorCoverage(finalShifts, scheduleDates);
```

---

## Priority Order for Implementation

```
Fix 1 — Move floor before LLM call in scheduleService.ts        ← Do this first
Fix 2 — Add rejection logging to fillRoleGaps                   ← Do this second
           (run one generation, read the logs, then do 3-7)
Fix 3 — Make workersNeeded mandatory, remove null bypass        ← Do third
Fix 4 — Fix exceedsLabourCap during floor phase                ← Do fourth
Fix 7 — Allow 2h closing shifts (Option B)                     ← Do fifth
Fix 5 — Re-audit H1 after prune                                ← Do sixth
Fix 6 — Deduplicate flags                                      ← Do last (cosmetic)
```

---

## What to Tell the Agent

> "Read this entire document before touching any code.
> There are 7 specific bugs in constraintSolver.ts and scheduleService.ts.
> Fix them in the priority order in the last section.
> After Fix 2, STOP and run one schedule generation.
> Paste the console output showing [FloorEngine] FLOOR GAP logs.
> That output will confirm which of the remaining fixes (3-7) is the primary cause.
> Do not refactor anything outside the functions listed.
> After all fixes, run assertFloorCoverage and confirm 0 gaps before closing."

---

*End of fix prompt.*
*Expected outcome: Friday gets a Cook. Wednesday gets 3 roles. Sunday gets 3 roles.*
*Hard violation count should drop from 84 to 0 or near-0 on a complete employee roster.*
