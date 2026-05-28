"""Per-role hourly floors from manager role_requirements bands."""

from __future__ import annotations

from datetime import datetime

from schemas import RoleBand, RoleDemandHour


DAY_NAMES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


def parse_hour(time_str: str) -> int:
    return int(time_str.split(":")[0])


def weekday_name(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    # Python: Monday=0 .. Sunday=6 — align to our sunday-first index if needed
    names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    return names[d.weekday()]


def band_covers_hour(band: RoleBand, hour: int) -> bool:
    start = parse_hour(band.from_)
    end = parse_hour(band.to)
    if end <= start:
        return hour >= start or hour < end
    return start <= hour < end


def role_floors_for_hour(
    role_requirements: dict[str, list[RoleBand]],
    date: str,
    hour: int,
) -> tuple[int, int, int]:
    day = weekday_name(date)
    bands = role_requirements.get(day) or role_requirements.get(day.capitalize()) or []
    cashiers = cooks = packliners = 0
    for band in bands:
        if band_covers_hour(band, hour):
            cashiers = max(cashiers, band.cashiers)
            cooks = max(cooks, band.cooks)
            packliners = max(packliners, band.packliners)
    return cashiers, cooks, packliners


def build_role_demand(
    dates: list[str],
    open_hour: int,
    close_hour: int,
    role_requirements: dict[str, list[RoleBand]],
) -> list[RoleDemandHour]:
    rows: list[RoleDemandHour] = []
    for date in dates:
        for hour in range(open_hour, close_hour):
            c, k, p = role_floors_for_hour(role_requirements, date, hour)
            rows.append(
                RoleDemandHour(date=date, hour=hour, cashiers=c, cooks=k, packliners=p)
            )
    return rows


def merge_demand(
    sales_workers: list[int],
    role_rows: list[RoleDemandHour],
) -> list[int]:
    merged: list[int] = []
    for i, roles in enumerate(role_rows):
        role_sum = roles.cashiers + roles.cooks + roles.packliners
        sales_w = sales_workers[i] if i < len(sales_workers) else 0
        merged.append(max(sales_w, role_sum))
    return merged
