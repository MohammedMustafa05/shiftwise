# ShiftWise — Constraint Engine Architecture Fix
# Cursor Agent Prompt: Fixing the Labour Formula vs Hard Constraint Conflict

---

## The Problem (Read This Before Touching Any Code)

The current engine is broken in one specific architectural way:

**The labour cost formula is being used as the primary decision-maker.
Hard constraints (1 cook, 1 pack, 1 cash per hour) are running as secondary checks.
This is backwards and must be completely reversed.**

The formula `workers_needed = (hourly_sales × labour_cost_pct) / avg_wage` tells you
**how many total workers demand justifies**. It has zero awareness of roles.
It does not know whether those workers are cooks, packliners, or cashiers.
It must never decide staffing composition — only total headcount above the mandatory floor.

The role coverage rules are non-negotiable hard constraints. They run first.
The formula runs second, only to determine how many extra workers to add on top.

---

## The Correct Mental Model

There are exactly TWO separate systems that run sequentially. Never mix them.

### System 1: The Floor Engine (Hard Constraints — Runs First)
- Assigns the mandatory minimum to every operating hour
- Completely ignores the labour formula
- Has no concept of cost, sales, or demand
- Cannot produce zero assignments for any covered hour
- If it cannot satisfy the floor: FLAG, do not reduce the floor

**Mandatory floor per operating hour (non-negotiable):**
- 1 cook (or multi-role employee covering cook)
- 1 packliner (or multi-role employee covering pack)
- 1 cashier (or multi-role employee covering cash)
- 1 veteran (hard during normal hours, soft during ML-identified low-traffic windows)

### System 2: The Demand Engine (Formula + ML — Runs Second)
- Calculates how many EXTRA workers above the floor the formula and ML suggest
- Only runs after the floor is fully satisfied
- Can produce zero extras — that is valid
- Assigns extras by role priority using ML predictions and LLM suggestions

---

## The Correct Formula Interpretation

```python
# WRONG (current engine):
workers_needed = (hourly_sales * labour_cost_pct) / avg_wage
# → used as total headcount target
# → role assignments are an afterthought

# CORRECT:
formula_headcount = max(MANDATORY_FLOOR, round((hourly_sales * labour_cost_pct) / avg_wage))
MANDATORY_FLOOR = 3   # 1 cook + 1 pack + 1 cash — always

extra_workers_needed = max(0, formula_headcount - MANDATORY_FLOOR)
# Floor engine assigns the 3 mandatory floor workers first
# Demand engine then assigns 'extra_workers_needed' on top, by role
# If formula produces 1.8, the floor engine still assigns 3
# The formula result of 1.8 is not used — floor wins
```

---

## The Two-Phase Architecture to Build

### Phase 1: Floor Assignment

```python
def assign_floor_coverage(
    operating_hours: list[HourSlot],
    employees: list[Employee],
    availability: dict,
    preferences: SchedulingPreferences,
) -> tuple[list[ShiftAssignment], list[Flag]]:
    """
    Assigns mandatory minimum coverage to every operating hour.
    
    Rules enforced here (and ONLY here — do not mix with demand logic):
    - H1: 1 cook, 1 packliner, 1 cashier per hour
    - H2: 1 veteran per hour (hard constraint, unless ML flags as low-traffic → soft)
    - H4: All 3 roles filled before any role gets a second person
    - H5: Availability only — never schedule outside approved windows
    - H9: Role qualification — cook stays cook, pack stays pack, cash stays cash
    - H10: Multi-role employees assigned one role per shift
    - H11: Vet can replace intermediate, not vice versa
    - H12: Trainee cannot be sole person in role
    
    Assignment priority within each role:
    1. Veterans first (satisfies H2 while filling H1)
    2. Intermediates
    3. Trainees (only if a non-trainee is also assigned to the same role)
    
    Returns: (assignments_list, flags_list)
    If a floor slot cannot be filled: add a HARD FLAG for that slot, continue.
    NEVER reduce the floor requirement. NEVER cross-assign roles.
    NEVER skip a flag to produce a cleaner schedule.
    """
    assignments = []
    flags = []

    for hour_slot in operating_hours:
        for required_role in ['COOK', 'PACK', 'CASH']:
            eligible = get_eligible_employees(
                role=required_role,
                hour=hour_slot,
                employees=employees,
                availability=availability,
                already_assigned=assignments,
            )

            if not eligible:
                flags.append(Flag(
                    severity='hard',
                    code='H1_ROLE_COVERAGE_GAP',
                    day=hour_slot.date,
                    time_window=hour_slot.time_range,
                    role=required_role,
                    detail=f'No eligible {required_role} available for {hour_slot}. '
                           f'Cannot meet mandatory floor coverage.',
                ))
                continue  # flag and move on — do not compensate

            # Assign the best eligible employee (vet first, then intermediate, then trainee)
            best = select_best_employee(eligible, prefer_veteran=True)
            assignments.append(ShiftAssignment(
                employee_id=best.id,
                role=required_role,
                date=hour_slot.date,
                start_time=hour_slot.start,
                end_time=hour_slot.end,
                is_floor_assignment=True,
            ))

        # After all 3 roles filled: check veteran coverage (H2)
        vet_on_shift = any(
            a for a in assignments
            if a.date == hour_slot.date
            and overlaps(a, hour_slot)
            and is_veteran(a.employee_id, employees)
        )
        if not vet_on_shift and not is_low_traffic(hour_slot):
            flags.append(Flag(
                severity='hard',
                code='H2_NO_VETERAN',
                day=hour_slot.date,
                time_window=hour_slot.time_range,
                detail='No veteran on shift. Minimum veteran coverage not met.',
            ))

    return assignments, flags
```

### Phase 2: Demand Assignment

```python
def assign_demand_coverage(
    floor_assignments: list[ShiftAssignment],
    operating_hours: list[HourSlot],
    employees: list[Employee],
    availability: dict,
    hourly_sales: dict,          # {date: {hour: sales_amount}}
    labour_cost_pct: float,
    avg_wage: float = 21.0,
    ml_predictions: list,        # from Prophet service
    llm_suggestions: list,       # from LLM planner
    preferences: SchedulingPreferences,
) -> tuple[list[ShiftAssignment], list[Flag]]:
    """
    Calculates extra workers above the mandatory floor using the labour formula.
    Only runs after floor_assignments is complete.
    
    The formula:
        formula_headcount = max(FLOOR, round((hourly_sales * labour_cost_pct) / avg_wage))
        extra_needed = max(0, formula_headcount - floor_already_assigned_this_hour)
    
    Floor already assigned = count of floor_assignments overlapping this hour.
    extra_needed = how many MORE to add on top.
    
    Extra assignment priority:
    1. Roles identified by ML as needing reinforcement during peak windows
    2. LLM suggestions for specific employees to those roles
    3. Employee performance and rush-hour suitability scores
    4. Fairness distribution (H14, H16)
    
    This phase NEVER reduces below the floor.
    It only ADDS workers. Minimum extra = 0.
    """
    MANDATORY_FLOOR = 3
    demand_assignments = []
    flags = []

    for hour_slot in operating_hours:
        sales = hourly_sales.get(str(hour_slot.date), {}).get(hour_slot.hour, 0)

        # Formula: how many total workers does demand justify?
        if sales > 0:
            formula_total = max(MANDATORY_FLOOR,
                                round((sales * labour_cost_pct) / avg_wage))
        else:
            formula_total = MANDATORY_FLOOR  # no sales data → just the floor

        # Count floor workers already assigned this hour
        floor_this_hour = count_assignments_overlapping(floor_assignments, hour_slot)

        # How many extras does the formula say we need?
        extra_needed = max(0, formula_total - floor_this_hour)

        if extra_needed == 0:
            continue  # floor already meets or exceeds demand — nothing to add

        # Get ML recommendation for role breakdown of extras
        ml_rec = get_ml_recommendation(ml_predictions, hour_slot)
        # ml_rec = {"cook": 1, "pack": 0, "cash": 1} — how many extras per role

        # Assign extras by role priority
        for role, count in ml_rec.items():
            for _ in range(count):
                eligible = get_eligible_for_extra(
                    role=role,
                    hour=hour_slot,
                    employees=employees,
                    availability=availability,
                    all_assignments=floor_assignments + demand_assignments,
                    preferences=preferences,
                )
                if eligible:
                    best = select_with_llm_preference(eligible, llm_suggestions, hour_slot, role)
                    demand_assignments.append(ShiftAssignment(
                        employee_id=best.id,
                        role=role,
                        date=hour_slot.date,
                        start_time=hour_slot.start,
                        end_time=hour_slot.end,
                        is_floor_assignment=False,
                    ))

    return demand_assignments, flags
```

### Phase 3: Merge + Validate

```python
def build_schedule(workplace_id: str, week_start: date, ...) -> ScheduleDraft:
    """
    Full generation pipeline. Phases run in strict order.
    """
    # ── PHASE 1: ML predictions (demand forecast) ──────────────────────
    ml_predictions = ml_service.predict(workplace_id, week_start)

    # ── PHASE 2: LLM suggestions (soft preferences, not decisions) ─────
    llm_output = llm_planner.generate(input)
    # llm_output.shifts are SUGGESTIONS — they go to demand phase only
    # they NEVER override floor assignments

    # ── PHASE 3: Floor engine (hard constraints, no formula) ────────────
    floor_assignments, floor_flags = assign_floor_coverage(
        operating_hours, employees, availability, preferences
    )
    # Floor is complete. Hard flags compiled.
    # Do not proceed past this point if floor_flags contains UNSATISFIED role gaps
    # (proceed anyway — full draft must always be returned — but mark schedule invalid)

    # ── PHASE 4: Demand engine (formula on top of floor) ────────────────
    demand_assignments, demand_flags = assign_demand_coverage(
        floor_assignments=floor_assignments,
        hourly_sales=hourly_sales,
        labour_cost_pct=0.28,   # 28% — configure per workplace
        avg_wage=21.0,
        ml_predictions=ml_predictions,
        llm_suggestions=llm_output.shifts,  # passed as preference hints only
        ...
    )

    # ── PHASE 5: Merge and deduplicate ──────────────────────────────────
    all_assignments = merge_assignments(floor_assignments, demand_assignments)
    # merge: combine overlapping floor + demand assignments for same employee
    # into single shifts where possible (respecting H6 min 3h, H7 max 14h)

    # ── PHASE 6: Fairness pass ──────────────────────────────────────────
    all_assignments = apply_fairness(all_assignments, employees, preferences)
    # H13: min hours, H14: fairness before saturation, H15: alternate open/close

    # ── PHASE 7: Late-night rule ─────────────────────────────────────────
    late_night_flags = check_late_night_headcount(all_assignments, operating_hours)

    # ── PHASE 8: Full constraint validation pass ─────────────────────────
    validation_flags = run_full_validation(all_assignments, employees, availability)

    # ── PHASE 9: Compile all flags ───────────────────────────────────────
    all_flags = floor_flags + demand_flags + late_night_flags + validation_flags

    # ── PHASE 10: Return draft (always — even with flags) ────────────────
    return ScheduleDraft(
        shifts=all_assignments,
        flags=all_flags,
        can_publish=not any(f.severity == 'hard' for f in all_flags),
    )
```

---

## What to Change in the Existing Code

### File: `apps/ml/app/services/prophet_service.py` or equivalent engine file

**Find any code that looks like this:**
```python
workers_needed = (hourly_sales * labour_cost_pct) / avg_wage
# followed by role assignment logic
```

**Replace the logic with:**
```python
MANDATORY_FLOOR = 3  # Always — 1 cook + 1 pack + 1 cash

# Step 1: Assign floor first (separate function — no formula involved)
floor_assignments = assign_floor_coverage(...)

# Step 2: Formula only determines EXTRAS
formula_total = max(MANDATORY_FLOOR, round((hourly_sales * labour_cost_pct) / avg_wage))
floor_count   = len([a for a in floor_assignments if overlaps_hour(a, hour)])
extra_needed  = max(0, formula_total - floor_count)

# Step 3: Assign extras
if extra_needed > 0:
    demand_assignments = assign_demand_coverage(extra_needed, ...)
```

### File: wherever role assignment happens (likely in the scheduler or engine loop)

**Remove any code that:**
- Uses the formula output as a headcount target and then tries to fit roles
- Checks role coverage as a post-generation validation step
- Reduces minimum headcount if the formula suggests fewer than 3 workers

**Add:**
- `assign_floor_coverage()` as the first step in every schedule generation call
- A guard that prevents demand engine from reducing below floor: `extra = max(0, ...)`
- Explicit flag generation when floor cannot be satisfied (do not silently skip)

---

## Constraint Priority Hierarchy (Reference This When Agent Gets Confused)

The engine must evaluate constraints in this exact priority order.
Lower-numbered constraints ALWAYS win over higher-numbered ones.
If two constraints conflict, flag both — never silently choose one.

```
PRIORITY 1 (ABSOLUTE — runs before everything):
  - Employee cannot be scheduled outside approved availability
  - Employee cannot exceed max_weekly_hours

PRIORITY 2 (FLOOR — runs before formula):
  - 1 cook per operating hour
  - 1 packliner per operating hour
  - 1 cashier per operating hour
  - 1 veteran per operating hour (hard, except soft during low-traffic)
  - All 3 roles filled before any role gets a 2nd person

PRIORITY 3 (FORMULA — runs after floor is satisfied):
  - workers_needed = (hourly_sales × labour_cost_pct) / avg_wage
  - Determines extra_workers = max(0, formula_result - floor_count)
  - Distributes extras by role using ML predictions

PRIORITY 4 (SOFT — optimize for, but yield to P1/P2/P3):
  - Fairness variance < 4h between same-role employees
  - Alternate open/close assignments
  - Preferred shift types (morning/afternoon/evening)
  - LLM-suggested employee-to-shift mappings

PRIORITY 5 (FLAGS — never blocks generation, blocks publish):
  - Compile all violations after full draft is complete
  - Hard flags: P1/P2 violations → block publish
  - Warning flags: P4 violations → acknowledge before publish
```

---

## Exact Language to Use With Your Cursor Agent

When you give this to your agent, say this at the top:

> "The current scheduling engine has one critical architectural flaw: it uses the labour cost formula as the primary decision-maker and checks role coverage as a secondary step. This must be completely reversed. Read this entire document before touching any code. The fix is not a small patch — it is a restructuring of the generation pipeline into two separate phases: Floor Phase (hard constraints, no formula) and Demand Phase (formula on top of floor). Implement exactly as specified."

Then paste this entire document.

---

## How to Verify the Fix Is Working

After implementing, run these manual tests in order. If any fail, the fix is incomplete.

```
Test 1 — Low sales hour must still get 3 workers
  Setup: hourly_sales = $20, labour_cost_pct = 0.28, avg_wage = 21
  Formula: ($20 × 0.28) / 21 = 0.27 → rounds to 0
  Expected: Engine assigns 3 workers (1 cook, 1 pack, 1 cash) — floor wins
  Fail: Engine assigns 0 or 1 worker because formula said < 3

Test 2 — Role composition must be correct even at low demand
  Setup: 1 worker suggested by formula, only packliners available
  Expected: HARD FLAG for missing cook and cashier
  Fail: Engine assigns 1 packliner and marks schedule valid

Test 3 — Busy hour correctly adds extras above floor
  Setup: hourly_sales = $500, labour_cost_pct = 0.28, avg_wage = 21
  Formula: ($500 × 0.28) / 21 = 6.67 → rounds to 7
  Floor: 3 workers (1 per role) already assigned
  Expected: demand engine adds 4 extra workers by role
  Fail: Engine treats 7 as total and assigns without floor guarantee

Test 4 — Multi-role employee counts correctly for floor
  Setup: Only 2 employees available — Marcus (cook+pack), Sarah (cash)
  Expected: Floor is satisfied — Marcus covers cook AND pack, Sarah covers cash
  Fail: Engine flags missing packliner because it treats Marcus as cook-only

Test 5 — Formula cannot override availability
  Setup: Formula says 5 workers needed, only 2 employees are available
  Expected: 2 workers assigned, hard flags for uncovered roles
  Fail: Engine stretches employees or cross-assigns roles to reach 5

Test 6 — Late night rule still enforced with multi-role
  Setup: After 10pm, only 1 employee available (Sarah, all 3 roles)
  Expected: HARD FLAG — headcount must be 2 people minimum, not 2 role qualifications
  Fail: Engine accepts 1 person because their multi-role covers all 3 roles
```

---

## What NOT to Change

- The Prophet ML service — it is correct. Peak window predictions feed Phase 3 demand only.
- The LLM planner — it is correct. LLM suggestions feed Phase 3 demand as preferences only.
- The constraint validator — it is correct. But it currently runs too late. It must also run after Phase 2 (floor), not only at the end.
- The flag system — it is correct. No changes needed.
- The Supabase schema — no changes needed.

The only thing broken is the sequencing of the formula vs the floor.
Fix the sequence. Everything else stays.

---

*End of fix prompt. Implement Phase 1 (floor engine) first and verify Test 1-4 pass before
implementing Phase 2 (demand engine). Do not merge the two phases into one function.*
