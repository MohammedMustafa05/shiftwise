"""
Optional sales forecast training. Falls back to last-week DOW mapping when no model exists.
"""

from __future__ import annotations

import os
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent / "models"


def forecast_sales_for_week(
    workplace_id: str,
    historical_rows: list[dict],
    target_dates: list[str],
) -> list[dict]:
    """
    MVP: copy same DOW/hour averages from historical_rows.
    When enough history exists, train sklearn model (future enhancement).
    """
    by_dow_hour: dict[tuple[int, int], list[float]] = {}
    for row in historical_rows:
        from datetime import datetime

        d = datetime.strptime(row["date"], "%Y-%m-%d")
        dow = d.weekday()
        key = (dow, int(row["hour"]))
        by_dow_hour.setdefault(key, []).append(float(row["sales_amount"]))

    averages = {k: sum(v) / len(v) for k, v in by_dow_hour.items() if v}

    out: list[dict] = []
    for date in target_dates:
        from datetime import datetime

        d = datetime.strptime(date, "%Y-%m-%d")
        dow = d.weekday()
        for hour in range(24):
            amount = averages.get((dow, hour), 0.0)
            out.append({"date": date, "hour": hour, "sales_amount": amount})
    return out


def train_workplace_model(workplace_id: str, historical_rows: list[dict]) -> str | None:
    """Placeholder for sklearn training when 8+ weeks of data available."""
    if len(historical_rows) < 24 * 7 * 4:
        return None
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = MODELS_DIR / f"sales_forecast_{workplace_id}.joblib"
    # sklearn integration deferred — return path when implemented
    return str(path) if path.exists() else None
