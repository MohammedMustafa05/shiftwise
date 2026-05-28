"""Hard filters and scoring helpers for assignment."""

from __future__ import annotations

from datetime import datetime, timedelta

from schemas import AvailabilityBlock, AvailabilitySubmission, Employee, TimeOff


ROLE_MAP = {
    "COOK": "Cook",
    "CASHIER": "Cashier",
    "PACKLINER": "Packliner",
    "Cook": "Cook",
    "Cashier": "Cashier",
    "Packliner": "Packliner",
}


def normalize_role(role: str) -> str:
    return ROLE_MAP.get(role, role)


def eligible_employee_ids(
    employees: list[Employee],
    submissions: list[AvailabilitySubmission],
) -> tuple[set[str], list[dict]]:
    submission_by_user = {s.user_id: s.status for s in submissions}
    eligible: set[str] = set()
    flags: list[dict] = []

    for emp in employees:
        status = submission_by_user.get(emp.user_id)
        if status in ("pending", "rejected"):
            flags.append(
                {
                    "type": "availability_not_approved",
                    "message": f"Availability not approved for employee {emp.user_id}",
                }
            )
            continue
        eligible.add(emp.user_id)

    return eligible, flags


def is_on_time_off(user_id: str, date: str, time_off: list[TimeOff]) -> bool:
    for t in time_off:
        if t.user_id != user_id:
            continue
        if t.start_date <= date <= t.end_date:
            return True
    return False


def parse_time_minutes(t: str) -> int:
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


def availability_covers(
    blocks: list[AvailabilityBlock],
    user_id: str,
    date: str,
    start_time: str,
    end_time: str,
) -> bool:
    d = datetime.strptime(date, "%Y-%m-%d")
    # DB day_of_week: 0=Sunday; Python weekday: Mon=0 .. Sun=6
    db_dow = (d.weekday() + 1) % 7

    start_m = parse_time_minutes(start_time)
    end_m = parse_time_minutes(end_time)
    for block in blocks:
        if block.user_id != user_id or block.day_of_week != db_dow:
            continue
        bs = parse_time_minutes(block.start_time)
        be = parse_time_minutes(block.end_time)
        if bs <= start_m and be >= end_m:
            return True
    return False


def experience_weight(level: str) -> float:
    return {"Veteran": 1.0, "Intermediate": 0.6, "Trainee": 0.3}.get(level, 0.5)


def tier_boost(tier: str, is_peak: bool) -> float:
    if not is_peak:
        return 0.1
    return 0.5 if tier == "Rush-capable" else 0.0


def can_work_role(emp: Employee, role: str) -> bool:
    norm = normalize_role(role)
    roles = [normalize_role(r) for r in (emp.roles or [])]
    if not roles:
        roles = [normalize_role(emp.role)]
    return norm in roles


def pairing_penalty(emp: Employee, assigned_user_ids: set[str]) -> float:
    penalty = 0.0
    for other in emp.pairing_never_with:
        if other in assigned_user_ids:
            penalty -= 2.0
    for other in emp.pairing_always_with:
        if other in assigned_user_ids:
            penalty += 0.5
    return penalty
