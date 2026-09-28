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
          Users · Teams · Roster ·       Bridge NLEX Daily Report Photos/
          Attendance · DailyReports ·      <date>/<team>/<file>.jpg
          Photos · Revisions ·
          AuditLog · Sessions
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
  Only edit the **Users** (PINs, names, active) and **Teams** tabs by hand.

## 2. Database — Sheet tabs

All cells are stored as plain text, so dates (`2026-09-27`), times and plate numbers stay
exactly as sent. Times are Manila time, `yyyy-MM-dd HH:mm:ss`. Text starting with `= + - @`
is stored with a leading `'` so Sheets never runs it as a formula.

| Tab | Key | Holds |
|---|---|---|
| **Users** | userId (`admin`, `lead-team2`…) | name, role (`admin`/`leadman`), teamId, PIN **hash**, active |
| **Teams** | teamId | name, short name, default unit, active |
| **Roster** | personId (`team2-abraham-balmeo`) | teamId, name, role (Leadman/Skilled/Crew), status (Active/Archived) |
| **Attendance** | `teamId\|date\|personId` | reportId, status (**Present/Absent/Leave/Rest Day/Sick/Other**), note (required for Other), submittedAt/By, rev |
| **DailyReports** | `teamId\|date` | server-made **reportId**, state (draft/submitted), all form fields, crew present, photo IDs + `=IMAGE` previews, **version** (submissions), **rev** (every change), firstSubmittedAt, late, reopen reason, last request ID |
| **Photos** | photoId | reportId, client photo ID, team, leadman, type, status (Active/Replaced/Removed), location + capture time (phone), upload time, Drive file, bytes |
| **Revisions** | revisionId | JSON snapshot of the report and its attendance each time it is submitted, reopened, or its attendance changes |
| **AuditLog** | (append-only) | who, role, team, action, entity + ID, before, after, reason, request ID, device, **chain hash** |
| **Sessions** | sessionId | user, role, team, device, created, expires, revoked |

- **draft**: attendance is in, but the report is not submitted yet (or it was reopened).
- **submitted**: accepted by the server. The phone locks the fields, attendance and photos.
- **locked**: a leadman can change today's and yesterday's report only; admin any past day.
- Nothing is deleted: replaced photos stay (status Replaced), a reopened report keeps a
  snapshot of the submitted version, archived crew keep their attendance.
- `Users`, `AuditLog`, `Revisions` and `Sessions` are protected (warning on hand edits).
  `verifyAuditLog()` recomputes the hash chain and reports the first row edited by hand.

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

All calls are `POST` with a JSON body `{ action, token, requestId?, ... }` and return `{ ok, ... }`
or `{ ok:false, error, auth?, missing?, conflict?, denied?, needReason? }`.
Every action runs `token → session → user → role → team → permission` on the server; the team,
role, user and date the phone sends are never trusted. Every write takes the script lock.
Writes carry `requestId`: the server keeps the answer for 6 hours per user + action + request ID
(and on the report row as `lastRequestId`), so a retry gets the first answer back and never saves
twice. Writes also carry `baseRev` (the revision the phone started editing from → `conflict` if
another device changed the report since; the refusal is written to the audit log as `CONFLICT …`).
All times stored by the server are Manila time from the server clock; `login` and `load` return
`serverTime` so the phone can correct its own clock for display.

| Action | Who | Does |
|---|---|---|
| `enroll {setupKey}` | phone with a valid, unexpired setup link | Returns a signed per-phone **device key**; the phone then deletes the setup key |
| `login {pin, deviceKey}` | enrolled phone | Checks the PIN hash, creates a Sessions row, returns a signed token |
| `logout` | signed in | Revokes the session |
| `load {days, outbox?}` | admin: all teams · leadman: own team | Teams, roster, attendance, reports, active photos, `serverTime`. A leadman's phone sends a summary of what it still holds unsent (`outbox`); admin gets every team's summary (`phoneQueue`), the Sheet link and any audit-write failures |
| `saveAttendance {teamId, reportDate, people[], baseRev, reason?}` | own team / admin | Every active crew member needs an explicit status; Other needs a note; unknown people refused. Locked for everyone once the report is submitted (reopen first). Changing attendance already submitted needs a `reason` (`needReason`); the audit entry holds each person's old and new status. Sending the same marks again → `unchanged`, no new revision |
| `uploadPhoto {teamId, reportDate, type, clientId, dataUrl, capturedAt, location}` | own team / admin | JPEG/PNG/WebP only, checked from the file's own bytes (not just the declared type), 6 MB max. Same `clientId` again → same photo back (no duplicate). Saves to Drive, links it to the reportId |
| `removePhoto {teamId, reportDate, photoId}` | own team / admin | The photo must belong to that report; marked Removed (file kept) |
| `submitReport {teamId, reportDate, report, baseRev, beforePhotoId/beforeClientId, afterPhotoId/afterClientId}` | own team / admin | Re-checks every rule (below); the photos named (server ID, or the phone's own photo ID for a report queued offline) must be the report's active ones; version+1, revision snapshot, audit before/after |
| `reopenReport {teamId, reportDate, reason, baseRev}` | own team (today/yesterday) / admin | Reason required; snapshot of the submitted version kept |
| `addMember / archiveMember / restoreMember` | admin | Roster changes (the leadman row cannot be archived) |
| `exportCsv {from, to}` | admin | CSV for up to 366 days with the stable **Report ID, Revision and Version** on every row, formula-safe cells. The same rows are written to a new Sheet in the photo folder's `Exports` subfolder for the `.xlsx` link (so the .xlsx never contains Users, Sessions or AuditLog) |
| `adminReports {from, to}` | admin | Every team × day: submitted/draft/missing, late/overdue, attendance and photo completeness, revision number and count, refused conflicting writes, reopened-not-resubmitted, and work still on the phone (pending, conflict, refused, failed upload) |
| `revisions {reportId}` / `auditLog {from, to, teamId}` | admin | Revision history of one report / audit log viewer |

**Report rules enforced by the server** (the phone shows the same list before sending):
valid `HH:mm` times with From before To; location, details, plate required (length limits);
status Ongoing/Complete and unit KM/Locations only; target and actual numbers 0–100 (whole
numbers for Locations); manpower whole numbers 1–60; remarks required when the work is
Ongoing, actual is below target, or actual manpower is above the Present count; Before photo
always; After photo when Complete; attendance submitted first, covering everyone on the crew
that day (someone added after attendance was sent must be marked before the report goes in).

Maintenance functions to run from the Apps Script editor: `setup()` (also upgrades an older
Sheet), `showSetupLink()`, `newSetupKey()`, `signOutEveryone()`, `forgetAllPhones()`,
`clearLoginLock()`, `verifyAuditLog()`, `clearAuditFailures()`. If an audit entry ever cannot be
written, the admin screen says so (count, time, error) until `clearAuditFailures()` is run.

## 5. Sign-in and roles

- **Setup link** → `https://<app>/?backend=<web app URL>&key=<setup key>`, valid for 7 days
  (`showSetupLink()` makes a new one when it has expired). On first open the phone swaps the
  key for its own signed **device key** and deletes the setup key from storage and the address bar.
- **PIN** (4 digits) → checked against an HMAC hash in the Users tab. To change a PIN, type
  4 new digits into the cell; it is hashed at the next sign-in. The server creates a
  **Sessions** row and returns a signed token (HMAC-SHA256, secret in Script Properties):
  14 days for leadmen (they work offline), 12 hours for admin.
- Every request checks: signature → not expired → session row exists and is not revoked →
  user active → PIN unchanged since sign-in → team active.
- **Brute-force protection**: 5 wrong PINs lock that phone for 15 min; 20 wrong PINs across
  all phones in 15 min pause sign-in for everyone (logged in the audit log; `clearLoginLock()`
  lifts it). Wrong setup keys are rate-limited separately and cannot lock PIN sign-in.
- **Revoking access**: change the PIN or set Active = No (that person, everywhere) ·
  **Log out** (that session) · `signOutEveryone()` · `newSetupKey()` (old links stop enrolling)
  · `forgetAllPhones()` (every phone needs a new setup link).
- **Roles**: **Leadman** reads and writes only their own team, today and yesterday; cannot
  change the roster, export, or see other teams, history across teams or the audit log.
  **Admin** reads and writes every team and past day, manages the roster, exports, sees
  revisions and the audit log.

## 6. Access rules (what row-level security would do in Supabase)

The server trusts nothing the phone says about identity, team, role, state, totals or IDs:
1. `verify_`: token → session → user → role (above).
2. `teamFor_`: a leadman's team comes from the session. A different `teamId` in the request
   is refused **and logged** as `DENIED team access`.
3. `writableDate_`: a real calendar date, not in the future; leadman only today/yesterday.
4. Admin-only actions are refused (and logged) for leadmen before any code runs.
5. Crew IDs must be on that team's active roster; photo IDs must belong to that team and day.
6. The server computes crew present, versions, revisions, report IDs, late flags and states.
7. `load` filters every tab by team for leadmen and hides the Sheet link from them.
8. CSV cells starting with `= + - @` (or tab/CR) are prefixed with `'`.

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

**Record states in live mode** (attendance and activity report, each per team per day)

| State | Meaning | Shown as |
|---|---|---|
| Draft | Edited on the phone, not submitted | "Saved on this phone" line |
| Pending sync | Submitted on the phone; saved in its outbox (localStorage) with a fixed request ID; not confirmed by the server | Orange **Pending sync** box + header chip; fields locked; **Send now** / **Edit before sending** (only if never sent) |
| Syncing | Being sent | "Syncing…" |
| Server confirmed | The server answered OK | Green "✓ … submitted at 3:42 PM · confirmed by server" |
| Conflict | The server refused: another device changed the report after this phone started editing | Red **Conflict — NOT saved** box + header chip; the phone's entries are kept; submitting again after seeing the server copy is a deliberate override |
| Not accepted | The server refused for another reason (validation, crew changed, report already submitted…) | Red box with the server's message; entries kept |

**Offline rules in live mode**
- With no signal the app shows a banner. The leadman keeps working: form fields and
  attendance marks autosave on the phone (localStorage, small). Photos are stored in
  **IndexedDB** (full size, with a watermarked evidence copy: type, team, date/time (Manila), leadman,
  location) and marked **Not uploaded yet**. A storage-full error is shown, never ignored.
- **Submit with no signal** puts the record in **Pending sync**. It is re-sent by itself when
  signal returns, every minute, and after the next sign-in — attendance before its report,
  that day's photos before the report. A re-send reuses the request ID, so it is never saved twice.
- `navigator.onLine` is only a hint. Any call that does not come back with a proper answer
  counts as *not confirmed*: the record stays Pending sync and the screen says so.
- Queued records and photos belong to the person who took/queued them: they are only ever
  sent with that person's sign-in (never with someone else's, e.g. the admin on the same phone).
- A photo the server refuses (not a real image, day locked…) is marked **Refused — retake** and not
  retried; the report cannot be confirmed without its required photos.
- An expired or revoked session sends the phone back to the PIN screen; queued work is kept and
  sent after signing in again.
- Each phone tells the server, when it loads, what it still holds unsent. The admin sees
  "On the phone: …" in **Needs attention** and **On phone, not synced** in the report overview.
- Dates and times shown are **Manila time** from the server clock, whatever the phone's time zone
  or clock says. Audit times are always the server's.
- Saved data that is damaged or hand-edited is checked before use: the app still opens, says so,
  and loads the server copy. A crash shows a Reload screen instead of a blank page.
- The first sign-in needs signal. After that the app opens offline and stays signed in.

## 10. Testing checklist

Automated tests (run before every change):
```sh
node google-apps-script/test/backend.test.cjs      # 151 backend checks, incl. adversarial cases
cd frontend && npm run test:e2e                     # 95 end-to-end checks: phones + admin in real browsers
```
The adversarial cases covered: forged teamId, leadman calling admin actions, expired/fake
tokens, duplicate submit, double tap, offline → reconnect, failed photo upload, edited
localStorage, invalid dates/times/numbers, Complete without After photo, two phones editing
the same report, CSV formula payloads, unauthorised reopen, reload/lost answer during submit,
offline queue sent automatically on reconnect, a server that never answers (client timeout), a refused required photo blocking confirmation, conflict state, crew changed while a record was
queued, expired session with work queued, phone in another time zone with a wrong clock,
corrupted local data, disguised/oversize photo files, attendance changes without a reason,
no demo data in the production build, and upgrading an old Sheet in place.

**Leadman (Android/iPhone, mobile data)**
- [ ] Open the setup link → PIN screen, no "Prototype only" bar, no Demo PINs box.
- [ ] Wrong PIN → "Wrong PIN". Own PIN → own name and team shown. **Add to Home Screen** works.
- [ ] Attendance: everyone shows **Not verified**; Submit stays disabled until every person is marked.
- [ ] Mark someone **Not present → Other** without a note → blocked. With a note → saved.
- [ ] **Take photo** opens the camera; **or choose from gallery** opens the gallery. The file in
      Drive has the watermark band at the bottom.
- [ ] Complete without an After photo → blocked. Ongoing without remarks → blocked.
- [ ] Airplane mode → "No signal" banner. Submit → **Pending sync** (not "Submitted"). The Sheet is unchanged.
      Turn airplane mode off → it sends by itself and shows "confirmed by server".
- [ ] Take a photo in airplane mode → "Not uploaded yet". Turn data on → it uploads by itself.
- [ ] Submit with signal → "Report submitted at …", fields locked.
- [ ] Edit report → asks for a reason → unlocks. Resubmit → version 2; Revisions and AuditLog tabs show it.
- [ ] Two phones on the same team: change attendance on one, then the other → "changed on another device".
- [ ] Close the app, airplane mode, open from the home screen → the app opens, still signed in.
- [ ] Log out → PIN screen; the Sessions row shows Revoked.

**Admin (computer and phone)**
- [ ] Admin PIN → command center. Every team's submission appears within 60 s, or with **Refresh**.
- [ ] **Reports, history & audit**: choose dates → **Show reports** lists missing/late days,
      attendance and photo completeness; **History** shows revisions; **Audit log** shows DENIED attempts in red.
- [ ] **Export CSV** exports the chosen dates; opens in Excel with photo links.
- [ ] Add / remove (confirm) / restore crew. The leadman cannot be removed.
- [ ] Type a new PIN into the Users tab → that phone must sign in again; the cell turns into `h:…` after the next sign-in.
- [ ] Run `verifyAuditLog()` → "Audit log intact".
