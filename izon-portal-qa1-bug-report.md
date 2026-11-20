# IZON Portal QA1 — Bug Report

- **Env:** https://portal-qa1.izon.dev · build **V.1.4.3** · tested 2026-10-23
- **Method:** automated sweep of all 111 routes in the bundle's router (failed API calls, JS errors, slow calls, title/redirect checks) + manual CRUD on Tags / Image Tags + mobile layout check.
- **Test data:** see `izon-qa-test-records.md` — 5 test records (2 tags, 1 survey, 1 template, 1 schedule) still need dev/DB cleanup because the UI can't delete them.

## Critical / High

| # | Area | Bug | Repro / evidence |
|---|---|---|---|
| 1 | Administration › Tags | **Edit creates a new record instead of updating.** | Edit any tag → change name → Save. `PUT /izonapi/v1/tag/` returns a **new Id** (7 → 8); original row stays. New record has `CompanyId:0, CustomerId:0`. |
| 2 | Administration › Tags | **Edit form doesn't prefill.** Name is blank and Customer = "Select" even for "Audit / Market Force". Saving would wipe/duplicate data. | Open Edit on "Audit". |
| 3 | Administration › Tags | **Delete always fails.** URL has a trailing comma: `DELETE /izonapi/v1/tag/7,` → **500**. Followed by `GET /tag/ → 401`, and grid is stuck forever on "Retrieving data from server… 0%" until reload. | Delete any tag → Yes. |
| 4 | Izon Academy / Training | **Whole module broken — server 500s.** User sees "Request failed HTTP 500" toast and empty charts. | `GET usercourses/?companyId=1` 500 (`/reports/usercourse`), `trainingcourses/listCourses` 500 (`/reports/coursereport`, `/training/certificate`), `izonTraining/` 500 (`/training/user-courses`), `usercourses/?CustomerId=1` 500 (`/training/leaderboard`), `quizzes/` **404** + `trainingcourses/null` 500 (`/training/modules`). |
| 5 | Mobile (≤ 600px) | **Administration and Log Out unreachable.** Top navbar is 594px wide in a 375px viewport and clipped; nothing in the hamburger menu offers them. Also clipped at ~680px ("Log…"). | Open any page at 375×812. |

## Medium

| # | Area | Bug | Evidence |
|---|---|---|---|
| 6 | Tags | Whitespace-only name accepted ("    " saved; blank row in grid). | Add New → type spaces → Save → "The tags was successfully saved!" |
| 7 | Tags | Edit/Delete buttons are **invisible** — Syncfusion `e-icons` font/CSS not loaded (`::before content: none`), buttons render as empty 39×34 boxes. | `/tags` Actions column. |
| 8 | Training › Modules Edit | Opening without a selected course sends `null` IDs: `courseCompanies/…/null`, `coursesuppliers/…/null`, `coursechannels/…/null` → 500. | `/training/modules-edit` |
| 9 | Tasking › View Task Report | `POST scheduletasks/reports/null/` → 404 when no report selected. | `/field/view-schedule-task-report` |
| 10 | Scheduler | Unhandled error `Cannot read properties of null (reading 'UserId')`. | `/field/individual-schedule`, `/admin/individual-schedule` |
| 11 | Stock › Discontinued Stock | Unhandled error `Cannot read properties of undefined (reading 'date')`. | `/stock/discontinued-stock` |
| 12 | Users (new) | Console error `object is not a function`. | `/users-new` |
| 13 | Dates in API calls | Raw `Date.toString()` sent unencoded in query strings, e.g. `startDate=Fri Oct 16 2026 09:35:28 GMT+0200 (South Africa Standard Time)` — locale/timezone dependent, fragile. | `TaskCount`, `getSchedule`, `tableattendancereport` |
| 14 | Performance | Very slow endpoints: `user/` **25–57 s** (Sales Out, Warehouses, Edit Todo), `getphotonotessummary` **20–30 s** (also fired on Dashboard), `getGalleryPhotos` 18 s, `TaskCount` 15 s, `scheduletasks/report` 9 s. | Network timings |
| 15 | Reports | `/field/reports/stores-without-users` and `/field/reports/users-without-stores` silently redirect to `/dashboard`. Either route is dead or permission check gives no message. | Direct navigation |
| 16 | Dashboard | Filter counts show "Company (0) / Client Role (0)" on first load, later "(1) / (6)" — counts render before data. | `/dashboard` |

## Low / Cosmetic

| # | Bug |
|---|---|
| 17 | Add modals are titled **"Edit Tags"** / **"Edit Image Tags"** when adding. |
| 18 | Validation text "* required" is `#FF0000` at 9.75px on `rgb(35,63,75)` — ~2.8:1 contrast (fails WCAG AA). |
| 19 | Delete confirmation doesn't name the item ("Are you sure you want to delete this item?"). Risky combined with invisible buttons. |
| 20 | Typos: "Academy **Sumary**" (`/reports/usercourse`); toast "The tags **was** successfully saved". |
| 21 | Stale page titles: `/training/certificate` → "Leaderboard", `/admin/notifications` → "Warehouses", `/field/edit-todo` → "Surveys", 404 page → "Exclusion Table"; Floorwalk/Stock pages use "Market Force" vs "Izon Portal" inconsistently. |
| 22 | HTTP 500 toast covers header buttons (bell / Administration). |
| 23 | "Custom Range" button on Dashboard Field Summary clipped at ~680px width. |
| 24 | Admin pages (e.g. `/tags`) show the Field sidebar menu; direct-loading a page first renders a blank shell for several seconds. |
| 25 | Wastage reports call an endpoint named `izonWastagePortalTest` — confirm a test endpoint isn't what ships. Bundle also hard-codes `http://mfapi-internal.izon.ai/V2/api` (plain HTTP, prod domain) and `https://portal.izon.ai`. |
| 26 | Duplicate requests on load (e.g. `companyfeaturegroups` twice, animated logo SVG fetched ~7×). |

## Login, Logout & Password Recovery

| # | Sev | Bug | Repro / evidence |
|---|---|---|---|
| 27 | **High** | **Wrong credentials give no feedback.** `POST userlogin/` → 404 `"Record not found"`, nothing shown to the user. | Login with `claude-qa-test@example.com` / any password. |
| 28 | **High** | **Password Recovery hangs forever on non-numeric input.** Letters are accepted, Submit enables, button sticks on "…Submitting", no request is sent, no console error. Cancel + reopen keeps it stuck (old value, disabled button) — only a page reload recovers. | Forgot Password? → type `abcxyz` → Submit. |
| 29 | **High** | **Logout doesn't reliably end the server session.** `GET izonLogout/?userId=…` is aborted (`net::ERR_ABORTED`) because the page redirects before it completes. Logout is also a GET keyed by userId. | Log Out → network tab. |
| 30 | Medium | Possible **user enumeration**: unknown account returns `404 Record not found`. If a known account + wrong password returns something different, emails/mobiles can be enumerated. *Not verified with a real account (lockout risk) — devs please check.* | |
| 31 | Medium | **Enter key doesn't submit login** — there's no `<form>` element; inputs have no `name`/`id`, so password managers/autofill can't detect them. | Type credentials → press Enter. |
| 32 | Medium | Empty or invalid-format username: Login click does nothing and shows no message. | Click Login with empty fields / `notanemail`. |
| 33 | Medium | Both labels have `for="password"` — clicking "Mobile / Email Address" focuses the **password** field; wrong screen-reader labels. | |
| 34 | Medium | Password recovery is **mobile-only** although login accepts email; it SMSes a **temporary password** (rather than a one-time reset link/OTP). No phone-format validation (`type=text`, no pattern/maxlength). | |
| 35 | Medium | **Leftover Metronic template pages are publicly reachable:** `/auth/registration` ("Sign Up / Your Social Campaigns / Sign in with Google / Apple", posts to template `/register`) and `/auth/forgot-password` (email-based reset, contradicting the SMS flow). Registration text is dark-on-dark (`rgb(24,28,50)`) so it looks like empty boxes. Remove these routes. | |
| 36 | Low | At ~800px wide, the login card is pushed below the fold and the footer links overlap the top of the card; "IZON APP" overlaps "Insights from IZON GROUP". | |
| 37 | Low | "Show password" checkbox is a 9×9 px target and its label text isn't clickable. Password field has `autocomplete="off"`. | |
| 38 | Low | Footer PDFs (Privacy, T's & C's, PAIA) open in the same tab, navigating away from login. PDFs themselves load fine. | |

## Surveys, Task Templates & Scheduler

| # | Sev | Bug | Repro / evidence |
|---|---|---|---|
| 39 | **High** | **Surveys/templates saved without a Company become orphans.** `surveys/listall` doesn't return them, so they never appear in the list (any Status / Company filter) and can't be opened, edited or deleted. Company is not marked required. | Add New survey or template with no Company → Save → back to list (ids 1121, 1122). |
| 40 | **High** | **Schedules can't be deleted (or edited) anywhere in the UI.** Grid items have no handlers; calendar events only support drag. `DeleteShiftAndSchedule()` exists in `NewIndividualSchedule` but is never called. | Scheduler / Individual Schedule. |
| 41 | **High** | **New schedule isn't displayed.** Created shift 17911 / SchedulesWork 230834 for 29 Oct; it doesn't appear in the Scheduler grid (Thu 29 empty) or the Individual Schedule calendar. | Add Schedule → Save → grid refresh. |
| 42 | **High** | **Schedule dates stored in UTC midnight-shifted form.** `SchedulesWork` saved `StartTime` = `EndTime` = `2026-10-28T22:00:00Z` for a 29 Oct schedule — the entered times are dropped and the date is the previous day in UTC. | Payload of `POST SchedulesWork/`. |
| 43 | Medium | **Scheduler accepts end time before start time** (17:00 → 08:00). | Add Schedule. |
| 44 | Medium | **Add Schedule dialog doesn't show who it's for** (titled "Edit Event", no user name). With 40 users in the grid it's easy to schedule the wrong person. | Click any "Add Schedule". |
| 45 | Medium | **Duration not validated:** surveys accept `-5`, templates accept `abc`; stored as a string (`"Duration":"-5"`). Existing data has mixed formats (`"10 minutes"`, `"30"`). | Survey / template form. |
| 46 | Medium | **Individual Schedule: add does nothing.** Day cells have `onDoubleClick`/`onContextMenu` handlers, but double-click/right-click open nothing (cell just highlights). | `/field/individual-schedule` → double-click empty day. |
| 47 | Medium | **Duplicate channel "Shoprite Checkers"** listed twice in the Scheduler channel picker; ticking one ticks both and the counter shows "(2)". | Add Schedule → Select Channels → search "Shoprite". |
| 48 | Medium | Every Add Schedule open fetches all ~11,949 stores **twice** (`stores/?active=1`) plus `provinces/?all=undefined`. | Network tab. |
| 49 | Low | Picker counters are ambiguous: "Select Companies (123)" = options available, but "Select Channels (1)" = selected. Easy to think 3,849 stores are selected. | Survey / template / schedule forms. |
| 50 | Low | In filtered pickers, "All" shows as ticked once every *visible* row is ticked; "All" also stays at the top of search results, inviting accidental select-all. | Any multi-select picker. |
| 51 | Low | Survey Status filter has All/Active/Expired but no **Inactive** (Templates page has Inactive). | `/field/surveys` filter. |
| 52 | Low | Default survey/template expiry is **100 years** out (`ExpiryDate: 2126-…`). | Save payload. |
| 53 | Low | Wording: new forms titled "Edit Survey", "Edit Task Template", "Edit Event"; template save toast says "The **Survey** was successfully saved!". Duration input too narrow (placeholder shows "Dura"). | |
| 54 | Low | "Add Schedule" controls are `<div>`s, not buttons — not keyboard-accessible. | Scheduler grid. |

## Checked and OK
- Survey edit updates in place (`PUT /surveys/1121`, same Id) — unlike Tags.
- Survey/template required-field validation for Name and Duration (empty) works; Scheduler blocks save with no channel/store.
- Scheduler Users filter works and correctly scopes Add Schedule (payload `UserId` matched the filtered user).
- After logout, protected routes redirect to `/auth`; local storage is cleared; API returns 401 for `company/`, `tag/`, `user/`, `stores/` without a session.
- Footer PDFs return valid PDFs (277 KB / 645 KB / 227 KB).
- Show password toggles correctly; recovery Submit is disabled when empty.
- Tags search: case-insensitive, handles `%`, `'`, `<b>` safely.
- Image Tags: create + delete work (`DELETE quizquestiontags/{id}` → 200).
- No API keys / secrets found in the JS bundle.
- Unknown routes go to `/error/404`.

## Not covered
- Lockout after N failed logins and session expiry (would need a real test account).
- Recovery with a real-format mobile number (would send a real SMS).
- Users / Stores / Companies admin CRUD; survey **questions** editor; Upload Schedule (Excel) and Copy survey.
- Schedule edit/delete (no UI path exists — see #40).
