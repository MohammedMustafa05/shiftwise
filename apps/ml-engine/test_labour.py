"""Reconciliation tests — Store 6412 Milton LSL (20% labour, $20/hr)."""

from datetime import datetime

from labour import (
    AVG_WAGE,
    LABOUR_COST_PCT,
    MANDATORY_FLOOR,
    MAX_ROLE_STAFF,
    OPERATING_HOURS,
    combined_role_targets,
    compute_workers_needed,
    extra_role_targets,
    extra_workers_from_formula,
    formula_headcount_from_sales,
    workers_needed_from_sales,
)
from scheduling_engine import build_hourly_demand_row, operating_hours_for_date


def test_workers_needed_formula():
    assert formula_headcount_from_sales(0, LABOUR_COST_PCT, AVG_WAGE) == MANDATORY_FLOOR
    assert formula_headcount_from_sales(43.15, LABOUR_COST_PCT, AVG_WAGE) == 3
    assert formula_headcount_from_sales(350, LABOUR_COST_PCT, AVG_WAGE) == 4
    assert workers_needed_from_sales(350, LABOUR_COST_PCT) == 4


def test_spot_checks_from_manual_session():
    cases = [
        (43.15, 3, 1, 1, 1),
        (350.0, 4, 1, 2, 1),
        (373.44, 4, 1, 2, 1),
        (496.87, 5, 1, 2, 2),
        (587.84, 6, 1, 3, 2),
        (728.53, 7, 1, 3, 3),
        (905.17, 9, 1, 3, 3),
        (1283.13, 13, 1, 3, 3),
    ]
    for sales, exp_total, exp_cook, exp_pack, exp_cash in cases:
        result = compute_workers_needed(sales)
        assert result["total"] == exp_total, sales
        assert result["cook"] == exp_cook
        assert result["pack"] == exp_pack
        assert result["cash"] == exp_cash
        if exp_total > MAX_ROLE_STAFF:
            assert result["overdemand"] is True
            assert result["effective_total"] == MAX_ROLE_STAFF


def test_extra_role_distribution_pack_then_cash():
    assert extra_role_targets(1) == {"COOK": 0, "CASHIER": 0, "PACKLINER": 1}
    assert extra_role_targets(2) == {"COOK": 0, "CASHIER": 1, "PACKLINER": 1}
    assert extra_role_targets(4) == {"COOK": 0, "CASHIER": 2, "PACKLINER": 2}
    assert combined_role_targets(5) == {"COOK": 1, "CASHIER": 2, "PACKLINER": 2}
    assert combined_role_targets(7) == {"COOK": 1, "CASHIER": 3, "PACKLINER": 3}


def test_low_sales_floor_wins():
    row = build_hourly_demand_row("2026-06-01", 12, 20.0)
    assert row["formula_headcount"] == MANDATORY_FLOOR
    assert row["extra_workers"] == 0
    assert row["floor_roles"] == {"COOK": 1, "CASHIER": 1, "PACKLINER": 1}


def test_busy_hour_adds_extras():
    formula = formula_headcount_from_sales(500, LABOUR_COST_PCT)
    assert formula == 5
    assert extra_workers_from_formula(formula) == 2
    assert combined_role_targets(formula) == {"COOK": 1, "CASHIER": 2, "PACKLINER": 2}


def test_operating_hours_by_day():
    # Monday Apr 20 2026 — weeknights close at 10PM (close=22), not 11PM.
    # Mon/Wed Drop Chart 10PM–11PM slots ($26/$18) are close-down stragglers.
    mon = "2026-04-20"
    assert datetime.strptime(mon, "%Y-%m-%d").weekday() == 0
    assert operating_hours_for_date(mon) == (10, 22)
    assert OPERATING_HOURS[0] == {"open": 10, "close": 22}

    fri = "2026-04-24"
    assert operating_hours_for_date(fri) == (10, 24)

    sat = "2026-04-25"
    assert operating_hours_for_date(sat) == (11, 24)

    sun = "2026-04-26"
    assert operating_hours_for_date(sun) == (11, 22)
