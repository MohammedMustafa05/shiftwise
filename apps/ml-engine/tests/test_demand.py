import json
from pathlib import Path

from demand import compute_sales_demand, workers_from_sales
from schemas import GenerateRequest, Preferences


FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def test_workers_from_sales_zero():
    prefs = Preferences(labourCostPct=0.2, avgHourlyWage=18.5)
    assert workers_from_sales(0, prefs) == 0


def test_workers_from_sales_rush():
    prefs = Preferences(labourCostPct=0.2, avgHourlyWage=18.5)
    # 2500 * 0.2 / 18.5 = 27.03 -> 28
    assert workers_from_sales(2500, prefs) >= 20


def test_quiet_day_low_workers():
    raw = json.loads((FIXTURES / "quiet_day.json").read_text())
    req = GenerateRequest.model_validate(raw)
    hourly = compute_sales_demand(
        req.sales, req.preferences, 10, 14, ["2026-05-25"]
    )
    assert all(h.workers_sales <= 2 for h in hourly)
