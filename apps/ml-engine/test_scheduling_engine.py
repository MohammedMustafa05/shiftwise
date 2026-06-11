from labour import (
    MANDATORY_FLOOR,
    combined_role_targets,
    extra_role_targets,
    extra_workers_from_formula,
    formula_headcount_from_sales,
)
from scheduling_engine import build_hourly_demand_row


def test_low_sales_floor_wins():
    row = build_hourly_demand_row("2026-06-01", 12, 20.0)
    assert row["formula_headcount"] == MANDATORY_FLOOR
    assert row["extra_workers"] == 0


def test_busy_hour_adds_extras():
    formula = formula_headcount_from_sales(500)
    assert formula == 5
    assert extra_workers_from_formula(formula) == 2
    assert combined_role_targets(formula) == {"COOK": 1, "CASHIER": 2, "PACKLINER": 2}


def test_extra_role_distribution():
    assert extra_role_targets(4) == {"COOK": 0, "CASHIER": 2, "PACKLINER": 2}
