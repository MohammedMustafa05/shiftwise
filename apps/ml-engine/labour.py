"""Two-phase labour demand: mandatory floor (3) then formula extras only.

Store 6412 Milton LSL — confirmed: 20% labour, $20/hr average wage.
"""

MANDATORY_FLOOR = 3
LABOUR_COST_PCT = 0.20
AVG_WAGE = 20.0
# Backward-compatible alias used in formula: (sales × labour_pct) / wage
LABOUR_COST_DIVISOR = AVG_WAGE
DEFAULT_AVG_WAGE = AVG_WAGE

MAX_ROLE_STAFF = 7

# Extras count → role breakdown (cook always 1; pack prioritized; max 2 cashiers)
ROLE_DISTRIBUTION: dict[int, dict[str, int]] = {
    0: {"cook": 1, "pack": 1, "cash": 1},  # 3 workers
    1: {"cook": 1, "pack": 2, "cash": 1},  # 4 workers
    2: {"cook": 1, "pack": 2, "cash": 2},  # 5 workers
    3: {"cook": 1, "pack": 3, "cash": 2},  # 6 workers
    4: {"cook": 1, "pack": 4, "cash": 2},  # 7 workers
}

# Known hourly distributions from Drop Charts (fraction of daily total per hour).
# dow 0=Monday .. 6=Sunday (Python weekday convention).
# Used as a fallback to synthesise missing (DOW, hour) slots and to validate output.
HOURLY_DISTRIBUTIONS: dict[int, dict[int, float]] = {
    0: {  # Monday
        10: 0.024, 11: 0.066, 12: 0.072, 13: 0.037, 14: 0.073,
        15: 0.081, 16: 0.096, 17: 0.106, 18: 0.150, 19: 0.130,
        20: 0.102, 21: 0.061, 22: 0.003,
    },
    1: {  # Tuesday
        10: 0.016, 11: 0.054, 12: 0.124, 13: 0.077, 14: 0.061,
        15: 0.084, 16: 0.076, 17: 0.137, 18: 0.116, 19: 0.138,
        20: 0.077, 21: 0.041,
    },
    2: {  # Wednesday
        10: 0.015, 11: 0.081, 12: 0.097, 13: 0.069, 14: 0.083,
        15: 0.078, 16: 0.074, 17: 0.132, 18: 0.122, 19: 0.112,
        20: 0.082, 21: 0.049, 22: 0.006,
    },
    3: {  # Thursday
        10: 0.013, 11: 0.074, 12: 0.096, 13: 0.048, 14: 0.053,
        15: 0.087, 16: 0.107, 17: 0.116, 18: 0.132, 19: 0.110,
        20: 0.132, 21: 0.031,
    },
    4: {  # Friday
        10: 0.004, 11: 0.047, 12: 0.067, 13: 0.043, 14: 0.061,
        15: 0.076, 16: 0.079, 17: 0.128, 18: 0.158, 19: 0.137,
        20: 0.107, 21: 0.071, 22: 0.012, 23: 0.007,
    },
    5: {  # Saturday
        11: 0.004, 12: 0.044, 13: 0.089, 14: 0.104, 15: 0.076,
        16: 0.075, 17: 0.146, 18: 0.136, 19: 0.152, 20: 0.091,
        21: 0.051, 22: 0.022, 23: 0.012,
    },
    6: {  # Sunday
        11: 0.019, 12: 0.051, 13: 0.092, 14: 0.087, 15: 0.117,
        16: 0.104, 17: 0.132, 18: 0.145, 19: 0.124, 20: 0.064,
        21: 0.065,
    },
}

# Per-day store hours (dow 0=Monday, Python weekday() convention)
# Monday and Wednesday show $26/$18 in the 10PM-11PM Drop Chart slot — stragglers
# during close-down, not active operating hours.  Tue/Thu have zero data past 10PM,
# confirming the weeknight pattern is close at 10PM, not 11PM.
OPERATING_HOURS: dict[int, dict[str, int]] = {
    0: {"open": 10, "close": 22},  # Monday    10AM–10PM
    1: {"open": 10, "close": 22},  # Tuesday   10AM–10PM
    2: {"open": 10, "close": 22},  # Wednesday 10AM–10PM
    3: {"open": 10, "close": 22},  # Thursday  10AM–10PM
    4: {"open": 10, "close": 24},  # Friday    10AM–12AM
    5: {"open": 11, "close": 24},  # Saturday  11AM–12AM
    6: {"open": 11, "close": 22},  # Sunday    11AM–10PM
}


def compute_workers(hour_sales: float) -> dict:
    """
    Compute capped per-hour worker count and role breakdown.

    Formula: max(3, min(7, round((hour_sales × 0.20) / 20)))
    Cook is always exactly 1.  Pack is prioritised over Cash for extras.
    is_capped=True when the raw formula would exceed the 7-worker maximum.
    """
    raw = round((hour_sales * LABOUR_COST_PCT) / AVG_WAGE) if hour_sales > 0 else 0
    total = max(MANDATORY_FLOOR, min(MAX_ROLE_STAFF, raw))
    extras = total - MANDATORY_FLOOR
    roles = ROLE_DISTRIBUTION[min(extras, 4)]
    return {
        "total": total,
        "cook": roles["cook"],
        "pack": roles["pack"],
        "cash": roles["cash"],
        "is_capped": raw > MAX_ROLE_STAFF,
    }


def formula_headcount_from_sales(
    sales_amount: float,
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
) -> int:
    """Total workers demand justifies — never below mandatory floor."""
    if sales_amount <= 0:
        return MANDATORY_FLOOR
    raw = round((sales_amount * labour_pct) / avg_wage)
    return max(MANDATORY_FLOOR, int(raw))


def extra_workers_from_formula(formula_headcount: int) -> int:
    """Workers to add ON TOP of the mandatory floor (may be zero)."""
    return max(0, formula_headcount - MANDATORY_FLOOR)


def roles_for_extras(extras: int) -> dict[str, int]:
    """Role breakdown for a given extras count (capped at max role model)."""
    return ROLE_DISTRIBUTION[min(extras, 4)]


def compute_workers_needed(
    hourly_sales: float,
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
) -> dict[str, int | bool]:
    """
    Compute total workers and role breakdown for a given hour's sales.

    When formula exceeds 7, roles cap at 7 (1C/3P/3Ca) and overdemand=True.
    """
    formula_total = formula_headcount_from_sales(hourly_sales, labour_pct, avg_wage)
    extras = extra_workers_from_formula(formula_total)
    roles = roles_for_extras(extras)
    overdemand = formula_total > MAX_ROLE_STAFF

    return {
        "total": formula_total,
        "effective_total": min(formula_total, MAX_ROLE_STAFF),
        "cook": roles["cook"],
        "pack": roles["pack"],
        "cash": roles["cash"],
        "extras": extras,
        "mandatory_floor": MANDATORY_FLOOR,
        "formula_headcount": formula_total,
        "overdemand": overdemand,
    }


def floor_role_targets() -> dict[str, int]:
    return {"COOK": 1, "CASHIER": 1, "PACKLINER": 1}


def extra_role_targets(extra_workers: int) -> dict[str, int]:
    """Distribute extras: Pack → Cash → Pack → Cash (cook stays at floor=1)."""
    roles = roles_for_extras(extra_workers)
    floor = floor_role_targets()
    return {
        "COOK": 0,
        "CASHIER": max(0, roles["cash"] - floor["CASHIER"]),
        "PACKLINER": max(0, roles["pack"] - floor["PACKLINER"]),
    }


def combined_role_targets(formula_headcount: int) -> dict[str, int]:
    """Floor roles + extra roles = total per-role targets (capped at max role model)."""
    extras = extra_workers_from_formula(formula_headcount)
    roles = roles_for_extras(extras)
    return {
        "COOK": roles["cook"],
        "CASHIER": roles["cash"],
        "PACKLINER": roles["pack"],
    }


def workers_needed_from_sales(
    sales_amount: float,
    labour_pct: float = LABOUR_COST_PCT,
    avg_wage: float = AVG_WAGE,
) -> int:
    return formula_headcount_from_sales(sales_amount, labour_pct, avg_wage)


def role_targets_for_total_workers(total_workers: int) -> dict[str, int]:
    return combined_role_targets(max(MANDATORY_FLOOR, total_workers))
