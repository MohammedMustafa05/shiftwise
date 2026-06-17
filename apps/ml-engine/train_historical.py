#!/usr/bin/env python3
"""Train LSL scheduling prior from Clearview PDFs (all 12 weeks)."""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from historical_prior import fit_prior_from_weeks, save_prior
from schedule_pdf_parser import parse_pdf_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ML scheduling prior from LSL PDFs")
    parser.add_argument(
        "pdf_dir",
        nargs="?",
        default=os.environ.get(
            "LSL_PDF_DIR",
            "/Users/mustafasaleem/Library/Application Support/Cursor/User/workspaceStorage/d03695c1532c7e3ac7bdf138f8eebd44/pdfs",
        ),
    )
    parser.add_argument(
        "--fixture-out",
        default=os.path.join(os.path.dirname(__file__), "../api/fixtures/lsl-historical-schedules.json"),
        help="Also write parsed weeks JSON for API LLM prompts",
    )
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.join(args.pdf_dir, "*", "*.pdf")) + glob.glob(os.path.join(args.pdf_dir, "*.pdf")))
    weeks = []
    for path in paths:
        base = os.path.basename(path)
        if "Prompt" in base or "Restaurant" in base:
            continue
        print(f"Parsing {base}...", file=sys.stderr)
        parsed = parse_pdf_file(path)
        n = len(parsed.get("shifts") or [])
        print(f"  -> {n} shifts, week ending {parsed.get('week_ending')}", file=sys.stderr)
        if n > 0:
            weeks.append(parsed)

    if not weeks:
        print("No schedules parsed.", file=sys.stderr)
        sys.exit(1)

    model = fit_prior_from_weeks(weeks)
    out_path = save_prior(model)
    print(f"Saved prior: {out_path} ({model['weeks_trained']} weeks, {model['shifts_learned']} shifts)", file=sys.stderr)

    fixture = {
        "restaurant": "LSL Milton (6412)",
        "imported_at": __import__("datetime").date.today().isoformat(),
        "weeks": weeks,
        "learned_prior_summary": {
            "dow_multiplier": model["dow_multiplier"],
            "top_templates": model["shift_templates"][:6],
        },
    }
    fixture_path = os.path.abspath(args.fixture_out)
    os.makedirs(os.path.dirname(fixture_path), exist_ok=True)
    with open(fixture_path, "w", encoding="utf-8") as f:
        json.dump(fixture, f, indent=2)
    print(f"Wrote fixture: {fixture_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
