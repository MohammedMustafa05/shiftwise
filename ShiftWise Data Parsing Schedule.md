# ShiftWise — Sales Data Parsing, Schedule Generation & PDF Export
# Full Cursor Agent Prompt — Based on Real File Analysis

> Feed this entire document to Cursor before writing any code.
> All data structures below are derived from real file analysis of the actual Clearview exports.

---

## 1. The Two Problems to Fix

### Problem 1: The hourly sales file is not being read correctly

The Clearview cash sheet export (`Cash_Sheet_-_Hourly_Sales.xls`) is **not a real XLS file**.
It is an **HTML document saved with a `.xls` extension** using UTF-16 LE encoding.
Any code using `xlrd`, `openpyxl`, or standard Excel parsers will crash or produce garbage.
The correct parser is `pandas.read_html()` after decoding the UTF-16 bytes.

### Problem 2: The engine does not cover the full operating day

The engine is not correctly reading the hour range from the sales data (10:00 AM → 11:00 PM)
and is generating schedules that leave hours uncovered.
The fix is a proper data cleaning pipeline that extracts clean hourly slots
and a floor engine that iterates every slot from open to close.

---

## 2. Exact Sales File Structure (from real file analysis)

The file contains **one HTML table** with **21 columns** and **16 data rows** (rows 0-15).

**Row structure:**

| Row index | Content |
|---|---|
| 0 | Multi-level column header row 1 (channel names: Take Out, Skip The Dishes, MB App, Smooth Delivery, Uber Eats, Total) |
| 1 | Multi-level column header row 2 (Count, Sales, Avg. Sale per channel) |
| 2–14 | Hourly data rows (one row per hour) |
| 15 | Totals row — **skip this** |

**Column layout (0-indexed):**

| Col index | Meaning |
|---|---|
| 0 | Hour start (string, e.g. `"10:00 AM"`) |
| 1 | Hour end (string, e.g. `"11:00 AM"`) |
| 2 | Take Out — Count |
| 3 | Take Out — Sales ($) |
| 4 | Take Out — Avg. Sale |
| 5 | Skip The Dishes — Count |
| 6 | Skip The Dishes — Sales ($) |
| 7 | Skip The Dishes — Avg. Sale |
| 8 | MB App — Count |
| 9 | MB App — Sales ($) |
| 10 | MB App — Avg. Sale |
| 11 | Smooth Delivery — Count |
| 12 | Smooth Delivery — Sales ($) |
| 13 | Smooth Delivery — Avg. Sale |
| 14 | Uber Eats — Count |
| 15 | Uber Eats — Sales ($) |
| 16 | Uber Eats — Avg. Sale |
| 17 | **Total — Count** |
| 18 | **Total — Sales ($)** ← this is the column you want |
| 19 | Total — Avg. Sale |
| 20 | Total — % of day |

**The column you must use for staffing decisions is column index 18 (Total Sales $).**
Do not use individual channel sales columns. Do not use Count or Avg columns.

**Actual data from the real file (this is one day's data — Saturday April 2026):**

| Hour window | Total Sales ($) |
|---|---|
| 10:00 AM – 11:00 AM | $24.97 |
| 11:00 AM – 12:00 PM | $322.81 |
| 12:00 PM – 1:00 PM | $339.97 |
| 1:00 PM – 2:00 PM | $141.32 |
| 2:00 PM – 3:00 PM | $267.30 |
| 3:00 PM – 4:00 PM | $167.83 |
| 4:00 PM – 5:00 PM | $228.76 |
| 5:00 PM – 6:00 PM | $411.92 |
| 6:00 PM – 7:00 PM | $465.92 |
| 7:00 PM – 8:00 PM | $439.20 |
| 8:00 PM – 9:00 PM | $153.79 |
| 9:00 PM – 10:00 PM | $213.66 |
| 10:00 PM – 11:00 PM | $9.98 |
| **Daily Total** | **$3,187.43** |

**Operating hours for this location: 10:00 AM to 11:00 PM (13 hours).**
The engine must cover ALL 13 hourly slots with floor coverage.

---

## 3. The Sales Data Parser — Write This Exactly

**File:** `apps/ml/app/services/sales_parser.py`

```python
"""
Clearview Cash Sheet Parser
Handles the UTF-16 HTML-as-XLS format that Clearview exports.
This is NOT a real Excel file. Do not use xlrd or openpyxl.
"""
import pandas as pd
import io
import re
from pathlib import Path
from datetime import time
from typing import Optional


def parse_clearview_cash_sheet(file_path: str) -> list[dict]:
    """
    Parse a Clearview hourly sales export file.
    
    The file is an HTML document saved as .xls with UTF-16 LE encoding.
    Returns a list of hourly records, one per operating hour.
    
    Returns:
        list of dicts with keys:
            hour_start: int (24h, e.g. 10 for 10:00 AM)
            hour_end: int (24h, e.g. 11 for 11:00 AM)
            hour_label: str (e.g. "10:00 AM - 11:00 AM")
            total_sales: float (sum of all channels)
            
    Raises:
        ValueError if file cannot be parsed or has unexpected structure
    """
    path = Path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"Sales file not found: {file_path}")
    
    # Step 1: Read raw bytes and detect encoding
    raw_bytes = path.read_bytes()
    
    # Clearview exports UTF-16 LE with BOM (bytes FF FE)
    if raw_bytes[:2] == b'\xff\xfe':
        html_text = raw_bytes.decode('utf-16-le', errors='replace')
    elif raw_bytes[:2] == b'\xfe\xff':
        html_text = raw_bytes.decode('utf-16-be', errors='replace')
    else:
        # Try UTF-8 fallback (some exports may differ)
        try:
            html_text = raw_bytes.decode('utf-8')
        except UnicodeDecodeError:
            html_text = raw_bytes.decode('latin-1', errors='replace')
    
    # Step 2: Parse HTML table
    try:
        tables = pd.read_html(io.StringIO(html_text), header=None)
    except Exception as e:
        raise ValueError(f"Could not parse HTML table from sales file: {e}")
    
    if not tables:
        raise ValueError("No tables found in sales file")
    
    # Take the first (and typically only) table
    df = tables[0]
    
    # Step 3: Validate shape
    if df.shape[1] < 19:
        raise ValueError(
            f"Expected at least 19 columns, got {df.shape[1]}. "
            f"File may be a different Clearview export format."
        )
    
    # Step 4: Extract hourly data rows
    # Skip rows 0 (header1), 1 (header2)
    # Skip last row (Totals)
    # Keep rows 2 through second-to-last
    data_rows = df.iloc[2:-1].copy()
    
    records = []
    
    for _, row in data_rows.iterrows():
        start_str = str(row.iloc[0]).strip()
        end_str   = str(row.iloc[1]).strip()
        
        # Skip if row looks like a header or totals
        if not start_str or start_str.lower() in ('nan', 'from', 'totals', 'total'):
            continue
        if not re.search(r'\d+:\d+', start_str):
            continue
        
        # Parse time strings → 24h integers
        hour_start = parse_time_to_hour(start_str)
        hour_end   = parse_time_to_hour(end_str)
        
        if hour_start is None or hour_end is None:
            continue
        
        # Total sales is column index 18 (0-indexed)
        try:
            total_sales = float(row.iloc[18])
        except (ValueError, TypeError):
            total_sales = 0.0
        
        # Replace NaN with 0
        if pd.isna(total_sales):
            total_sales = 0.0
        
        records.append({
            'hour_start':  hour_start,
            'hour_end':    hour_end,
            'hour_label':  f"{format_hour(hour_start)} - {format_hour(hour_end)}",
            'total_sales': round(total_sales, 2),
        })
    
    if not records:
        raise ValueError(
            "No valid hourly data rows found. "
            "Check that this is a Clearview hourly sales export."
        )
    
    # Sort by hour
    records.sort(key=lambda r: r['hour_start'])
    
    return records


def parse_time_to_hour(time_str: str) -> Optional[int]:
    """
    Convert Clearview time strings to 24h integer hour.
    
    Examples:
        "10:00 AM" → 10
        "12:00 PM" → 12
        "1:00 PM"  → 13
        "10:00 PM" → 22
        "11:00 PM" → 23
    """
    time_str = time_str.strip().upper()
    
    match = re.match(r'(\d+):(\d+)\s*(AM|PM)', time_str)
    if not match:
        return None
    
    hour = int(match.group(1))
    ampm = match.group(3)
    
    if ampm == 'PM' and hour != 12:
        hour += 12
    elif ampm == 'AM' and hour == 12:
        hour = 0
    
    return hour


def format_hour(hour_24: int) -> str:
    """Convert 24h integer to display string: 10 → '10:00 AM', 22 → '10:00 PM'"""
    if hour_24 == 0:
        return "12:00 AM"
    elif hour_24 < 12:
        return f"{hour_24}:00 AM"
    elif hour_24 == 12:
        return "12:00 PM"
    else:
        return f"{hour_24 - 12}:00 PM"


def get_operating_hours(records: list[dict]) -> tuple[int, int]:
    """
    Extract open and close hours from parsed records.
    Returns (open_hour, close_hour) in 24h format.
    Example: (10, 23) for 10:00 AM to 11:00 PM
    """
    if not records:
        return (10, 23)  # default fallback
    
    return (records[0]['hour_start'], records[-1]['hour_end'])
```

---

## 4. Updated Labour Demand Function — Use Parsed Sales Data

**File:** `apps/ml/app/services/labour.py` (or equivalent)

```python
def compute_workers_needed_from_sales(
    sales_records: list[dict],
    labour_cost_pct: float = 0.28,
    avg_wage: float = 21.0,
) -> dict[int, dict]:
    """
    Compute workers needed per hour using the two-phase model.
    
    Phase 1 (Floor): Always 3 workers minimum (1 cook + 1 pack + 1 cash).
                     This is independent of sales. Never goes below 3.
    Phase 2 (Extras): Formula determines additional workers above floor.
                      formula_headcount = max(3, round((sales * labour_pct) / wage))
                      extra_workers = max(0, formula_headcount - 3)
    
    Args:
        sales_records: output of parse_clearview_cash_sheet()
        labour_cost_pct: target labour as % of sales (default 28%)
        avg_wage: average hourly wage (default $21.00)
    
    Returns:
        dict keyed by hour_start (int), value is:
        {
            'hour_label': str,
            'total_sales': float,
            'mandatory_floor': 3,           ← always 3
            'formula_headcount': int,        ← max(3, round(sales * pct / wage))
            'extra_workers': int,            ← max(0, formula - floor)
            'floor_roles': ['COOK', 'PACK', 'CASH'],  ← always these 3
            'extra_roles': list[str],        ← extra roles from ML/demand
        }
    """
    MANDATORY_FLOOR = 3
    FLOOR_ROLES = ['COOK', 'PACK', 'CASH']
    
    result = {}
    
    for record in sales_records:
        hour     = record['hour_start']
        sales    = record['total_sales']
        
        # Phase 1: Floor (ignores sales completely)
        mandatory_floor = MANDATORY_FLOOR
        
        # Phase 2: Formula (only determines EXTRAS above floor)
        if sales > 0:
            raw_formula = (sales * labour_cost_pct) / avg_wage
            formula_headcount = max(MANDATORY_FLOOR, round(raw_formula))
        else:
            # No sales data for this hour → only the floor
            formula_headcount = MANDATORY_FLOOR
        
        extra_workers = max(0, formula_headcount - mandatory_floor)
        
        result[hour] = {
            'hour_label':       record['hour_label'],
            'total_sales':      sales,
            'mandatory_floor':  mandatory_floor,
            'formula_headcount': formula_headcount,
            'extra_workers':    extra_workers,
            'floor_roles':      FLOOR_ROLES.copy(),
            'extra_roles':      [],  # filled later by demand phase
        }
    
    return result


# Usage example with real data:
# 10:00 AM: sales=$24.97 → (24.97*0.28)/21=0.33 → formula=max(3,0)=3 → extras=0
# 11:00 AM: sales=$322.81 → (322.81*0.28)/21=4.30 → formula=max(3,4)=4 → extras=1
# 6:00 PM:  sales=$465.92 → (465.92*0.28)/21=6.21 → formula=max(3,6)=6 → extras=3
# 10:00 PM: sales=$9.98  → (9.98*0.28)/21=0.13 → formula=max(3,0)=3 → extras=0
# Late night: also triggers H3 (min 2 people covering all roles)
```

---

## 5. Floor Engine — Must Cover EVERY Hour from Open to Close

The current engine is not covering the full operating day.
The fix is to iterate every hour between `open_hour` and `close_hour`,
not just hours that appear in the sales data.

**File:** `apps/ml/app/services/scheduling_engine.py` (or equivalent)

```python
def assign_floor_coverage(
    workers_needed: dict[int, dict],   # output of compute_workers_needed_from_sales()
    open_hour: int,                    # e.g. 10 (10:00 AM)
    close_hour: int,                   # e.g. 23 (11:00 PM)
    employees: list,
    availability: dict,
) -> tuple[list, list]:
    """
    Assigns mandatory floor coverage (1 cook + 1 pack + 1 cash) to EVERY
    operating hour from open_hour to close_hour, inclusive.
    
    CRITICAL: Iterates over range(open_hour, close_hour) — not just hours
    that appear in workers_needed. If a sales hour is missing, the floor
    still applies.
    
    Returns (assignments, flags).
    """
    assignments = []
    flags = []
    
    # Every single hour from open to close — no gaps allowed
    for hour in range(open_hour, close_hour):
        # Get demand data for this hour (may be missing for some hours)
        demand = workers_needed.get(hour, {
            'floor_roles': ['COOK', 'PACK', 'CASH'],
            'extra_workers': 0,
            'total_sales': 0.0,
        })
        
        for required_role in demand['floor_roles']:  # always ['COOK', 'PACK', 'CASH']
            eligible = get_eligible_employees(
                role=required_role,
                hour=hour,
                employees=employees,
                availability=availability,
                already_assigned=assignments,
            )
            
            if not eligible:
                # Hard flag — cannot fill floor — do NOT skip, do NOT compensate
                flags.append({
                    'severity': 'hard',
                    'code': 'H1_ROLE_COVERAGE_GAP',
                    'hour': hour,
                    'role': required_role,
                    'message': (
                        f"No eligible {required_role} available for "
                        f"{format_hour(hour)}-{format_hour(hour+1)}. "
                        f"Floor coverage cannot be met."
                    )
                })
                continue  # flag and move on — never compensate with wrong role
            
            best = select_best_employee(eligible)
            assignments.append({
                'employee_id': best['id'],
                'role': required_role,
                'hour': hour,
                'is_floor': True,
            })
    
    return assignments, flags
```

---

## 6. The Schedule Output Format — Match This Exactly

The output PDF must match the Clearview schedule format exactly as shown in the provided example.

### What the format looks like (from real file analysis):

**Title:** `Schedule for [location_code] - [location_name] for week ending [date]`
Example: `Schedule for 6412 - Milton LSL for week ending April 26, 2026`

**Header row columns:**
- Employee (leftmost, fixed width)
- One column per day of the week, with date and day name stacked:
  ```
  April 20
  Monday
  ```
- Days: Monday through Sunday (7 columns)

**Data rows:**
- Employee name (Last name initial with period, e.g. `Ghanva A.`)
- Bold names indicate a specific designation (e.g. seniority) — preserve bold
- Each day cell: shift time range or empty
- Time format: `10AM - 10PM` (no leading zero, no space before AM/PM)
- Empty cells are blank (not dashes or zeros)

**Footer:**
`© 2000 - 2026, Quick Service Software Inc.`

**Real schedule data from the April 26, 2026 example:**

| Employee | Mon Apr 20 | Tue Apr 21 | Wed Apr 22 | Thu Apr 23 | Fri Apr 24 | Sat Apr 25 | Sun Apr 26 |
|---|---|---|---|---|---|---|---|
| Ghanva A. | 10AM-10PM | | 10AM-4PM | 5PM-10PM | | | 10:30AM-3PM |
| Mehran A. | 10AM-10PM | 10AM-3PM | 10AM-10PM | | 10AM-10PM | | |
| Omrah B. | | | | 5PM-10PM | | | |
| rupali b. | | | | | | 10:30AM-10PM | 11AM-10PM |
| Sakeena C. | | 10AM-3PM | 10AM-5PM | 10AM-5PM | 10AM-5PM | | |
| Abdul Nafay K. | 10AM-5PM | | 4PM-10PM | | | 3PM-8PM | |
| Hassan K. | | | | | | 5PM-11PM | 3PM-10PM |
| Inayah K. | 2PM-7PM | | | | | 5PM-9PM | |
| Ghunwah M. | 5PM-10PM | 3PM-10PM | | | | | |
| Mariam N. | 10AM-10PM | | | | | | |
| ghazia n. | | | 5PM-10PM | | | | |
| Logan P. | | 4PM-10PM | | 5PM-8PM | | | |
| Damanjeet Kaur P. | 10AM-1PM | 4PM-8PM | 4PM-8PM | 10AM-5PM | | 3PM-9PM | |
| Syed Mehrab Ali R. | | | | | 5PM-10PM | | |
| Shahmeer R. | | | | | | 11AM-5PM | |
| Sana S. | 5PM-10PM | | | | 5PM-10PM | | |
| Pankaj S. | 10AM-5PM | 10AM-10PM | | 10AM-10PM | | 10:30AM-11PM | |
| S. | | | | | | | 5PM-10PM |
| Syed Muhammad Kazim Hasnain Z. | 10AM-10PM | | | | 10AM-11PM | | 10:30AM-10PM |

---

## 7. PDF Export Code — Write This Exactly

**File:** `apps/api/src/services/scheduleExporter.ts`

Install dependencies:
```bash
cd apps/api
npm install pdfkit
npm install --save-dev @types/pdfkit
```

```typescript
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export interface ScheduleEmployee {
  name: string;           // e.g. "Ghanva A."
  isBold?: boolean;       // true for veterans/leads — bold in Clearview format
}

export interface ScheduleShift {
  employee_name: string;
  date: string;           // YYYY-MM-DD
  start_time: string;     // HH:MM (24h)
  end_time: string;       // HH:MM (24h)
}

export interface ScheduleExportData {
  location_code: string;  // e.g. "6412"
  location_name: string;  // e.g. "Milton LSL"
  week_end_date: string;  // e.g. "April 26, 2026"
  week_start_date: string; // e.g. "2026-04-20" (YYYY-MM-DD, always Monday)
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
}

export async function exportScheduleToPDF(
  data: ScheduleExportData,
  outputPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',          // 8.5 x 11 inches — matches Clearview output
      layout: 'landscape',     // 11 x 8.5 — wider for 7 day columns
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pageW = doc.page.width;    // 792 in landscape letter
    const pageH = doc.page.height;   // 612

    // ── HEADER: "Clearview Schedule" (top-left, grey, small) ──
    doc
      .fontSize(16)
      .fillColor('#aaaaaa')
      .font('Helvetica')
      .text('Clearview Schedule', 36, 28);

    // ── TITLE: "Schedule for [code] - [name] for week ending [date]" ──
    const title = `Schedule for ${data.location_code} - ${data.location_name} for week ending ${data.week_end_date}`;
    doc
      .fontSize(14)
      .fillColor('#000000')
      .font('Helvetica')
      .text(title, 36, 55, { align: 'center', width: pageW - 72 });

    // ── COLUMN SETUP ──
    const tableTop = 85;
    const employeeColW = 155;       // width of employee name column
    const dayColW = (pageW - 72 - employeeColW) / 7;  // 7 equal day columns
    const rowH = 18;                // height per employee row
    const headerH = 28;             // height of day header row

    // Day headers
    const weekStart = new Date(data.week_start_date + 'T00:00:00');
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

    // ── DRAW TABLE HEADER ──
    // "Employee" header cell
    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#000000');

    drawCell(doc, 36, tableTop, employeeColW, headerH, 'Employee', true);

    // Day header cells
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + d);
      const x = 36 + employeeColW + d * dayColW;
      const dateLabel = `${monthNames[dayDate.getMonth()]} ${dayDate.getDate()}`;
      const dayLabel = dayNames[d];
      drawDayHeader(doc, x, tableTop, dayColW, headerH, dateLabel, dayLabel);
    }

    // ── DRAW EMPLOYEE ROWS ──
    // Build shift lookup: employee_name → date → "10AM - 10PM"
    const shiftLookup: Record<string, Record<string, string>> = {};
    for (const shift of data.shifts) {
      const name = shift.employee_name;
      if (!shiftLookup[name]) shiftLookup[name] = {};
      shiftLookup[name][shift.date] = formatShiftTime(shift.start_time, shift.end_time);
    }

    let y = tableTop + headerH;

    for (let i = 0; i < data.employees.length; i++) {
      const emp = data.employees[i];
      const rowY = y + i * rowH;

      // Employee name cell
      doc
        .fontSize(8)
        .font(emp.isBold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor('#000000');

      drawCell(doc, 36, rowY, employeeColW, rowH, emp.name, false, true);

      // Day cells
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + d);
        const dateStr = dayDate.toISOString().split('T')[0]; // YYYY-MM-DD

        const shiftText = shiftLookup[emp.name]?.[dateStr] ?? '';
        const x = 36 + employeeColW + d * dayColW;

        doc.font('Helvetica').fontSize(8);
        drawCell(doc, x, rowY, dayColW, rowH, shiftText, false, false);
      }
    }

    // ── TABLE BORDER (full outer rectangle) ──
    const tableH = headerH + data.employees.length * rowH;
    doc
      .rect(36, tableTop, pageW - 72, tableH)
      .stroke('#000000');

    // ── FOOTER ──
    doc
      .fontSize(8)
      .fillColor('#000000')
      .font('Helvetica')
      .text(
        '© 2000 - 2026, Quick Service Software Inc.',
        36,
        tableTop + tableH + 16,
      );

    doc.end();

    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// ── HELPER: Draw a bordered cell with centered text ──
function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  bold: boolean,
  leftAlign = false,
): void {
  // Cell border
  doc.rect(x, y, w, h).stroke('#cccccc');

  if (!text) return;

  const textX = leftAlign ? x + 4 : x;
  const textW = leftAlign ? w - 6 : w;

  doc
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(8)
    .fillColor('#000000')
    .text(text, textX, y + (h - 8) / 2, {
      width: textW,
      align: leftAlign ? 'left' : 'center',
      lineBreak: false,
    });
}

// ── HELPER: Draw day column header with date + day name stacked ──
function drawDayHeader(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  dateLabel: string,
  dayLabel: string,
): void {
  doc.rect(x, y, w, h).stroke('#cccccc');
  // Date on top line
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor('#000000')
    .text(dateLabel, x, y + 4, { width: w, align: 'center', lineBreak: false });
  // Day name on second line
  doc
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(dayLabel, x, y + 14, { width: w, align: 'center', lineBreak: false });
}

// ── HELPER: Format shift times in Clearview style ──
// Input: "10:00", "22:00" → Output: "10AM - 10PM"
// Input: "10:30", "22:00" → Output: "10:30AM - 10PM"
export function formatShiftTime(start24: string, end24: string): string {
  return `${formatTime(start24)} - ${formatTime(end24)}`;
}

function formatTime(time24: string): string {
  const [hourStr, minStr] = time24.split(':');
  const hour = parseInt(hourStr, 10);
  const min  = parseInt(minStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12  = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

  // Include minutes only if non-zero (matches Clearview style: "10AM" not "10:00AM")
  if (min === 0) {
    return `${h12}${ampm}`;
  } else {
    return `${h12}:${String(min).padStart(2, '0')}${ampm}`;
  }
}
```

---

## 8. API Endpoint — Download Schedule as PDF

**Add to `apps/api/src/routes/schedules.ts`:**

```typescript
// GET /api/schedules/:id/export/pdf
// Downloads the schedule as a PDF in Clearview format
router.get('/:id/export/pdf', requireAuth, async (req, res) => {
  const { data: schedule } = await supabase
    .from('weekly_schedules')
    .select(`
      *,
      workplaces(name, location_code),
      schedule_shifts(
        shift_date, start_time, end_time, role,
        users(name)
      )
    `)
    .eq('id', req.params.id)
    .single();

  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  // Build employee list (unique, sorted alphabetically)
  const employeeMap = new Map<string, { name: string; isBold: boolean }>();
  for (const shift of schedule.schedule_shifts) {
    const name = formatEmployeeDisplayName(shift.users.name);
    if (!employeeMap.has(name)) {
      employeeMap.set(name, { name, isBold: isVeteranEmployee(shift.users.id) });
    }
  }
  const employees = Array.from(employeeMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  // Build shift list
  const shifts = schedule.schedule_shifts.map((s: any) => ({
    employee_name: formatEmployeeDisplayName(s.users.name),
    date: s.shift_date,
    start_time: s.start_time,
    end_time: s.end_time,
  }));

  // Build week-end date string (the Sunday of the week)
  const weekStart = new Date(schedule.week_start + 'T00:00:00');
  const weekEnd   = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekEndStr = weekEnd.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  const exportData: ScheduleExportData = {
    location_code: schedule.workplaces.location_code ?? '',
    location_name: schedule.workplaces.name,
    week_end_date: weekEndStr,
    week_start_date: schedule.week_start,
    employees,
    shifts,
  };

  // Write to temp file and stream back
  const tmpPath = `/tmp/schedule_${req.params.id}.pdf`;
  await exportScheduleToPDF(exportData, tmpPath);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="schedule_${schedule.week_start}.pdf"`
  );
  fs.createReadStream(tmpPath).pipe(res);
});

// Format "Firstname Lastname" → "Firstname L." (Clearview style)
function formatEmployeeDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName  = parts.slice(0, -1).join(' ');
  const lastInitial = parts[parts.length - 1][0].toUpperCase();
  return `${firstName} ${lastInitial}.`;
}
```

---

## 9. Frontend — Download Button

**In `apps/web/src/components/schedule/ScheduleGrid.tsx` (or the publish page):**

```tsx
// Add a download button next to the Publish button
<button
  onClick={() => {
    window.open(`/api/schedules/${scheduleId}/export/pdf`, '_blank');
  }}
  className="btn-secondary"
>
  Download PDF (Clearview Format)
</button>
```

---

## 10. Testing Checklist

```
Sales parser
[ ] UTF-16 LE file with BOM (0xFF 0xFE) → parsed correctly
[ ] Column 18 (Total Sales) extracted for each hourly row
[ ] Hour strings "10:00 AM", "12:00 PM", "1:00 PM", "10:00 PM" → correct 24h integers
[ ] Last row (Totals) is skipped
[ ] Header rows (0 and 1) are skipped
[ ] Records sorted by hour_start ascending

Labour demand
[ ] $24.97 sales, 28% labour → extra_workers = 0, floor = 3
[ ] $322.81 sales → formula = max(3, round(4.30)) = 4 → extras = 1
[ ] $465.92 sales → formula = max(3, round(6.21)) = 6 → extras = 3
[ ] $0.00 sales → formula = 3 → extras = 0 → floor still assigned
[ ] mandatory_floor is always exactly 3 regardless of sales

Floor engine
[ ] Iterates range(10, 23) — all 13 hours — not just hours with sales data
[ ] Every hour gets exactly 1 COOK, 1 PACK, 1 CASH assigned
[ ] If no COOK available for an hour → hard flag generated, PACK/CASH still assigned
[ ] Never cross-assigns roles to compensate for gaps

PDF export
[ ] Title format: "Schedule for 6412 - Milton LSL for week ending April 26, 2026"
[ ] Day headers show date + day name stacked (e.g. "April 20 / Monday")
[ ] Shift times formatted as "10AM - 10PM" (no leading zeros, no space before AM/PM)
[ ] "10:30AM - 10PM" format for half-hour starts
[ ] Empty cells are blank (not dashes or zeros)
[ ] Bold employee names for veterans/leads
[ ] Footer: "© 2000 - 2026, Quick Service Software Inc."
[ ] Landscape letter size (792 × 612 pts)
[ ] All employees appear even if they have no shifts that week
```

---

## 11. Key Facts About the Real Data (Reference)

- **Operating hours:** 10:00 AM to 11:00 PM = 13 hourly slots
- **Peak hours from real data:** 5PM-8PM (sales $400-$465/hr)
- **Lowest hours:** 10:00 AM ($24.97) and 10:00 PM ($9.98) — floor only
- **Labour formula with real data:** `(sales × 0.28) / 21`
  - At $465.92 → 6.21 → 6 workers → 3 extras
  - At $24.97 → 0.33 → floor=3 → 0 extras
- **Location:** Store 6412, Milton LSL
- **Schedule title must use week-ending Sunday's date, not week-starting Monday**
- **Employee names in Clearview format:** First name + Last initial + period (e.g. `Ghanva A.`)
- **Shift time format:** `10AM - 10PM` (12h, no leading zero, no colon for whole hours, no space before AM/PM)

---

*End of prompt. Start with Section 3 (sales_parser.py), verify with the test data in Section 2,
then Section 4 (labour.py), then Section 5 (floor engine), then Section 7 (PDF export).
Run all tests in Section 10 before moving on.*
