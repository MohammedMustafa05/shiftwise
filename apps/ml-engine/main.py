import glob
import os
import re
import uuid
from datetime import date as _date, timedelta
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from drop_chart_parser import extract_drop_chart_metadata
from historical_prior import apply_prior_to_workers, build_style_hints, load_prior
from labour import HOURLY_DISTRIBUTIONS, MANDATORY_FLOOR, OPERATING_HOURS
from sales_parser import parse_clearview_cash_sheet
from scheduling_engine import build_workers_needed, smooth_demand_to_shift_windows

ML_ENGINE_API_KEY = os.environ.get("ML_ENGINE_API_KEY", "")

app = FastAPI(
    title="ShiftAgent ML Engine",
    description="Demand forecasting and schedule assignment service",
    version="0.1.0",
)


class SalesRow(BaseModel):
    date: str
    hour: int
    sales_amount: float = Field(alias="sales_amount")


class AvailabilityRow(BaseModel):
    userId: str | None = None
    user_id: str | None = None
    dayOfWeek: int | None = None
    day_of_week: int | None = None
    startTime: str | None = None
    start_time: str | None = None
    endTime: str | None = None
    end_time: str | None = None


class EmployeeRow(BaseModel):
    userId: str | None = None
    user_id: str | None = None
    role: str = "STAFF"


class GenerateRequest(BaseModel):
    workplace_id: str
    week_start: str
    schedule_id: str | None = None
    sales: list[dict[str, Any]] = Field(default_factory=list)
    preferences: dict[str, Any] = Field(default_factory=dict)
    employees: list[dict[str, Any]] = Field(default_factory=list)
    availability: list[dict[str, Any]] = Field(default_factory=list)


DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

_SALES_FOLDER = Path(__file__).parent / "hourly sales data"
# File (11).xls = April 11, 2026 (Saturday, Python weekday 5).
# Files are consecutive daily cash sheets: (N) = April 11 + (N – 11) days.
# Verified by user's analysis: file (20) = April 20 Monday, (21) = Tuesday, etc.
_FILE_BASE_DATE = _date(2026, 4, 11)
_FILE_BASE_NUM = 11


def load_sales_from_folder(week_start: str) -> list[dict[str, Any]]:
    """
    Parse Drop Chart PDFs and XLS/CSV cash sheets from 'hourly sales data' folder.

    Priority:
      1. Drop Chart PDFs — authoritative: they carry the exact date and hourly sales.
         These are loaded first; their DOW/hour data takes precedence.
      2. Cash Sheet XLS/CSV files — numbered sequentially, no embedded date.
         Each file's date is inferred from _FILE_BASE_DATE + offset.
         All dates are included — holidays like Victoria Day (Monday Apr 20) are
         valid Monday data and must contribute to Monday DOW averages.

    Averaging per (DOW, hour) gives realistic per-day demand.  Result is remapped
    to the requested schedule week.  API-provided sales data is used only if this
    folder yields nothing.
    """
    if not _SALES_FOLDER.exists():
        return []

    # Accumulate sales by (Python weekday 0=Mon, hour) across all sources.
    dow_hour: dict[tuple[int, int], list[float]] = {}

    # ── Step 1: Drop Chart PDFs (authoritative — exact dates, exact hourly sales) ──
    # All Drop Chart dates are treated as representative weekly patterns — no date
    # filtering.  Track which dates were loaded so Cash Sheets don't double-count.
    drop_chart_dates: set[str] = set()
    for pdf_path in sorted(_SALES_FOLDER.glob("Drop Chart*.pdf")):
        try:
            meta = extract_drop_chart_metadata(str(pdf_path))
            sale_date = meta["date"]
            dow = meta["day_of_week"]  # Python weekday 0=Monday
            for hour, sales in meta["hourly_sales"].items():
                key = (dow, int(hour))
                dow_hour.setdefault(key, []).append(float(sales))
            drop_chart_dates.add(sale_date)
        except Exception:
            continue

    # ── Step 2: Cash Sheet XLS/CSV files (prefer CSV over XLS for same number) ──
    file_map: dict[int, str] = {}
    for fpath in sorted(_SALES_FOLDER.glob("Cash Sheet - Hourly Sales*.*")):
        if fpath.suffix.lower() not in (".xls", ".csv"):
            continue
        m = re.search(r"\((\d+)\)", fpath.name)
        if not m:
            continue
        num = int(m.group(1))
        if num not in file_map or fpath.suffix.lower() == ".csv":
            file_map[num] = str(fpath)

    for num, fpath in sorted(file_map.items()):
        file_date = _FILE_BASE_DATE + timedelta(days=num - _FILE_BASE_NUM)
        date_str = file_date.isoformat()
        # Skip dates already loaded from a Drop Chart to avoid double-counting
        if date_str in drop_chart_dates:
            continue
        dow = file_date.weekday()  # 0=Monday
        try:
            records = parse_clearview_cash_sheet(fpath)
            for r in records:
                key = (dow, int(r["hour"]))
                dow_hour.setdefault(key, []).append(float(r["total_sales"]))
        except Exception:
            continue

    # ── Step 3: Fill any missing (DOW, hour) operating slots ──
    # When a particular DOW/hour has no data from files, synthesise a value using
    # the known HOURLY_DISTRIBUTIONS fractions scaled by the average daily total
    # derived from existing data for that DOW.  This ensures the constraint solver
    # always gets a full per-hour demand profile (never flat-floor-only).
    for dow in range(7):
        op_open = OPERATING_HOURS[dow]["open"]
        op_close = OPERATING_HOURS[dow]["close"]
        dist = HOURLY_DISTRIBUTIONS.get(dow, {})

        # Average sales per hour from actual file data for this DOW
        existing_avgs: dict[int, float] = {
            hour: sum(vals) / len(vals)
            for (d, hour), vals in dow_hour.items()
            if d == dow
        }

        if not existing_avgs:
            # No data at all for this DOW — skip; workersNeededMaps will enforce floor
            continue

        # Estimate full-day total using the distribution fractions we DO have data for
        known_fraction = sum(dist.get(h, 0.0) for h in existing_avgs)
        if known_fraction > 0:
            est_daily_total = sum(existing_avgs.values()) / known_fraction
        else:
            est_daily_total = sum(existing_avgs.values())

        for hour in range(op_open, op_close):
            if (dow, hour) not in dow_hour:
                fraction = dist.get(hour, 0.0)
                synthetic = round(est_daily_total * fraction, 2) if fraction > 0 else 0.0
                dow_hour[(dow, hour)] = [synthetic]

    if not dow_hour:
        return []

    # ── Step 4: Map per-DOW averages to each day of the requested schedule week ──
    start = _date.fromisoformat(week_start)
    rows: list[dict[str, Any]] = []
    for day_offset in range(7):
        d = start + timedelta(days=day_offset)
        date_str = d.isoformat()
        dow = d.weekday()
        hours_seen: set[int] = set()
        for (bucket_dow, hour), values in sorted(dow_hour.items()):
            if bucket_dow != dow or hour in hours_seen:
                continue
            hours_seen.add(hour)
            rows.append({
                "date": date_str,
                "hour": hour,
                "sales_amount": round(sum(values) / len(values), 2),
            })

    return rows


def verify_ml_key(x_ml_engine_key: str | None) -> None:
    if not ML_ENGINE_API_KEY:
        return
    if x_ml_engine_key != ML_ENGINE_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid ML engine API key")


def _get(row: dict[str, Any], *keys: str, default=None):
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return default


@app.get("/health")
def health():
    return {"status": "ok", "service": "shiftagent-ml-engine"}


@app.post("/generate")
def generate(
    request: GenerateRequest,
    x_ml_engine_key: str | None = Header(default=None),
):
    verify_ml_key(x_ml_engine_key)

    prefs = request.preferences or {}
    labour_pct = float(prefs.get("labourCostPct") or 0.2)
    avg_wage = float(prefs.get("avgHourlyWage") or 20.0)

    # Always read from the local XLS folder — it is the canonical source.
    # Fall back to API-provided sales only if the folder yields nothing.
    sales = load_sales_from_folder(request.week_start) or request.sales

    workers_needed = build_workers_needed(sales, labour_pct, avg_wage)
    by_hour = workers_needed["byHour"]
    day_sales = {d["date"]: d["sales"] for d in workers_needed["byDay"]}

    prior = load_prior()
    if prior:
        by_hour = apply_prior_to_workers(by_hour, labour_pct, prior)
    else:
        by_day = workers_needed["byDay"]

    # Smooth per-hour demand to shift-window peaks AFTER all shaping (prior included).
    # This ensures the constraint solver sees a consistent cap across each shift window
    # (open: open_hour→17:00, close: 17:00→close_hour) so low-demand early hours don't
    # block valid open-crew assignments needed for later peak hours.
    by_hour = smooth_demand_to_shift_windows(by_hour)
    workers_needed["byHour"] = by_hour

    # Rebuild by_day from smoothed hourly data for a consistent daily summary.
    day_workers: dict[str, int] = {}
    for h in by_hour:
        day_workers[h["date"]] = max(day_workers.get(h["date"], MANDATORY_FLOOR), h["workers"])
    by_day = [
        {
            "date": date,
            "sales": day_sales.get(date, 0.0),
            "mandatory_floor": MANDATORY_FLOOR,
            "formula_headcount": day_workers.get(date, MANDATORY_FLOOR),
            "extra_workers": max(0, day_workers.get(date, MANDATORY_FLOOR) - MANDATORY_FLOOR),
            "workers": day_workers.get(date, MANDATORY_FLOOR),
        }
        for date in sorted(day_workers.keys())
    ]

    avail_user_ids = set()
    avail_blocks: list[tuple[str, int, str, str]] = []
    for a in request.availability:
        uid = _get(a, "userId", "user_id")
        if not uid:
            continue
        avail_user_ids.add(str(uid))
        avail_blocks.append((
            str(uid),
            int(_get(a, "dayOfWeek", "day_of_week", default=0)),
            str(_get(a, "startTime", "start_time", default="09:00"))[:5],
            str(_get(a, "endTime", "end_time", default="17:00"))[:5],
        ))

    schedulable = [
        e for e in request.employees
        if str(_get(e, "userId", "user_id", default="")) in avail_user_ids
    ]

    # Shift assignment is done by the LLM + constraint solver in the API.
    # ML engine only computes demand (workersNeeded); do not fill entire availability blocks.
    shifts: list[dict[str, str]] = []
    flags: list[dict[str, str]] = []

    if not schedulable and request.employees:
        flags.append({"type": "understaffed", "message": "No employees with availability for this week"})
    elif not request.employees:
        flags.append({"type": "understaffed", "message": "No employees in roster"})

    response: dict[str, Any] = {
        "scheduleId": str(uuid.uuid4()),
        "status": "draft",
        "workersNeeded": {"byHour": by_hour, "byDay": by_day},
        "shifts": shifts,
        "flags": flags,
    }
    if prior:
        response["schedulingPrior"] = build_style_hints(prior)
    return response
