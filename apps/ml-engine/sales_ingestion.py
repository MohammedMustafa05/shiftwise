"""Ingest Clearview sales files into hourly_sales_data."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from drop_chart_parser import extract_drop_chart_metadata
from sales_parser import (
    ANOMALY_DATES,
    daily_total,
    is_anomaly_date,
    parse_clearview_cash_sheet,
)

# Ground truth from Drop Chart PDFs (Store 6412 Milton LSL, week of Apr 20–26 2026)
KNOWN_DATE_MAPPINGS: dict[str, dict[str, Any]] = {
    "2026-04-20": {
        "day": "Monday",
        "dow": 0,
        "total": 8565.87,
        "anomaly": True,
        "anomaly_reason": "Victoria Day holiday — exclude from ML training",
    },
    "2026-04-21": {"day": "Tuesday", "dow": 1, "total": 2734.36, "anomaly": False},
    "2026-04-22": {"day": "Wednesday", "dow": 2, "total": 3055.73, "anomaly": False},
    "2026-04-23": {"day": "Thursday", "dow": 3, "total": 3760.31, "anomaly": False},
    "2026-04-24": {"day": "Friday", "dow": 4, "total": 4595.24, "anomaly": False},
    "2026-04-25": {"day": "Saturday", "dow": 5, "total": 3546.39, "anomaly": False},
    "2026-04-26": {"day": "Sunday", "dow": 6, "total": 3015.15, "anomaly": False},
}


def match_cash_sheets_to_dates(
    cash_sheet_dir: str | Path,
    known_mappings: dict[str, dict[str, Any]] | None = None,
    tolerance: float = 5.0,
) -> dict[str, str]:
    """
    Match cash sheet filenames to known dates by comparing total daily sales.
    Returns {filename: 'YYYY-MM-DD'}.
    """
    mappings = known_mappings or KNOWN_DATE_MAPPINGS
    directory = Path(cash_sheet_dir)
    matched: dict[str, str] = {}

    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in (".xls", ".csv"):
            continue
        if not path.name.startswith("Cash Sheet"):
            continue
        try:
            records = parse_clearview_cash_sheet(str(path))
            file_total = daily_total(records)
        except Exception:
            continue

        for date_str, info in mappings.items():
            if abs(file_total - float(info["total"])) <= tolerance:
                matched[path.name] = date_str
                break

    return matched


def ingest_cash_sheet_records(
    cur,
    workplace_id: str,
    records: list[dict],
    sale_date: str,
    source_file: str,
    data_source: str = "cash_sheet",
    force_reimport: bool = False,
) -> dict[str, Any]:
    anomaly = is_anomaly_date(sale_date)
    anomaly_reason = KNOWN_DATE_MAPPINGS.get(sale_date, {}).get("anomaly_reason")
    if anomaly and not anomaly_reason:
        anomaly_reason = "Holiday/event day"

    if force_reimport:
        cur.execute(
            "DELETE FROM hourly_sales_data WHERE workplace_id = %s AND sale_date = %s",
            (workplace_id, sale_date),
        )

    rows_written = 0
    for r in records:
        cur.execute(
            """
            INSERT INTO hourly_sales_data
              (workplace_id, sale_date, hour, sales_amount, day_of_week,
               is_anomaly, anomaly_reason, data_source, transaction_count, source_file)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET
              sales_amount = EXCLUDED.sales_amount,
              day_of_week = EXCLUDED.day_of_week,
              is_anomaly = EXCLUDED.is_anomaly,
              anomaly_reason = EXCLUDED.anomaly_reason,
              data_source = EXCLUDED.data_source,
              transaction_count = EXCLUDED.transaction_count,
              source_file = EXCLUDED.source_file
            """,
            (
                workplace_id,
                sale_date,
                r["hour"],
                r["total_sales"],
                r.get("day_of_week"),
                anomaly,
                anomaly_reason if anomaly else None,
                data_source,
                r.get("transaction_count", 0),
                source_file,
            ),
        )
        rows_written += 1

    return {
        "rows_written": rows_written,
        "total_sales": daily_total(records),
        "is_anomaly": anomaly,
        "sale_date": sale_date,
    }


def ingest_cash_sheet_file(
    cur,
    workplace_id: str,
    file_path: str,
    sale_date: str,
    force_reimport: bool = False,
) -> dict[str, Any]:
    records = parse_clearview_cash_sheet(file_path, sale_date=sale_date)
    return ingest_cash_sheet_records(
        cur,
        workplace_id,
        records,
        sale_date,
        source_file=Path(file_path).name,
        data_source="cash_sheet",
        force_reimport=force_reimport,
    )


def ingest_drop_chart_file(
    cur,
    workplace_id: str,
    pdf_path: str,
    force_reimport: bool = False,
) -> dict[str, Any]:
    meta = extract_drop_chart_metadata(pdf_path)
    sale_date = meta["date"]
    anomaly = is_anomaly_date(sale_date) or bool(
        KNOWN_DATE_MAPPINGS.get(sale_date, {}).get("anomaly")
    )
    anomaly_reason = KNOWN_DATE_MAPPINGS.get(sale_date, {}).get("anomaly_reason")
    if anomaly and not anomaly_reason:
        anomaly_reason = "Holiday/event day"

    if force_reimport:
        cur.execute(
            "DELETE FROM hourly_sales_data WHERE workplace_id = %s AND sale_date = %s",
            (workplace_id, sale_date),
        )

    rows_written = 0
    for hour, sales in sorted(meta["hourly_sales"].items()):
        cur.execute(
            """
            INSERT INTO hourly_sales_data
              (workplace_id, sale_date, hour, sales_amount, day_of_week,
               is_anomaly, anomaly_reason, data_source, source_file)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (workplace_id, sale_date, hour) DO UPDATE SET
              sales_amount = EXCLUDED.sales_amount,
              day_of_week = EXCLUDED.day_of_week,
              is_anomaly = EXCLUDED.is_anomaly,
              anomaly_reason = EXCLUDED.anomaly_reason,
              data_source = EXCLUDED.data_source,
              source_file = EXCLUDED.source_file
            """,
            (
                workplace_id,
                sale_date,
                hour,
                sales,
                meta["day_of_week"],
                anomaly,
                anomaly_reason if anomaly else None,
                "drop_chart",
                Path(pdf_path).name,
            ),
        )
        rows_written += 1

    return {
        "date": sale_date,
        "day": meta["day_of_week_name"],
        "rows_written": rows_written,
        "total_sales": meta["total_sales"],
        "is_anomaly": anomaly,
    }


def default_sales_data_dir() -> Path:
    return Path(__file__).resolve().parent / "hourly sales data"


def ingest_all_clearview_sales(
    conn,
    workplace_id: str,
    data_dir: str | Path | None = None,
    force_reimport: bool = False,
) -> dict[str, Any]:
    directory = Path(data_dir) if data_dir else default_sales_data_dir()
    cur = conn.cursor()
    results: dict[str, Any] = {"drop_charts": [], "cash_sheets": [], "unmatched_cash_sheets": []}

    for pdf in sorted(directory.glob("Drop Chart*.pdf")):
        try:
            result = ingest_drop_chart_file(cur, workplace_id, str(pdf), force_reimport)
            results["drop_charts"].append({"file": pdf.name, **result})
        except Exception as e:
            results["drop_charts"].append({"file": pdf.name, "error": str(e)})

    matched = match_cash_sheets_to_dates(directory)
    matched_files = set(matched.keys())

    for fname, sale_date in sorted(matched.items()):
        path = directory / fname
        try:
            result = ingest_cash_sheet_file(cur, workplace_id, str(path), sale_date, force_reimport)
            results["cash_sheets"].append({"file": fname, **result})
        except Exception as e:
            results["cash_sheets"].append({"file": fname, "error": str(e)})

    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in (".xls", ".csv") or not path.name.startswith("Cash Sheet"):
            continue
        if path.name in matched_files:
            continue
        try:
            total = daily_total(parse_clearview_cash_sheet(str(path)))
            results["unmatched_cash_sheets"].append({"file": path.name, "total_sales": total})
        except Exception as e:
            results["unmatched_cash_sheets"].append({"file": path.name, "error": str(e)})

    conn.commit()
    return results
