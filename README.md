# LYFJSHS Availability Board

A web-based Teacher and Department Availability Monitoring System for Luis Y. Ferrer Jr. Senior High School.
Research project of Group 1, Practical Research 2 (TVL-ICT).

Students see, in one place, whether a teacher or department is Available, Unavailable, or Status Not Updated.
Teachers (and the people they assign) update statuses; administrators manage records and accounts.

## Stack
HTML, CSS, JavaScript | Supabase (PostgreSQL, Auth, Realtime) | SQL | Python (tools only) | GitHub | Vercel | VS Code

## Folder structure
```
index.html            availability board          (Phase 3)
login.html            login                       (Phase 4)
dashboard.html        update panel                (Phase 4)
admin.html            admin tools                 (Phase 5)
css/styles.css
js/                   config.js, board.js, auth.js, dashboard.js, admin.js
sql/schema.sql        tables, views, triggers, security rules (Phase 2)
sql/seed.sql          starting departments, first admin
sql/migration_01_self_signup.sql      teacher sign-up with admin approval
sql/migration_02_profile_pictures.sql   teacher pictures (2 MB max)
tools/                Python scripts: import, test runner, survey analysis
docs/BUILD_GUIDE.md   step-by-step build guide
```

## Rules for the team
- Never commit the Supabase **service_role** key or any `.env` file.
- Work on `feature/*` branches, open a Pull Request into `dev`, get one review.
- Commit messages start with `feat:`, `fix:`, `docs:`, or `test:`.