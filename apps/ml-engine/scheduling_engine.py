"""
Two-phase scheduling demand model (Floor → Demand).

Phase 1 — Floor: mandatory 1 cook + 1 cash + 1 pack every operating hour.
Phase 2 — Demand: formula determines extras only above the floor.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from labour import (
    AVG_WAGE,
    LABOUR_COST_PCT,
    MANDATORY_FLOOR,
    MAX_ROLE_STAFF,
    OPERATING_HOURS,
    combined_role_targets,
    compute_workers,
    compute_workers_needed,
    extra_role_targets,
    extra_workers_from_formula,
    floor_role_targets,
    formula_headcount_from_sales,
)


# Minimum length for an extra-worker shift segment (matches the API solver's
# MIN_SHIFT_HOURS).  Demand dips shorter than this keep the worker on shift.
MIN_EXTRA_SHIFT_HOURS = 3


def _extra_shift_segments(
    hours: list[int], extras_by_hour: dict[int, int]
) -> list[tuple[int, int]]:
    """
    Decompose an hourly extras curve into shift segments (start_hour, end_hour).

    LIFO stack: rising demand opens new extra shifts; falling demand closes the
    most recently opened first, so long-running extras hold their shift across
    brief dips while short peak extras are released.  Segments shorter than
    MIN_EXTRA_SHIFT_HOURS are extended (forward, else backward) because a real
    employee cannot be called in for a 1-hour shift.
    """
    if not hours:
        return []
    open_hour, close_hour = hours[0], hours[-1] + 1
    segments: list[tuple[int, int]] = []
    stack: list[int] = []  # start hours of currently-open extra shifts
    prev: int | None = None

    for h in hours:
        if prev is not None and h > prev + 1:
            for s in reversed(stack):
                segments.append((s, prev + 1))
            stack = []
        needed = max(0, extras_by_hour.get(h, 0))
        while len(stack) < needed:
            stack.append(h)
        while len(stack) > needed:
            segments.append((stack.pop(), h))
        prev = h

    last_end = (prev + 1) if prev is not None else close_hour
    for s in reversed(stack):
        segments.append((s, last_end))

    fixed: list[tuple[int, int]] = []
    for start, end in segments:
        if end - start < MIN_EXTRA_SHIFT_HOURS:
            end = min(start + MIN_EXTRA_SHIFT_HOURS, close_hour)
        if end - start < MIN_EXTRA_SHIFT_HOURS:
            start = max(open_hour, end - MIN_EXTRA_SHIFT_HOURS)
        if end > start:
            fixed.append((start, end))
    fixed.sort()
    return fixed


def smooth_demand_to_shift_windows(
    by_hour: list[dict],
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
) -> tuple[list[dict], dict]:
    """
    Shift-feasible demand smoothing with weekly labour-budget enforcement.

    Replaces the old window-peak propagation (which inflated EVERY hour in the
    open/close block to the block peak and blew the labour budget) with:

      1. Per day, extras above the mandatory floor are decomposed into shift
         segments via a LIFO stack with a minimum segment length, so the caps
         follow the true demand contour yet remain realisable by real shifts.
      2. Weekly budget reconciliation:
             budget_hours = weekly_sales × labour_pct / avg_wage
         Floor hours (3 per operating hour) are mandatory and always kept.
         Extra segments compete for the remaining budget, ranked by marginal
         value (average hourly sales covered) — busiest hours keep their
         staff, quiet-day bumps are dropped first.  Busy days are therefore
         never underscheduled in favour of quiet ones.

    Returns (rows, summary) where summary reports budget/projected hours and
    the projected labour percentage.
    """
    from collections import defaultdict

    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in by_hour:
        by_date[str(row["date"])].append(row)

    weekly_sales = sum(float(r.get("sales") or 0) for r in by_hour)
    budget_hours = (weekly_sales * labour_pct) / avg_wage if avg_wage > 0 else 0.0
    floor_hours = float(len(by_hour) * MANDATORY_FLOOR)
    extra_budget = max(0.0, budget_hours - floor_hours)

    # Collect candidate extra segments across the whole week with their value.
    candidates: list[dict] = []
    for date, rows in sorted(by_date.items()):
        rows.sort(key=lambda r: int(r["hour"]))
        hours = [int(r["hour"]) for r in rows]
        sales_at = {int(r["hour"]): float(r.get("sales") or 0) for r in rows}
        extras_at = {
            int(r["hour"]): max(
                0, min(MAX_ROLE_STAFF, int(r["workers"])) - MANDATORY_FLOOR
            )
            for r in rows
        }
        for start, end in _extra_shift_segments(hours, extras_at):
            seg_hours = end - start
            seg_sales = sum(sales_at.get(h, 0.0) for h in range(start, end))
            candidates.append({
                "date": date,
                "start": start,
                "end": end,
                "hours": seg_hours,
                "value": seg_sales / seg_hours if seg_hours else 0.0,
            })

    # Greedy keep: highest marginal value first while budget remains.
    candidates.sort(key=lambda c: (-c["value"], c["date"], c["start"]))
    kept: list[dict] = []
    dropped: list[dict] = []
    used = 0.0
    for c in candidates:
        if used + c["hours"] <= extra_budget + 1e-9:
            kept.append(c)
            used += c["hours"]
        else:
            dropped.append(c)

    kept_by_date: dict[str, list[dict]] = defaultdict(list)
    for c in kept:
        kept_by_date[c["date"]].append(c)

    result: list[dict] = []
    for date, rows in sorted(by_date.items()):
        for r in rows:
            hour = int(r["hour"])
            extra = sum(
                1 for c in kept_by_date[date] if c["start"] <= hour < c["end"]
            )
            extra = min(extra, MAX_ROLE_STAFF - MANDATORY_FLOOR)
            target = MANDATORY_FLOOR + extra
            result.append({
                **r,
                "workers": target,
                "effective_headcount": target,
                "extra_workers": extra,
                "floor_roles": {"COOK": 1, "CASHIER": 1, "PACKLINER": 1},
                "extra_roles": extra_role_targets(extra),
                "roles": combined_role_targets(target),
            })

    projected_hours = floor_hours + used
    summary = {
        "weeklySales": round(weekly_sales, 2),
        "labourPctTarget": labour_pct,
        "avgWage": avg_wage,
        "budgetHours": round(budget_hours, 1),
        "floorHours": round(floor_hours, 1),
        "extraBudgetHours": round(extra_budget, 1),
        "extraHoursKept": round(used, 1),
        "extraHoursDropped": round(sum(c["hours"] for c in dropped), 1),
        "projectedHours": round(projected_hours, 1),
        "projectedLabourPct": round(
            (projected_hours * avg_wage) / weekly_sales, 4
        ) if weekly_sales > 0 else 0.0,
        "floorExceedsBudget": floor_hours > budget_hours,
    }
    return result, summary


def operating_hours_for_date(date: str) -> tuple[int, int]:
    """Return (open_hour, close_hour) for date — close is exclusive loop bound."""
    dow = datetime.strptime(date, "%Y-%m-%d").weekday()
    hours = OPERATING_HOURS[dow]
    return hours["open"], hours["close"]


def build_hourly_demand_row(
    date: str,
    hour: int,
    sales_amount: float,
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
) -> dict[str, Any]:
    # Use compute_workers for the capped per-hour total (max 7 workers).
    # Keep formula_headcount as the raw uncapped value for transparency.
    capped = compute_workers(sales_amount)
    raw_result = compute_workers_needed(sales_amount, labour_pct, avg_wage)
    formula_total = int(raw_result["formula_headcount"])  # raw, may exceed 7
    effective_total = capped["total"]                     # capped at 7
    extra = effective_total - MANDATORY_FLOOR
    floor_roles = floor_role_targets()
    extra_roles = extra_role_targets(extra)
    total_roles = combined_role_targets(effective_total)

    return {
        "date": date,
        "hour": hour,
        "sales": sales_amount,
        "mandatory_floor": MANDATORY_FLOOR,
        "formula_headcount": formula_total,
        "effective_headcount": effective_total,
        "extra_workers": extra,
        "workers": effective_total,
        "overdemand": capped["is_capped"],
        "floor_roles": floor_roles,
        "extra_roles": extra_roles,
        "roles": total_roles,
    }


def build_workers_needed(
    sales_rows: list[dict[str, Any]],
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
    open_hour: int | None = None,
    close_hour: int | None = None,
) -> dict[str, Any]:
    by_hour = []
    day_sales: dict[str, float] = {}
    sales_by_date_hour: dict[tuple[str, int], float] = {}

    for s in sales_rows:
        sales_amount = float(s.get("sales_amount") or s.get("salesAmount") or 0)
        date = str(s["date"])
        hour = int(s["hour"])
        sales_by_date_hour[(date, hour)] = sales_amount
        day_sales[date] = day_sales.get(date, 0.0) + sales_amount

    dates = sorted(day_sales.keys()) if day_sales else []
    if not dates and sales_rows:
        dates = sorted({str(s["date"]) for s in sales_rows})

    for date in dates:
        day_open, day_close = operating_hours_for_date(date)
        start = open_hour if open_hour is not None else day_open
        end = close_hour if close_hour is not None else day_close
        for hour in range(start, end):
            sales_amount = sales_by_date_hour.get((date, hour), 0.0)
            by_hour.append(build_hourly_demand_row(date, hour, sales_amount, labour_pct, avg_wage))

    by_day = []
    for date, sales in sorted(day_sales.items()):
        formula_total = formula_headcount_from_sales(sales, labour_pct, avg_wage)
        by_day.append({
            "date": date,
            "sales": sales,
            "mandatory_floor": MANDATORY_FLOOR,
            "formula_headcount": formula_total,
            "effective_headcount": min(formula_total, MAX_ROLE_STAFF),
            "extra_workers": extra_workers_from_formula(formula_total),
            "workers": formula_total,
            "overdemand": formula_total > MAX_ROLE_STAFF,
        })

    return {"byHour": by_hour, "byDay": by_day}
