# ShiftWise — ML Engine Averaging Bug Fix
# Cursor Agent Prompt

> Read this entire document before touching any code.
> This is a targeted fix to one specific bug in the ML engine.
> Do not change anything outside the files and functions listed.

---

## The Problem in One Sentence

The ML engine is applying the workers formula to an **averaged** sales value
instead of each **individual hour's** sales value.

This produces flat staffing (e.g. "4 workers all day") instead of the
correct variable staffing (e.g. "3 at 10AM, 6 at 11AM, 7 at 6PM, 3 at 10PM").

---

## Why It Happens

Prophet returns predictions as a smoothed time series. When the engine reads
that output, it is either:

**A) Averaging all hourly predictions into one daily number, then applying the formula:**
```python
# WRONG
daily_avg = sum(prophet_predictions) / len(prophet_predictions)
workers = round((daily_avg * 0.20) / 20)  # one number for the whole day
```

**B) Applying the formula to a block average (e.g. 4-hour windows):**
```python
# WRONG
morning_avg = mean(sales[10], sales[11], sales[12], sales[13])
workers_morning = round((morning_avg * 0.20) / 20)  # same for all 4 hours
```

**C) Using `yhat` (Prophet's smoothed output) which is inherently averaged:**
```python
# WRONG — yhat smooths out hourly spikes
forecast = model.predict(future_df)
workers = round((forecast['yhat'].mean() * 0.20) / 20)
```

---

## The Correct Approach — Apply Formula Per Hour Independently

### For weeks with historical sales data (Approach 1 — use this first):

```python
# prophet_service.py — in predict_week()

# CORRECT: apply formula to EACH hour independently
predictions = []
for hour in range(open_hour, close_hour):
    # Get this specific hour's predicted sales
    hour_sales = get_hourly_prediction(forecast_df, date, hour)

    # Apply formula to THIS hour's value — never average
    formula_total = max(3, min(7, round((hour_sales * LABOUR_COST_PCT) / AVG_WAGE)))

    # Role distribution
    roles = ROLE_DISTRIBUTION[formula_total]

    predictions.append({
        'date':               date_str,
        'hour':               hour,
        'predicted_sales':    hour_sales,
        'traffic_multiplier': hour_sales / daily_baseline,
        'formula_headcount':  formula_total,
        'recommended': {
            'cook': roles[0],
            'pack': roles[1],
            'cash': roles[2],
        },
        'is_peak': hour_sales > (daily_baseline * 1.4),
    })
```

### For future weeks without historical data (Approach 2 — use when Approach 1 has no data):

```python
# When Prophet has no actual sales for a specific future date,
# use the historical HOURLY DISTRIBUTION from known same-day-of-week data

def predict_using_distribution(
    predicted_daily_total: float,
    historical_hourly_distribution: dict,  # {hour: fraction_of_day}
    open_hour: int,
    close_hour: int,
) -> list[dict]:
    """
    Scale a predicted daily total using the known hourly distribution pattern.

    Example:
        Monday 6PM historically = 15.0% of daily sales
        predicted_daily = $8,000
        predicted_6PM   = $8,000 × 0.15 = $1,200
        workers_6PM     = max(3, min(7, round((1200 × 0.20) / 20))) = 7
    """
    predictions = []
    for hour in range(open_hour, close_hour):
        fraction    = historical_hourly_distribution.get(hour, 0.07)  # 7% default
        hour_sales  = predicted_daily_total * fraction

        formula_total = max(3, min(7, round((hour_sales * LABOUR_COST_PCT) / AVG_WAGE)))
        roles = ROLE_DISTRIBUTION[formula_total]

        predictions.append({
            'hour':            hour,
            'predicted_sales': round(hour_sales, 2),
            'formula_headcount': formula_total,
            'recommended': {'cook': roles[0], 'pack': roles[1], 'cash': roles[2]},
            'is_peak': fraction > 0.10,  # hours above 10% of daily = peak
        })
    return predictions
```

---

## The Role Distribution Table — Hardcode This

```python
# LABOUR_COST_PCT = 0.20
# AVG_WAGE        = 20.0
# MAX_WORKERS     = 7
# FLOOR_WORKERS   = 3

ROLE_DISTRIBUTION = {
    3: (1, 1, 1),   # 3 total: 1 Cook + 1 Pack + 1 Cash
    4: (1, 2, 1),   # 4 total: +1 Pack
    5: (1, 2, 2),   # 5 total: +1 Cash
    6: (1, 3, 2),   # 6 total: +1 Pack
    7: (1, 3, 3),   # 7 total: +1 Cash  ← MAX
}
# Priority order when adding above floor: Pack → Cash → Pack → Cash
# Cook is ALWAYS exactly 1. Never 0, never 2.
```

---

## The Hourly Distribution Table — Pre-Compute From Known Data

Build this once from your Drop Chart data and store in Supabase.
Use it every time you need to predict a future week.

```python
# Known hourly distributions from Drop Charts (% of daily total)
# These are the ground-truth patterns for this location

HOURLY_DISTRIBUTIONS = {
    0: {  # Monday (dow=0)
        10: 0.024, 11: 0.066, 12: 0.072, 13: 0.037, 14: 0.073,
        15: 0.081, 16: 0.096, 17: 0.106, 18: 0.150, 19: 0.130,
        20: 0.102, 21: 0.061, 22: 0.003
    },
    1: {  # Tuesday (dow=1)
        10: 0.016, 11: 0.054, 12: 0.124, 13: 0.077, 14: 0.061,
        15: 0.084, 16: 0.076, 17: 0.137, 18: 0.116, 19: 0.138,
        20: 0.077, 21: 0.041
    },
    2: {  # Wednesday (dow=2)
        10: 0.015, 11: 0.081, 12: 0.097, 13: 0.069, 14: 0.083,
        15: 0.078, 16: 0.074, 17: 0.132, 18: 0.122, 19: 0.112,
        20: 0.082, 21: 0.049, 22: 0.006
    },
    3: {  # Thursday (dow=3)
        10: 0.013, 11: 0.074, 12: 0.096, 13: 0.048, 14: 0.053,
        15: 0.087, 16: 0.107, 17: 0.116, 18: 0.132, 19: 0.110,
        20: 0.132, 21: 0.031
    },
    4: {  # Friday (dow=4)
        10: 0.004, 11: 0.047, 12: 0.067, 13: 0.043, 14: 0.061,
        15: 0.076, 16: 0.079, 17: 0.128, 18: 0.158, 19: 0.137,
        20: 0.107, 21: 0.071, 22: 0.012, 23: 0.007
    },
    5: {  # Saturday (dow=5)
        11: 0.004, 12: 0.044, 13: 0.089, 14: 0.104, 15: 0.076,
        16: 0.075, 17: 0.146, 18: 0.136, 19: 0.152, 20: 0.091,
        21: 0.051, 22: 0.022, 23: 0.012
    },
    6: {  # Sunday (dow=6)
        11: 0.019, 12: 0.051, 13: 0.092, 14: 0.087, 15: 0.117,
        16: 0.104, 17: 0.132, 18: 0.145, 19: 0.124, 20: 0.064,
        21: 0.065
    },
}
```

---

## Validation Table — Check Engine Output Against This

After fixing, the engine must produce these exact numbers for the known
Drop Chart week. If the output differs by more than ±1 worker on any hour,
the formula is still broken.

```
MONDAY — $8,565.87
Hour    Sales      Workers   Cook  Pack  Cash
10AM    $206.87    3         1     1     1
11AM    $564.06    6         1     3     2
12PM    $613.32    6         1     3     2
1PM     $315.22    3         1     1     1
2PM     $624.71    6         1     3     2
3PM     $690.19    7         1     3     3
4PM     $826.59    7         1     3     3  ← formula=8, capped to 7
5PM     $905.17    7         1     3     3  ← formula=9, capped to 7
6PM     $1,283.13  7         1     3     3  ← formula=13, capped to 7
7PM     $1,115.62  7         1     3     3  ← formula=11, capped to 7
8PM     $872.34    7         1     3     3  ← formula=9, capped to 7
9PM     $521.98    5         1     2     2
10PM    $26.67     3         1     1     1

TUESDAY — $2,734.36
Hour    Sales      Workers   Cook  Pack  Cash
10AM    $43.15     3         1     1     1
11AM    $148.91    3         1     1     1
12PM    $338.47    3         1     1     1
1PM     $210.50    3         1     1     1
2PM     $165.59    3         1     1     1
3PM     $230.51    3         1     1     1
4PM     $208.46    3         1     1     1
5PM     $373.44    4         1     2     1
6PM     $316.82    3         1     1     1
7PM     $376.57    4         1     2     1
8PM     $210.65    3         1     1     1
9PM     $111.29    3         1     1     1

FRIDAY — $4,595.24
Hour    Sales      Workers   Cook  Pack  Cash
10AM    $20.42     3         1     1     1
11AM    $218.19    3         1     1     1
12PM    $309.01    3         1     1     1
1PM     $195.70    3         1     1     1
2PM     $280.94    3         1     1     1
3PM     $351.30    4         1     2     1
4PM     $364.95    4         1     2     1
5PM     $587.84    6         1     3     2
6PM     $728.53    7         1     3     3  ← peak
7PM     $631.20    6         1     3     2
8PM     $492.00    5         1     2     2
9PM     $326.90    3         1     1     1
10PM    $54.78     3         1     1     1
11PM    $33.48     3         1     1     1
```

---

## What to Find and Fix in the Code

Search for any of these patterns — they are the bug:

```python
# BUG PATTERN 1 — averaging before formula
workers = round((sales_data.mean() * 0.20) / 20)
workers = round((np.mean(yhat) * 0.20) / 20)
workers = round((forecast['yhat'].mean() * 0.20) / 20)

# BUG PATTERN 2 — applying formula to daily total
daily_total = sum(hourly_sales)
workers = round((daily_total * 0.20) / 20)

# BUG PATTERN 3 — groupby that collapses hourly granularity
df.groupby('date')['sales'].mean().apply(lambda s: round((s * 0.20) / 20))

# BUG PATTERN 4 — traffic_multiplier applied to baseline then workers
# (loses hourly variation if baseline is a daily average)
baseline = hourly_sales.mean()
multiplier = yhat / baseline  # yhat is smoothed, loses peaks
workers = round((baseline * multiplier * 0.20) / 20)
```

Replace every occurrence with:

```python
# CORRECT — per-hour independent formula
def compute_workers(hour_sales: float) -> dict:
    total = max(3, min(7, round((hour_sales * 0.20) / 20)))
    dist = {3:(1,1,1), 4:(1,2,1), 5:(1,2,2), 6:(1,3,2), 7:(1,3,3)}
    c, p, ca = dist[total]
    return {
        'total': total,
        'cook': c,
        'pack': p,
        'cash': ca,
        'is_capped': round((hour_sales * 0.20) / 20) > 7,
    }

# Then call per hour:
for hour, sales in hourly_sales.items():
    result = compute_workers(sales)
    # result['total'] is the correct per-hour worker count
```

---

## Testing Checklist

```
[ ] compute_workers(206.87)  → total=3  (C:1 P:1 Ca:1)
[ ] compute_workers(564.06)  → total=6  (C:1 P:3 Ca:2)
[ ] compute_workers(1283.13) → total=7  (C:1 P:3 Ca:3), is_capped=True
[ ] compute_workers(43.15)   → total=3  (C:1 P:1 Ca:1)
[ ] compute_workers(728.53)  → total=7  (C:1 P:3 Ca:3)
[ ] compute_workers(20.42)   → total=3  (C:1 P:1 Ca:1)

[ ] Monday 10AM prediction = 3 workers (NOT 4, NOT 6, NOT 7)
[ ] Monday 11AM prediction = 6 workers
[ ] Monday 6PM prediction  = 7 workers (capped)
[ ] Tuesday ALL hours      = 3 or 4 workers (never 6 or 7)
[ ] Friday 6PM prediction  = 7 workers

[ ] workersNeeded object passed to constraint solver has one entry PER HOUR
    (should be 12-14 entries per day, NOT 1 entry per day or 3 block entries)
[ ] constraintSolver reads per-hour workersNeeded correctly
    (log: "Processing hour 10: need 3 workers" … "Processing hour 18: need 7 workers")
```

---

## Tell Your Agent This

> "Find every place in the ML engine where the formula
> `round((sales * 0.20) / 20)` or `round((sales * labour_pct) / wage)`
> is applied. Check whether it is being called once per day, once per block,
> or once per hour. It MUST be called once per hour with that specific hour's
> sales value — never with an average, never with a daily total.
>
> Add a `compute_workers(hour_sales)` function as specified in this document.
> Replace all formula calls with calls to this function.
> Run the validation table test: Monday 11AM must return 6 workers,
> Monday 10AM must return 3 workers. If those two numbers are the same,
> the averaging bug is still present."

---

*End of fix prompt. One function change. Run the checklist. Done.*
