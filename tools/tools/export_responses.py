"""Export Practical Research Survey & Evaluation Responses from Supabase into CSV files.
Generates:
    responses_part1.csv  (Part I: Respondent Profile)
    responses_part2.csv  (Part II: SOP 1 Level of Difficulty)
    responses_part3.csv  (Part III: SOP 2 System Features)
    responses_part4.csv  (Part IV: SOP 3 Technical Performance)

Zero external dependencies: uses Python standard library (urllib, json, csv).

Usage:
    cd tools
    python tools/export_responses.py
"""
import csv
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_PATH = HERE / ".env"

def parse_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env_vars = parse_env(ENV_PATH)
SUPABASE_URL = os.environ.get("SUPABASE_URL") or env_vars.get("SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env_vars.get("SUPABASE_SERVICE_ROLE_KEY") or \
      os.environ.get("SUPABASE_ANON_KEY") or env_vars.get("SUPABASE_ANON_KEY")

def fetch_table(table_name: str) -> list[dict]:
    if not SUPABASE_URL or not KEY:
        print(f"Notice: Missing SUPABASE_URL or API key in tools/.env")
        return []
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table_name}?select=*"
    req = urllib.request.Request(url, headers={
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code} fetching {table_name}: {e.reason}")
    except Exception as e:
        print(f"Error fetching {table_name}: {e}")
    return []

def export_part4():
    print("Fetching Part IV (SOP 3: Technical Performance)...")
    data = fetch_table("sop3_evaluations")
    if not data:
        print("  No online responses found in 'sop3_evaluations' table yet.")
        print("  (Tip: Make sure you ran sql/migration_05_survey_evaluations.sql in Supabase).")
        return
    
    cols = ["4.1.1", "4.1.2", "4.1.3", "4.1.4", "4.1.5",
            "4.2.1", "4.2.2", "4.2.3", "4.2.4", "4.2.5",
            "4.3.1", "4.3.2", "4.3.3", "4.3.4", "4.3.5"]
    
    out_file = HERE.parent / "responses_part4.csv"
    with out_file.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(cols)
        for r in data:
            writer.writerow([r.get("q" + c.replace(".", "_")) for c in cols])
            
    print(f"  Saved {len(data)} response(s) to: {out_file}")

def export_part1_2_3():
    print("Fetching Part I, II & III (SOP 1 & SOP 2)...")
    data = fetch_table("sop1_sop2_surveys")
    if not data:
        print("  No responses found in 'sop1_sop2_surveys' table yet.")
        return
    
    # Part 1: Profile
    out_p1 = HERE.parent / "responses_part1.csv"
    with out_p1.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["grade_level", "check_frequency", "verify_methods"])
        for r in data:
            methods = "; ".join(r.get("verify_methods") or [])
            writer.writerow([r.get("grade_level"), r.get("check_frequency"), methods])
    print(f"  Saved {len(data)} profile(s) to: {out_p1}")

    # Part 2: SOP 1 (9 items)
    p2_cols = ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9"]
    out_p2 = HERE.parent / "responses_part2.csv"
    with out_p2.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(p2_cols)
        for r in data:
            writer.writerow([r.get("q" + c.replace(".", "_")) for c in p2_cols])
    print(f"  Saved {len(data)} SOP 1 response(s) to: {out_p2}")

    # Part 3: SOP 2 (14 items)
    p3_cols = ["3.1.1", "3.1.2", "3.1.3", "3.2.1", "3.2.2", "3.2.3",
               "3.3.1", "3.3.2", "3.3.3", "3.3.4", "3.4.1", "3.4.2", "3.4.3", "3.4.4"]
    out_p3 = HERE.parent / "responses_part3.csv"
    with out_p3.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(p3_cols)
        for r in data:
            writer.writerow([r.get("q" + c.replace(".", "_")) for c in p3_cols])
    print(f"  Saved {len(data)} SOP 2 response(s) to: {out_p3}")

def main():
    print("=" * 60)
    print("PRACTICAL RESEARCH DATA EXPORT TOOL")
    print("=" * 60)
    export_part4()
    export_part1_2_3()
    print("\nExport completed. You can run analyze_survey.py on these files.")

if __name__ == "__main__":
    main()
