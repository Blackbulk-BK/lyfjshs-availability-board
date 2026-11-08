# Practical Research Guide: SOP 3 & Questionnaire Integration
**Research Title:** Development and Implementation of a Web-Based Teacher and Department Availability Monitoring System for Luis Y. Ferrer Jr. Senior High School  
**Researcher:** Angeles, Henrich Gutierrez (TVL-ICT 12-Kotlin)  
**Research Instrument Validator:** Mr. Zander Allen S. Flores (Computer Programming 2 &mdash; Teacher)  
**Date of Validation:** October 30, 2026  

---

## 1. Research Questions & Statement of the Problem (SOP) Alignment

| Research Question (SOP) | Instrument Part | Indicator / Scope | Evaluation Method |
|---|---|---|---|
| **SOP 1:** What is the level of difficulty experienced by students when verifying availability? | **Questionnaire 1: Part II** (9 items) | Baseline difficulty in verifying teachers, departments (clinic, library, stockroom, computer lab) | Survey with 4-point difficulty scale (Very Difficult to Not Difficult) |
| **SOP 2:** What features should be incorporated into the proposed system? | **Questionnaire 1: Part III** (14 items) | 2.1 Department status (3)<br>2.2 Teacher availability status (3)<br>2.3 Availability updates (4)<br>2.4 Access to information (4) | 4-point Likert scale (Strongly Agree to Strongly Disagree); Decision threshold: Mean &ge; 2.51 (Incorporate) |
| **SOP 3:** What is the level of technical performance of the developed system? | **Questionnaire 2: Part IV** (15 items) + Technical Test Matrix | 3.1 Functional Suitability (5)<br>3.2 Reliability (5)<br>3.3 Response Time (5) | Evaluator Assessment (Mean & SD) + Automated test runner (`test_runner.py`) |

---

## 2. SOP 3 System Implementation & Questionnaire Mapping (Part IV)

Every statement in Questionnaire 2 (Part IV) maps directly to concrete features and automated tests:

### 3.1 Functional Suitability
| Item | Validated Statement | System Implementation | Verification / Evidence |
|---|---|---|---|
| **4.1.1 (FS-1)** | *The website displays teacher availability statuses correctly.* | Public board (`index.html`) queries `teachers_board` view, displaying dynamic status pills and avatars. | Evaluator task 2; `teachers_board` SQL view |
| **4.1.2 (FS-2)** | *The website displays department availability statuses correctly.* | Dedicated Departments tab displays Clinic, Library, Stockroom, and Computer Laboratory with current status. | Evaluator task 3; `departments_board` view |
| **4.1.3 (FS-3)** | *The website provides the necessary information for checking availability.* | Displays status badge, category, handler teachers, room location, and exact time of last update. | Public board UI; meta timestamp with clock icon |
| **4.1.4 (FS-4)** | *Authorized personnel can update teacher and department statuses successfully.* | Update panel (`dashboard.html`) permits authenticated teachers and delegates to toggle Available/Unavailable; Row Level Security blocks unauthorized edits. | Checkpoint 4 testing; RLS policies |
| **4.1.5 (FS-5)** | *The website displays the latest recorded availability updates correctly.* | Server timestamp generated in Philippine time (`Asia/Manila`) automatically via database trigger `stamp_status`. | Database trigger `t2_stamp`; `status_log` audit |

### 3.2 Reliability
| Item | Validated Statement | System Implementation | Verification / Evidence |
|---|---|---|---|
| **4.2.1 (RL-1)** | *The website works consistently when viewing teacher availability information.* | Resilient fetching with caching, error trapping, and automatic retry. | 30/30 runs pass in `test_runner.py` |
| **4.2.2 (RL-2)** | *The website works consistently when viewing department availability information.* | Resilient querying of `departments_board` with stable JSON payloads. | 30/30 runs pass in `test_runner.py` |
| **4.2.3 (RL-3)** | *The website saves availability updates successfully.* | Double-check update mutation: saves only on HTTP 200 confirmation and logs changes to `status_log`. | Database trigger; `status_log` verification |
| **4.2.4 (RL-4)** | *The website displays recorded information without unexpected errors.* | Fallback UI states, skeleton shimmer loader, and user-friendly notice banners on disconnect. | DevTools offline test; graceful retry button |
| **4.2.5 (RL-5)** | *The website provides consistent results when users access the same information under the same conditions.* | Status Not Updated rule computed centrally in database views (`teachers_board`, `departments_board`), ensuring identical results across all devices. | SHA-256 multi-device hash match |

### 3.3 Response Time (User Assessment)
| Item | Validated Statement | System Implementation | Verification / Evidence |
|---|---|---|---|
| **4.3.1 (RT-1)** | *The website loads the main availability page within an acceptable amount of time.* | Lightweight zero-framework frontend (< 100 KB total), CDN assets, fast initial render. | Lighthouse Performance score > 90; load time < 2.0s |
| **4.3.2 (RT-2)** | *The website displays teacher availability information promptly.* | Indexed database query via Supabase REST API. | Median response time < 300 ms |
| **4.3.3 (RT-3)** | *The website displays department availability information promptly.* | Indexed database query via Supabase REST API. | Median response time < 280 ms |
| **4.3.4 (RT-4)** | *The website responds promptly when searching for a teacher or department.* | Client-side memory search filtering across pre-fetched arrays. | Search filter latency < 50 ms (instant as typed) |
| **4.3.5 (RT-5)** | *The website displays latest saved status promptly after an authorized user updates.* | Supabase Realtime WebSocket channel (`postgres_changes`) automatically broadcasts changes to all open tabs within seconds. | Two-device stopwatch timing (< 2 seconds) |

---

## 3. How to Run Survey Data Analysis (`analyze_survey.py`)

The analysis script runs with the standard Python library (no external packages needed).

```bash
# 1. Analyze SOP 1: Level of Difficulty (Part II, 9 statements)
python tools/tools/analyze_survey.py part2 tools/sample_part2.csv

# 2. Analyze SOP 2: System Features & Requirements (Part III, 14 statements)
python tools/tools/analyze_survey.py part3 tools/sample_part3.csv

# 3. Analyze SOP 3: Technical Performance Evaluation (Part IV, 15 statements)
python tools/tools/analyze_survey.py part4 tools/sample_part4.csv

# 4. Analyze Part I: Respondent Profile (Frequency & Percentage)
python tools/tools/analyze_survey.py profile tools/sample_part1.csv
```

### Interpretation Scale (Standard Practical Research 4-Point Likert Scale)

#### Part II (SOP 1 - Level of Difficulty)
- **3.26 &ndash; 4.00:** Very Difficult (Napakahirap)
- **2.51 &ndash; 3.25:** Difficult (Mahirap)
- **1.76 &ndash; 2.50:** Slightly Difficult (Bahagyang Mahirap)
- **1.00 &ndash; 1.75:** Not Difficult (Hindi Mahirap)

#### Part III (SOP 2 - Feature Decision)
- **3.26 &ndash; 4.00:** Strongly Agree &rarr; **Incorporate**
- **2.51 &ndash; 3.25:** Agree &rarr; **Incorporate**
- **1.76 &ndash; 2.50:** Disagree &rarr; Do not incorporate
- **1.00 &ndash; 1.75:** Strongly Disagree &rarr; Do not incorporate

#### Part IV (SOP 3 - Technical Performance)
- **3.26 &ndash; 4.00:** Very High
- **2.51 &ndash; 3.25:** High
- **1.76 &ndash; 2.50:** Low
- **1.00 &ndash; 1.75:** Very Low

---

## 4. In-System Evaluation Page

Evaluators can directly access and answer the evaluation online at:
[`evaluation.html`](file:///c:/Users/bluel/lyfjshs-availability-board/evaluation.html)

Features:
1. Complete bilingual questionnaires (English + Filipino).
2. Live interactive computation of indicator means and verbal interpretations.
3. One-click CSV export directly formatted for `analyze_survey.py`.
4. Supabase cloud database submission (`sql/migration_05_survey_evaluations.sql`).
