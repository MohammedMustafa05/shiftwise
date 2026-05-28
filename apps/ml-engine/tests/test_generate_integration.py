import json
from pathlib import Path

from engine import generate_schedule
from schemas import GenerateRequest


FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def _run_fixture(name: str):
    raw = json.loads((FIXTURES / name).read_text())
    req = GenerateRequest.model_validate(raw)
    return generate_schedule(req)


def test_quiet_day_generates():
    res = _run_fixture("quiet_day.json")
    assert len(res.workersNeeded.byHour) > 0
    assert res.status == "draft"


def test_rush_day_peak_higher_than_off_peak():
    res = _run_fixture("rush_day.json")
    by_hour = {h.hour: h.workers for h in res.workersNeeded.byHour}
    assert by_hour.get(12, 0) >= by_hour.get(22, 0)


def test_short_roster_understaffed_flags():
    res = _run_fixture("short_roster.json")
    types = {f.type for f in res.flags}
    assert "understaffed" in types
