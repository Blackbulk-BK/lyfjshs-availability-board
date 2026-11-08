"""Compute the means, SDs, and interpretations for your Practical Research Results tables.
Title: Development and Implementation of a Web-Based Teacher and Department
       Availability Monitoring System for Luis Y. Ferrer Jr. Senior High School
Validated by: Mr. Zander Allen S. Flores, Computer Programming 2 Teacher

Zero external dependencies: works with Python standard library (csv, math, statistics).

Usage:
    python analyze_survey.py part2 responses_part2.csv      # SOP 1: Level of Difficulty (9 statements)
    python analyze_survey.py part3 responses_part3.csv      # SOP 2: System Features (14 statements)
    python analyze_survey.py part4 responses_part4.csv      # SOP 3: Technical Performance (15 statements)
    python analyze_survey.py profile responses_part1.csv    # Part I: Respondent Profile (Freq & %)

Results are printed and saved next to the input file as <name>_results.csv.
"""
import argparse
import csv
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

SCALES = {   # (lowest mean, interpretation), highest first
    "part2": [(3.26, "Very Difficult"), (2.51, "Difficult"), (1.76, "Slightly Difficult"), (1.00, "Not Difficult")],
    "part3": [(3.26, "Strongly Agree"), (2.51, "Agree"), (1.76, "Disagree"), (1.00, "Strongly Disagree")],
    "part4": [(3.26, "Very High"), (2.51, "High"), (1.76, "Low"), (1.00, "Very Low")],
}

GROUPS = {   # indicator name -> number of statements, in questionnaire order
    "part2": {
        "Level of Difficulty in Verifying Availability (SOP 1)": 9
    },
    "part3": {
        "2.1 Department Status": 3,
        "2.2 Teacher Availability Status": 3,
        "2.3 Availability Updates": 4,
        "2.4 Access to Availability Information": 4
    },
    "part4": {
        "3.1 Functional Suitability": 5,
        "3.2 Reliability": 5,
        "3.3 Response Time (User Assessment)": 5
    },
}

QUESTION_TEXTS = {
    "part2": [
        "I find it difficult to determine whether a teacher is available before visiting or consulting them. (Nahihirapan akong alamin kung available ang isang guro bago ko siya puntahan o konsultahin.)",
        "I find it difficult to know whether a teacher is available at the time I need to consult them. (Nahihirapan akong malaman kung available ang isang guro sa oras na kailangan ko siyang konsultahin.)",
        "I find it difficult to verify whether a school department is available before visiting it. (Nahihirapan akong alamin kung available ang isang kagawaran ng paaralan bago ko ito puntahan.)",
        "I find it difficult to determine whether the clinic is available for student use. (Nahihirapan akong alamin kung available ang klinika para sa mga mag-aaral.)",
        "I find it difficult to determine whether the library is available for student use. (Nahihirapan akong alamin kung available ang aklatan para sa mga mag-aaral.)",
        "I find it difficult to determine whether the stockroom is accessible when needed. (Nahihirapan akong alamin kung maaaring puntahan o magamit ang stockroom/bodega kung kinakailangan.)",
        "I find it difficult to determine whether the computer laboratory is available for student use. (Nahihirapan akong alamin kung available ang computer laboratory para sa mga mag-aaral.)",
        "I find it difficult to obtain updated information about teacher and department availability. (Nahihirapan akong makakuha ng napapanahong impormasyon tungkol sa availability ng mga guro at kagawaran.)",
        "I find it difficult to verify teacher and department availability without asking other people or visiting them personally. (Nahihirapan akong alamin kung available ang mga guro at kagawaran nang hindi nagtatanong sa ibang tao o personal na nagpupunta sa kanila.)"
    ],
    "part3": [
        # 3.1 Department Status
        "The website should display the availability status of each selected school department. (Dapat ipakita ng website ang availability status ng bawat napiling kagawaran ng paaralan.)",
        "The website should provide clear department status labels, such as Available, Unavailable, and Status Not Updated. (Dapat magpakita ang website ng malinaw na mga label ng katayuan ng kagawaran, tulad ng Available, Unavailable, at Status Not Updated.)",
        "The website should display the latest recorded status of the clinic, library, stockroom, and computer laboratories. (Dapat ipakita ng website ang pinakabagong naitalang status ng klinika, aklatan, stockroom/bodega, at mga computer laboratory.)",
        # 3.2 Teacher Availability Status
        "The website should display the availability status of teachers. (Dapat ipakita ng website kung available o hindi available ang mga guro.)",
        "The website should provide clear teacher availability labels, such as Available, Unavailable, and Status Not Updated. (Dapat magpakita ang website ng malinaw na mga label para sa availability ng mga guro, tulad ng Available, Unavailable, at Status Not Updated.)",
        "The website should allow students to find a specific teacher's recorded availability status. (Dapat pahintulutan ng website ang mga mag-aaral na hanapin ang naitalang availability status ng isang partikular na guro.)",
        # 3.3 Availability Updates
        "The website should allow authorized personnel to update teacher availability statuses. (Dapat pahintulutan ng website ang mga awtorisadong kawani na i-update ang availability status ng mga guro.)",
        "The website should allow authorized personnel to update department availability statuses. (Dapat pahintulutan ng website ang mga awtorisadong kawani na i-update ang availability status ng mga kagawaran.)",
        "The website should display the date and time of the latest availability update. (Dapat ipakita ng website ang petsa at oras ng pinakahuling update sa availability.)",
        "The website should indicate when availability information has not been updated. (Dapat ipaalam ng website kung hindi pa naa-update ang impormasyon tungkol sa availability.)",
        # 3.4 Access to Availability Information
        "The website should provide a centralized page for viewing teacher and department availability. (Dapat magkaroon ang website ng isang sentralisadong pahina kung saan makikita ang availability ng mga guro at kagawaran.)",
        "The website should allow users to search for a teacher or school department. (Dapat pahintulutan ng website ang mga gumagamit na maghanap ng guro o kagawaran ng paaralan.)",
        "The website should be accessible through a web browser. (Dapat ma-access ang website gamit ang isang web browser.)",
        "The website should present availability information in a clear and understandable format. (Dapat ipakita ng website ang impormasyon tungkol sa availability sa malinaw at madaling maunawaang paraan.)"
    ],
    "part4": [
        # 4.1 Functional Suitability
        "The website displays teacher availability statuses correctly. (Tama ang pagpapakita ng website ng availability status ng mga guro.)",
        "The website displays department availability statuses correctly. (Tama ang pagpapakita ng website ng availability status ng mga kagawaran.)",
        "The website provides the necessary information for checking teacher and department availability. (Ibinibigay ng website ang kinakailangang impormasyon upang malaman ang availability ng mga guro at kagawaran.)",
        "Authorized personnel can update teacher and department statuses successfully. (Matagumpay na naa-update ng mga awtorisadong kawani ang status ng mga guro at kagawaran.)",
        "The website displays the latest recorded availability updates correctly. (Tama ang pagpapakita ng website ng pinakabagong naitalang mga update sa availability.)",
        # 4.2 Reliability
        "The website works consistently when viewing teacher availability information. (Pare-parehong gumagana nang maayos ang website kapag tinitingnan ang impormasyon tungkol sa availability ng mga guro.)",
        "The website works consistently when viewing department availability information. (Pare-parehong gumagana nang maayos ang website kapag tinitingnan ang impormasyon tungkol sa availability ng mga kagawaran.)",
        "The website saves availability updates successfully. (Matagumpay na nase-save ng website ang mga update sa availability.)",
        "The website displays recorded information without unexpected errors. (Ipinapakita ng website ang naitalang impormasyon nang walang hindi inaasahang error.)",
        "The website provides consistent results when users access the same availability information under the same conditions. (Nagbibigay ang website ng pare-parehong resulta kapag ina-access ng mga gumagamit ang parehong impormasyon sa ilalim ng parehong mga kondisyon.)",
        # 4.3 Response Time
        "The website loads the main availability page within an acceptable amount of time. (Nilo-load ng website ang pangunahing pahina ng availability sa loob ng katanggap-tanggap na oras.)",
        "The website displays teacher availability information promptly. (Mabilis na ipinapakita ng website ang impormasyon tungkol sa availability ng mga guro.)",
        "The website displays department availability information promptly. (Mabilis na ipinapakita ng website ang impormasyon tungkol sa availability ng mga kagawaran.)",
        "The website responds promptly when searching for a teacher or department. (Mabilis tumugon ang website kapag naghahanap ng guro o kagawaran.)",
        "The website displays the latest saved status promptly after an authorized user updates the information. (Mabilis na ipinapakita ng website ang pinakabagong na-save na status pagkatapos mag-update ng impormasyon ang isang awtorisadong gumagamit.)"
    ]
}


def interpret(mean: float, part: str) -> str:
    for low, label in SCALES[part]:
        if mean >= low:
            return label
    return SCALES[part][-1][1]


def calc_mean(nums: list[float]) -> float:
    return sum(nums) / len(nums) if nums else 0.0


def calc_sd(nums: list[float]) -> float:
    if len(nums) <= 1:
        return 0.0
    return statistics.stdev(nums)


def load_csv_data(path: Path, expected_cols: int) -> tuple[list[str], list[list[float]]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))
    if not reader:
        sys.exit(f"File {path.name} is empty.")
    
    headers = [h.strip() for h in reader[0]]
    if len(headers) != expected_cols:
        sys.exit(f"{path.name} has {len(headers)} columns but needs {expected_cols} (one per statement).")
    
    valid_rows = []
    dropped = []
    for line_idx, row in enumerate(reader[1:], start=2):
        if len(row) != expected_cols:
            dropped.append(line_idx)
            continue
        try:
            nums = [float(v.strip()) for v in row]
            if all(v in (1.0, 2.0, 3.0, 4.0) for v in nums):
                valid_rows.append(nums)
            else:
                dropped.append(line_idx)
        except ValueError:
            dropped.append(line_idx)
            
    if dropped:
        print(f"Dropped {len(dropped)} row(s) with blank or invalid answers (rows: {', '.join(map(str, dropped[:10]))}{'...' if len(dropped) > 10 else ''}).")
    if not valid_rows:
        sys.exit("No valid respondent rows left.")
    return headers, valid_rows


def analyze(path: Path, part: str) -> None:
    expected_count = sum(GROUPS[part].values())
    headers, rows_data = load_csv_data(path, expected_count)
    n_respondents = len(rows_data)
    texts = QUESTION_TEXTS.get(part, [])
    
    results = []
    start = 0
    all_all_values = []
    respondent_means = []
    
    for row in rows_data:
        respondent_means.append(calc_mean(row))
        all_all_values.extend(row)
        
    for indicator, size in GROUPS[part].items():
        ind_values_all = []
        ind_resp_means = []
        for r in rows_data:
            ind_resp_means.append(calc_mean(r[start:start + size]))
            ind_values_all.extend(r[start:start + size])
            
        for local_idx in range(size):
            q_idx = start + local_idx
            q_num = q_idx + 1
            col_vals = [r[q_idx] for r in rows_data]
            m = calc_mean(col_vals)
            sd = calc_sd(col_vals)
            stmt = texts[q_idx] if q_idx < len(texts) else headers[q_idx]
            interp = interpret(m, part)
            decision = "Incorporate" if (part == "part3" and m >= 2.51) else ("Do not incorporate" if part == "part3" else "")
            results.append({
                "No.": q_num,
                "Statement": stmt,
                "Mean": round(m, 2),
                "SD": round(sd, 2),
                "Interpretation": interp,
                "Indicator": indicator,
                "Decision": decision
            })
            
        ind_mean = calc_mean(ind_values_all)
        ind_sd = calc_sd(ind_resp_means)
        ind_interp = interpret(ind_mean, part)
        ind_decision = "Incorporate" if (part == "part3" and ind_mean >= 2.51) else ("Do not incorporate" if part == "part3" else "")
        results.append({
            "No.": "",
            "Statement": f"INDICATOR MEAN: {indicator}",
            "Mean": round(ind_mean, 2),
            "SD": round(ind_sd, 2),
            "Interpretation": ind_interp,
            "Indicator": indicator,
            "Decision": ind_decision
        })
        start += size

    overall_mean = calc_mean(all_all_values)
    overall_sd = calc_sd(respondent_means)
    overall_interp = interpret(overall_mean, part)
    results.append({
        "No.": "",
        "Statement": "OVERALL WEIGHTED MEAN",
        "Mean": round(overall_mean, 2),
        "SD": round(overall_sd, 2),
        "Interpretation": overall_interp,
        "Indicator": "",
        "Decision": ""
    })

    print("=" * 86)
    print(f"PRACTICAL RESEARCH STATISTICAL RESULTS - {part.upper()} ({n_respondents} Valid Respondents)")
    print("Research Title: Web-Based Teacher & Department Availability Monitoring System (LYFJSHS)")
    print("=" * 86)
    
    for r in results:
        no = r["No."]
        stmt = r["Statement"]
        m = f"{r['Mean']:.2f}"
        sd = f"{r['SD']:.2f}"
        interp = r["Interpretation"]
        dec = f" | {r['Decision']}" if part == "part3" and r['Decision'] else ""
        if no == "":
            print("-" * 86)
            print(f"** {stmt:<56} Mean: {m} | SD: {sd} [{interp}]{dec}")
            print("-" * 86)
        else:
            short_stmt = (stmt[:60] + "...") if len(stmt) > 60 else stmt
            print(f"{no:<3} {short_stmt:<63} {m:<5} {sd:<5} [{interp}]{dec}")

    # Save to CSV
    target = path.with_name(path.stem + "_results.csv")
    fieldnames = ["No.", "Statement", "Mean", "SD", "Interpretation", "Indicator"]
    if part == "part3":
        fieldnames.append("Decision")
        
    with target.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)
        
    print(f"\nSaved CSV Results: {target}")


def profile(path: Path) -> None:
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = list(csv.reader(f))
    if not reader:
        sys.exit(f"File {path.name} is empty.")
    headers = [h.strip() for h in reader[0]]
    total = len(reader) - 1
    if total <= 0:
        sys.exit("No data rows.")
        
    rows = []
    print("=" * 70)
    print(f"PART I. RESPONDENT PROFILE ANALYSIS ({total} Respondents)")
    print("=" * 70)
    
    for col_idx, col_name in enumerate(headers):
        counts = Counter()
        for r in reader[1:]:
            val = r[col_idx].strip() if col_idx < len(r) else ""
            if ";" in val:
                for sub in val.split(";"):
                    counts[sub.strip()] += 1
            else:
                counts[val] += 1
                
        subtotal = sum(counts.values())
        print(f"\nQuestion: {col_name}")
        print(f"{'Answer Category':<50} {'Freq':<8} {'Percent':<8}")
        print("-" * 70)
        for ans, freq in counts.most_common():
            pct = round((freq / subtotal) * 100, 1) if subtotal else 0.0
            print(f"{ans:<50} {freq:<8} {pct:.1f}%")
            rows.append({"Question": col_name, "Answer": ans, "Frequency": freq, "Percent": pct})

    target = path.with_name(path.stem + "_results.csv")
    with target.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["Question", "Answer", "Frequency", "Percent"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nSaved Profile Results: {target}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("part", choices=["part2", "part3", "part4", "profile"])
    ap.add_argument("csv_file", type=Path)
    a = ap.parse_args()
    if not a.csv_file.exists():
        sys.exit(f"File not found: {a.csv_file}")
    profile(a.csv_file) if a.part == "profile" else analyze(a.csv_file, a.part)
