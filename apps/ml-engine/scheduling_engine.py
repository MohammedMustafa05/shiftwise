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


def smooth_demand_to_shift_windows(by_hour: list[dict]) -> list[dict]:
    """
    Propagate the peak workers_needed within each shift window to all hours in that window.

    Two windows per day:
      • Open  block: operating open hour → 17:00 (morning/lunch crew)
      • Close block: 17:00 → operating close hour (evening/close crew)

    Workers scheduled into a shift cannot be sent home mid-shift when sales dip.
    The constraint solver needs a CONSISTENT cap across the whole shift window.
    Without smoothing, a low-cap 10 AM hour blocks the solver from adding a
    10-17 shift even when that shift is needed for the busy 1 PM rush.

    Smoothing sets every hour's cap to the window PEAK so the solver can freely
    assign open-crew and close-crew shifts without artificial early-hour blocking.
    The prune step uses the same smoothed caps, so it does not remove workers
    that are genuinely needed at peak hours later in the window.
    """
    from collections import defaultdict

    by_date: dict[str, list[dict]] = defaultdict(list)
    for row in by_hour:
        by_date[str(row["date"])].append(row)

    result: list[dict] = []
    for date, rows in sorted(by_date.items()):
        open_rows = [r for r in rows if int(r["hour"]) < 17]
        close_rows = [r for r in rows if int(r["hour"]) >= 17]

        open_peak = max((int(r["workers"]) for r in open_rows), default=MANDATORY_FLOOR)
        close_peak = max((int(r["workers"]) for r in close_rows), default=MANDATORY_FLOOR)
        open_peak = min(open_peak, MAX_ROLE_STAFF)
        close_peak = min(close_peak, MAX_ROLE_STAFF)

        for r in rows:
            target = open_peak if int(r["hour"]) < 17 else close_peak
            extra = max(0, min(4, target - MANDATORY_FLOOR))
            result.append({
                **r,
                "workers": target,
                "effective_headcount": target,
                "formula_headcount": max(int(r.get("formula_headcount", target)), target),
                "extra_workers": extra,
                "floor_roles": {"COOK": 1, "CASHIER": 1, "PACKLINER": 1},
                "extra_roles": extra_role_targets(extra),
                "roles": combined_role_targets(target),
            })

    return result


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
