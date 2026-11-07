"""Add or update departments from a CSV file (Phase 5).

Teachers register themselves on login.html, so this script only handles departments.
It uses the SECRET key, so run it only on your own laptop.

Usage:
    cd tools
    pip install -r requirements.txt
    python import_data.py sample_departments.csv --dry-run   # preview
    python import_data.py sample_departments.csv             # save to Supabase

CSV columns: name, category, building, floor_level
category: clinic, library, stockroom, computer_lab, or other
"""
import argparse
import csv
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

CATEGORIES = {"clinic", "library", "stockroom", "computer_lab", "other"}


def read_rows(path: Path) -> list[dict]:
    rows, seen = [], set()
    with path.open(newline="", encoding="utf-8-sig") as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            name = (r.get("name") or "").strip()
            if not name:
                print(f"Line {n}: skipped (no name)")
                continue
            if name.lower() in seen:
                print(f"Line {n}: skipped (duplicate name in file: {name})")
                continue
            seen.add(name.lower())
            category = (r.get("category") or "other").strip().lower()
            if category not in CATEGORIES:
                print(f"Line {n}: unknown category '{category}', using 'other'")
                category = "other"
            rows.append({
                "name": name,
                "category": category,
                "building": (r.get("building") or "").strip() or None,
                "floor_level": (r.get("floor_level") or "").strip() or None,
            })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Import departments from a CSV file.")
    ap.add_argument("csv_file", type=Path)
    ap.add_argument("--dry-run", action="store_true", help="show what would be saved, change nothing")
    args = ap.parse_args()

    if not args.csv_file.exists():
        print(f"File not found: {args.csv_file}")
        return 1
    rows = read_rows(args.csv_file)
    if not rows:
        print("No valid rows found.")
        return 1
    for r in rows:
        print(f"  {r['name']}  |  {r['category']}  |  {r['building']}, {r['floor_level']}")
    if args.dry_run:
        print(f"Dry run: {len(rows)} department(s) would be saved.")
        return 0

    from supabase import create_client  # imported here so --dry-run works without it

    load_dotenv(Path(__file__).resolve().parent / ".env")
    try:
        sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    except KeyError as e:
        print(f"Missing {e} in tools/.env")
        return 1
    sb.table("departments").upsert(rows, on_conflict="name").execute()
    print(f"Saved {len(rows)} department(s). Existing names were updated, new names were added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())