# Bridge NLEX Daily Report — Backend (Google Sheets + Google Drive)

This replaces browser-only storage with a shared backend in your own Google account.
The v3 screens, workflow, validation rules and team data are unchanged. Setup steps
for the admin are in [`google-apps-script/SETUP.md`](../google-apps-script/SETUP.md).

---

## 1. Architecture and recommendation

```
 Leadman phones (PWA, works offline)        Admin computer / phone
 ┌───────────────────────────────┐          ┌──────────────────────────┐
 │ frontend/ (React build)       │          │ same app, Admin PIN      │
 │ • drafts + photos kept on     │          │ • command center         │
 │   phone until sent            │          │ • CSV / .xlsx export     │
 └──────────────┬────────────────┘          └────────────┬─────────────┘
                │  HTTPS POST (JSON, signed session token)│
                ▼                                         ▼
        ┌──────────────────────────────────────────────────────┐
        │ Google Apps Script web app  (google-apps-script/)     │
        │ • checks PIN → issues signed token (role + team)      │
        │ • enforces team access + all report rules             │
        │ • one writer at a time (script lock)                  │
        └──────────────┬──────────────────────────┬─────────────┘
                       ▼                          ▼
          Google Sheet (database)        Google Drive (photos)
          Teams · Roster · Attendance    Bridge NLEX Daily Report Photos/
          Reports · Photos · Audit         <date>/<team>/<file>.jpg
```

**Which option.** You asked for Google only, and for this app's size (4 teams, ~40
people, ~4 reports and ~8 photos a day) Google Sheets + Drive does the job. It costs
nothing extra and admin can open, filter and print the data directly in Sheets.

**What Supabase would do better.** It would be the stronger choice at larger scale:

| | Google Sheets + Drive (built) | Supabase |
|---|---|---|
| Cost | Free with your Google account | Free tier, then paid |
| Admin can read the data directly | Yes — it is a spreadsheet | Needs a dashboard or SQL |
| Speed per request | 1–3 s | < 0.5 s |
| Many people saving at the same moment | Queued (script lock, ~30 at once max) | Fine |
| Access control | Enforced in script code | Database row-level security |
| Size limit | 10 million cells per Sheet (~15+ years at this volume); Drive storage quota (15 GB free) | Much larger |
| Real-time updates | Admin screen refreshes every 60 s | Live push |

**Limitations to know**
- Apps Script has daily usage quotas (developers.google.com/apps-script/guides/services/quotas).
  This app makes roughly 200 calls a day, well under them. Google Workspace accounts get higher limits.
- The web app must be deployed with access **Anyone**, because phones call it without a
  Google sign-in. Security therefore comes from the setup key + PIN + signed token (section 5),
  not from Google sign-in.
- Photo previews in the app and Sheet need Drive link sharing. Some Google Workspace
  domains block that; photos are still stored, and admin opens them from Drive.
- If someone edits the Sheet by hand (for example deletes a column), the app can break.
  Only edit the **Teams** tab (PINs, names) by hand.

## 2. Database — Sheet tabs

All cells are stored as plain text, so dates (`2026-09-27`), times and plate numbers stay
exactly as sent. Times are Manila time, `yyyy-MM-dd HH:mm:ss`.

**Teams** (key: Team ID). The admin edits this tab. `setup()` gives everyone a random PIN; demo PINs 0000–4444 are never used in live mode.
| Team ID | Team | Short Name | Leadman | PIN (4 digits) | Default Unit | Active (Yes/No) |
|---|---|---|---|---|---|---|
| admin | Operations Admin | Admin | | *random* | | Yes |
| team1 | Bridge RM_Team 1 | RM Team 1 | Pijay Tanjeco | *random* | Locations | Yes |
| team2 | Segment 10 Scupper Drain | Segment 10 | Glenn Butiong | *random* | KM | Yes |
| team3 | Bridge Epoxy 1 | Epoxy 1 | Allan Miranda | *random* | Locations | Yes |
| team4 | Bridge Epoxy 2 | Epoxy 2 | Gilbert Rivera | *random* | Locations | Yes |

**Roster** (key: personId, e.g. `team2-abraham-balmeo`). Seeded with the 34 real crew
members, including the leadmen.
`personId, teamId, name, role (Leadman/Skilled/Crew), status (Active/Archived), createdAt, updatedAt, archivedAt, editedBy`

**Attendance** (key: `teamId|reportDate|personId`)
`reportDate, teamId, personId, name, role, status (Present/Absent), absenceReason (Sick/Leave/No show/Other), submittedAt, submittedBy, createdAt, updatedAt`

**Reports** (key: `teamId|reportDate`, one row per team per day)
`reportDate, teamId, team, leadman, state (draft/submitted), fromTime, toTime, location, activityDetails, status (Ongoing/Complete), target, actual, unit (KM/Locations), targetManpower, actualManpower, plateNumber, remarks, crewPresent, absentList, beforePreview (=IMAGE), afterPreview (=IMAGE), beforePhotoId, afterPhotoId, attendanceSubmittedAt, submittedAt, submittedBy, createdAt, updatedAt, editedBy, version`

- **draft**: attendance is in, but the report is not submitted yet (or it was reopened).
- **submitted**: accepted by the server. The phone locks the fields.
- **locked**: a leadman can change today's and yesterday's report only. Older reports are
  locked for them (the server refuses changes); admin can still change them.

**Photos** (key: photoId). Every upload is kept, including replaced and removed photos.
`photoId, teamId, reportDate, type (before/after), status (Active/Replaced/Removed), fileId, fileUrl, thumbnailUrl, originalFilename, uploadedAt, uploadedBy`

**Audit** (append-only)
`at, user, role, teamId, reportDate, action, changes`
Examples: `login`, `attendance submitted — 8/9 present. Absent: Abraham Balmeo (Leave)`,
`report resubmitted (v2) — location: "Km.11" → "Km.12"; after photo replaced`, `crew archived`, `export`.

## 3. Photo storage (Google Drive)

```
Bridge NLEX Daily Report Photos/          (created by setup(), in the admin's Drive)
  2026-09-27/
    Segment 10/
      2026-09-27_Segment10_BEFORE_071210.jpg
      2026-09-27_Segment10_AFTER_153801.jpg
    Epoxy 1/ …
```
- The phone resizes photos to at most 1600 px, JPEG quality 0.82 (about 200–400 KB),
  before uploading. The original filename is kept in the Photos tab and in the file description.
- `fileUrl` opens the full photo. `thumbnailUrl` (`drive.google.com/thumbnail?id=…&sz=w800`) is
  used for previews in the app and in the Sheet (`=IMAGE(...)`).
- Replacing a photo marks the old one **Replaced**. The old file stays in Drive as evidence.

## 4. API (Apps Script `doPost` actions)

All calls are `POST` with a JSON body `{ action, token, device, ... }` and return `{ ok, ... }`
or `{ ok:false, error, auth?, missing? }`.

| Action | Who | Does |
|---|---|---|
| `login {pin, setupKey}` | anyone with the setup link | Checks the PIN, returns a signed token and the user (role, team) |
| `me` | signed in | Returns the current user |
| `load {days}` | admin: all teams · leadman: own team | Teams, roster, attendance, reports, active photos for the last N days; Sheet link (admin) |
| `saveAttendance {teamId, reportDate, people[]}` | own team / admin | Validates absence reasons, writes Attendance + Reports summary |
| `uploadPhoto {teamId, reportDate, type, dataUrl, originalFilename}` | own team / admin | Saves to Drive, adds to Photos (replaces the previous active one) |
| `removePhoto {teamId, reportDate, type}` | own team / admin | Marks the active photo Removed |
| `submitReport {teamId, reportDate, report}` | own team / admin | Re-checks every rule, sets state=submitted, submittedAt/By, version+1, audit diff |
| `reopenReport {teamId, reportDate}` | own team (today/yesterday) / admin | Sets state back to draft so it can be edited |
| `addMember / archiveMember / restoreMember` | admin | Roster changes (the leadman row cannot be archived) |
| `exportCsv {from, to}` | admin | CSV built from the Sheet (default last 30 days) plus an `.xlsx` download link |

Maintenance functions to run from the Apps Script editor: `setup()`, `showSetupLink()`,
`newSetupKey()`, `signOutEveryone()`.

## 5. Sign-in and roles

- **Setup link** → `https://<app>/?backend=<web app URL>&key=<setup key>`. The admin sends it
  to each phone once. The app stores it and removes it from the address bar. Without the
  setup key the server refuses to check a PIN at all, so knowing the web app URL is not enough.
- **PIN** (4 digits, from the Teams tab) → the server returns a **signed session token**
  (HMAC-SHA256 with a secret kept in Script Properties), valid for 14 days. The token says
  which team the user belongs to. The phone stays signed in, including offline, until logout or expiry.
- **Brute-force protection**: after 5 wrong PINs a device is blocked for 15 minutes, and after
  30 wrong attempts in an hour sign-in is paused for everyone.
- **Revoking access**:
  - Change a person's PIN in the Teams tab → that person is signed out everywhere.
  - Set `Active = No` → that person is blocked.
  - Run `signOutEveryone()` → everybody must sign in again.
  - Run `newSetupKey()` → old setup links stop working.
- **Roles**:
  - **Leadman**: reads and writes only their own team. Can write today and yesterday only. Cannot change the roster or export.
  - **Admin**: reads and writes every team and any date, manages the roster, exports.

## 6. Access rules (what row-level security would do in Supabase)

The Sheet itself is private to the admin's Google account. Every action checks, on the server:
1. The token signature is valid and not expired, and the PIN has not changed since it was issued.
2. `needTeam_`: a leadman's `teamId` must equal the requested `teamId`; otherwise the request is refused.
3. `needWritableDate_`: a leadman can write only today or yesterday (Manila), never a future date.
4. `needAdmin_`: roster changes and export are admin only.
5. `load` filters every tab by team for leadmen and hides the Sheet link from them.
6. Text typed on a phone is stored as text and never runs as a spreadsheet formula. CSV
   cells starting with `= + - @` are prefixed with `'` so Excel won't run them either.

## 7. Moving from the browser-storage prototype

- The prototype only ever held **demo data on each device**; there are no real records to
  move. Real teams and crews are seeded into the Sheet by `setup()`.
- If a device holds prototype data someone wants to keep, open that device's Admin screen
  before switching and press **Export CSV**. Keep the file; it is not imported.
- A phone switches to live mode when it opens the setup link. Opening `?backend=off` returns
  it to the offline demo.
- Demo seeding, demo history, the Demo PINs box, "Reset demo data" and the prototype
  screen bar are all turned off in live mode.

## 8. Implementation order (done in this branch)

1. Backend `Code.gs`: tabs, seed, sign-in, access checks, attendance, photos, submit, reopen, roster, export, audit. ✅
2. Backend tests against in-memory Google services (`google-apps-script/test/`). ✅
3. Frontend `api.js` (setup link, session, calls) and `live.js` (live behaviour). ✅
4. Hand-off points in the design logic (`App.jsx`, marked `// live`) and small screen additions (`View.jsx`). ✅
5. Offline: installable app (service worker), bundled fonts, offline banner, photos queued on the phone. ✅
6. End-to-end test: leadman phone + admin computer against the real backend code. ✅
7. **Your steps**: paste the code, run setup, deploy, host the app, send setup links (SETUP.md).

## 9. Code changes in the app

| File | Change |
|---|---|
| `frontend/src/api.js` | New. Setup link capture, device id, session token storage, `call()` with timeout, offline and error handling |
| `frontend/src/live.js` | New. Login, load/merge from the Sheet, attendance submit, photo upload queue, report submit/reopen, roster, export |
| `frontend/src/App.jsx` | Design logic kept. Added `this.live` switch, no demo seeding in live mode, `unit` field, and `// live` hand-offs in `press`, `logout`, `submitAtt`, `submitAct`, `editAct`, `onFile`, photo remove, `addMember`, `removeMember`, `restoreMember`, `exportCsv`; photo resize now takes a size |
| `frontend/src/View.jsx` | Offline banner; sign-in status message; Demo PINs hidden in live mode; KM/Locations unit toggle; Admin **Refresh**, **Open Google Sheet** and **Download .xlsx**; busy labels (Submitting…) |
| `frontend/src/main.jsx` | Bundled fonts (work offline); setup-link capture |
| `frontend/vite.config.js` | PWA: installable, all app files cached for offline use; backend calls never cached |

**Offline rules in live mode**
- With no signal the app shows a banner. The leadman keeps working: form fields autosave
  on the phone, and photos are kept on the phone marked **Not uploaded yet**.
- **Submit** needs signal and a server confirmation. If there is no signal or the server
  fails, the app says *NOT submitted* and keeps the draft. It never shows a report as
  submitted unless the server confirmed it.
- Photos taken offline upload by themselves when signal returns, and again before submit.
- The first sign-in needs signal. After that the app opens offline and stays signed in.

## 10. Testing checklist (on real phones, after deployment)

Automated tests (run before every change):
```sh
node google-apps-script/test/backend.test.cjs      # 51 backend checks
cd frontend && npm run build && node tests/live-e2e.mjs   # 41 end-to-end checks (leadman + admin)
```

**Leadman (Android/iPhone, mobile data)**
- [ ] Open the setup link → PIN screen, no "Prototype only" bar, no Demo PINs box.
- [ ] Wrong PIN → "Wrong PIN". Own PIN → own name and team shown. **Add to Home Screen** works.
- [ ] Crew list matches the Roster tab.
- [ ] Submit report before attendance → "Submit attendance first".
- [ ] Mark someone absent without a reason → blocked. With a reason → "Attendance submitted" and rows appear in the Attendance tab.
- [ ] Take the Before photo with the camera → "uploaded to Google Drive"; the file is in Drive under today/team.
- [ ] Status Complete without an After photo → blocked. Ongoing → After photo optional.
- [ ] Airplane mode → orange "No signal" banner. Submit → "NOT submitted". The Sheet is unchanged.
- [ ] Take a photo in airplane mode → "Not uploaded yet". Turn data on → it uploads by itself.
- [ ] Submit with signal → "Report submitted at …", fields locked, a Reports row shows `submitted` with photo previews.
- [ ] Edit report → unlocks. Change the location, resubmit → version 2; the Audit tab shows the change.
- [ ] Close the app, airplane mode, open from the home screen → the app opens, still signed in.
- [ ] Log out → PIN screen.

**Admin (computer and phone)**
- [ ] Admin PIN (from the Teams tab) → command center. Every team's submission appears within 60 s, or immediately with **Refresh**.
- [ ] Needs attention lists teams missing attendance or reports.
- [ ] Team tab → today + history rows, roster. Add a crew member → it appears on that leadman's phone after refresh.
- [ ] Remove → "Tap to confirm" → archived. Restore works. The leadman cannot be removed.
- [ ] **Export CSV** opens in Excel with correct columns and photo links. **Download .xlsx** works while signed in to Google.
- [ ] Change a leadman's PIN in the Teams tab → that phone is asked to sign in again.
- [ ] With leadman A signed in, check you cannot see or change team B (the app only offers your own team; the server refuses others).
