#!/usr/bin/env python3
"""Import Clearview Drop Chart PDFs + matched Cash Sheets into hourly_sales_data."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

from sales_ingestion import default_sales_data_dir, ingest_all_clearview_sales

# Load repo root .env (same as API)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def resolve_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url
    password = os.environ.get("SUPABASE_DB_PASSWORD", "").strip()
    ref = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
    if password and ref:
        return f"postgresql://postgres.{ref}:{password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
    raise SystemExit("DATABASE_URL or SUPABASE credentials required")


def resolve_workplace_id(
    conn, workplace_id: str | None, slug: str | None = None
) -> str:
    if workplace_id:
        return workplace_id
    with conn.cursor() as cur:
        if slug:
            cur.execute("SELECT id, slug FROM workplaces WHERE slug = %s LIMIT 1", (slug,))
        else:
            cur.execute("SELECT id, slug FROM workplaces ORDER BY created_at LIMIT 1")
        row = cur.fetchone()
    if not row:
        hint = f" slug={slug!r}" if slug else ""
        raise SystemExit(f"No workplace found{hint}. Run db:seed-restaurant first.")
    print(f"Using workplace: {row[1]} ({row[0]})", file=sys.stderr)
    return str(row[0])


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Clearview sales (Drop Charts + Cash Sheets)")
    parser.add_argument("workplace_id", nargs="?", help="Workplace UUID (defaults to first workplace)")
    parser.add_argument(
        "--slug",
        default="demo-restaurant",
        help="Workplace slug when UUID omitted (default: demo-restaurant)",
    )
    parser.add_argument(
        "--data-dir",
        default=str(default_sales_data_dir()),
        help="Directory with Drop Chart PDFs and Cash Sheet files",
    )
    parser.add_argument("--force", action="store_true", help="Replace existing rows for each date")
    args = parser.parse_args()

    conn = psycopg2.connect(resolve_database_url())
    try:
        workplace_id = resolve_workplace_id(conn, args.workplace_id, args.slug)
        results = ingest_all_clearview_sales(
            conn,
            workplace_id,
            data_dir=args.data_dir,
            force_reimport=args.force,
        )
        print(json.dumps(results, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
