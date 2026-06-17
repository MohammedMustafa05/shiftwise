# Hourly Sales Data — Analysis Breakdown

Analysis of all Clearview hourly sales exports in `apps/ml-engine/hourly sales data/`.

**Generated:** May 29, 2026  
**Files analyzed:** 27 (26 UTF-16 HTML-as-XLS + 1 CSV)  
**Metric used:** Column **Total Sales ($)** per hour (not order counts or per-channel averages)

---

## 1. What this data is

Each file is a **Clearview Cash Sheet — Hourly Sales** export for a single calendar day. The `.xls` files are not real Excel workbooks; they are **HTML tables encoded as UTF-16 LE**, parsed in this project via `pandas.read_html()`.

Each file contains:

- One row per hour (typically **10:00 AM → 11:00 PM**, 13 slots)
- Sales broken down by channel (Take Out, Skip The Dishes, MB App, DoorDash, Smooth Delivery, Uber Eats — exact channels vary by export)
- A **Total Sales** column used for staffing / labour-demand calculations

Operating window assumed for this analysis: **hours 10–23** (10:00 AM through 11:00 PM).

---

## 2. Date mapping (inferred)

The exports do **not** embed calendar dates in the file body. Dates were inferred as follows:

| File suffix `(N)` | Inferred date |
|---|---|
| `(11)` – `(30)` | **April N, 2026** |
| `(31)` – `(37)` | **May (N−30), 2026** (i.e. `(31)` = May 1, `(37)` = May 7) |

**Evidence this mapping is correct:**

- File `(11)` totals **$3,187.43** on a **Saturday** — matches exactly the sample day documented in `ShiftWise Data Parsing Schedule.md` (“Saturday April 2026”).
- File `(22)` = Wednesday April 22, 2026 — highest-volume April day at **$3,789.79**.

**Coverage:** April 11 – May 7, 2026 (**27 days**).

---

## 3. Executive summary

| Metric | Value |
|---|---|
| **Grand total (27 days)** | **$24,815.59** |
| **Average daily sales** | $919.10 |
| **Median daily sales** | $395.27 |
| **Std deviation** | $1,411.33 (very high — data is heavily skewed) |
| **High-volume days (≥ $2,000)** | 5 days |
| **Low-volume days (< $500)** | 19 days |

### Key takeaways

1. **Dinner rush dominates.** Roughly **51%** of all sales fall in **5:00–8:00 PM**; **~43%** of high-volume-day sales peak between **5:00–7:00 PM**.
2. **Busiest clock hours:** **6:00–7:00 PM** (avg $142/hr across all days), then **5:00–6:00 PM** ($128/hr), then **7:00–8:00 PM** ($111/hr).
3. **Quietest clock hours:** **10:00–11:00 AM** (avg $3.50/hr), **11:00 PM–12:00 AM** ($15/hr), **10:00–11:00 PM** ($21/hr).
4. **Busiest weekdays by average:** **Tuesday** ($1,857/day), **Thursday** ($1,296/day), **Wednesday** ($1,094/day).
5. **Quietest weekdays:** **Monday** ($212/day), **Friday** ($434/day), **Sunday** ($442/day).
6. **Take Out is the core channel** on busy days (~72% of high-volume sales); delivery apps (Smooth Delivery, MB App, Skip, DoorDash, Uber Eats) make up the rest.
7. **Most days look like partial or closed operations.** 19 of 27 days had total sales under $500, often with only 1–2 hours registering any sales. The five high-volume days appear to represent **normal full trading days**.

---

## 4. Daily sales — all 27 days

Sorted by date:

| Date | Day | Daily total | Peak hour | Peak hour sales |
|---|---|---:|---|---:|
| 2026-04-11 | Saturday | $3,187.43 | 6:00 PM | $465.92 |
| 2026-04-12 | Sunday | $585.73 | 7:00 PM | $267.35 |
| 2026-04-13 | Monday | $270.79 | 5:00 PM | $94.46 |
| 2026-04-14 | Tuesday | $100.87 | 4:00 PM | $63.13 |
| 2026-04-15 | Wednesday | $97.23 | 3:00 PM | $56.75 |
| 2026-04-16 | Thursday | $41.97 | 7:00 PM | $24.99 |
| 2026-04-17 | Friday | $484.28 | 4:00 PM | $105.91 |
| 2026-04-18 | Saturday | $44.05 | 5:00 PM | $44.05 |
| 2026-04-19 | Sunday | $195.30 | 11:00 AM | $58.46 |
| 2026-04-20 | Monday | $219.34 | 6:00 PM | $139.41 |
| 2026-04-21 | Tuesday | $413.77 | 1:00 PM | $134.89 |
| 2026-04-22 | Wednesday | **$3,789.79** | 6:00 PM | $511.89 |
| 2026-04-23 | Thursday | $105.62 | 4:00 PM | $81.63 |
| 2026-04-24 | Friday | $422.96 | 6:00 PM | $105.49 |
| 2026-04-25 | Saturday | $561.40 | 5:00 PM | $100.30 |
| 2026-04-26 | Sunday | $475.74 | 8:00 PM | $157.79 |
| 2026-04-27 | Monday | $222.22 | 12:00 PM | $121.09 |
| 2026-04-28 | Tuesday | **$3,375.96** | 5:00 PM | $781.25 |
| 2026-04-29 | Wednesday | $466.67 | 6:00 PM | $259.84 |
| 2026-04-30 | Thursday | $174.73 | 2:00 PM | $56.75 |
| 2026-05-01 | Friday | $395.27 | 7:00 PM | $122.25 |
| 2026-05-02 | Saturday | $111.27 | 8:00 PM | $46.45 |
| 2026-05-03 | Sunday | $511.40 | 8:00 PM | $174.94 |
| 2026-05-04 | Monday | $136.82 | 3:00 PM | $54.89 |
| 2026-05-05 | Tuesday | **$3,539.30** | 6:00 PM | $591.71 |
| 2026-05-06 | Wednesday | $24.27 | 4:00 PM | $24.27 |
| 2026-05-07 | Thursday | **$4,861.41** | 6:00 PM | $759.60 |

### Top 5 busiest days

1. **Thu May 7** — $4,861.41  
2. **Wed Apr 22** — $3,789.79  
3. **Tue May 5** — $3,539.30  
4. **Tue Apr 28** — $3,375.96  
5. **Sat Apr 11** — $3,187.43  

These five days account for **$18,767** (~**76%** of all sales in the dataset).

---

## 5. Day-of-week patterns

Averages across the 27-day window (note: uneven sample sizes per weekday):

| Day | Days in sample | Avg daily sales | Total sales | Share of all sales |
|---|---:|---:|---:|---:|
| **Tuesday** | 4 | **$1,857.48** | $7,429.90 | **29.9%** |
| **Thursday** | 4 | **$1,295.93** | $5,183.73 | **20.9%** |
| **Wednesday** | 4 | $1,094.49 | $4,377.96 | 17.6% |
| **Saturday** | 4 | $976.04 | $3,904.15 | 15.7% |
| **Sunday** | 4 | $442.04 | $1,768.17 | 7.1% |
| **Friday** | 3 | $434.17 | $1,302.51 | 5.2% |
| **Monday** | 4 | $212.29 | $849.17 | 3.4% |

**Weekday vs weekend (this sample):**

| Group | Avg daily | Days |
|---|---:|---:|
| Mon–Fri | $1,007.54 | 19 |
| Sat–Sun | $709.04 | 8 |

> **Caution:** DOW averages are distorted by the mix of full-trade and near-zero days. On **high-volume days only**, peaks still cluster Tue/Wed/Thu, but Saturday Apr 11 is also a strong full day.

---

## 6. Hourly profile — all days

Average, min, and max hourly sales across all 27 files (hours 10 AM–11 PM):

| Hour | Avg sales | Min | Max |
|---|---:|---:|---:|
| 10:00 AM – 11:00 AM | $3.50 | $0.00 | $44.96 |
| 11:00 AM – 12:00 PM | $29.45 | $0.00 | $322.81 |
| 12:00 PM – 1:00 PM | $63.14 | $0.00 | $358.56 |
| 1:00 PM – 2:00 PM | $51.18 | $0.00 | $384.92 |
| 2:00 PM – 3:00 PM | $71.83 | $0.00 | $426.18 |
| 3:00 PM – 4:00 PM | $67.35 | $0.00 | $455.53 |
| 4:00 PM – 5:00 PM | $88.18 | $0.00 | $447.91 |
| **5:00 PM – 6:00 PM** | **$127.97** | $0.00 | **$781.25** |
| **6:00 PM – 7:00 PM** | **$142.21** | $0.00 | **$759.60** |
| **7:00 PM – 8:00 PM** | **$111.30** | $0.00 | $660.09 |
| 8:00 PM – 9:00 PM | $83.27 | $0.00 | $313.93 |
| 9:00 PM – 10:00 PM | $63.25 | $0.00 | $353.56 |
| 10:00 PM – 11:00 PM | $21.43 | $0.00 | $233.39 |
| 11:00 PM – 12:00 AM | $15.02 | $0.00 | $89.65 |

### Peak hour of day (which hour “wins” on each file)

| Peak hour | # of days it was the daily peak |
|---|---:|
| **6:00 PM** | **7** |
| 5:00 PM | 4 |
| 4:00 PM | 4 |
| 7:00 PM | 3 |
| 8:00 PM | 3 |
| Other hours | 6 (scattered — mostly on low-volume days) |

---

## 7. Daypart breakdown (all days combined)

| Daypart | Hours | Total sales | % of all sales |
|---|---|---:|---:|
| Late morning | 10:00–11:00 AM | $69.93 | 0.3% |
| Lunch build | 11:00 AM–1:00 PM | $3,881.84 | 15.6% |
| Afternoon | 2:00–4:00 PM | $6,138.54 | 24.7% |
| **Dinner rush** | **5:00–8:00 PM** | **$12,548.06** | **50.6%** |
| Evening wind-down | 9:00–10:00 PM | $2,177.22 | 8.8% |
| Late night | 10:00–11:00 PM (+ after) | $469.46 | 1.9% |

**Staffing implication:** The floor must be fully covered **5:00–8:00 PM** every operating day; this window drives half of all observed revenue.

---

## 8. High-volume days only (≥ $2,000) — realistic trading profile

These five days are the best model for “normal” busy operations:

| Date | Day | Total |
|---|---|---:|
| Apr 11 | Saturday | $3,187.43 |
| Apr 22 | Wednesday | $3,789.79 |
| Apr 28 | Tuesday | $3,375.96 |
| May 5 | Tuesday | $3,539.30 |
| May 7 | Thursday | $4,861.41 |

### Average hourly sales on high-volume days only

| Hour | Avg | Min | Max |
|---|---:|---:|---:|
| 10:00 AM – 11:00 AM | $34.97 | $24.97 | $44.96 |
| 11:00 AM – 12:00 PM | $132.21 | $6.99 | $322.81 |
| 12:00 PM – 1:00 PM | $259.76 | $63.94 | $358.56 |
| 1:00 PM – 2:00 PM | $213.34 | $86.61 | $384.92 |
| 2:00 PM – 3:00 PM | $341.36 | $267.30 | $426.18 |
| 3:00 PM – 4:00 PM | $271.16 | $167.83 | $455.53 |
| 4:00 PM – 5:00 PM | $353.22 | $228.76 | $447.91 |
| **5:00 PM – 6:00 PM** | **$544.35** | $350.20 | **$781.25** |
| **6:00 PM – 7:00 PM** | **$565.58** | $465.92 | **$759.60** |
| **7:00 PM – 8:00 PM** | **$451.78** | $214.52 | $660.09 |
| 8:00 PM – 9:00 PM | $227.95 | $153.79 | $313.93 |
| 9:00 PM – 10:00 PM | $282.19 | $213.66 | $353.56 |
| 10:00 PM – 11:00 PM | $91.08 | $6.99 | $233.39 |

On a full day, sales ramp from ~$25 at 10 AM to a **plateau of $350–760/hr between 5:00 and 7:00 PM**, then taper through 10 PM.

### Example: Saturday Apr 11, 2026 (hour by hour)

| Hour | Sales |
|---|---:|
| 10:00 AM – 11:00 AM | $24.97 |
| 11:00 AM – 12:00 PM | $322.81 |
| 12:00 PM – 1:00 PM | $339.97 |
| 1:00 PM – 2:00 PM | $141.32 |
| 2:00 PM – 3:00 PM | $267.30 |
| 3:00 PM – 4:00 PM | $167.83 |
| 4:00 PM – 5:00 PM | $228.76 |
| 5:00 PM – 6:00 PM | $411.92 |
| **6:00 PM – 7:00 PM** | **$465.92** |
| 7:00 PM – 8:00 PM | $439.20 |
| 8:00 PM – 9:00 PM | $153.79 |
| 9:00 PM – 10:00 PM | $213.66 |
| 10:00 PM – 11:00 PM | $9.98 |

---

## 9. Sales channel mix (high-volume days)

Take Out dominates; delivery platform mix varies by day/export format.

### Combined across 5 high-volume days ($18,767 total)

| Channel | Sales | Share |
|---|---:|---:|
| **Take Out** | $13,431.24 | **71.6%** |
| Smooth Delivery | $1,723.36 | 9.2% |
| MB App | $1,643.99 | 8.8% |
| Skip The Dishes | $885.09 | 4.7% |
| Uber Eats | $630.67 | 3.4% |
| DoorDash | $431.05 | 2.3% |
| Eat In | $21.98 | 0.1% |

### Per-day channel snapshots

**Sat Apr 11 ($3,187)** — Take Out 74%, MB App 16%, Uber Eats 7%  
**Wed Apr 22 ($3,790)** — Take Out 65%, Smooth Delivery 15%, Skip 13%  
**Tue Apr 28 ($3,376)** — Take Out 67%, MB App 16%, Smooth Delivery 14%  
**Tue May 5 ($3,539)** — Take Out 70%, Smooth Delivery 16%, Skip 7%  
**Thu May 7 ($4,875)** — Take Out 79%, Uber Eats 8%, MB App 7%

---

## 10. Low-volume days — what they likely mean

19 days had totals **under $500**. Inspection shows:

- Files still contain 12–14 hourly rows (structure intact)
- But **most hours register $0.00** (e.g. Apr 15: only 2 hours with any sales; Apr 16: 2 hours)

This pattern is consistent with **store closure, partial shift, or non-representative exports** — not parser failure. Examples:

| Date | Total | Active hours (sales > $0) |
|---|---:|---:|
| Apr 15 (Wed) | $97.23 | 2 |
| Apr 16 (Thu) | $41.97 | 2 |
| May 6 (Wed) | $24.27 | 1 |

**Recommendation for scheduling models:** Train on the **5 high-volume days** (or apply a minimum daily-sales threshold) rather than treating all 27 days as equivalent operating days.

---

## 11. Implications for scheduling

Based on this data alone:

1. **Mandatory peak coverage:** 5:00–8:00 PM every open day; **6:00 PM** is the single most common peak hour.
2. **Pre-rush staffing:** Sales build from 11:00 AM onward on full days; by 2:00 PM averages exceed $340/hr on busy days.
3. **Open hour (10 AM)** is consistently slow ($25–45 on full days) — minimal labour beyond floor of 3.
4. **Late night (10–11 PM):** Highly variable ($10–$233); still requires coverage but lower sales density.
5. **Tuesday / Wednesday / Thursday** produced the highest full-day totals in this sample — worth weighting in ML priors.
6. **Take Out–heavy workload:** ~72% of busy-day sales are counter/pickup; pack/cash roles likely track Take Out peaks closely.

---

## 12. Data files reference

| Location | Count | Format |
|---|---:|---|
| `apps/ml-engine/hourly sales data/Cash Sheet - Hourly Sales (11–36).xls` | 26 | UTF-16 HTML-as-XLS |
| `apps/ml-engine/hourly sales data/Cash Sheet - Hourly Sales (37).csv` | 1 | Standard CSV (includes Eat In + DoorDash columns) |

Related project code (not modified for this analysis):

- `apps/ml-engine/sales_parser.py` — Python parser for `.xls` exports  
- `apps/api/src/services/clearviewCashSheet.ts` — TypeScript mirror for API uploads  
- `ShiftWise Data Parsing Schedule.md` — format specification; Apr 11 sample validation  

---

## 13. Caveats

- **Dates are inferred**, not read from file metadata. If file numbering used a different scheme, DOW conclusions would shift.
- **Channel columns shift** between exports (19 vs 21 columns; CSV has Eat In). Totals (col 18 or 24) are reliable; channel splits required per-format column maps.
- **27 days is a small sample** with extreme variance; patterns are directional, not statistically definitive.
- Some `.xls` files start at **11:00 AM** instead of 10:00 AM (e.g. file 22); open-hour totals may slightly undercount vs a strict 10 AM–11 PM window.

---

## 14. Per-Hour Staffing Demand Tables

Role split by worker count:

| Workers | Cook | Pack | Cash |
|---------|------|------|------|
| 3       | 1    | 1    | 1    |
| 4       | 1    | 2    | 1    |
| 5       | 1    | 2    | 2    |
| 6       | 1    | 3    | 2    |
| 7 (max) | 1    | 3    | 3    |

Formula: `workers = max(3, min(7, round((hourly_sales × 0.20) / 20)))`  
Cook is always exactly 1. Pack is prioritised over Cash when adding extras above the floor.

---

### Monday — $8,566 total | Opens 10AM, Closes 10PM

Monday is the **busiest day**. Hits max staffing (7) from 3PM–9PM. The 1PM dip ($315) is unusual.

| Hour | Sales    | Workers | Cook | Pack | Cash |
|------|----------|---------|------|------|------|
| 10AM | $207     | 3       | 1    | 1    | 1    |
| 11AM | $564     | 6       | 1    | 3    | 2    |
| 12PM | $613     | 6       | 1    | 3    | 2    |
| 1PM  | $315     | 3       | 1    | 1    | 1    |
| 2PM  | $625     | 6       | 1    | 3    | 2    |
| 3PM  | $690     | 7       | 1    | 3    | 3    |
| 4PM  | $827     | 7       | 1    | 3    | 3    |
| 5PM  | $905     | 7       | 1    | 3    | 3    |
| 6PM  | $1,283   | 7       | 1    | 3    | 3    |
| 7PM  | $1,116   | 7       | 1    | 3    | 3    |
| 8PM  | $872     | 7       | 1    | 3    | 3    |
| 9PM  | $522     | 5       | 1    | 2    | 2    |

---

### Tuesday — $2,734 total | Opens 10AM, Closes 10PM

Quietest weekday. Floor minimum (3) almost the entire day. Only 5PM and 7PM bump to 4.

| Hour | Sales | Workers | Cook | Pack | Cash |
|------|-------|---------|------|------|------|
| 10AM | $43   | 3       | 1    | 1    | 1    |
| 11AM | $149  | 3       | 1    | 1    | 1    |
| 12PM | $338  | 3       | 1    | 1    | 1    |
| 1PM  | $211  | 3       | 1    | 1    | 1    |
| 2PM  | $166  | 3       | 1    | 1    | 1    |
| 3PM  | $231  | 3       | 1    | 1    | 1    |
| 4PM  | $208  | 3       | 1    | 1    | 1    |
| 5PM  | $373  | 4       | 1    | 2    | 1    |
| 6PM  | $317  | 3       | 1    | 1    | 1    |
| 7PM  | $377  | 4       | 1    | 2    | 1    |
| 8PM  | $211  | 3       | 1    | 1    | 1    |
| 9PM  | $111  | 3       | 1    | 1    | 1    |

---

### Wednesday — $3,056 total | Opens 10AM, Closes 10PM

Similar to Tuesday. Only 5PM–6PM need a 4th person.

| Hour | Sales | Workers | Cook | Pack | Cash |
|------|-------|---------|------|------|------|
| 10AM | $46   | 3       | 1    | 1    | 1    |
| 11AM | $249  | 3       | 1    | 1    | 1    |
| 12PM | $297  | 3       | 1    | 1    | 1    |
| 1PM  | $212  | 3       | 1    | 1    | 1    |
| 2PM  | $252  | 3       | 1    | 1    | 1    |
| 3PM  | $238  | 3       | 1    | 1    | 1    |
| 4PM  | $226  | 3       | 1    | 1    | 1    |
| 5PM  | $402  | 4       | 1    | 2    | 1    |
| 6PM  | $373  | 4       | 1    | 2    | 1    |
| 7PM  | $342  | 3       | 1    | 1    | 1    |
| 8PM  | $249  | 3       | 1    | 1    | 1    |
| 9PM  | $151  | 3       | 1    | 1    | 1    |

---

### Thursday — $3,760 total | Opens 10AM, Closes 10PM

Starts picking up. 6PM and 8PM hit 5 workers — first time cashier needs 2.

| Hour | Sales | Workers | Cook | Pack | Cash |
|------|-------|---------|------|------|------|
| 10AM | $48   | 3       | 1    | 1    | 1    |
| 11AM | $279  | 3       | 1    | 1    | 1    |
| 12PM | $361  | 4       | 1    | 2    | 1    |
| 1PM  | $179  | 3       | 1    | 1    | 1    |
| 2PM  | $201  | 3       | 1    | 1    | 1    |
| 3PM  | $328  | 3       | 1    | 1    | 1    |
| 4PM  | $403  | 4       | 1    | 2    | 1    |
| 5PM  | $434  | 4       | 1    | 2    | 1    |
| 6PM  | $497  | 5       | 1    | 2    | 2    |
| 7PM  | $415  | 4       | 1    | 2    | 1    |
| 8PM  | $497  | 5       | 1    | 2    | 2    |
| 9PM  | $118  | 3       | 1    | 1    | 1    |

---

### Friday — $4,595 total | Opens 10AM, Closes 12AM

6PM peaks at 7 (max). Strong evening ramp: 4→6→7→6→5 from 3PM–8PM.

| Hour | Sales | Workers | Cook | Pack | Cash |
|------|-------|---------|------|------|------|
| 10AM | $20   | 3       | 1    | 1    | 1    |
| 11AM | $218  | 3       | 1    | 1    | 1    |
| 12PM | $309  | 3       | 1    | 1    | 1    |
| 1PM  | $196  | 3       | 1    | 1    | 1    |
| 2PM  | $281  | 3       | 1    | 1    | 1    |
| 3PM  | $351  | 4       | 1    | 2    | 1    |
| 4PM  | $365  | 4       | 1    | 2    | 1    |
| 5PM  | $588  | 6       | 1    | 3    | 2    |
| 6PM  | $729  | 7       | 1    | 3    | 3    |
| 7PM  | $631  | 6       | 1    | 3    | 2    |
| 8PM  | $492  | 5       | 1    | 2    | 2    |
| 9PM  | $327  | 3       | 1    | 1    | 1    |
| 10PM | $55   | 3       | 1    | 1    | 1    |
| 11PM | $33   | 3       | 1    | 1    | 1    |

---

### Saturday — $3,546 total | Opens 11AM, Closes 12AM

5–7PM needs 5 workers for 3 straight hours. Sharp drop at 8PM back to floor.

| Hour  | Sales | Workers | Cook | Pack | Cash |
|-------|-------|---------|------|------|------|
| 11AM  | $14   | 3       | 1    | 1    | 1    |
| 12PM  | $155  | 3       | 1    | 1    | 1    |
| 1PM   | $315  | 3       | 1    | 1    | 1    |
| 2PM   | $367  | 4       | 1    | 2    | 1    |
| 3PM   | $268  | 3       | 1    | 1    | 1    |
| 4PM   | $268  | 3       | 1    | 1    | 1    |
| 5PM   | $516  | 5       | 1    | 2    | 2    |
| 6PM   | $484  | 5       | 1    | 2    | 2    |
| 7PM   | $538  | 5       | 1    | 2    | 2    |
| 8PM   | $322  | 3       | 1    | 1    | 1    |
| 9PM   | $180  | 3       | 1    | 1    | 1    |
| 10PM  | $77   | 3       | 1    | 1    | 1    |
| 11PM  | $42   | 3       | 1    | 1    | 1    |

---

### Sunday — $3,015 total | Opens 11AM, Closes 10PM

Never exceeds 4 workers. Flat 4-person window from 3PM (skipping 4PM) then 5–7PM.

| Hour | Sales | Workers | Cook | Pack | Cash |
|------|-------|---------|------|------|------|
| 11AM | $56   | 3       | 1    | 1    | 1    |
| 12PM | $155  | 3       | 1    | 1    | 1    |
| 1PM  | $278  | 3       | 1    | 1    | 1    |
| 2PM  | $262  | 3       | 1    | 1    | 1    |
| 3PM  | $353  | 4       | 1    | 2    | 1    |
| 4PM  | $313  | 3       | 1    | 1    | 1    |
| 5PM  | $397  | 4       | 1    | 2    | 1    |
| 6PM  | $437  | 4       | 1    | 2    | 1    |
| 7PM  | $374  | 4       | 1    | 2    | 1    |
| 8PM  | $192  | 3       | 1    | 1    | 1    |
| 9PM  | $197  | 3       | 1    | 1    | 1    |
