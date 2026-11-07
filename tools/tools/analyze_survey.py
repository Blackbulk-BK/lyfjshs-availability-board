"""Compute the means, SDs, and interpretations for your Results tables.

Each questionnaire part is one CSV file: ONE ROW PER RESPONDENT, ONE COLUMN PER STATEMENT,
in the same order as the questionnaire, with answers 1 to 4 (4 = highest).

    python analyze_survey.py part2 responses_part2.csv      # SOP 1: level of difficulty (9 statements)
    python analyze_survey.py part3 responses_part3.csv      # SOP 2: features (14 statements)
    python analyze_survey.py part4 responses_part4.csv      # SOP 3: technical performance (15 statements)
    python analyze_survey.py profile responses_part1.csv    # Part I: frequency and percentage

Results are printed and saved next to the input file as <name>_results.csv.
(Survey files are git-ignored: keep them out of the repository.)
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

SCALES = {   # (lowest mean, interpretation), highest first
    "part2": [(3.26, "Very Difficult"), (2.51, "Difficult"), (1.76, "Slightly Difficult"), (1.00, "Not Difficult")],
    "part3": [(3.26, "Strongly Agree"), (2.51, "Agree"), (1.76, "Disagree"), (1.00, "Strongly Disagree")],
    "part4": [(3.26, "Very High"), (2.51, "High"), (1.76, "Low"), (1.00, "Very Low")],
}
GROUPS = {   # indicator name -> number of statements, in questionnaire order
    "part2": {"Difficulty in verifying availability": 9},
    "part3": {"2.1 Department status": 3, "2.2 Teacher availability status": 3,
              "2.3 Availability updates": 4, "2.4 Access to availability information": 4},
    "part4": {"3.1 Functional suitability": 5, "3.2 Reliability": 5, "3.3 Response time": 5},
}


def interpret(mean: float, part: str) -> str:
    for low, label in SCALES[part]:
        if mean >= low:
            return label
    return SCALES[part][-1][1]


def load(path: Path, part: str) -> pd.DataFrame:
    expected = sum(GROUPS[part].values())
    df = pd.read_csv(path).apply(pd.to_numeric, errors="coerce")
    if df.shape[1] != expected:
        sys.exit(f"{path.name} has {df.shape[1]} columns but {part} needs {expected} (one per statement).")
    bad = df.isna().any(axis=1) | ~df.isin([1, 2, 3, 4]).all(axis=1)
    if bad.any():
        print(f"Dropped {int(bad.sum())} respondent row(s) with blank or invalid answers (rows: "
              f"{', '.join(str(i + 2) for i in df.index[bad])}).")
    df = df[~bad]
    if df.empty:
        sys.exit("No valid responses left.")
    return df


def analyze(path: Path, part: str) -> None:
    df = load(path, part)
    rows, start = [], 0
    for indicator, size in GROUPS[part].items():
        cols = df.columns[start:start + size]
        for n, col in enumerate(cols, start=start + 1):
            m, sd = df[col].mean(), df[col].std(ddof=1)
            rows.append([n, str(col), round(m, 2), round(sd, 2) if len(df) > 1 else 0, interpret(m, part), indicator])
        ind_mean = df[cols].to_numpy().mean()
        ind_sd = df[cols].mean(axis=1).std(ddof=1) if len(df) > 1 else 0
        rows.append(["", f"INDICATOR: {indicator}", round(ind_mean, 2), round(ind_sd, 2), interpret(ind_mean, part), indicator])
        start += size
    overall = df.to_numpy().mean()
    rows.append(["", "OVERALL WEIGHTED MEAN", round(overall, 2), round(df.mean(axis=1).std(ddof=1), 2) if len(df) > 1 else 0,
                 interpret(overall, part), ""])
    out = pd.DataFrame(rows, columns=["No.", "Statement", "Mean", "SD", "Interpretation", "Indicator"])
    if part == "part3":   # SOP 2 decision rule: a feature is necessary when the mean is Agree or higher
        out["Decision"] = ["Incorporate" if (isinstance(v, float) and v >= 2.51) else "Do not incorporate" for v in out["Mean"]]
    print(f"\n{len(df)} valid respondent(s)\n")
    print(out.to_string(index=False))
    target = path.with_name(path.stem + "_results.csv")
    out.to_csv(target, index=False)
    print(f"\nSaved: {target}")


def profile(path: Path) -> None:
    df = pd.read_csv(path)
    frames = []
    for col in df.columns:
        counts = df[col].value_counts(dropna=False)
        part = pd.DataFrame({"Question": col, "Answer": counts.index.astype(str), "Frequency": counts.values,
                             "Percent": (counts.values / counts.sum() * 100).round(1)})
        frames.append(part)
    out = pd.concat(frames, ignore_index=True)
    print(f"\n{len(df)} respondent(s)\n")
    print(out.to_string(index=False))
    target = path.with_name(path.stem + "_results.csv")
    out.to_csv(target, index=False)
    print(f"\nSaved: {target}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("part", choices=["part2", "part3", "part4", "profile"])
    ap.add_argument("csv_file", type=Path)
    a = ap.parse_args()
    if not a.csv_file.exists():
        sys.exit(f"File not found: {a.csv_file}")
    profile(a.csv_file) if a.part == "profile" else analyze(a.csv_file, a.part)