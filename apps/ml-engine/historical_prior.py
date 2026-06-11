"""
Learn scheduling *patterns* from historical Clearview weeks (not copy-paste).

Produces a prior used to shape workersNeeded by day-of-week / hour while sales
data still controls overall labour budget.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

OPERATING_START = 10
OPERATING_END = 22
MIN_WORKERS = 3
MODEL_PATH = Path(__file__).resolve().parent / "models" / "lsl_scheduling_prior.json"


def _to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _hours_covered(start: str, end: str) -> list[int]:
    sm, em = _to_minutes(start), _to_minutes(end)
    if em <= sm:
        em += 24 * 60
    hours: list[int] = []
    for m in range(sm, em, 60):
        hours.append((m // 60) % 24)
    return [h for h in hours if OPERATING_START <= h < OPERATING_END]


def fit_prior_from_weeks(weeks: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate all historical weeks into statistical priors."""
    dow_hour_counts: dict[int, dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))
    template_counts: dict[str, int] = defaultdict(int)
    employee_dow: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    employee_templates: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    weeks_used = 0
    shift_count = 0

    for week in weeks:
        shifts = week.get("shifts") or []
        if not shifts:
            continue
        weeks_used += 1
        week_concurrent: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
        for s in shifts:
            shift_count += 1
            emp = s["employee"]
            dow = int(s.get("dow", -1))
            start, end = s["start"], s["end"]
            tpl = f"{start}-{end}"
            template_counts[tpl] += 1
            employee_templates[emp][tpl] += 1
            if dow >= 0:
                employee_dow[emp][dow] += 1
                for hour in _hours_covered(start, end):
                    week_concurrent[dow][hour] += 1
        for dow, hours in week_concurrent.items():
            for hour, count in hours.items():
                dow_hour_counts[dow][hour].append(count)

    # Average concurrent headcount per (dow, hour) across weeks
    dow_hour_avg: dict[str, dict[str, float]] = {}
    global_hour: dict[int, list[float]] = defaultdict(list)
    for dow in range(7):
        dow_hour_avg[str(dow)] = {}
        for hour in range(OPERATING_START, OPERATING_END):
            samples = dow_hour_counts[dow][hour]
            if samples:
                avg = sum(samples) / len(samples)
            else:
                avg = 0.0
            dow_hour_avg[str(dow)][str(hour)] = round(avg, 2)
            if avg > 0:
                global_hour[hour].append(avg)

    global_avg_hour: dict[str, float] = {}
    for hour in range(OPERATING_START, OPERATING_END):
        vals = global_hour[hour]
        global_avg_hour[str(hour)] = round(sum(vals) / len(vals), 2) if vals else float(MIN_WORKERS)

    # DOW multiplier vs weekly mean staffing shape
    dow_totals = []
    for dow in range(7):
        dow_totals.append(sum(float(dow_hour_avg[str(dow)].get(str(h), 0)) for h in range(OPERATING_START, OPERATING_END)))
    mean_total = sum(dow_totals) / max(len(dow_totals), 1) or 1.0
    dow_multiplier: dict[str, float] = {}
    for dow in range(7):
        dow_multiplier[str(dow)] = round(dow_totals[dow] / mean_total, 3) if mean_total > 0 else 1.0

    # Hour-of-day multiplier (pooled across DOW)
    hour_pool = [global_avg_hour[str(h)] for h in range(OPERATING_START, OPERATING_END)]
    mean_h = sum(hour_pool) / len(hour_pool) if hour_pool else float(MIN_WORKERS)
    hour_multiplier: dict[str, float] = {}
    for hour in range(OPERATING_START, OPERATING_END):
        hour_multiplier[str(hour)] = round(global_avg_hour[str(hour)] / mean_h, 3) if mean_h > 0 else 1.0

    total_tpl = sum(template_counts.values()) or 1
    shift_templates = [
        {
            "start": k.split("-")[0],
            "end": k.split("-")[1],
            "weight": round(v / total_tpl, 4),
        }
        for k, v in sorted(template_counts.items(), key=lambda x: -x[1])[:12]
    ]

    employee_priors: dict[str, Any] = {}
    for emp, dows in employee_dow.items():
        total = sum(dows.values()) or 1
        employee_priors[emp] = {
            "dow_probability": {str(d): round(c / total, 3) for d, c in dows.items()},
            "top_templates": [
                t.split("-")
                for t, _ in sorted(employee_templates[emp].items(), key=lambda x: -x[1])[:3]
            ],
        }

    return {
        "version": 1,
        "weeks_trained": weeks_used,
        "shifts_learned": shift_count,
        "shift_templates": shift_templates,
        "dow_hour_avg_staffing": dow_hour_avg,
        "global_avg_hourly_staffing": global_avg_hour,
        "dow_multiplier": dow_multiplier,
        "hour_multiplier": hour_multiplier,
        "employee_priors": employee_priors,
        "notes": "Statistical prior from historical weeks; applied as shape on sales-based caps, not verbatim schedule copy.",
    }


def load_prior(path: Path | None = None) -> dict[str, Any] | None:
    p = path or MODEL_PATH
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_prior(model: dict[str, Any], path: Path | None = None) -> Path:
    p = path or MODEL_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)
    return p


def _dow_from_iso_date(date_str: str) -> int:
    """0=Sunday .. 6=Saturday."""
    from datetime import datetime

    dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
    return (dt.weekday() + 1) % 7


def apply_prior_to_workers(
    by_hour: list[dict[str, Any]],
    labour_pct: float,
    prior: dict[str, Any],
    blend: float = 0.35,
) -> list[dict[str, Any]]:
    """
    Blend sales-based headcount with learned DOW/hour shape.

    blend=0 → sales only; blend=1 → fully follow historical shape (capped).
    Only adjusts extra_workers above mandatory floor — never reduces floor.
    """
    from labour import (
        MANDATORY_FLOOR,
        combined_role_targets,
        extra_role_targets,
        extra_workers_from_formula,
        formula_headcount_from_sales,
    )

    dow_mult = prior.get("dow_multiplier") or {}
    hour_mult = prior.get("hour_multiplier") or {}
    dow_hour = prior.get("dow_hour_avg_staffing") or {}

    out = []
    for row in by_hour:
        sales = float(row.get("sales") or 0)
        date = str(row["date"])
        hour = int(row["hour"])
        formula_total = formula_headcount_from_sales(sales, labour_pct)
        base_extra = extra_workers_from_formula(formula_total)

        dow = _dow_from_iso_date(date)
        dm = float(dow_mult.get(str(dow), 1.0))
        hm = float(hour_mult.get(str(hour), 1.0))
        learned_avg = float((dow_hour.get(str(dow)) or {}).get(str(hour), 0))
        learned_extra = max(0, learned_avg - MANDATORY_FLOOR)

        shape = dm * hm
        shaped_extra = base_extra * (1 - blend) + max(base_extra * shape, learned_extra * blend)
        # Allow up to 4 extras above floor (floor=3 + 4 extras = 7 max workers).
        # Previous cap of 3 incorrectly limited peak hours to 6 workers.
        extra = max(0, min(4, int(round(shaped_extra))))
        formula_total = MANDATORY_FLOOR + extra

        out.append({
            **row,
            "mandatory_floor": MANDATORY_FLOOR,
            "formula_headcount": formula_total,
            "extra_workers": extra,
            "workers": formula_total,
            "floor_roles": {"COOK": 1, "CASHIER": 1, "PACKLINER": 1},
            "extra_roles": extra_role_targets(extra),
            "roles": combined_role_targets(formula_total),
        })
    return out


def build_style_hints(prior: dict[str, Any], max_employees: int = 14) -> dict[str, Any]:
    """Hints for API/LLM — patterns, not a fixed schedule."""
    templates = prior.get("shift_templates") or []
    return {
        "weeks_trained": prior.get("weeks_trained", 0),
        "shifts_learned": prior.get("shifts_learned", 0),
        "shift_templates": templates[:8],
        "dow_multiplier": prior.get("dow_multiplier"),
        "hour_multiplier": prior.get("hour_multiplier"),
        "employee_priors": dict(list((prior.get("employee_priors") or {}).items())[:max_employees]),
        "guidance": [
            "Use open crew 10:00–17:00 and close crew 17:00–22:00; overlap for hourly 1+1+1.",
            "Staffing shape follows learned DOW/hour demand; sales caps still limit headcount.",
        ],
    }
