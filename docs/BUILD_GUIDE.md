# LYFJSHS Availability Board: Build Guide

Follow the phases in order. Tick each checkpoint before moving on.
Eight phases, built in order. Each phase lists the SOP 3 questionnaire IDs (FS, RL, RT) it supports.

---
## File structure (keep this layout in your GitHub repository)
Status: all `js/` files and all `sql/` files are ready. Still to build: the four HTML pages and `css/styles.css`, then the Python tools.
Yes: every file below goes in the Git repository (open the folder in VS Code and commit with Git). The only files that must NEVER be committed are secrets (`tools/.env`) and data files (`*.csv` except `docs/test_*.csv`); `.gitignore` already blocks them.

```
lyfjshs-availability-board/
├── README.md                              (ready)
├── .gitignore                             (ready)
├── index.html                             (Phase 3: availability board)
├── login.html                             (Phase 4: log in / teacher sign-up)
├── dashboard.html                         (Phase 4: update panel, picture upload, delegates)
├── admin.html                             (Phase 5)
├── css/
│   └── styles.css                         (Phase 3)
├── js/
│   ├── config.example.js                  (ready)
│   ├── config.js                          (ready: has your URL and publishable key; commit it)
│   ├── supabaseClient.js                  (ready)
│   ├── board.js                           (ready)
│   ├── auth.js                            (ready)
│   ├── dashboard.js                       (ready)
│   └── admin.js                           (ready)
├── sql/
│   ├── schema.sql                         (ready; run once, Phase 2.1)
│   ├── seed.sql                           (ready; Phase 2.2)
│   ├── migration_01_self_signup.sql       (ready; Phase 2.3)
│   ├── migration_02_profile_pictures.sql  (ready; Phase 2.4)
│   └── phase4_delegates.sql               (ready; run in Phase 4 step 5)
├── tools/
│   ├── .env.example                       (ready)
│   ├── .env                               (Phase 5: secret, NOT committed)
│   ├── teachers.csv                       (Phase 5: NOT committed)
│   ├── import_data.py                     (Phase 5)
│   └── test_runner.py                     (Phase 6)
└── docs/
    ├── BUILD_GUIDE.md                     (ready)
    ├── test_log.csv                       (Phase 6)
    └── test_results.csv                   (Phase 6, created by test_runner.py)
```

---
## PHASE 1: Setup

### 1.1 GitHub repository
1. One member (the account owner) creates a repository named `lyfjshs-availability-board`.
2. Settings > Collaborators: add all group members, the project lead, and the adviser or a second admin.
3. Clone it: `git clone <repo-url>`, then open the folder in VS Code.
4. Copy the files from this package into the repository folder.
5. Commit and push:
   ```
   git add .
   git commit -m "docs: add project skeleton and database scripts"
   git push origin main
   ```
6. Create the integration branch: `git checkout -b dev` then `git push -u origin dev`.
7. Protect `main`: Settings > Branches > add a rule that requires a Pull Request.

### 1.2 VS Code
Install the extensions: Live Server, Prettier, ESLint, GitLens.

### 1.3 Task board
Repository > Projects > New project (Board). Columns: To do, In progress, Review, Done.
Create one Issue per phase below and assign owners.

### 1.4 Supabase project
1. Sign in at supabase.com and create a New project named `lyfjshs-availability-board`.
2. Pick the region closest to the Philippines (Southeast Asia, Singapore).
3. Set a strong database password and store it in a password manager (not in the repo).
4. Open Project Settings > API. Note the **Project URL** and the **publishable key** (starts with `sb_publishable_`; older projects call it the anon key). It is safe in the browser.
   The **service_role** key is secret: never put it in the repo or the website code.

### 1.5 Vercel project
1. Sign in at vercel.com with GitHub.
2. Add New > Project > import `lyfjshs-availability-board`.
3. Framework preset: **Other**. Leave the build command empty. Output directory: `./`.
4. Deploy. From now on, every push to `main` updates the live site and every Pull Request gets a preview link.
5. Check Vercel's current free (Hobby) plan terms for a school project.

### Checkpoint 1
- [ ] Everyone can clone the repo and push to a `feature/*` branch.
- [ ] `main` needs a Pull Request.
- [ ] The Supabase project exists and the URL and anon key are saved.
- [ ] Vercel deployed the repository.
- [ ] A second admin is added to GitHub, Vercel, and Supabase.

---
## PHASE 2: Database

### 2.1 Create the tables and rules
1. Supabase > SQL Editor > New query.
2. Open `sql/schema.sql`, copy everything, paste, and press **Run**. It should say "Success".
   (Run it once only. If it errors halfway, ask for help before re-running, because some objects now exist.)
3. Table Editor: confirm these tables exist: `profiles`, `teachers`, `departments`, `status_managers`, `status_log`, `settings`.
4. Confirm the live-update setup with this query (you should see `teachers` and `departments`):
   ```sql
   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
   ```

### 2.2 Create your admin account
1. Authentication > Users > Add user > Create new user. Enter your email and a password, and tick **Auto Confirm User**.
2. Open `sql/seed.sql`, replace `YOUR-EMAIL@example.com` with that email, edit the department names, and Run it.
3. Check: Table Editor > `profiles` shows your row with role `admin`.

### 2.3 Teacher self sign-up (Gmail or school email, with admin approval)
Teachers create their own account on the website; students never need one. So that strangers cannot use an account, every new account starts **unapproved** and can do nothing until an admin approves it.
1. SQL Editor > New query > paste `sql/migration_01_self_signup.sql` > **Run**. It adds the `approved` column and keeps your admin account approved.
2. Check with `select full_name, role, approved from public.profiles;`. Your row should show role `admin` and approved `true`.
3. Supabase > Authentication > Providers: make sure **Email** is enabled and **Confirm email** is on. This way only people who own the address can register, and both Gmail and school addresses work.
4. Authentication > URL Configuration: set **Site URL** to your Vercel address and add `http://127.0.0.1:5500` (Live Server) to **Redirect URLs**.
5. Supabase's built-in email sender allows only a few emails per hour (check the current limit). If many teachers register at once, have them register in small batches, or set up custom SMTP later.
6. Optional later: "Sign in with Google" (Authentication > Providers > Google) needs extra Google Cloud setup, so it is not required.

The sign-up form itself is built in Phase 4.

### 2.4 Teacher profile pictures (Storage, 2 MB maximum)
1. SQL Editor > New query > paste `sql/migration_02_profile_pictures.sql` > **Run**. Migration 01 (step 2.3) must be run first. If you see `function public.is_approved() does not exist`, run migration 01, then run this one again (it is safe to re-run).
2. Open **Storage** in the left menu. You should see a **public** bucket named `avatars`. Check in its settings that the file size limit is 2 MB and only JPEG, PNG, and WebP are allowed (menu names may differ slightly).
3. Check the new column: `select name, avatar_path from public.teachers_board;` (empty until a teacher uploads).
4. Who can do what: anyone can see pictures; only an approved teacher can upload into their own folder (the folder is named after their user id); only that teacher can set the picture on their own record; admins can remove any picture.
5. Pictures are visible to anyone who opens the board, so uploading is voluntary and teachers can remove their picture at any time.

The upload form is built in Phase 4.

### 2.5 Add teachers
Add the teachers' names here first. Teachers then create their own accounts on the website, and an admin links each account to the right name (Phases 4 and 5). Start with two or three real teachers to test. In Table Editor > `teachers` > Insert row, enter `full_name` only.
Later, `tools/import_data.py` (Python, built in a later phase) will import the full list from a CSV.

### 2.6 Test the security rules (this is your FS-4 evidence)
Replace the URL and key with yours. The `curl` commands are for Mac, Linux, or Git Bash. **On Windows PowerShell, use the PowerShell versions under each one** (in PowerShell, `curl` is a different command and `\` does not work).

Anyone can read the board (should return a list):
```
curl "https://YOUR-PROJECT-ID.supabase.co/rest/v1/teachers_board?select=*" \
  -H "apikey: YOUR-PUBLISHABLE-KEY"
```

PowerShell:
```powershell
Invoke-RestMethod -Uri "https://YOUR-PROJECT-ID.supabase.co/rest/v1/teachers_board?select=*" -Headers @{ apikey = "YOUR-PUBLISHABLE-KEY" }
```

Anyone cannot change a status (should return an empty list or an error, and the status must NOT change):
```
curl -X PATCH "https://YOUR-PROJECT-ID.supabase.co/rest/v1/teachers?full_name=eq.Teacher%20Full%20Name" \
  -H "apikey: YOUR-PUBLISHABLE-KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"status":"available"}'
```

PowerShell (one line):
```powershell
Invoke-RestMethod -Method Patch -Uri "https://YOUR-PROJECT-ID.supabase.co/rest/v1/teachers?full_name=eq.Teacher%20Full%20Name" -Headers @{ apikey = "YOUR-PUBLISHABLE-KEY"; Prefer = "return=representation" } -ContentType "application/json" -Body '{"status":"available"}'
```

Status rule check (in SQL Editor, which acts as an admin):
```sql
update public.teachers set status = 'available' where full_name = 'Teacher Full Name';
select * from public.teachers_board;      -- display_status = available
select * from public.status_log;          -- one new history row
```
Then set `updated_at` to yesterday to see the Status Not Updated rule:
```sql
update public.teachers set updated_at = now() - interval '1 day' where full_name = 'Teacher Full Name';
select * from public.teachers_board;      -- display_status = not_updated
```
(The SQL Editor bypasses the stamp trigger only when you change `updated_at` without touching `status`, so this works for testing.)

### 2.7 Save your work
```
git checkout -b feature/database
git add .
git commit -m "feat: add database schema, migrations, and docs"
git push -u origin feature/database
```
Open a Pull Request into `dev` and have one teammate review it.

### Checkpoint 2
- [ ] All six tables exist and `schema.sql` is in the repo.
- [ ] You are an admin in `profiles` and `approved` is true.
- [ ] Email sign-up settings are set (confirm email on, Site URL saved).
- [ ] The `avatars` bucket exists, is public, and has a 2 MB limit.
- [ ] Anonymous read works; anonymous update does not.
- [ ] Updating a status creates a `status_log` row and a new `updated_at`.
- [ ] A status from an earlier day shows `not_updated` in the view.

---

---
## PHASE 3: Availability Board (public page)
Supports: FS-1, FS-2, FS-3, RL-1, RL-2, RL-4, RL-5, RT-1 to RT-4.
Files: `index.html`, `css/styles.css`, `js/supabaseClient.js`, `js/board.js`, `js/config.js`.

1. **Config.** Copy `js/config.example.js` to `js/config.js` and fill in your URL and publishable key (safe to commit; Row Level Security protects the data). Your `js/config.js` is already prepared in the package.
2. **Connect.** `js/supabaseClient.js`:
   ```js
   import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
   import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
   ```
   (Pin an exact version in the URL before final deployment.)
3. **Page structure** (`index.html`): header with logo and system name, search box, Teachers | Departments tabs, status filter (All, Available, Unavailable, Not updated), a list area, a short footer. Load `board.js` with `<script type="module" src="js/board.js"></script>` at the end of `<body>`. `board.js` expects these ids: `search` (input), `tabs` (buttons with `data-tab="teachers"` and `data-tab="departments"`), `filters` (buttons with `data-filter` set to `all`, `available`, `unavailable`, `not_updated`), `list` (a `<ul>`), `message` (a `<p>`), `retry` (a `<button>`), and optionally `refreshed` (a `<span>`).
4. **Load data.** Read only from the views, so the Status Not Updated rule stays in one place:
   `supabase.from("teachers_board").select("*").order("name")` and the same for `departments_board`. Keep the result in an array.
5. **Render.** Each teacher row starts with a small round profile picture (40 px, `loading="lazy"`, with width and height set; show the teacher's initials in a circle when there is no picture). The picture address is `supabase.storage.from("avatars").getPublicUrl(avatar_path).data.publicUrl`. Each row shows the name, a status dot plus text label (never color alone), and "Updated 8:15 AM today" or "Not updated today" (format times with `Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", timeStyle: "short" })`).
6. **Search and filter** work on the array already in memory, so results appear as the person types (RT-4).
7. **Loading and errors.** Show a skeleton while loading. Wrap every call in `try/catch`; on failure show a plain message and a Retry button (RL-1, RL-2, RL-4).
8. **Live updates.** Subscribe to changes, then re-query the views instead of trusting the event data (RL-5, RT-5):
   ```js
   supabase.channel("board")
     .on("postgres_changes", { event: "*", schema: "public", table: "teachers" }, refresh)
     .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, refresh)
     .subscribe();
   ```
   Also call `refresh` every 5 minutes and when the tab becomes visible, so a page left open overnight corrects itself.
9. **Styling (professional minimalist).** Background `#fafafa`, text `#1f2937`, borders `#e5e7eb`, one accent `#1e3a5f`; statuses: Available `#15803d`, Unavailable `#b91c1c`, Not updated `#6b7280`. One font (Inter with system fallback), 16px base, 8px spacing grid, content width about 720px, mobile first, 44px tap targets, visible focus outlines, and `prefers-reduced-motion` respected. No images except the logo and the small teacher pictures.
10. **Run it.** VS Code > right-click `index.html` > Open with Live Server. Check the browser console is clean.

Checkpoint 3
- [ ] Teachers and departments show correct labels and times (compare with Table Editor).
- [ ] Search and filter work on a phone-size screen.
- [ ] Pictures show (initials when there is none) and do not slow the page.
- [ ] A status changed in Supabase appears on the open page without refreshing.
- [ ] Turning the network off (DevTools > Offline) shows the Retry message, not a blank page.

---
## PHASE 4: Login and update panel (teachers and delegates)
Supports: FS-4, FS-5, RL-3, RT-5.
Files: `login.html`, `dashboard.html`, `js/auth.js`, `js/dashboard.js`, `sql/phase4_delegates.sql`. Each JS file lists the HTML ids it needs in a comment at the top.

1. **Accounts.** Teachers register themselves on `login.html` (step 2). Until the admin page exists (Phase 5), approve and link an account in the SQL Editor:
   ```sql
   update public.profiles set approved = true
   where id = (select id from auth.users where email = 'teacher@example.com');
   update public.teachers set profile_id = (select id from auth.users where email = 'teacher@example.com')
   where full_name = 'Teacher Full Name';
   ```
2. **Sign up and login** (`js/auth.js`; `login.html` has two tabs: Log in and Create teacher account, labeled for teachers). Sign up with `supabase.auth.signUp({ email, password, options: { data: { full_name } } })`, then show "Check your email to confirm your account. An administrator must approve it before you can update statuses." Login: `supabase.auth.signInWithPassword({ email, password })`; show a friendly message on error; `supabase.auth.signOut()` for logout. On `dashboard.html`, call `supabase.auth.getSession()` first and redirect to `login.html` if there is none. Then read the user's profile: if `approved` is false, show a Waiting for approval message instead of the panel.
3. **My items.** Show what the signed-in user may update: their own teacher record (`teachers` where `profile_id` = user id), departments they created, and anything assigned to them (read `status_managers` for their user id, then fetch those rows). Admins see everything.
4. **Update buttons.** For each item, Available and Unavailable buttons:
   ```js
   const { data, error } = await supabase.from("teachers")
     .update({ status: "available" }).eq("id", id).select();
   if (error || !data || data.length !== 1) { /* show error, keep old status */ }
   else { /* show "Saved" with data[0].updated_at */ }
   ```
   Disable the buttons while saving. Show "Saved" only after the database confirms (RL-3); use the server timestamp it returns (FS-5). Zero rows returned means the rules blocked it, so show "You are not allowed to update this."
5. **Delegates.** Run `sql/phase4_delegates.sql` once. It adds a function that lists accounts a teacher may pick from:
   ```sql
   create function public.assignable_users() returns table (id uuid, full_name text)
   language sql stable security definer set search_path = public as $$
     select id, full_name from public.profiles where approved order by full_name;
   $$;
   revoke all on function public.assignable_users() from public;
   grant execute on function public.assignable_users() to authenticated;
   ```
   In the panel: `supabase.rpc("assignable_users")` fills a dropdown; Assign inserts `{ entity_type, entity_id, user_id, assigned_by: user.id }` into `status_managers`; Remove deletes that row.
6. **Add department.** A small form inserting `{ name, category }` into `departments` (the creator becomes its owner automatically).

7. **Profile picture** (teachers only; needs `sql/migration_02_profile_pictures.sql`).
   - Add a file picker with `accept="image/jpeg,image/png,image/webp"`. Before uploading, check the file. If it is not a JPG, PNG, or WebP, or `file.size > 2 * 1024 * 1024` (2 MB), show "Pick a JPG, PNG, or WebP picture of 2 MB or less." and stop.
   - Resize in the browser to a 256 x 256 square (draw it on a `<canvas>`, then `canvas.toBlob(callback, "image/jpeg", 0.85)`). The board then loads small files, which protects RT-1.
   - Upload into your own folder, save the path, and remove the old file:
     ```js
     const path = `${user.id}/avatar-${Date.now()}.jpg`;
     const { error: upErr } = await supabase.storage.from("avatars")
       .upload(path, blob, { contentType: "image/jpeg" });
     if (upErr) { /* show the error and stop */ }
     const { data, error } = await supabase.from("teachers")
       .update({ avatar_path: path }).eq("profile_id", user.id).select();
     if (error || !data || data.length !== 1) {
       /* "Your account is not linked to a teacher record yet. Ask an admin." */
     } else if (oldPath) {
       await supabase.storage.from("avatars").remove([oldPath]);
     }
     ```
   - Add a Remove picture button (set `avatar_path` to `null`, then delete the file).
   - Tell teachers that the picture is public on the board, that uploading is voluntary, and that they can remove it any time.

Checkpoint 4
- [ ] A teacher can update their own status; the board shows it on another device within seconds.
- [ ] An assigned delegate can update only what was assigned.
- [ ] An unassigned teacher and a logged-out visitor cannot change someone else's status (zero rows or an error).
- [ ] A failed save (turn the network off) shows an error and does not show "Saved".
- [ ] A brand-new sign-up (not approved) sees the waiting message and cannot update anything.
- [ ] A teacher can upload a JPG, PNG, or WebP picture up to 2 MB, and a bigger or wrong-type file is rejected with a clear message.
- [ ] A teacher cannot change another teacher's picture.

---
## PHASE 5: Admin page and data import
Supports: FS-4, RL-4.
Files: `admin.html`, `js/admin.js`, `tools/import_data.py`. Each JS file lists the HTML ids it needs in a comment at the top.

1. **Admin gate.** On load read your profile (`profiles` where `id` = user id) and redirect non-admins. This is only for convenience; the real protection is the database rules.
2. **Manage teachers and departments.** Lists with add, rename, set `is_active` (hide instead of delete), and delete. Admins can also remove a teacher's picture (set `avatar_path` to null). Link a teacher to an account by setting `profile_id` from a dropdown of accounts.
3. **Accounts.** A Pending accounts list (`profiles` where `approved` is false) with an Approve button (sets `approved` to true) and a dropdown to link the account to a teacher record (sets that teacher's `profile_id`). Admins can also change `role`. To remove a bad sign-up, delete the user in Supabase > Authentication, because the browser must never hold the service_role key.
4. **History.** Show the latest 50 rows of `status_log` (admins only).
5. **Bulk import** with Python on your laptop. Install: `pip install supabase python-dotenv`. Copy `tools/.env.example` to `tools/.env` and fill it in. Put names in `tools/teachers.csv` (header `full_name`; git-ignored). `tools/import_data.py`:
   ```python
   import csv, os
   from dotenv import load_dotenv
   from supabase import create_client

   load_dotenv()
   sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
   with open("teachers.csv", newline="", encoding="utf-8") as f:
       rows = [{"full_name": r["full_name"].strip()} for r in csv.DictReader(f) if r["full_name"].strip()]
   sb.table("teachers").insert(rows).execute()
   print(f"Imported {len(rows)} teachers")
   ```

Checkpoint 5
- [ ] The complete teacher and department lists are in the database.
- [ ] A non-admin account cannot open or use the admin page (try to rename a teacher: it is rejected).

---
## PHASE 6: Internal testing (SOP 3 matrix)
Supports: every FS, RL, and RT ID.
Files: `docs/test_log.csv`, `tools/test_runner.py`.

1. **Test log.** Columns: ID, test, steps, expected, actual, pass/fail, tester, date, device and network. One row per ID in Section 8 of the concept paper. Fix every failed row and retest.
2. **Functional (FS-1 to FS-5).** Change a status in the database and compare with the board for every teacher and department; run the evaluator tasks end to end; update as teacher, delegate, and admin; confirm the shown time matches the real time.
3. **Reliability (RL-1 to RL-5).** Open each view 30 times on at least two devices; submit empty and invalid input; interrupt the connection mid-save; open the same item on two devices and compare. Record any console error. Upload a picture over 2 MB and a file that is not an image (both must be rejected with a clear message), and try to upload into another user's folder (the database must refuse).
4. **Response time (RT-1 to RT-5).** In Chrome DevTools > Lighthouse (Mobile, Performance) record the score and load time of the main page (with teacher pictures showing), also with Network throttled to Fast 4G. Time search with a stopwatch. For update-to-display, update on one device and time how long until it appears on another.
5. **Automated runner.** Put `SUPABASE_ANON_KEY=...` in `tools/.env`, then `tools/test_runner.py`:
   ```python
   import csv, os, statistics, time
   import requests
   from dotenv import load_dotenv

   load_dotenv()
   KEY = os.environ["SUPABASE_ANON_KEY"]
   BASE = os.environ["SUPABASE_URL"] + "/rest/v1/"
   H = {"apikey": KEY}
   rows = []
   for view in ("teachers_board", "departments_board"):
       for i in range(30):
           t = time.perf_counter()
           r = requests.get(BASE + view + "?select=*", headers=H, timeout=15)
           rows.append([view, i + 1, r.status_code, round((time.perf_counter() - t) * 1000)])
   with open("../docs/test_results.csv", "w", newline="") as f:
       csv.writer(f).writerows([["view", "run", "http_status", "ms"], *rows])
   ms = [r[3] for r in rows]
   print(f"OK {sum(r[2] == 200 for r in rows)}/{len(rows)} | median {statistics.median(ms)} ms | max {max(ms)} ms")
   ```
   This measures the data request, not the whole page, so report it next to the Lighthouse results.
6. **Targets** (your own goals, to confirm with the adviser): main page usable in about 3 seconds, search under 1 second, update visible on another device within about 3 seconds.

Checkpoint 6
- [ ] Every ID in the log is Pass, or has a written reason and a fix.
- [ ] `docs/test_results.csv` and the Lighthouse screenshots are saved.

---
## PHASE 7: Evaluation with student evaluators
Supports: the Part IV ratings (SOP 3).

1. **Freeze the version.** Merge `dev` into `main`, then tag it: `git tag v1.0-eval && git push --tags`. Do not change the system while evaluators are testing.
2. **Prepare.** Create a test teacher account and a test delegate account (never real teachers' accounts): sign them up through the site and approve them. Put test data on the board that is clearly marked as a test.
3. **Consent first.** Collect assent and parent or guardian consent, following school requirements.
4. **Predefined tasks** (give them on one printed sheet): (1) open the board on your phone; (2) find a named teacher; (3) check each department; (4) filter by Available; (5) log in with the test account and update a status; (6) confirm the change appears on a second device.
5. **Then Questionnaire 2 (Part IV).** The researchers hand it out, guide the evaluators, and check that no item is blank. Record any problems the evaluators report, with device and network.
6. **Analyze.** Encode responses (1 to 4) in a spreadsheet or CSV, one column per statement. Use Python (pandas) or the spreadsheet to compute each indicator's mean and SD, and interpret with the paper's scale: 3.26 to 4.00 Very High, 2.51 to 3.25 High, 1.76 to 2.50 Low, 1.00 to 1.75 Very Low. The same approach gives the SOP 1 and SOP 2 tables.
7. **Privacy.** Keep response files out of the repository (CSV files are git-ignored) and delete raw data after the defense, as stated in your methodology.

Checkpoint 7
- [ ] All evaluator forms are complete and encoded.
- [ ] Means, SDs, and interpretations are ready for the Results tables.

---
## PHASE 8: Final release and documentation
1. Merge `dev` into `main` through a Pull Request. Vercel publishes the production site automatically.
2. Open the live URL on a phone and a computer and repeat the key tasks once.
3. Export a backup of each Supabase table (Table Editor > Export as CSV) and store it outside the repo. Teacher pictures live in Supabase Storage (bucket `avatars`); download a copy if you need one.
4. Confirm the Supabase project is active and that two people can log in to GitHub, Vercel, and Supabase.
5. Update `README.md`: purpose, live URL, how to run locally, the folder layout, and who maintains it.
6. Collect material for the paper: screenshots (board on mobile, update panel, admin page), the architecture diagram, the data flow diagram, and the database diagram (Supabase > Database > Schema Visualizer), plus the test log and Lighthouse results.
7. Tag the final release: `git tag v1.0 && git push --tags`.

Checkpoint 8
- [ ] The live site works on a phone and a computer.
- [ ] Backups, diagrams, screenshots, and the test log are saved for the paper.

---
## Where each SOP 3 ID is built and checked
| IDs | Built in | Checked in |
|---|---|---|
| FS-1, FS-2, FS-3 | Phase 3 | Phase 6 functional tests |
| FS-4, FS-5 | Phase 4 (rules from Phase 2) | Phase 6, Checkpoint 4 negative tests |
| RL-1, RL-2, RL-4, RL-5 | Phase 3 | Phase 6 reliability tests |
| RL-3 | Phase 4 | Phase 6 interrupted-save test |
| RT-1 to RT-4 | Phase 3 | Phase 6 Lighthouse and runner |
| RT-5 | Phases 3 and 4 | Phase 6 two-device timing |