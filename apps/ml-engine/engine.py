"""Orchestrate demand + assignment for one schedule week."""

from __future__ import annotations

from assign import assign_shifts, week_dates
from demand import build_workers_needed, compute_sales_demand
from role_demand import build_role_demand, merge_demand
from schemas import GenerateRequest, GenerateResponse, WorkersNeeded


def get_operating_bounds(req: GenerateRequest) -> tuple[int, int, list[str]]:
    from assign import get_hours_for_date

    dates = week_dates(req.week_start)
    min_open, max_close = 24, 0
    active_dates: list[str] = []
    for date in dates:
        open_h, close_h, closed = get_hours_for_date(req.operating_hours, date)
        if closed:
            continue
        active_dates.append(date)
        min_open = min(min_open, open_h)
        max_close = max(max_close, close_h)
    if not active_dates:
        active_dates = dates
        min_open, max_close = 10, 22
    return min_open, max_close, active_dates


def expand_role_slots(
    role_rows: list,
    merged_workers: list[int],
) -> list:
    """Ensure hourly slot count matches merged worker demand."""
    from schemas import RoleDemandHour

    expanded: list[RoleDemandHour] = []
    for i, row in enumerate(role_rows):
        total_roles = row.cashiers + row.cooks + row.packliners
        target = merged_workers[i] if i < len(merged_workers) else total_roles
        extra = max(0, target - total_roles)
        c, k, p = row.cashiers, row.cooks, row.packliners
        # Distribute extras: cashier, cook, packliner round-robin
        for j in range(extra):
            if j % 3 == 0:
                c += 1
            elif j % 3 == 1:
                k += 1
            else:
                p += 1
        expanded.append(
            RoleDemandHour(
                date=row.date, hour=row.hour, cashiers=c, cooks=k, packliners=p
            )
        )
    return expanded


def generate_schedule(req: GenerateRequest) -> GenerateResponse:
    open_h, close_h, dates = get_operating_bounds(req)
    hourly = compute_sales_demand(req.sales, req.preferences, open_h, close_h, dates)
    role_rows = build_role_demand(dates, open_h, close_h, req.role_requirements)
    sales_workers = [h.workers_sales for h in hourly]
    merged = merge_demand(sales_workers, role_rows)
    expanded_roles = expand_role_slots(role_rows, merged)
    workers_needed = build_workers_needed(hourly, merged)
    shifts, flags = assign_shifts(req, hourly, expanded_roles)

    return GenerateResponse(
        status="draft",
        workersNeeded=workers_needed,
        roleDemandByHour=expanded_roles,
        shifts=shifts,
        flags=flags,
        engineVersion="2.0.0",
    )
