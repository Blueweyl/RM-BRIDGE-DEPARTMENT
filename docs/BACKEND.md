# Bridge NLEX Daily Report — Backend (Google Sheets + Google Drive)

Setup steps are in [`google-apps-script/SETUP.md`](../google-apps-script/SETUP.md).

## 1. Architecture

```
 Leadman phones (installable app, works offline)          Office (the Google Sheet)
 ┌──────────────────────────────────────┐                 ┌───────────────────────────────┐
 │ frontend/  React build on Netlify    │                 │ "Daily Report" menu:          │
 │ • team remembered on the phone       │                 │ app link, reopen, export,     │
 │ • draft autosaved (localStorage)     │                 │ roster IDs, rebuild, audit    │
 │ • photos wait in IndexedDB           │                 │ (runs as the Sheet owner,     │
 │ • submitted report waits in a queue  │                 │  never over the web)          │
 └──────────────────┬───────────────────┘                 └───────────────┬───────────────┘
                    │ HTTPS POST, JSON (4 actions)                        │
                    ▼                                                     ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │ Google Apps Script web app (google-apps-script/Code.gs)              │
        │ • checks every report rule again • one writer at a time (lock)      │
        │ • one report per team per day     • audit log with a hash chain     │
        └──────────────┬───────────────────────────────┬───────────────────────┘
                       ▼                               ▼
          Google Sheet (the database)        Google Drive (private photos)
          Teams · Roster · Attendance ·      Bridge NLEX Daily Report Photos/
          Reports · Photos · Audit ·           <date>/<team>/<file>.jpg
          client report tabs
```

There is **no sign-in**: no PINs, setup keys, device keys or session tokens. Field work and admin work
are separated by *where* they run, not by a password:

- The web app only offers four field actions (section 4). It can read the team list and a team's crew
  list and recent sent reports, and it can add photos and submit **today's or yesterday's** report once.
- Everything an admin does (reopen a report, export, roster IDs, rebuild tabs, check the audit log,
  setup) is in the Sheet's **Daily Report** menu or the Apps Script editor. Those functions are not
  reachable over the web (the test suite checks every old admin action is refused).

What this means: anyone who has the app link could submit a report for a team that has not sent one yet
today. That is the trade for no sign-in. It is limited by: one report per team per day (a second one is
refused and logged), today/yesterday only, a daily photo cap, every rule checked on the server, the
device label and time on every row, and the office's **Reopen** to correct anything.

## 2. Sheet tabs

All cells are plain text, so dates (`2026-09-27`), times and plate numbers stay exactly as sent.
Times are Manila time, `yyyy-MM-dd HH:mm:ss`. Text starting with `= + - @` is stored with a leading `'`
so Sheets never runs it as a formula; exports quote such cells too.

| Tab | Key | Columns (readable first) |
|---|---|---|
| **Teams** | Team ID | Team ID, Team, Short Name, Leadman, Unit, Active |
| **Roster** | Person ID | team, name, role (Leadman/Skilled/Crew), status (Active/Archived), report name. Rows typed by hand get an ID automatically |
| **Attendance** | `teamId\|date\|personId` | Date, Team, Name, Role, Status (Present / Sick / Leave / No Show / Other), Reason / Note, Submitted, then IDs and revision |
| **Reports** | `teamId\|date` | Date, Team, Location, Activity, Status, Present, Target, Actual, Unit, Before, After, Submitted, then Start, End, Manpower, Absent, Equipment / Plate, Remarks, Leadman, Late, State, Report ID, Version, Revision, Crew Size, photo IDs, timestamps, Reopen Reason, Request ID, Device |
| **Photos** | Photo ID | team, date, type, status (Active/Replaced), Drive file, upload time (server), client photo ID, location and capture time *as claimed by the phone (not verified)*, bytes, device |
| **Audit** | append-only | time, who, team, action, entity, before, after, reason, request ID, device, **chain hash** |
| **Accomplishment Report**, team tabs, **Bridge_Conso**, attendance grids | report ID | the client's layouts, filled automatically on every submit; **Rebuild the client report tabs** regenerates them |

**Present** is counted by the server from the attendance sent ("8/9"). **Manpower** = people present.
**Crew Size** = active people on the roster that day.

## 3. Photos (Google Drive)

- The phone resizes photos to at most 1600 px (JPEG 0.8, about 150–450 KB) and stamps BEFORE/AFTER,
  team, Manila time, leadman and location on them, in a background worker. A small preview stays on the phone.
  Limits: see [`PERFORMANCE.md`](PERFORMANCE.md).
- **Private.** Files are never shared by link. The Sheet's Before/After cells are links that open the file
  for the Drive owner. The app never downloads photos from the server; previews come from the phone.
- **Checked on upload**: the type must match the file's first bytes (JPEG/PNG/WebP), max 6 MB, complete
  file structure (no truncated files, nothing appended), sensible size (16–12,000 px a side, ≤ 50 MP).
- A retried upload (same client photo ID) returns the photo already stored, never a second copy.
  Replacing a photo marks the old one **Replaced**; the file stays in Drive.

## 4. API (`doPost`)

`POST` with a JSON body (sent as `text/plain` so it is a simple CORS request). Answers are `{ ok: true, … }`
or `{ ok: false, error, missing?, alreadySubmitted?, rosterChanged?, retry? }`. Error texts are plain
words the app shows as they are.

| Action | Does |
|---|---|
| `teams` | Active teams: id, name, short name, leadman, unit. Server date and clock |
| `team` | One active team: crew list (leadman first) and its sent reports for today and yesterday (`history: true`: the last 14 days, for Previous reports) |
| `uploadPhoto` | `teamId, reportDate, type (before/after), clientId, dataUrl` → photo ID. Refused once that day's report is sent |
| `submitReport` | `teamId, reportDate, requestId, attendance[], report{fromTime,toTime,location,activityDetails,status,target,actual,unit,plateNumber,remarks}, before/after photo IDs` |

`submitReport` rules (the app checks the same before sending, the server decides):
- Date is today or yesterday (Manila). Team is active.
- Every active crew member has a status; otherwise `rosterChanged` (the app reloads the crew list and asks
  to check attendance again). At least one person Present.
- Start before End, location, work performed, Ongoing/Complete, Target and Actual numbers (≤ 100; whole
  numbers for Locations), plate pattern if given, length limits.
- Before photo required; After photo required when Complete.
- **One report per team per day.** The same `requestId` again (a retry after a lost answer) gets the first
  answer back and writes nothing. A different request for a sent report gets `alreadySubmitted`
  ("already sent at 3:42 PM"), is logged as *duplicate report refused*, and the app shows the day as sent.
- Writes take the script lock; if it is busy the answer is `retry: true` and the phone tries again.

## 5. Admin (Sheet → Daily Report menu)

| Menu item | Function |
|---|---|
| Show the app link | `showAppLink()`: the app address, and the Web app URL that is built into the app (`VITE_BACKEND_URL` in `netlify.toml`) |
| Reopen a submitted report… | `reopenReport(teamId, date, reason)`: today or yesterday, reason required, audited with a snapshot |
| Export reports (Excel)… | `exportReports(from, to)`: CSV + .xlsx in the *Exports* folder, formula-safe |
| Give new Roster rows an ID | `tidyRoster_()` |
| Rebuild the client report tabs | `rebuildAccomplishmentReport()` + `rebuildClientTabs()` |
| Check the audit log | `verifyAuditLog()` (also `resetAuditCheckpoint()`, `clearAuditFailures()` from the editor) |
| Set up / upgrade the Sheet | `setup()`: safe to run again; upgrades older Sheets in place |

## 6. On the phone

- Saved under `bnlex.live.*` in localStorage: `url` (backend), `team`, `teams`, `teamData.<team>`,
  `draft.<team>|<date>` (autosaved 0.6 s after the last change, and at once when the app is hidden), `queue` (submitted, waiting for the server),
  `sent` (confirmed, locks the day), `device` (a random label for the audit log, not a password).
- Photos wait in IndexedDB (`bnlex` / `photos`, as JPEG Blobs) until the report is confirmed.
- A submitted report keeps one request ID until the server answers, so retries never make a second report.
  While no request has reached the server the leadman can still take it back to change something.
- Unreadable saved data is never thrown away silently: a copy goes to `bnlex.quarantine` and the app says so.

## 7. Tests

- `npm run test:backend` runs the real `Code.gs` on in-memory Google services: every rule, the four
  actions only, duplicates and replays, the lock, the audit chain, exports, the client tabs, and upgrades
  from the previous (PIN) version and from v1.
- `npm run test:e2e` runs the production build in Chromium phones against the same backend: the whole
  flow, autosave across reload, a failed photo upload, a lost submit answer, offline submit, two phones on
  one team, a crew list changed mid-report, and an old-version phone.
