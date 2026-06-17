"""Parse Clearview schedule PDFs (text or OCR) into shift records."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any

TIME_RE = re.compile(
    r"(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)",
    re.I,
)
DOW_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
DOW_INDEX = {d.lower(): i for i, d in enumerate(DOW_NAMES)}

ALIASES = {
    "ghanva a.": "Gazia",
    "syed aayan a.": "Ayaan",
    "mehran a.": "Mehran",
    "omrah b.": "Umrah",
    "rupali b.": "Rupali",
    "sakeena c.": "Sakina",
    "aaima f.": "Ayma",
    "syed h.": "Hasan",
    "abdul nafay k.": "Nafey",
    "hassan k.": "Hasan",
    "inayah k.": "Inaya",
    "ghunwah m.": "Ganma",
    "ghazia n.": "Gazia",
    "logan p.": "Logan",
    "syed mehrab ali r.": "Merab",
    "shahmeer r.": "Shahmeer",
    "sana s.": "Kanza",
    "pankaj s.": "Pankaj",
    "s.": "Simran",
    "ss.": "Simran",
    "syed muhammad kazim hasnain z.": "Kazim",
    "murtaza a.": "Murtaza",
    "damanjeet kaur p.": "Aleeza",
}


@dataclass
class ParsedShift:
    employee: str
    dow: int
    start: str
    end: str


def _to24(h: str, m: str | None, ampm: str) -> str:
    hour, minute = int(h), int(m or 0)
    ap = ampm.upper()
    if ap == "AM":
        if hour == 12:
            hour = 0
    elif hour != 12:
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def _normalize_time_token(s: str) -> str:
    """Fix common OCR errors: 40AM -> 10AM, 1AM -> 11AM, SPM -> 5PM."""
    t = s.strip()
    t = re.sub(r"\b40\s*AM\b", "10AM", t, flags=re.I)
    t = re.sub(r"\b41\s*AM\b", "11AM", t, flags=re.I)
    t = re.sub(r"\b1\s*AM\b", "11AM", t, flags=re.I)
    t = re.sub(r"\bSPM\b", "5PM", t, flags=re.I)
    t = re.sub(r"(\d)(AM|PM)", r"\1 \2", t, flags=re.I)
    return t


def parse_times_from_text(text: str) -> list[tuple[str, str]]:
    normalized = _normalize_time_token(text)
    out: list[tuple[str, str]] = []
    for m in TIME_RE.finditer(normalized):
        out.append((_to24(m.group(1), m.group(2), m.group(3)), _to24(m.group(4), m.group(5), m.group(6))))
    return out


def normalize_employee(raw: str) -> str:
    key = raw.strip().lower()
    key = re.sub(r"[''`]", "", key)
    return ALIASES.get(key, raw.strip().title())


def extract_pdf_text(path: str) -> str:
    try:
        from pypdf import PdfReader

        text = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
        if len(text.strip()) > 200:
            return text
    except Exception:
        pass

    import fitz
    import pytesseract
    from PIL import Image

    doc = fitz.open(path)
    parts: list[str] = []
    for page in doc:
        t = page.get_text().strip()
        if len(t) < 80:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            t = pytesseract.image_to_string(Image.open(io.BytesIO(pix.tobytes("png"))))
        parts.append(t)
    return "\n".join(parts)


def _parse_horizontal_rows(lines: list[str]) -> list[ParsedShift]:
    """Employee row with Mon–Sun times left-to-right."""
    shifts: list[ParsedShift] = []
    days: list[int] = []
    emp_idx = next((i for i, l in enumerate(lines) if l.strip() == "Employee"), None)
    if emp_idx is None:
        return shifts

    i = emp_idx + 1
    while i < len(lines) and len(days) < 7:
        line = lines[i]
        m = re.match(
            r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+",
            line,
            re.I,
        )
        if m and i + 1 < len(lines):
            dow_line = lines[i + 1]
            for d in DOW_NAMES:
                if d.lower() in dow_line.lower():
                    days.append(DOW_INDEX[d.lower()])
                    break
            i += 2
            continue
        i += 1

    while i < len(lines):
        line = lines[i]
        if line.startswith("©") or "Quick Service" in line:
            break
        m = re.match(r"^(.+?)\s+((?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[-–]\s*)+.+)$", line, re.I)
        if m:
            name = normalize_employee(m.group(1))
            times = parse_times_from_text(m.group(2))
            for di, (st, en) in enumerate(times):
                if di < len(days):
                    shifts.append(ParsedShift(name, days[di], st, en))
        i += 1
    return shifts


def _parse_vertical_day_columns(text: str) -> list[ParsedShift]:
    """OCR layout: employee list then per-day time columns."""
    shifts: list[ParsedShift] = []
    employees: list[str] = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    in_emp = False
    for line in lines:
        low = line.lower()
        if low == "employee":
            in_emp = True
            continue
        if in_emp:
            if any(d.lower() in low for d in DOW_NAMES) or re.match(r"^(January|April|May|March)", line, re.I):
                in_emp = False
                break
            if parse_times_from_text(line):
                continue
            if len(line) > 2 and "schedule for" not in low:
                employees.append(normalize_employee(line))

    for dow_name in DOW_NAMES:
        dow = DOW_INDEX[dow_name.lower()]
        pattern = rf"{dow_name}\s*$|{dow_name}\b"
        idx = next((i for i, l in enumerate(lines) if re.search(pattern, l, re.I)), None)
        if idx is None:
            continue
        times_col: list[tuple[str, str]] = []
        j = idx + 1
        while j < len(lines):
            l = lines[j]
            if any(re.search(rf"\b{d}\b", l, re.I) for d in DOW_NAMES if d != dow_name):
                break
            if re.match(r"^(January|February|March|April|May|June)", l, re.I):
                break
            if l.startswith("©"):
                break
            parsed = parse_times_from_text(l)
            if parsed:
                times_col.append(parsed[0])
            j += 1
        for ei, (st, en) in enumerate(times_col):
            if ei < len(employees):
                shifts.append(ParsedShift(employees[ei], dow, st, en))
    return shifts


def parse_clearview_schedule(text: str) -> dict[str, Any]:
    wm = re.search(r"week ending (\w+ \d+, \d{4})", text, re.I)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    shifts = _parse_horizontal_rows(lines)
    if len(shifts) < 20:
        shifts = _parse_vertical_day_columns(text)
    if len(shifts) < 20:
        # fallback: times per line without DOW (global templates only)
        for line in lines:
            times = parse_times_from_text(line)
            if not times:
                continue
            pre = TIME_RE.split(_normalize_time_token(line))[0].strip()
            if len(pre) < 2 or "schedule" in pre.lower():
                continue
            name = normalize_employee(pre)
            for st, en in times:
                shifts.append(ParsedShift(name, -1, st, en))
    return {
        "week_ending": wm.group(1) if wm else None,
        "shifts": [
            {"employee": s.employee, "dow": s.dow, "start": s.start, "end": s.end}
            for s in shifts
        ],
    }


def parse_pdf_file(path: str) -> dict[str, Any]:
    text = extract_pdf_text(path)
    result = parse_clearview_schedule(text)
    result["source"] = path.split("/")[-1]
    return result
