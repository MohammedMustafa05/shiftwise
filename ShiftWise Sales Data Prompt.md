# ShiftWise — Sales Data Pipeline & ML Engine Integration
# Cursor Agent Prompt: How to Read Clearview Data and Feed the ML Engine

> Feed this entire document to your Cursor agent before writing any code.
> All data formats, column positions, and business rules below come from
> real file analysis of actual Clearview exports from Store 6412 Milton LSL.

---

## 1. What You Are Building

A data ingestion pipeline that:
1. Reads Clearview hourly sales exports (XLS and CSV formats)
2. Reads Clearview Drop Chart PDFs (these contain dates and day-of-week)
3. Cleans, labels, and stores the data in Supabase
4. Feeds the Prophet ML model with properly dated, labelled hourly records
5. Applies the two-phase staffing model (floor + demand extras)

---

## 2. The Two File Types You Will Encounter

### File Type A — Cash Sheet Hourly Sales (`.xls` or `.csv`)
- **What it is:** Daily hourly sales totals exported from Clearview POS
- **File naming:** `Cash_Sheet_-_Hourly_Sales__N_.xls` (sequential N, no dates in filename)
- **Critical:** These files are NOT real Excel files — they are HTML tables saved with a
  `.xls` extension using UTF-16 LE encoding. Standard Excel parsers will crash.
- **Parser:** Read raw bytes → detect UTF-16 BOM → decode → `pd.read_html()`
- **CSV variant:** Same structure but UTF-8 with BOM, has one extra channel column
  ("Eat In") making it 27 columns instead of 21

### File Type B — Drop Chart Worksheets (`.pdf`)
- **What it is:** Clearview's daily production planning sheet — contains the date,
  day of week, and hourly sales breakdown
- **Why it matters:** Cash sheets have NO dates. Drop Charts have dates.
  Use Drop Charts to build the date→file mapping for Prophet training.
- **Structure:** PDF with text layer, extractable via pdftotext or PyPDF2

---

## 3. Exact Column Structure — Cash Sheet XLS (21 columns)

The HTML table has these columns at index 0-20:

```
Col 0:  Hour start string  (e.g. "10:00 AM")
Col 1:  Hour end string    (e.g. "11:00 AM")
Col 2:  Take Out — Count
Col 3:  Take Out — Sales ($)       ← individual channel, do NOT use
Col 4:  Take Out — Avg Sale
Col 5:  Skip The Dishes — Count
Col 6:  Skip The Dishes — Sales    ← individual channel, do NOT use
Col 7:  Skip The Dishes — Avg Sale
Col 8:  MB App — Count
Col 9:  MB App — Sales             ← individual channel, do NOT use
Col 10: MB App — Avg Sale
Col 11: Smooth Delivery — Count
Col 12: Smooth Delivery — Sales    ← individual channel, do NOT use
Col 13: Smooth Delivery — Avg Sale
Col 14: Uber Eats — Count
Col 15: Uber Eats — Sales          ← individual channel, do NOT use
Col 16: Uber Eats — Avg Sale
Col 17: TOTAL — Count              ← USE THIS for transaction count
Col 18: TOTAL — Sales ($)          ← USE THIS for staffing calculations
Col 19: Total — Avg Sale
Col 20: Total — % of day
```

**Always use column 18 (Total Sales) and column 17 (Total Count).**
Never use individual channel sales — they do not represent full revenue.

### Row structure:
```
Row 0:  Channel header row 1  (Take Out, Skip The Dishes, etc.)  ← SKIP
Row 1:  Column label row       (Count, Sales, Avg. Sale, %)       ← SKIP
Row 2 to second-to-last: Hourly data rows                         ← USE THESE
Last row: Totals row                                              ← SKIP
```

---

## 4. Exact Column Structure — Cash Sheet CSV (27 columns)

The CSV variant adds "Eat In" as the first channel, shifting all columns right by 3.
Total Sales is now at the **third-to-last column** (index `ncols - 3`).
Total Count is at **fourth-to-last** (index `ncols - 4`).

```python
# Safe formula that works for BOTH XLS and CSV:
ncols = df.shape[1]
if ncols == 21:
    total_sales_col = 18   # XLS format
    total_count_col = 17
else:
    total_sales_col = ncols - 3   # CSV format (27 cols) or any variant
    total_count_col = ncols - 4
```

---

## 5. The Parser — Implement This Exactly

**File:** `apps/ml/app/services/sales_parser.py`

```python
import pandas as pd
import io
import re
from pathlib import Path
from typing import Optional


def parse_clearview_cash_sheet(file_path: str, sale_date: str = None) -> list[dict]:
    """
    Parse a Clearview hourly sales export.

    Handles:
    - UTF-16 LE encoded HTML files saved as .xls (BOM: FF FE)
    - UTF-8 CSV files with BOM (EF BB BF)
    - Both 21-column (XLS) and 27-column (CSV) variants

    Args:
        file_path: Path to the .xls or .csv file
        sale_date: Date string "YYYY-MM-DD" — required for ML training.
                   If None, record is stored without a date (cannot be used
                   for Prophet training until date is assigned).

    Returns:
        List of dicts:
        {
            'sale_date': str or None,    # YYYY-MM-DD
            'hour': int,                  # 24h integer (10-23)
            'hour_label': str,            # "10AM-11AM"
            'total_sales': float,         # total $ all channels
            'transaction_count': int,     # total orders
            'day_of_week': int or None,   # 0=Monday...6=Sunday (if date provided)
        }
    """
    fp = Path(file_path)
    raw = fp.read_bytes()

    # Detect encoding
    if raw[:2] == b'\xff\xfe':
        html = raw.decode('utf-16-le', errors='replace')
    elif raw[:2] == b'\xfe\xff':
        html = raw.decode('utf-16-be', errors='replace')
    elif raw[:3] == b'\xef\xbb\xbf':
        # UTF-8 BOM — this is a CSV
        html_or_csv = raw.decode('utf-8-sig')
        return _parse_csv_content(html_or_csv, sale_date)
    else:
        html = raw.decode('utf-8', errors='replace')

    # Parse HTML table
    try:
        tables = pd.read_html(io.StringIO(html), header=None)
    except Exception as e:
        raise ValueError(f"Cannot parse HTML from {fp.name}: {e}")

    if not tables:
        raise ValueError(f"No table found in {fp.name}")

    df = tables[0]
    return _extract_records(df, sale_date, is_csv=False)


def _parse_csv_content(text: str, sale_date: str) -> list[dict]:
    import io
    df = pd.read_csv(io.StringIO(text), header=None)
    return _extract_records(df, sale_date, is_csv=True)


def _extract_records(df: pd.DataFrame, sale_date: str, is_csv: bool) -> list[dict]:
    ncols = df.shape[1]

    # Column indices
    if not is_csv and ncols == 21:
        sales_col = 18
        count_col = 17
    else:
        # CSV variant or unknown — use offset from end
        sales_col = ncols - 3
        count_col = ncols - 4

    day_of_week = None
    if sale_date:
        from datetime import date
        d = date.fromisoformat(sale_date)
        day_of_week = d.weekday()  # 0=Monday, 6=Sunday

    records = []

    # Skip first 2 rows (headers), skip last row (totals)
    for _, row in df.iloc[2:-1].iterrows():
        start_str = str(row.iloc[0]).strip()

        # Skip non-data rows
        if not re.search(r'\d+:\d+', start_str):
            continue
        if start_str.lower() in ('nan', 'from', 'totals', 'total'):
            continue

        hour = _parse_time_to_hour(start_str)
        if hour is None:
            continue

        # Skip midnight artifact (hour 0) — Clearview export bug
        if hour == 0:
            continue

        try:
            sales = float(row.iloc[sales_col])
            sales = 0.0 if (pd.isna(sales) or sales < 0) else round(sales, 2)
        except (ValueError, TypeError):
            sales = 0.0

        try:
            count = int(float(row.iloc[count_col]))
            count = 0 if pd.isna(count) else count
        except (ValueError, TypeError):
            count = 0

        records.append({
            'sale_date':         sale_date,
            'hour':              hour,
            'hour_label':        f"{_format_hour(hour)}-{_format_hour(hour + 1)}",
            'total_sales':       sales,
            'transaction_count': count,
            'day_of_week':       day_of_week,
        })

    # Sort by hour ascending
    records.sort(key=lambda r: r['hour'])
    return records


def _parse_time_to_hour(time_str: str) -> Optional[int]:
    """Convert "10:00 AM" → 10, "1:00 PM" → 13, "10:00 PM" → 22"""
    m = re.match(r'(\d+):(\d+)\s*(AM|PM)', time_str.strip().upper())
    if not m:
        return None
    h, ampm = int(m.group(1)), m.group(3)
    if ampm == 'PM' and h != 12:
        h += 12
    elif ampm == 'AM' and h == 12:
        h = 0
    return h


def _format_hour(h: int) -> str:
    if h == 0:   return "12AM"
    if h < 12:   return f"{h}AM"
    if h == 12:  return "12PM"
    if h == 24:  return "12AM"
    return f"{h - 12}PM"


def get_operating_window(records: list[dict]) -> tuple[int, int]:
    """Returns (open_hour, close_hour) from parsed records. E.g. (10, 23)"""
    if not records:
        return (10, 23)
    return (records[0]['hour'], records[-1]['hour'] + 1)
```

---

## 6. The Drop Chart Parser — Extract Dates

Drop Charts are the ONLY reliable source of dates for the cash sheet files.
Parse them to build a mapping of `{date: day_of_week}` that you use when
calling `parse_clearview_cash_sheet(file_path, sale_date=...)`.

**File:** `apps/ml/app/services/drop_chart_parser.py`

```python
import re
import subprocess
from pathlib import Path
from datetime import datetime


def extract_drop_chart_metadata(pdf_path: str) -> dict:
    """
    Extract date and day-of-week from a Clearview Drop Chart PDF.

    Returns:
        {
            'date': 'YYYY-MM-DD',
            'day_of_week_name': 'Monday',
            'day_of_week': 0,          # 0=Monday...6=Sunday
            'total_sales': float,
            'store': '6412',
            'hourly_sales': {hour_int: sales_float, ...}
        }
    """
    # Extract text from PDF
    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        capture_output=True, text=True
    )
    text = result.stdout

    if not text.strip():
        # Fallback: try pypdf
        try:
            import pypdf
            reader = pypdf.PdfReader(pdf_path)
            text = '\n'.join(p.extract_text() or '' for p in reader.pages)
        except Exception:
            raise ValueError(f"Cannot extract text from {pdf_path}")

    return _parse_drop_chart_text(text)


def _parse_drop_chart_text(text: str) -> dict:
    # Extract date — format: "April 21, 2026"
    date_match = re.search(
        r'(January|February|March|April|May|June|July|August|September|'
        r'October|November|December)\s+(\d{1,2}),?\s+(\d{4})',
        text
    )
    if not date_match:
        raise ValueError("Cannot find date in Drop Chart")

    month_str = date_match.group(1)
    day_str   = date_match.group(2)
    year_str  = date_match.group(3)
    date_obj  = datetime.strptime(f"{month_str} {day_str} {year_str}", "%B %d %Y")
    date_str  = date_obj.strftime("%Y-%m-%d")
    dow_name  = date_obj.strftime("%A")   # "Monday", "Tuesday", etc.
    dow_int   = date_obj.weekday()        # 0=Monday, 6=Sunday

    # Extract day of week (validation)
    dow_match = re.search(
        r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)', text
    )
    if dow_match and dow_match.group(1) != dow_name:
        # Mismatch — trust the date, not the label
        pass

    # Extract total sales
    total_match = re.search(r'\$\s*([\d,]+\.\d{2})\s*\$\s*Yield', text)
    total_sales = 0.0
    if total_match:
        total_sales = float(total_match.group(1).replace(',', ''))

    # Extract hourly sales from the table
    # Pattern: "10:00 AM - 11:00 AM $43.15"
    hourly = {}
    hour_pattern = re.finditer(
        r'(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*\$\s*([\d,]+\.\d{2})',
        text
    )
    for m in hour_pattern:
        h = _parse_drop_chart_time(m.group(1))
        s = float(m.group(3).replace(',', ''))
        if h is not None:
            hourly[h] = s

    return {
        'date':             date_str,
        'day_of_week_name': dow_name,
        'day_of_week':      dow_int,
        'total_sales':      total_sales,
        'store':            '6412',
        'hourly_sales':     hourly,
    }


def _parse_drop_chart_time(s: str) -> int | None:
    m = re.match(r'(\d+):(\d+)\s*(AM|PM)', s.strip().upper())
    if not m: return None
    h, ampm = int(m.group(1)), m.group(3)
    if ampm == 'PM' and h != 12: h += 12
    elif ampm == 'AM' and h == 12: h = 0
    return h
```

---

## 7. The Date Mapping Table — Hardcode This as Ground Truth

This mapping was derived from the Drop Chart PDFs (April 20–26, 2026).
Store this in your database and use it to label cash sheet files.

```python
# Known date mappings from Drop Chart analysis
# Format: {cash_sheet_file_number: {date, day_of_week, day_name, total_sales}}
# These are confirmed ground truth — do not change

KNOWN_DATE_MAPPINGS = {
    # Week of April 20-26, 2026 (from Drop Chart PDFs)
    # NOTE: Cash sheet file numbers for this week are NOT confirmed
    # until you match total_sales values between Drop Charts and Cash Sheets
    "2026-04-20": {"day": "Monday",    "dow": 0, "total": 8565.87,  "anomaly": True,
                   "anomaly_reason": "Victoria Day holiday — exclude from ML training"},
    "2026-04-21": {"day": "Tuesday",   "dow": 1, "total": 2734.36,  "anomaly": False},
    "2026-04-22": {"day": "Wednesday", "dow": 2, "total": 3055.73,  "anomaly": False},
    "2026-04-23": {"day": "Thursday",  "dow": 3, "total": 3760.31,  "anomaly": False},
    "2026-04-24": {"day": "Friday",    "dow": 4, "total": 4595.24,  "anomaly": False},
    "2026-04-25": {"day": "Saturday",  "dow": 5, "total": 3546.39,  "anomaly": False},
    "2026-04-26": {"day": "Sunday",    "dow": 6, "total": 3015.15,  "anomaly": False},
}
```

---

## 8. How to Match Cash Sheet Files to Dates

Since cash sheet files have no dates in them, match by **total daily sales**:

```python
def match_cash_sheets_to_dates(
    cash_sheet_dir: str,
    known_mappings: dict,
    tolerance: float = 5.0  # $5 tolerance for rounding differences
) -> dict[str, str]:
    """
    Match cash sheet files to known dates by comparing total sales.

    Returns: {filename: 'YYYY-MM-DD'}
    """
    import os
    from sales_parser import parse_clearview_cash_sheet

    unmatched_files = {}
    for fname in os.listdir(cash_sheet_dir):
        if not (fname.endswith('.xls') or fname.endswith('.csv')):
            continue
        fp = os.path.join(cash_sheet_dir, fname)
        try:
            records = parse_clearview_cash_sheet(fp)
            file_total = sum(r['total_sales'] for r in records)
            unmatched_files[fname] = file_total
        except Exception:
            continue

    # Match by total sales
    matched = {}
    for fname, file_total in unmatched_files.items():
        for date_str, info in known_mappings.items():
            if abs(file_total - info['total']) <= tolerance:
                matched[fname] = date_str
                break

    return matched
```

**Apply this matching, then manually verify and fill in remaining files.**
Any file with total sales that matches a known date within $5 is a confirmed match.

---

## 9. Supabase Table — Store Sales Data with Dates

Run this in the Supabase SQL editor. This extends the existing `hourly_sales_data` table:

```sql
-- Add date and day columns if not already present
ALTER TABLE hourly_sales_data
  ADD COLUMN IF NOT EXISTS day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS is_anomaly BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomaly_reason TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'cash_sheet';

-- Index for Prophet queries (needs date + hour sorted)
CREATE INDEX IF NOT EXISTS idx_hourly_sales_date_hour
  ON hourly_sales_data (workplace_id, sale_date, hour);

-- Index for day-of-week pattern analysis
CREATE INDEX IF NOT EXISTS idx_hourly_sales_dow
  ON hourly_sales_data (workplace_id, day_of_week, hour);

-- View: only non-anomaly records for ML training
CREATE OR REPLACE VIEW hourly_sales_for_training AS
SELECT * FROM hourly_sales_data
WHERE is_anomaly = false
  AND sale_date IS NOT NULL
  AND day_of_week IS NOT NULL
ORDER BY sale_date, hour;
```

---

## 10. Data Ingestion Pipeline — Write This Function

**File:** `apps/ml/app/services/data_ingestion.py`

```python
from sqlalchemy.orm import Session
from sales_parser import parse_clearview_cash_sheet
from drop_chart_parser import extract_drop_chart_metadata
from app.models.sales import HourlySalesData
import uuid
import logging

logger = logging.getLogger(__name__)

ANOMALY_DATES = {
    "2026-04-20",  # Victoria Day — $8,565 vs $2,734-3,760 normal weekday
    # Add more as you discover them
}


def ingest_cash_sheet(
    file_path: str,
    workplace_id: str,
    sale_date: str,    # YYYY-MM-DD — required
    db: Session,
    force_reimport: bool = False,
) -> dict:
    """
    Parse a cash sheet file and write records to hourly_sales_data.

    Args:
        file_path: Path to .xls or .csv file
        workplace_id: Supabase workplace UUID
        sale_date: The calendar date this file represents (YYYY-MM-DD)
        db: SQLAlchemy session
        force_reimport: If True, delete existing records for this date first

    Returns:
        {'rows_written': int, 'total_sales': float, 'is_anomaly': bool}
    """
    is_anomaly = sale_date in ANOMALY_DATES

    if force_reimport:
        db.query(HourlySalesData).filter(
            HourlySalesData.workplace_id == workplace_id,
            HourlySalesData.sale_date == sale_date
        ).delete()
        db.commit()

    records = parse_clearview_cash_sheet(file_path, sale_date=sale_date)

    if not records:
        raise ValueError(f"No valid hourly records found in {file_path}")

    rows_written = 0
    for r in records:
        # Check for existing record (upsert)
        existing = db.query(HourlySalesData).filter(
            HourlySalesData.workplace_id == workplace_id,
            HourlySalesData.sale_date == sale_date,
            HourlySalesData.hour == r['hour'],
        ).first()

        if existing:
            existing.sales_amount = r['total_sales']
            existing.day_of_week  = r['day_of_week']
            existing.is_anomaly   = is_anomaly
        else:
            db.add(HourlySalesData(
                id           = str(uuid.uuid4()),
                workplace_id = workplace_id,
                sale_date    = sale_date,
                hour         = r['hour'],
                sales_amount = r['total_sales'],
                day_of_week  = r['day_of_week'],
                is_anomaly   = is_anomaly,
                anomaly_reason = "Victoria Day holiday" if is_anomaly else None,
                source_file  = str(file_path).split('/')[-1],
                data_source  = 'cash_sheet',
            ))
            rows_written += 1

    db.commit()

    logger.info(
        f"Ingested {rows_written} records for {sale_date} "
        f"({'ANOMALY - flagged' if is_anomaly else 'normal'})"
    )

    return {
        'rows_written': rows_written,
        'total_sales':  sum(r['total_sales'] for r in records),
        'is_anomaly':   is_anomaly,
    }


def ingest_drop_chart(
    pdf_path: str,
    workplace_id: str,
    db: Session,
) -> dict:
    """
    Parse a Drop Chart PDF and write its hourly sales to hourly_sales_data.
    Drop Charts are the authoritative source of dates — use them first.
    """
    meta = extract_drop_chart_metadata(pdf_path)
    sale_date = meta['date']
    is_anomaly = sale_date in ANOMALY_DATES

    rows_written = 0
    for hour, sales in meta['hourly_sales'].items():
        existing = db.query(HourlySalesData).filter(
            HourlySalesData.workplace_id == workplace_id,
            HourlySalesData.sale_date    == sale_date,
            HourlySalesData.hour         == hour,
        ).first()

        if existing:
            # Drop Chart data takes precedence — it's more reliable
            existing.sales_amount  = sales
            existing.day_of_week   = meta['day_of_week']
            existing.is_anomaly    = is_anomaly
            existing.data_source   = 'drop_chart'
        else:
            db.add(HourlySalesData(
                id            = str(uuid.uuid4()),
                workplace_id  = workplace_id,
                sale_date     = sale_date,
                hour          = hour,
                sales_amount  = sales,
                day_of_week   = meta['day_of_week'],
                is_anomaly    = is_anomaly,
                anomaly_reason = "Holiday/event day" if is_anomaly else None,
                source_file   = str(pdf_path).split('/')[-1],
                data_source   = 'drop_chart',
            ))
            rows_written += 1

    db.commit()
    return {
        'date':         sale_date,
        'day':          meta['day_of_week_name'],
        'rows_written': rows_written,
        'total_sales':  meta['total_sales'],
        'is_anomaly':   is_anomaly,
    }
```

---

## 11. Prophet Training — Use Only Clean, Dated, Non-Anomaly Records

**File:** `apps/ml/app/services/prophet_service.py` — update `train_model()`:

```python
def train_model(workplace_id: str, db: Session) -> dict:
    """
    Train Prophet model using only:
    - Records with a confirmed sale_date
    - Records with a confirmed day_of_week
    - Records where is_anomaly = False
    - Records where sales_amount >= 0

    Anomaly days (holidays, events, promotional days) are EXCLUDED.
    The Monday April 20 ($8,565) Victoria Day record is automatically excluded.
    """

    # Query only clean training records
    rows = db.execute(text("""
        SELECT sale_date, hour, sales_amount, day_of_week
        FROM hourly_sales_data
        WHERE workplace_id = :wid
          AND is_anomaly   = false
          AND sale_date    IS NOT NULL
          AND day_of_week  IS NOT NULL
          AND sales_amount >= 0
        ORDER BY sale_date, hour
    """), {"wid": workplace_id}).fetchall()

    if len(rows) < 168:  # Minimum 1 week of clean data
        raise ValueError(
            f"Only {len(rows)} clean training records found. "
            f"Need at least 168 (1 week). "
            f"Check that cash sheets are ingested with correct dates and "
            f"that anomaly records are flagged."
        )

    # Build Prophet DataFrame
    import pandas as pd
    from prophet import Prophet

    records = []
    for row in rows:
        from datetime import datetime, date
        dt = datetime.combine(
            row.sale_date if isinstance(row.sale_date, date)
            else date.fromisoformat(str(row.sale_date)),
            __import__('datetime').time(row.hour, 0)
        )
        records.append({'ds': dt, 'y': float(row.sales_amount)})

    df = pd.DataFrame(records).sort_values('ds').reset_index(drop=True)

    # Remove zeros? Keep them — zero sales hours are real data
    # (store is open but no orders came in)
    df = df[df['y'] >= 0]  # only remove negatives (data errors)

    model = Prophet(
        yearly_seasonality  = False,
        weekly_seasonality  = True,   # learns Mon-Sun patterns
        daily_seasonality   = True,   # learns hour-of-day patterns
        seasonality_mode    = 'multiplicative',
        changepoint_prior_scale = 0.05,
        interval_width      = 0.80,
    )
    model.fit(df)

    # ... rest of training pipeline unchanged
```

---

## 12. What the Clean Data Looks Like After Ingestion

Based on the Drop Chart analysis, here is exactly what your Supabase
`hourly_sales_data` table should contain after ingesting this week:

```
sale_date    hour  sales_amount  day_of_week  is_anomaly  data_source
2026-04-20   10    206.87        0            TRUE        drop_chart   ← excluded from ML
2026-04-20   11    564.06        0            TRUE        drop_chart   ← excluded from ML
... (all Monday records flagged as anomaly)

2026-04-21   10    43.15         1            FALSE       cash_sheet   ← used for ML
2026-04-21   11    148.91        1            FALSE       cash_sheet
2026-04-21   12    338.47        1            FALSE       cash_sheet
2026-04-21   13    210.50        1            FALSE       cash_sheet
2026-04-21   14    165.59        1            FALSE       cash_sheet
2026-04-21   15    230.51        1            FALSE       cash_sheet
2026-04-21   16    208.46        1            FALSE       cash_sheet
2026-04-21   17    373.44        1            FALSE       cash_sheet
2026-04-21   18    316.82        1            FALSE       cash_sheet
2026-04-21   19    376.57        1            FALSE       cash_sheet
2026-04-21   20    210.65        1            FALSE       cash_sheet
2026-04-21   21    111.29        1            FALSE       cash_sheet

2026-04-22   10    45.79         2            FALSE       drop_chart
... (Wednesday through Sunday all FALSE)

2026-04-24   10    20.42         4            FALSE       cash_sheet   ← Friday
2026-04-24   17    587.84        4            FALSE       cash_sheet   ← Friday peak
2026-04-24   18    728.53        4            FALSE       cash_sheet   ← Friday peak
...
```

---

## 13. What Prophet Learns From This Data

With properly labelled data, Prophet learns these patterns:

**Weekly seasonality (day_of_week patterns):**
- Tuesday: lowest weekday (~$2,734 avg)
- Wednesday: mid (~$3,056)
- Thursday: strong (~$3,760)
- Friday: highest normal day (~$4,595) — Friday multiplier ≈ 1.3-1.5x baseline
- Saturday: weekend (~$3,546)
- Sunday: weekend (~$3,015)
- Monday: excluded (anomaly) — Prophet will interpolate from adjacent data

**Daily seasonality (hour-of-day patterns):**
- 10AM: near zero — multiplier ≈ 0.1
- 12PM-3PM: moderate — multiplier ≈ 0.6-0.8
- 5PM-8PM: peak rush — multiplier ≈ 1.4-2.0
- 6PM: single highest hour every day — multiplier ≈ 1.8-2.2
- 9PM+: rapid decline — multiplier ≈ 0.3-0.5

**These multipliers feed the two-phase staffing model:**
```python
# Floor phase: always 3 workers (independent of Prophet)
floor = 3  # 1 cook + 1 pack + 1 cash

# Demand phase: Prophet prediction → formula → extras
predicted_sales  = prophet_prediction[hour]           # from model.predict()
formula_headcount = max(3, round((predicted_sales * 0.28) / 21))
extra_workers     = max(0, formula_headcount - floor)

# Final: floor + extras
total_workers = floor + extra_workers
```

---

## 14. Validated Staffing Numbers From Real Data

These are confirmed from actual Drop Chart data — your ML model should
produce outputs close to these for the same day types:

```python
# TUESDAY (day_of_week=1) — validated against April 21, 2026 ($2,734)
TUESDAY_EXPECTED = {
    10: 3, 11: 3, 12: 5, 13: 3, 14: 3,
    15: 3, 16: 3, 17: 5, 18: 4, 19: 5,
    20: 3, 21: 3
}

# WEDNESDAY (day_of_week=2) — validated against April 22, 2026 ($3,056)
WEDNESDAY_EXPECTED = {
    10: 3, 11: 3, 12: 4, 13: 3, 14: 3,
    15: 3, 16: 3, 17: 5, 18: 5, 19: 5,
    20: 3, 21: 3, 22: 3
}

# THURSDAY (day_of_week=3) — validated against April 23, 2026 ($3,760)
THURSDAY_EXPECTED = {
    10: 3, 11: 4, 12: 5, 13: 3, 14: 3,
    15: 4, 16: 5, 17: 6, 18: 7, 19: 6,
    20: 7, 21: 3
}

# FRIDAY (day_of_week=4) — validated against April 24, 2026 ($4,595)
FRIDAY_EXPECTED = {
    10: 3, 11: 3, 12: 4, 13: 3, 14: 4,
    15: 5, 16: 5, 17: 8, 18: 10, 19: 8,
    20: 7, 21: 4, 22: 3, 23: 3
}

# SATURDAY (day_of_week=5) — validated against April 25, 2026 ($3,546)
SATURDAY_EXPECTED = {
    11: 3, 12: 3, 13: 4, 14: 5, 15: 4,
    16: 4, 17: 7, 18: 6, 19: 7, 20: 4,
    21: 3, 22: 3, 23: 3
}

# SUNDAY (day_of_week=6) — validated against April 26, 2026 ($3,015)
SUNDAY_EXPECTED = {
    11: 3, 12: 3, 13: 4, 14: 3, 15: 5,
    16: 4, 17: 5, 18: 6, 19: 5, 20: 3,
    21: 3
}
```

---

## 15. Anomaly Handling Rules — Bake These Into the Engine

```python
# Rules the engine must enforce when processing sales data:

ANOMALY_RULES = {
    # 1. Known anomaly dates — hardcoded, always excluded from ML training
    "known_dates": ["2026-04-20"],  # Victoria Day holiday

    # 2. Revenue threshold anomaly detection — auto-flag days that are
    #    more than 2.5x the rolling 30-day average for that day-of-week
    "auto_detect_threshold": 2.5,

    # 3. Zero-revenue hours — keep them in training data
    #    They represent "store is open but no orders" — real signal
    "exclude_zero_hours": False,

    # 4. Midnight artifact (hour=0) — always exclude
    #    Clearview sometimes exports a midnight row that is a parsing artifact
    "exclude_midnight": True,

    # 5. Operating hours — only train on hours within operating window
    #    Do not penalize Prophet for hours when store is closed
    "default_open_hour":  10,  # 10AM weekdays
    "weekend_open_hour":  11,  # 11AM weekends (Sat/Sun)
    "default_close_hour": 23,  # 11PM
}
```

---

## 16. API Endpoint — Upload Sales Data

Add to `apps/api/src/routes/workplaces.ts`:

```typescript
// POST /api/workplaces/:id/sales-data
// Accepts: multipart/form-data with file + sale_date + source_type fields
router.post('/:id/sales-data', requireAuth, upload.single('file'), async (req, res) => {
  const { sale_date, source_type } = req.body;
  // sale_date: "YYYY-MM-DD" — required
  // source_type: "cash_sheet" | "drop_chart"

  if (!sale_date) {
    return res.status(400).json({
      error: 'sale_date is required. Format: YYYY-MM-DD',
      code: 'MISSING_DATE',
    });
  }

  // Upload file to Supabase Storage
  const { data: upload } = await supabase.storage
    .from('sales-data')
    .upload(`${req.params.id}/${sale_date}/${req.file.originalname}`, req.file.buffer);

  // Call Python ML service to parse and ingest
  const response = await fetch(`${process.env.ML_SERVICE_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Key': process.env.ML_SERVICE_SECRET },
    body: JSON.stringify({
      workplace_id: req.params.id,
      file_path:    upload.path,   // Supabase storage path
      sale_date,
      source_type,
    }),
  });

  const result = await response.json();

  // Trigger model retrain after new data
  await fetch(`${process.env.ML_SERVICE_URL}/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Service-Key': process.env.ML_SERVICE_SECRET },
    body: JSON.stringify({ workplace_id: req.params.id }),
  });

  return res.json({ data: result });
});
```

---

## 17. Testing Checklist

```
Parser tests
[ ] UTF-16 XLS file parses without crashing
[ ] CSV file (27 cols) uses correct column offset (ncols-3, ncols-4)
[ ] Hour "10:00 AM" → 10, "12:00 PM" → 12, "1:00 PM" → 13, "10:00 PM" → 22
[ ] Hour 0 (midnight artifact) is always skipped
[ ] Last row (Totals) is always skipped
[ ] First 2 rows (headers) are always skipped
[ ] Records sorted by hour ascending
[ ] Zero-sales hours are included (not filtered out)

Date matching tests
[ ] File with total=$2,734.36 matches 2026-04-21 (Tuesday)
[ ] File with total=$3,055.73 matches 2026-04-22 (Wednesday)
[ ] File with total=$8,565.87 matches 2026-04-20 (Monday, anomaly=True)
[ ] Anomaly file is ingested but flagged is_anomaly=True

Ingestion tests
[ ] Records written to hourly_sales_data with correct sale_date and day_of_week
[ ] Monday April 20 records have is_anomaly=True
[ ] All other records have is_anomaly=False
[ ] Duplicate ingestion does not create duplicate rows (upsert works)

Prophet training tests
[ ] Training query excludes is_anomaly=True records
[ ] Training query excludes records with NULL sale_date
[ ] Prophet model fits without error on 6 days (168 records) of clean data
[ ] Model saved to models_store/{workplace_id}.pkl

Prediction tests
[ ] Prediction for Friday produces ~8-10 workers at 6PM (formula: $728*0.28/21≈10)
[ ] Prediction for Tuesday produces floor only (3 workers) at 10AM (formula: $43*0.28/21≈1)
[ ] is_peak=True for hours with multiplier > 1.4
[ ] is_peak=False for early morning and late night hours

Integration tests
[ ] POST /sales-data with cash sheet file + sale_date → ingested + model retrained
[ ] POST /sales-data with drop chart PDF → date auto-extracted, ingested
[ ] GET /peak-windows shows Friday 5-8PM as peak
[ ] Schedule generation uses Friday peak windows to assign extras correctly
```

---

## 18. Summary of What the Agent Must Know

Tell your agent this before starting:

> "Read this entire document. The sales data comes in two formats from
> Clearview POS: cash sheets (HTML-as-XLS, UTF-16 encoded, 21 or 27 columns)
> and drop chart PDFs (contain dates and hourly breakdown).
> Cash sheets have no dates — match them to dates using total sales values
> from the known mapping table. Always use column 18 (XLS) or ncols-3 (CSV)
> for total sales. Always flag Monday April 20, 2026 as an anomaly.
> Prophet trains only on non-anomaly records with confirmed dates.
> The floor is always 3 workers (1 cook + 1 pack + 1 cash) regardless of sales.
> Extras are determined by formula: max(0, round((sales * 0.28) / 21) - 3).
> Implement the parser in Section 5, the ingestion pipeline in Section 10,
> and update the Prophet trainer in Section 11. Run the test checklist in
> Section 17 before declaring anything done."

---

*End of prompt. Start with Section 5 (sales_parser.py), verify with the
test data in Section 12, then Section 6 (drop_chart_parser.py),
then Section 10 (data_ingestion.py), then Section 11 (prophet update).
Run Section 17 tests after each section.*
