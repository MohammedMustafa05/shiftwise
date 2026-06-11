"""Parse Clearview Drop Chart PDFs — authoritative source for sale dates."""
from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path


def extract_drop_chart_metadata(pdf_path: str) -> dict:
    """
    Extract date, day-of-week, total sales, and hourly breakdown from a Drop Chart PDF.
    """
    path = Path(pdf_path)
    text = _extract_pdf_text(path)
    if not text.strip():
        raise ValueError(f"Cannot extract text from {path.name}")
    return _parse_drop_chart_text(text)


def _extract_pdf_text(path: Path) -> str:
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.stdout.strip():
            return result.stdout
    except FileNotFoundError:
        pass

    try:
        import pypdf

        reader = pypdf.PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        raise ValueError(f"Cannot extract text from {path.name}: {e}") from e


def _parse_drop_chart_text(text: str) -> dict:
    date_match = re.search(
        r"(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+(\d{1,2}),?\s+(\d{4})",
        text,
    )
    if not date_match:
        raise ValueError("Cannot find date in Drop Chart")

    month_str = date_match.group(1)
    day_str = date_match.group(2)
    year_str = date_match.group(3)
    date_obj = datetime.strptime(f"{month_str} {day_str} {year_str}", "%B %d %Y")
    date_str = date_obj.strftime("%Y-%m-%d")
    dow_name = date_obj.strftime("%A")
    dow_int = date_obj.weekday()

    total_match = re.search(r"\$\s*([\d,]+\.\d{2})\s*\$\s*Yield", text)
    total_sales = float(total_match.group(1).replace(",", "")) if total_match else 0.0

    hourly: dict[int, float] = {}
    for match in re.finditer(
        r"(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s*\$\s*([\d,]+\.\d{2})",
        text,
    ):
        hour = _parse_drop_chart_time(match.group(1))
        if hour is None or hour == 0:
            continue
        hourly[hour] = float(match.group(3).replace(",", ""))

    return {
        "date": date_str,
        "day_of_week_name": dow_name,
        "day_of_week": dow_int,
        "total_sales": total_sales,
        "store": "6412",
        "hourly_sales": hourly,
    }


def _parse_drop_chart_time(time_str: str) -> int | None:
    match = re.match(r"(\d+):(\d+)\s*(AM|PM)", time_str.strip().upper())
    if not match:
        return None
    hour = int(match.group(1))
    ampm = match.group(3)
    if ampm == "PM" and hour != 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0
    return hour
