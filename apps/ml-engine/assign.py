"""Greedy shift assignment from hourly demand."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from constraints import (
    availability_covers,
    can_work_role,
    eligible_employee_ids,
    experience_weight,
    is_on_time_off,
    normalize_role,
    pairing_penalty,
    parse_time_minutes,
    tier_boost,
)
from demand import HourlyDemand
from role_demand import RoleDemandHour
from schemas import (
    AvailabilityBlock,
    AvailabilitySubmission,
    Employee,
    FlagOut,
    GenerateRequest,
    OperatingHours,
    Preferences,
    ShiftOut,
    TimeOff,
)


DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

API_ROLES = {"Cook": "COOK", "Cashier": "CASHIER", "Packliner": "PACKLINER"}


def _api_role(role: str) -> str:
    return API_ROLES.get(role, role.upper())


def day_abbr(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return DAY_ABBR[(d.weekday() + 1) % 7]


def get_hours_for_date(operating: OperatingHours, date: str) -> tuple[int, int, bool]:
    from role_demand import weekday_name

    day_name = weekday_name(date)
    day_cfg = operating.byDay.get(day_name) or operating.byDay.get(day_name.capitalize())
    if day_cfg and day_cfg.closed:
        return 0, 0, True
    default = operating.default
    open_h = int((day_cfg.open if day_cfg else default.open).split(":")[0])
    close_h = int((day_cfg.close if day_cfg else default.close).split(":")[0])
    return open_h, close_h, False


def week_dates(week_start: str) -> list[str]:
    start = datetime.strptime(week_start, "%Y-%m-%d")
    return [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]


def is_peak_hour(hour: int) -> bool:
    return 11 <= hour <= 20


@dataclass
class AssignedSlot:
    user_id: str
    date: str
    hour: int
    role: str


def build_slots(role_rows: list[RoleDemandHour]) -> list[tuple[str, int, str]]:
    """(date, hour, role) slots to fill."""
    slots: list[tuple[str, int, str]] = []
    for row in role_rows:
        for role, count in [
            ("Cook", row.cooks),
            ("Cashier", row.cashiers),
            ("Packliner", row.packliners),
        ]:
            for _ in range(count):
                slots.append((row.date, row.hour, role))
    return slots


def hours_assigned(assignments: dict[str, float]) -> float:
    return assignments.get("_total", 0.0)


def assign_shifts(
    req: GenerateRequest,
    hourly: list[HourlyDemand],
    role_rows: list[RoleDemandHour],
) -> tuple[list[ShiftOut], list[FlagOut]]:
    eligible_ids, gate_flags = eligible_employee_ids(req.employees, req.availability_submissions)
    flags = [FlagOut(**f) for f in gate_flags]

    emp_by_id = {e.user_id: e for e in req.employees if e.user_id in eligible_ids}
    weekly_hours: dict[str, float] = defaultdict(float)
    assigned_slots: list[AssignedSlot] = []
    shift_length = int(req.preferences.shiftLengthHours or 8)
    max_week = float(
        (req.preferences.constraints or {}).get("maxHoursPerWeek", 45) or 45
    )

    slots = build_slots(role_rows)
    # Sort peak hours first
    slots.sort(key=lambda s: (s[0], s[1], s[2]), reverse=False)
    slots.sort(key=lambda s: is_peak_hour(s[1]), reverse=True)

    for date, hour, role in slots:
        candidates: list[tuple[float, Employee]] = []
        start_time = f"{hour:02d}:00"
        end_hour = min(hour + shift_length, 23)
        end_time = f"{end_hour:02d}:00"

        for emp in emp_by_id.values():
            if not can_work_role(emp, role):
                continue
            if is_on_time_off(emp.user_id, date, req.approved_time_off):
                continue
            max_h = emp.max_hours or max_week
            if weekly_hours[emp.user_id] >= max_h:
                continue
            if not availability_covers(
                req.availability, emp.user_id, date, start_time, end_time
            ):
                # try 1-hour slot
                end_time_1h = f"{hour + 1:02d}:00"
                if not availability_covers(
                    req.availability, emp.user_id, date, start_time, end_time_1h
                ):
                    continue
                end_time = end_time_1h

            assigned_same_hour = {
                a.user_id
                for a in assigned_slots
                if a.date == date and a.hour == hour
            }
            score = (
                1.0
                + experience_weight(emp.experience_level)
                + tier_boost(emp.shift_tier, is_peak_hour(hour))
                - weekly_hours[emp.user_id] * 0.05
                + pairing_penalty(emp, assigned_same_hour)
            )
            candidates.append((score, emp))

        if not candidates:
            flags.append(
                FlagOut(
                    type="understaffed",
                    date=date,
                    hour=hour,
                    message=f"No eligible employee for {role}",
                )
            )
            continue

        candidates.sort(key=lambda x: x[0], reverse=True)
        _, chosen = candidates[0]
        duration = max(1.0, (parse_time_minutes(end_time) - parse_time_minutes(start_time)) / 60)
        weekly_hours[chosen.user_id] += duration
        assigned_slots.append(
            AssignedSlot(user_id=chosen.user_id, date=date, hour=hour, role=role)
        )

    # Merge consecutive hours per employee/role/date into shifts
    grouped: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for slot in assigned_slots:
        grouped[(slot.user_id, slot.date, slot.role)].append(slot.hour)

    shifts: list[ShiftOut] = []
    for (user_id, date, role), hours in grouped.items():
        hours = sorted(set(hours))
        ranges: list[tuple[int, int]] = []
        start = hours[0]
        prev = hours[0]
        for h in hours[1:]:
            if h == prev + 1:
                prev = h
            else:
                ranges.append((start, prev + 1))
                start = h
                prev = h
        ranges.append((start, prev + 1))

        for sh, eh in ranges:
            shifts.append(
                ShiftOut(
                    employeeId=user_id,
                    day=day_abbr(date),
                    shiftDate=date,
                    startTime=f"{sh:02d}:00",
                    endTime=f"{eh:02d}:00",
                    role=_api_role(role),
                    location="Main",
                )
            )

    return shifts, flags


def run_assignment_pipeline(
    req: GenerateRequest,
    hourly: list[HourlyDemand],
    role_rows: list[RoleDemandHour],
) -> tuple[list[ShiftOut], list[FlagOut]]:
    return assign_shifts(req, hourly, role_rows)
