"""
Clearview Cash Sheet Parser
Handles UTF-16 HTML-as-XLS and UTF-8 CSV Clearview hourly sales exports.
"""
from __future__ import annotations

import io
import re
from datetime import date
from pathlib import Path
from typing import Optional

import pandas as pd

DEFAULT_OPEN_HOUR = 10
DEFAULT_CLOSE_HOUR = 23

ANOMALY_DATES = frozenset()  # All historical dates contribute to demand averages (Victoria Day included)


def resolve_total_columns(ncols: int, is_csv: bool) -> tuple[int, int]:
    """Return (sales_col, count_col) for XLS (21 cols) or CSV/variant layouts."""
    if not is_csv and ncols == 21:
        return 18, 17
    return ncols - 3, ncols - 4


def parse_clearview_cash_sheet(file_path: str, sale_date: str | None = None) -> list[dict]:
    """
    Parse a Clearview hourly sales export (.xls HTML or .csv).

    Returns records with hour, total_sales, transaction_count, and optional sale_date.
    Legacy keys hour_start / hour_end are included for backward compatibility.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Sales file not found: {file_path}")

    raw = path.read_bytes()
    suffix = path.suffix.lower()

    if raw[:3] == b"\xef\xbb\xbf" or suffix == ".csv":
        text = raw.decode("utf-8-sig", errors="replace")
        return _parse_csv_content(text, sale_date)

    if raw[:2] == b"\xff\xfe":
        html = raw.decode("utf-16-le", errors="replace")
    elif raw[:2] == b"\xfe\xff":
        html = raw.decode("utf-16-be", errors="replace")
    else:
        html = raw.decode("utf-8", errors="replace")

    try:
        tables = pd.read_html(io.StringIO(html), header=None)
    except Exception as e:
        raise ValueError(f"Cannot parse HTML from {path.name}: {e}") from e

    if not tables:
        raise ValueError(f"No table found in {path.name}")

    return _extract_records(tables[0], sale_date, is_csv=False)


def _parse_csv_content(text: str, sale_date: str | None) -> list[dict]:
    df = pd.read_csv(io.StringIO(text), header=None)
    return _extract_records(df, sale_date, is_csv=True)


def _extract_records(df: pd.DataFrame, sale_date: str | None, is_csv: bool) -> list[dict]:
    ncols = df.shape[1]
    if ncols < 19:
        raise ValueError(
            f"Expected at least 19 columns, got {ncols}. "
            "File may be a different Clearview export format."
        )

    sales_col, count_col = resolve_total_columns(ncols, is_csv)
    day_of_week: int | None = None
    if sale_date:
        day_of_week = date.fromisoformat(sale_date).weekday()

    records: list[dict] = []
    for _, row in df.iloc[2:-1].iterrows():
        start_str = str(row.iloc[0]).strip()
        end_str = str(row.iloc[1]).strip() if ncols > 1 else ""

        if not start_str or start_str.lower() in ("nan", "from", "totals", "total"):
            continue
        if not re.search(r"\d+:\d+", start_str):
            continue

        hour = parse_time_to_hour(start_str)
        hour_end = parse_time_to_hour(end_str) if end_str else None
        if hour is None:
            continue

        # Clearview midnight export artifact
        if hour == 0:
            continue

        try:
            sales = float(row.iloc[sales_col])
            sales = 0.0 if (pd.isna(sales) or sales < 0) else round(float(sales), 2)
        except (ValueError, TypeError, IndexError):
            sales = 0.0

        try:
            count = int(float(row.iloc[count_col]))
            count = 0 if pd.isna(count) else count
        except (ValueError, TypeError, IndexError):
            count = 0

        end_hour = hour_end if hour_end is not None else hour + 1
        records.append(
            {
                "sale_date": sale_date,
                "hour": hour,
                "hour_start": hour,
                "hour_end": end_hour,
                "hour_label": f"{format_hour(hour)} - {format_hour(end_hour)}",
                "total_sales": sales,
                "transaction_count": count,
                "day_of_week": day_of_week,
            }
        )

    if not records:
        raise ValueError(
            "No valid hourly data rows found. "
            "Check that this is a Clearview hourly sales export."
        )

    records.sort(key=lambda r: r["hour"])
    return records


def parse_time_to_hour(time_str: str) -> Optional[int]:
    """Convert Clearview time strings to 24h integer hour."""
    match = re.match(r"(\d+):(\d+)\s*(AM|PM)", time_str.strip().upper())
    if not match:
        return None

    hour = int(match.group(1))
    ampm = match.group(3)

    if ampm == "PM" and hour != 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0

    return hour


def format_hour(hour_24: int) -> str:
    """Convert 24h integer to display string."""
    if hour_24 == 0:
        return "12:00 AM"
    if hour_24 < 12:
        return f"{hour_24}:00 AM"
    if hour_24 == 12:
        return "12:00 PM"
    return f"{hour_24 - 12}:00 PM"


def get_operating_hours(records: list[dict]) -> tuple[int, int]:
    """Extract open and close hours from parsed records."""
    if not records:
        return (DEFAULT_OPEN_HOUR, DEFAULT_CLOSE_HOUR)
    first = records[0].get("hour_start", records[0].get("hour"))
    last_end = records[-1].get("hour_end", records[-1].get("hour", 0) + 1)
    return (int(first), int(last_end))


def get_operating_window(records: list[dict]) -> tuple[int, int]:
    """Returns (open_hour, close_hour). E.g. (10, 23)."""
    if not records:
        return (DEFAULT_OPEN_HOUR, DEFAULT_CLOSE_HOUR)
    return (records[0]["hour"], records[-1]["hour"] + 1)


def daily_total(records: list[dict]) -> float:
    return round(sum(r["total_sales"] for r in records), 2)


def is_anomaly_date(sale_date: str) -> bool:
    return sale_date in ANOMALY_DATES
