# IZON Portal QA — test records created by Claude (2026-10-23)

Only these records were created/modified. No pre-existing records were changed.
Everything marked **NOT deleted** needs a dev/DB cleanup — the UI gives no way to remove it (see bug report).

| Entity | Id(s) | Name / details | Created via | Status |
|---|---|---|---|---|
| Tag (`/tags`) | 7 | `"    "` (4 spaces) | Add New, whitespace-only name | **NOT deleted** — UI delete sends `DELETE /tag/7,` → 500 |
| Tag (`/tags`) | 8 | `CLAUDE-QA-TEST blank tag (delete me)` | "Edit" on Id 7 (Edit inserts instead of updating) | **NOT deleted** — same delete bug |
| Survey (`/field/surveys`) | 1121 (+ auto-created Quiz 2375) | `CLAUDE-QA-TEST survey EDITED` — Inactive, no company/channel targets | Add New, then edited | **NOT deleted** — not returned by `surveys/listall`, unreachable in UI |
| Task Template (`/field/task-template`) | 1122 (+ its auto-created Quiz) | `CLAUDE-QA-TEST template` — Inactive, channel PNP + supplier Adcock Ingram, no company | Add New | **NOT deleted** — not returned by `surveys/listall`, unreachable in UI |
| Schedule (`/field/scheduler`) | Shift 17911, SchedulesWork 230834, related `shiftstores` rows | User **Taelo Remake (2683) only**, store Shoprite - SS Orange Farm, 29 Oct 2026, 17:00→08:00 | Add Schedule with Users filter = Taelo Remake | **NOT deleted** — not shown in grid or calendar; no delete action in UI |
| Survey copy (`/field/surveys`) | 1123 (quiz 2377, question 16846) | `dfghjukio (Copy)` — copy of expired survey 257 | COPY icon; added/edited/deleted question 16846 | Deleted ✅ survey (DELETE → 200) and question 16846. Quiz 2377 + copied questions 16844/16845 may remain in DB |
| Image Tag (`/field/image-tags`) | 1181 | `CLAUDE-QA-TEST IMG TAG` | Add New | Deleted ✅ (DELETE → 200) |

## Suggested cleanup (dev/DB)
- `DELETE /izonapi/v1/tag/7`, `/tag/8`
- Surveys 1121, 1122 and their quizzes (2375 + the one linked to 1122), plus any `surveyprovince` / `surveycompany` rows for them
- `DELETE /izonapi/v1/SchedulesWork/230834`; shift 17911 and its `shiftstores` rows
