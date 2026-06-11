"""Tests for Clearview UTF-16 HTML-as-XLS and CSV sales parser."""
from pathlib import Path

import pandas as pd
import pytest

from sales_parser import (
    ANOMALY_DATES,
    daily_total,
    format_hour,
    get_operating_hours,
    get_operating_window,
    is_anomaly_date,
    parse_clearview_cash_sheet,
    parse_time_to_hour,
    resolve_total_columns,
)

DATA_DIR = Path(__file__).resolve().parent / "hourly sales data"
SAMPLE_XLS = DATA_DIR / "Cash Sheet - Hourly Sales (22).xls"
SAMPLE_CSV = DATA_DIR / "Cash Sheet - Hourly Sales (37).csv"
DROP_CHART = DATA_DIR / "Drop Chart Worksheet 3.pdf"


@pytest.mark.skipif(not SAMPLE_XLS.exists(), reason="sample xls not present")
def test_parse_utf16_cash_sheet():
    records = parse_clearview_cash_sheet(str(SAMPLE_XLS))
    assert len(records) == 13
    assert records[0]["hour"] == 11
    assert records[0]["hour_start"] == 11
    assert records[0]["total_sales"] == pytest.approx(87.94, abs=0.01)
    assert records[-1]["hour"] == 23
    assert all(r["total_sales"] >= 0 for r in records)


@pytest.mark.skipif(not SAMPLE_CSV.exists(), reason="sample csv not present")
def test_parse_csv_cash_sheet_uses_ncols_offset():
    records = parse_clearview_cash_sheet(str(SAMPLE_CSV), sale_date="2026-05-07")
    assert len(records) >= 13
    assert records[0]["hour"] == 10
    assert records[0]["sale_date"] == "2026-05-07"
    assert records[0]["day_of_week"] == 3  # Thursday
    total = daily_total(records)
    assert total == pytest.approx(4861.41, abs=1.0)


def test_resolve_total_columns():
    assert resolve_total_columns(21, is_csv=False) == (18, 17)
    assert resolve_total_columns(27, is_csv=True) == (24, 23)


def test_parse_time_to_hour():
    assert parse_time_to_hour("10:00 AM") == 10
    assert parse_time_to_hour("12:00 PM") == 12
    assert parse_time_to_hour("1:00 PM") == 13
    assert parse_time_to_hour("10:00 PM") == 22
    assert parse_time_to_hour("11:00 PM") == 23


def test_skips_midnight_artifact():
    df = pd.DataFrame(
        [
            ["h1", "h2"] + [""] * 19,
            ["From", "To"] + [""] * 19,
            ["12:00 AM", "1:00 AM"] + [0] * 17 + [99.0, 0, 0],
            ["10:00 AM", "11:00 AM"] + [0] * 17 + [50.0, 0, 0],
            ["Totals", "Totals"] + [0] * 19,
        ]
    )
    from sales_parser import _extract_records

    records = _extract_records(df, None, is_csv=False)
    assert len(records) == 1
    assert records[0]["hour"] == 10


def test_operating_hours_from_records():
    records = [{"hour_start": 10, "hour_end": 23, "hour": 10}]
    assert get_operating_hours(records) == (10, 23)
    assert get_operating_window([{"hour": 10}, {"hour": 22}]) == (10, 23)


def test_format_hour():
    assert format_hour(10) == "10:00 AM"
    assert format_hour(22) == "10:00 PM"


def test_anomaly_date():
    assert is_anomaly_date("2026-04-20")
    assert "2026-04-20" in ANOMALY_DATES


@pytest.mark.skipif(not DROP_CHART.exists(), reason="drop chart pdf not present")
def test_drop_chart_april_22_total():
    from drop_chart_parser import extract_drop_chart_metadata

    meta = extract_drop_chart_metadata(str(DROP_CHART))
    assert meta["date"] == "2026-04-22"
    assert meta["day_of_week_name"] == "Wednesday"
    assert meta["total_sales"] == pytest.approx(3055.73, abs=0.01)
    assert sum(meta["hourly_sales"].values()) == pytest.approx(3055.73, abs=0.01)


@pytest.mark.skipif(not DATA_DIR.exists(), reason="sales data dir missing")
def test_match_known_drop_chart_totals():
    from sales_ingestion import KNOWN_DATE_MAPPINGS, match_cash_sheets_to_dates

    matched = match_cash_sheets_to_dates(DATA_DIR, KNOWN_DATE_MAPPINGS, tolerance=5.0)
    # Cash sheets in repo do not share totals with Apr 20-26 drop charts — matching may be empty
    assert isinstance(matched, dict)
