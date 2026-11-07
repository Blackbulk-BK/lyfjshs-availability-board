"""Automated checks for the LYFJSHS Availability Board (Phase 6).

Measures the DATA requests the board makes (not the whole page: use Lighthouse for that)
and checks the security rules as an anonymous visitor (a student).
Writes docs/test_results.csv (every request) and docs/test_summary.csv (one row per check).

Usage:
    cd tools
    pip install -r requirements.txt
    python test_runner.py            # RUNS=50 python test_runner.py  for more runs

Needs SUPABASE_URL and SUPABASE_ANON_KEY (publishable key) in tools/.env.
Run it when nobody is changing statuses, or the consistency check (RL-5) may fail.
"""
import csv
import hashlib
import json
import os
import statistics
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent / "docs"
load_dotenv(HERE / ".env")

try:
    BASE = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    HEADERS = {"apikey": os.environ["SUPABASE_ANON_KEY"]}
except KeyError as e:
    sys.exit(f"Missing {e} in tools/.env")

RUNS = int(os.environ.get("RUNS", "30"))
MAX_MEDIAN_MS = 1000   # your own goals: adjust with your adviser
MAX_P95_MS = 1500
VIEWS = {"teachers_board": ("RL-1", "RT-2"), "departments_board": ("RL-2", "RT-3")}

summary: list[list] = []   # [id, check, result, detail]
raw: list[list] = []       # [view, run, http_status, ms]


def record(test_id: str, check: str, ok: bool | None, detail: str) -> None:
    result = "SKIPPED" if ok is None else ("PASS" if ok else "FAIL")
    summary.append([test_id, check, result, detail])


def get(view: str, query: str = "select=*"):
    t = time.perf_counter()
    r = requests.get(f"{BASE}{view}?{query}", headers=HEADERS, timeout=15)
    return r, round((time.perf_counter() - t) * 1000)


def timing_and_reliability() -> dict:
    sample_ids = {}
    for view, (rl_id, rt_id) in VIEWS.items():
        ms_list, fingerprints, all_ok = [], set(), True
        for i in range(1, RUNS + 1):
            try:
                r, ms = get(view)
                body = r.json() if r.ok else None
                ok = r.status_code == 200 and isinstance(body, list)
            except (requests.RequestException, ValueError):
                r, ms, body, ok = None, 15000, None, False
            all_ok &= ok
            ms_list.append(ms)
            raw.append([view, i, r.status_code if r is not None else "error", ms])
            if ok:
                fingerprints.add(hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest())
                if body and view == "teachers_board":
                    sample_ids["teacher"] = body[0]
        n = len(ms_list)
        record(rl_id, f"{view}: {RUNS} loads, no errors", all_ok, f"{sum(1 for m in ms_list if m < 15000)}/{n} answered")
        record("RL-5", f"{view}: same result every time", len(fingerprints) == 1, f"{len(fingerprints)} different result(s)")
        med = statistics.median(ms_list)
        p95 = sorted(ms_list)[max(0, int(n * 0.95) - 1)]
        record(rt_id, f"{view}: response time", med <= MAX_MEDIAN_MS and p95 <= MAX_P95_MS,
               f"median {med:.0f} ms, p95 {p95} ms, max {max(ms_list)} ms")
    return sample_ids


def security_checks(sample: dict) -> None:
    # 1) A visitor must not be able to change a teacher. We "change" the name to its current value,
    #    so nothing is altered even if the rule were broken.
    t = sample.get("teacher")
    if not t:
        record("FS-4", "visitor cannot update a teacher", None, "no teachers on the board yet")
    else:
        r = requests.patch(f"{BASE}teachers?id=eq.{t['id']}", headers={**HEADERS, "Prefer": "return=representation",
                           "Content-Type": "application/json"}, json={"full_name": t["name"]}, timeout=15)
        blocked = r.status_code in (401, 403, 404) or (r.status_code == 200 and r.json() == [])
        record("FS-4", "visitor cannot update a teacher", blocked, f"HTTP {r.status_code}")

    # 2) A visitor must not read the history table.
    r = requests.get(f"{BASE}status_log?select=*", headers=HEADERS, timeout=15)
    hidden = r.status_code in (401, 403) or (r.status_code == 200 and r.json() == [])
    record("FS-4", "visitor cannot read the status history", hidden, f"HTTP {r.status_code}")

    # 3) A visitor must not add a department.
    r = requests.post(f"{BASE}departments", headers={**HEADERS, "Content-Type": "application/json"},
                      json={"name": "TEST-should-be-rejected"}, timeout=15)
    record("FS-4", "visitor cannot add a department", r.status_code in (401, 403), f"HTTP {r.status_code}")


def write_files() -> None:
    DOCS.mkdir(exist_ok=True)
    with (DOCS / "test_results.csv").open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([["view", "run", "http_status", "ms"], *raw])
    with (DOCS / "test_summary.csv").open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([["id", "check", "result", "detail"], *summary])


def main() -> int:
    print(f"Running {RUNS} loads per view against {os.environ['SUPABASE_URL']} ...")
    sample = timing_and_reliability()
    security_checks(sample)
    write_files()
    width = max(len(s[1]) for s in summary)
    for test_id, check, result, detail in summary:
        print(f"{test_id:<5} {result:<8} {check:<{width}}  {detail}")
    failed = [s for s in summary if s[2] == "FAIL"]
    print(f"\n{len(summary) - len(failed)} of {len(summary)} checks passed. Files saved in docs/.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())