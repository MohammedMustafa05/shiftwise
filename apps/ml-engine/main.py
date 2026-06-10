"""ShiftAgent ML Engine — demand forecasting and shift assignment.

Pipeline:
  1. Demand: map previous-week hourly sales onto the target week by day-of-week,
     then compute workers needed per hour:
         workers = max(MIN_WORKERS, min(MAX_WORKERS, round((sales * labour_pct) / demand_divisor)))
     Hours with no sales are treated as closed.
  2. Role split: fixed lookup (Cook always 1; Pack prioritised over Cash above the floor).
  3. Shift construction: per day/role, decompose the hourly demand curve into shifts
     with a LIFO stack — base workers open long shifts, peak workers are layered on
     top for the rush and released when demand falls (honouring a minimum shift length).
  4. Assignment: match shifts to employees by role + availability, balancing weekly
     hours for fairness, respecting max weekly hours and one shift per day.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(
    title="ShiftAgent ML Engine",
    description="Demand forecasting and schedule assignment service",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Demand model constants
# ---------------------------------------------------------------------------

MIN_WORKERS = 3
MAX_WORKERS = 7
DEFAULT_LABOUR_PCT = 0.20
DEFAULT_DEMAND_DIVISOR = 20.0  # dollars of labour budget per worker-hour
DEFAULT_MIN_SHIFT_HOURS = 2
DEFAULT_MAX_WEEKLY_HOURS = 40.0

# Role split by total workers: workers -> (cook, pack, cash).
# Cook is always exactly 1; Pack is prioritised over Cash above the floor.
ROLE_SPLIT: dict[int, tuple[int, int, int]] = {
    3: (1, 1, 1),
    4: (1, 2, 1),
    5: (1, 2, 2),
    6: (1, 3, 2),
    7: (1, 4, 2),
}

ROLE_KEYS = ("COOK", "PACKLINER", "CASHIER")
ROLE_DISPLAY = {"COOK": "Cook", "PACKLINER": "Packliner", "CASHIER": "Cashier"}
DAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]


# ---------------------------------------------------------------------------
# Request models (mirrors apps/api/src/services/mlClient.ts payload)
# ---------------------------------------------------------------------------


class SalesRow(BaseModel):
    date: str
    hour: int
    sales_amount: float


class EmployeeIn(BaseModel):
    id: str | None = None
    userId: str
    name: str = "Employee"
    role: str = "CASHIER"

    model_config = {"extra": "allow"}


class AvailabilityIn(BaseModel):
    userId: str
    dayOfWeek: int = Field(ge=0, le=6)
    startTime: str
    endTime: str
    block: str | None = None

    model_config = {"extra": "allow"}


class GenerateRequest(BaseModel):
    workplace_id: str
    week_start: str
    sales: list[SalesRow] = []
    preferences: dict = {}
    employees: list[EmployeeIn] = []
    availability: list[AvailabilityIn] = []

    model_config = {"extra": "allow"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_hhmm(t: str) -> int:
    """'17:30' -> minutes since midnight. '00:00' as an end time means midnight (1440)."""
    h, m = int(t[:2]), int(t[3:5])
    return h * 60 + m


def fmt_hour(hour: int) -> str:
    """Hour index (may be 24) -> 'HH:MM' wall-clock string."""
    return f"{hour % 24:02d}:00"


def workers_for_sales(sales: float, labour_pct: float, divisor: float) -> int:
    raw = round((sales * labour_pct) / divisor)
    return max(MIN_WORKERS, min(MAX_WORKERS, raw))


def role_split(workers: int) -> dict[str, int]:
    w = max(MIN_WORKERS, min(MAX_WORKERS, workers))
    cook, pack, cash = ROLE_SPLIT[w]
    return {"COOK": cook, "PACKLINER": pack, "CASHIER": cash}


def normalize_role_key(role: str) -> str:
    r = (role or "").strip().upper()
    if r in ROLE_KEYS:
        return r
    aliases = {"PACK": "PACKLINER", "CASH": "CASHIER", "STAFF": "CASHIER"}
    return aliases.get(r, "CASHIER")


# ---------------------------------------------------------------------------
# Step 1 — demand curve for the target week
# ---------------------------------------------------------------------------


def build_demand(
    sales: list[SalesRow], week_start: date, labour_pct: float, divisor: float
) -> dict[date, dict[int, dict]]:
    """Map sales onto the target week by day-of-week and compute hourly worker demand.

    Returns {target_date: {hour: {"sales": float, "workers": int}}}.
    Hours with zero sales are excluded (treated as closed).
    """
    demand: dict[date, dict[int, dict]] = defaultdict(dict)
    for row in sales:
        try:
            sale_date = date.fromisoformat(row.date[:10])
        except ValueError:
            continue
        if row.sales_amount <= 0:
            continue
        # week_start is Monday; offset Monday=0 ... Sunday=6
        offset = sale_date.weekday()
        target = week_start + timedelta(days=offset)
        slot = demand[target].setdefault(row.hour, {"sales": 0.0, "workers": 0})
        slot["sales"] += row.sales_amount

    for day_slots in demand.values():
        for slot in day_slots.values():
            slot["workers"] = workers_for_sales(slot["sales"], labour_pct, divisor)
    return demand


# ---------------------------------------------------------------------------
# Step 2/3 — decompose role demand curves into shifts
# ---------------------------------------------------------------------------


def build_role_shifts(
    hourly_workers: dict[int, int], min_shift_hours: int
) -> list[tuple[int, int]]:
    """Decompose an hourly headcount curve into shift (start_hour, end_hour) tuples.

    LIFO stack: rising demand opens new shifts; falling demand closes the most
    recently opened ones first, so base staff hold long shifts and peak staff
    cover short rush windows. Shifts shorter than min_shift_hours are extended
    forward (kept on through brief dips) when the day allows it.
    """
    if not hourly_workers:
        return []
    hours = sorted(hourly_workers)
    close_hour = hours[-1] + 1

    open_stack: list[int] = []  # start hours of currently open shifts
    shifts: list[tuple[int, int]] = []

    prev_hour = None
    for h in hours:
        if prev_hour is not None and h > prev_hour + 1:
            # gap in operating hours: close everything
            for start in reversed(open_stack):
                shifts.append((start, prev_hour + 1))
            open_stack = []
        needed = hourly_workers[h]
        while len(open_stack) < needed:
            open_stack.append(h)
        while len(open_stack) > needed:
            start = open_stack.pop()
            end = h
            if end - start < min_shift_hours and end + 1 <= close_hour:
                end = min(start + min_shift_hours, close_hour)
            shifts.append((start, end))
        prev_hour = h

    for start in reversed(open_stack):
        shifts.append((start, close_hour))

    # Extend any still-short shifts to the minimum where possible
    fixed = []
    for start, end in shifts:
        if end - start < min_shift_hours:
            end = min(start + min_shift_hours, close_hour)
        if end > start:
            fixed.append((start, end))
    fixed.sort()
    return fixed


# ---------------------------------------------------------------------------
# Step 4 — assignment with availability, constraints, fairness
# ---------------------------------------------------------------------------


class Assigner:
    def __init__(
        self,
        employees: list[EmployeeIn],
        availability: list[AvailabilityIn],
        max_weekly_hours: float,
    ):
        self.max_weekly_hours = max_weekly_hours
        self.by_role: dict[str, list[EmployeeIn]] = defaultdict(list)
        for e in employees:
            self.by_role[normalize_role_key(e.role)].append(e)
        # availability windows in minutes: {userId: {dow: [(start, end)]}}
        self.avail: dict[str, dict[int, list[tuple[int, int]]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for a in availability:
            if a.block == "off":
                continue
            start = parse_hhmm(a.startTime)
            end = parse_hhmm(a.endTime)
            if end == 0:
                end = 24 * 60  # midnight end
            if end > start:
                self.avail[a.userId][a.dayOfWeek].append((start, end))
        self.hours_assigned: dict[str, float] = defaultdict(float)
        self.days_assigned: dict[str, set[date]] = defaultdict(set)

    def is_available(self, user_id: str, dow: int, start_min: int, end_min: int) -> bool:
        return any(
            ws <= start_min and end_min <= we for ws, we in self.avail[user_id][dow]
        )

    def pick(
        self, role_key: str, day: date, start_hour: int, end_hour: int
    ) -> EmployeeIn | None:
        dow = (day.weekday() + 1) % 7  # Python Monday=0 -> JS Sunday=0 convention
        start_min, end_min = start_hour * 60, end_hour * 60
        shift_hours = end_hour - start_hour

        candidates = [
            e
            for e in self.by_role[role_key]
            if day not in self.days_assigned[e.userId]
            and self.hours_assigned[e.userId] + shift_hours <= self.max_weekly_hours
            and self.is_available(e.userId, dow, start_min, end_min)
        ]
        if not candidates:
            return None
        # Fairness: fewest hours so far, then fewest distinct days, stable by name
        candidates.sort(
            key=lambda e: (
                self.hours_assigned[e.userId],
                len(self.days_assigned[e.userId]),
                e.name,
            )
        )
        chosen = candidates[0]
        self.hours_assigned[chosen.userId] += shift_hours
        self.days_assigned[chosen.userId].add(day)
        return chosen


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "service": "shiftagent-ml-engine"}


@app.post("/generate")
def generate(request: GenerateRequest):
    prefs = request.preferences or {}
    labour_pct = float(prefs.get("labourCostPct", DEFAULT_LABOUR_PCT))
    divisor = float(prefs.get("demandDivisor", DEFAULT_DEMAND_DIVISOR))
    min_shift_hours = int(prefs.get("minShiftHours", DEFAULT_MIN_SHIFT_HOURS))
    max_weekly_hours = float(prefs.get("maxWeeklyHours", DEFAULT_MAX_WEEKLY_HOURS))

    try:
        week_start = date.fromisoformat(request.week_start[:10])
    except ValueError:
        return {"status": "error", "message": f"Invalid week_start: {request.week_start}"}

    flags: list[dict] = []
    demand = build_demand(request.sales, week_start, labour_pct, divisor)

    by_hour = []
    by_day = []
    for day in sorted(demand):
        slots = demand[day]
        day_sales = 0.0
        day_workers_peak = 0
        for hour in sorted(slots):
            slot = slots[hour]
            day_sales += slot["sales"]
            day_workers_peak = max(day_workers_peak, slot["workers"])
            by_hour.append(
                {
                    "date": day.isoformat(),
                    "hour": hour,
                    "sales": round(slot["sales"], 2),
                    "workers": slot["workers"],
                }
            )
        by_day.append(
            {"date": day.isoformat(), "sales": round(day_sales, 2), "workers": day_workers_peak}
        )

    assigner = Assigner(request.employees, request.availability, max_weekly_hours)
    shifts_out: list[dict] = []

    for day in sorted(demand):
        slots = demand[day]
        # Per-role hourly demand from the role split
        role_hourly: dict[str, dict[int, int]] = {r: {} for r in ROLE_KEYS}
        for hour, slot in slots.items():
            split = role_split(slot["workers"])
            for r in ROLE_KEYS:
                role_hourly[r][hour] = split[r]

        dow_js = (day.weekday() + 1) % 7
        for role_key in ROLE_KEYS:
            for start_hour, end_hour in build_role_shifts(role_hourly[role_key], min_shift_hours):
                emp = assigner.pick(role_key, day, start_hour, end_hour)
                if emp is None:
                    flags.append(
                        {
                            "type": "understaffed",
                            "date": day.isoformat(),
                            "hour": start_hour,
                            "message": (
                                f"No available {ROLE_DISPLAY[role_key]} for "
                                f"{day.isoformat()} {fmt_hour(start_hour)}–{fmt_hour(end_hour)}"
                            ),
                        }
                    )
                    continue
                shifts_out.append(
                    {
                        "id": str(uuid.uuid4()),
                        "employeeId": emp.userId,
                        "day": DAY_CODES[dow_js],
                        "shiftDate": day.isoformat(),
                        "startTime": fmt_hour(start_hour),
                        "endTime": fmt_hour(end_hour),
                        "role": emp.role,
                        "location": "Main",
                    }
                )

    if not demand:
        flags.append({"type": "no_demand", "message": "No sales data with positive amounts"})

    return {
        "scheduleId": str(uuid.uuid4()),
        "status": "draft",
        "workersNeeded": {"byHour": by_hour, "byDay": by_day},
        "shifts": shifts_out,
        "flags": flags,
    }
