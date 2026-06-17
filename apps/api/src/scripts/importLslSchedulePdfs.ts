/**
 * Import Clearview schedule PDFs into apps/api/fixtures/lsl-historical-schedules.json
 *
 * Usage:
 *   npx tsx src/scripts/importLslSchedulePdfs.ts [pdf-dir]
 *
 * Default pdf-dir: glob of *.pdf in the given folder (one level of subdirs).
 * Requires: pip install pypdf (or run the embedded python importer below).
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureOut = path.join(here, "../../fixtures/lsl-historical-schedules.json");

const pdfDir =
  process.argv[2] ??
  "/Users/mustafasaleem/Library/Application Support/Cursor/User/workspaceStorage/d03695c1532c7e3ac7bdf138f8eebd44/pdfs";

const pythonScript = `
import json, re, glob, os, sys
from pypdf import PdfReader

TIME_RE = re.compile(r"(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)\\s*-\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)", re.I)
ALIASES = ${JSON.stringify({
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
  "syed muhammad kazim hasnain z.": "Kazim",
})}

def to24(h, m, ampm):
    h, m = int(h), int(m or 0)
    if ampm.upper()=="AM":
        if h==12: h=0
    else:
        if h!=12: h+=12
    return f"{h:02d}:{m:02d}"

def parse_times(s):
    return [(to24(*m.group(1,2,3)), to24(*m.group(4,5,6))) for m in TIME_RE.finditer(s)]

def parse_pdf(path):
    text = "\\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    if "Schedule for" not in text:
        return None
    wm = re.search(r"week ending (\\w+ \\d+, \\d{4})", text)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    emp_idx = next((i for i,l in enumerate(lines) if l == "Employee"), None)
    if emp_idx is None:
        return None
    days = []
    i = emp_idx + 1
    while i < len(lines) and len(days) < 7:
        if re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December) \\d+$", lines[i], re.I):
            dow = lines[i+1]
            if re.match(r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$", dow, re.I):
                days.append({"date_label": lines[i], "dow": dow})
                i += 2
                continue
        i += 1
    shifts = []
    while i < len(lines):
        line = lines[i]
        if line.startswith("©"):
            break
        m = re.match(r"^(.+?)\\s+((?:\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM)\\s*-\\s*)+.*)$", line, re.I)
        if m:
            raw = m.group(1).strip()
            norm = ALIASES.get(raw.lower(), raw)
            times = parse_times(m.group(2))
            for di, (st, en) in enumerate(times):
                if di >= len(days):
                    break
                shifts.append({"raw_name": raw, "employee": norm, "dow": days[di]["dow"], "start": st, "end": en})
        i += 1
    return {"source": os.path.basename(path), "week_ending": wm.group(1) if wm else None, "shifts": shifts}

base = sys.argv[1]
weeks = []
for path in sorted(glob.glob(base + "/*/*.pdf") + glob.glob(base + "/*.pdf")):
    if "Prompt" in path or "Restaurant" in path:
        continue
    d = parse_pdf(path)
    if d and d["shifts"]:
        weeks.append(d)

out = {"restaurant": "LSL Milton (6412)", "imported_at": __import__("datetime").date.today().isoformat(), "weeks": weeks}
print(json.dumps(out, indent=2))
`;

function main() {
  if (!fs.existsSync(pdfDir)) {
    console.error("PDF directory not found:", pdfDir);
    process.exit(1);
  }
  try {
    execSync("python3 -c 'import pypdf'", { stdio: "ignore" });
  } catch {
    console.error("Install pypdf: pip3 install pypdf");
    process.exit(1);
  }
  const json = execSync(`python3 -c ${JSON.stringify(pythonScript)} ${JSON.stringify(pdfDir)}`, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(json) as { weeks: unknown[] };
  if (parsed.weeks.length === 0) {
    console.warn("No Clearview schedules parsed (image-only PDFs need OCR). Keeping existing fixture if present.");
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(fixtureOut), { recursive: true });
  fs.writeFileSync(fixtureOut, json);
  console.log(`Wrote ${parsed.weeks.length} week(s) to ${fixtureOut}`);
}

main();
