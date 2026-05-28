"""Sales-driven staffing demand (DOW-mapped sales in request.sales)."""

from __future__ import annotations

import math
from dataclasses import dataclass

from schemas import Preferences, SalesRow, WorkersNeeded, WorkersNeededDay, WorkersNeededHour


@dataclass
class HourlyDemand:
    date: str
    hour: int
    sales: float
    workers_sales: int


def sales_by_date_hour(sales: list[SalesRow]) -> dict[tuple[str, int], float]:
    out: dict[tuple[str, int], float] = {}
    for row in sales:
        out[(row.date, row.hour)] = row.sales_amount
    return out


def workers_from_sales(sales_amount: float, prefs: Preferences) -> int:
    if sales_amount <= 0:
        return 0
    budget = sales_amount * prefs.labourCostPct
    wage = prefs.avgHourlyWage or 18.5
    workers = math.ceil(budget / wage)
    constraints = prefs.constraints or {}
    min_w = int(constraints.get("minWorkersPerHour", 0) or 0)
    max_w = constraints.get("maxWorkersPerHour")
    workers = max(workers, min_w)
    if max_w is not None:
        workers = min(workers, int(max_w))
    return workers


def compute_sales_demand(
    sales: list[SalesRow],
    prefs: Preferences,
    open_hour: int,
    close_hour: int,
    dates: list[str],
) -> list[HourlyDemand]:
    lookup = sales_by_date_hour(sales)
    result: list[HourlyDemand] = []
    for date in dates:
        for hour in range(open_hour, close_hour):
            amount = lookup.get((date, hour), 0.0)
            result.append(
                HourlyDemand(
                    date=date,
                    hour=hour,
                    sales=amount,
                    workers_sales=workers_from_sales(amount, prefs),
                )
            )
    return result


def build_workers_needed(
    hourly: list[HourlyDemand],
    merged_workers: list[int],
) -> WorkersNeeded:
    by_hour: list[WorkersNeededHour] = []
    for i, h in enumerate(hourly):
        workers = merged_workers[i] if i < len(merged_workers) else h.workers_sales
        by_hour.append(
            WorkersNeededHour(date=h.date, hour=h.hour, sales=h.sales, workers=workers)
        )

    day_map: dict[str, dict[str, float]] = {}
    for row in by_hour:
        cur = day_map.setdefault(row.date, {"sales": 0.0, "workers": 0})
        cur["sales"] += row.sales
        cur["workers"] = max(cur["workers"], row.workers)

    by_day = [
        WorkersNeededDay(date=d, sales=v["sales"], workers=int(v["workers"]))
        for d, v in sorted(day_map.items())
    ]
    return WorkersNeeded(byHour=by_hour, byDay=by_day)
