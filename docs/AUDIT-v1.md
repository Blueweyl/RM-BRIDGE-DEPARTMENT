# Bridge NLEX Daily Report — Audit Brief

## What it is
Clickable mockup of a field-ops reporting app for Savvice (NLEX bridge/road maintenance contract). Mobile-first for leadmen, desktop-first for admin. Single file: `Bridge NLEX Daily Report.dc.html`.

## Files
- `Bridge NLEX Daily Report.dc.html` — the whole app: template markup + one logic class (`class Component extends DCLogic`). Inline styles only.
- `image-slot.js` — drag-and-drop image placeholder web component (Before/After photos).
- `support.js` — runtime (auto-generated; don't audit).

## Template rules (runtime constraints)
- `{{ path }}` holes accept dotted lookups ONLY — no expressions, ternaries, or function calls. Compute in `renderVals()`.
- `<sc-for list as>` loops, `<sc-if value>` conditionals.
- Style strings passed via holes are CSS text strings (e.g. `"background:#fff;color:#000;"`).

## Screens (sticky top switcher)
1. **Login** — 4-digit PIN pad, logo mark, Unlock enabled at 4 digits (no auth, visual only).
2. **Admin** (default screen) — header with Import/Export Excel (non-functional), 3 KPI cards, 5 tabs (All Teams + 4 teams), data table (Date, Location, Activity Details, Status, Target/Actual, Manpower, Leadman), Employee Roster panel with add/remove buttons (non-functional) when a team tab is active.
3–6. **Leadman screens**, one per team — tabs: Activity (pre-filled form), Attendance (toggle Present/Absent chips), History (3 past entries).

## Data (static, `Component.TEAMS`)
| id | Team | Leadman | Crew count | Absent (default) | Status |
|---|---|---|---|---|---|
| team1 | Bridge RM_Team 1 | Pijay Tanjeco | 7 | Rocky Miranda | COMPLETE |
| team2 | Segment 10 Scupper Drain | Glenn Butiong | 8 | Abraham Balmeo | COMPLETE |
| team3 | Bridge Epoxy 1 | Allan Miranda | 8 | Eroll Pangilinan | ONGOING |
| team4 | Bridge Epoxy 2 | Gilbert Rivera | 7 | Voltaire Rotamula | ONGOING |

Note: Epoxy 2 leadman was changed from Cederick Martinez to Gilbert Rivera per request; Rivera removed from crew list; Alvin Galang is Skilled.

KPIs (computed): Manpower Today = sum of actual manpower = 7+7+8+7 = **29**; Jobs Completed = **2**; Active Crews = **4**.

## State
- `screen`: `'login' | 'admin' | 'team1'..'team4'`
- `pin`: string (max 4)
- `adminTab`: `'all' | teamId`
- `teamTabs`: `{ [teamId]: 'activity' | 'attendance' | 'history' }`
- `attendance`: `{ [teamId]: { [personName]: boolean } }` — seeded in constructor; leadman always present.

## Known issues / audit targets
1. **User report:** attendance missing for Team 1, Epoxy 1, Epoxy 2, and Segment 10 activity missing. Could not reproduce in my preview. Check:
   - leadman screens are rendered with `<sc-for list="{{ teams }}">` wrapping `<sc-if value="{{ team.isCurrentScreen }}">`. Is nested sc-for → sc-if → sc-for (`team.attendanceList`) resolving reliably?
   - Form inputs use `defaultValue`. Because every team screen shares one DOM position, React may reuse the uncontrolled inputs across team switches and show stale values. Fix: add a `key` per team or use controlled `value`.
   - Tab clicks (`goAttendance`) update `teamTabs[teamId]` — check that the correct team id is captured.
2. **Invalid hole:** the Status `<select>` style contains `{{ team.sample.status === 'COMPLETE' ? ... }}` — an expression, which the runtime won't evaluate. Replace with a precomputed `team.statusSelectColor`.
3. Dead code in `renderVals()` → `attendanceList` map: unused `present` variable.
4. `navPillBase` defined twice (inside team map and outside).
5. `image-slot` `id` comes from a hole (`team.beforePhotoId`) — confirm the component reads the id after render so drops persist per team.
6. Admin table was changed from `<table>` to CSS grid rows (sc-for inside `<tbody>` was breaking). Not responsive below ~900px — no horizontal scroll wrapper.
7. Non-functional by design: PIN auth, Submit, Submit Attendance, Import/Export Excel, add/remove employee. Flag if these should be wired up.
8. Dates are hardcoded (`09/14/2026`, "Sept 14, 2026") — should come from `new Date()` if "auto-filled" is meant literally.

## Suggested fixes checklist
- [ ] Reproduce missing-attendance/activity bug; add keys or controlled inputs.
- [ ] Remove the expression hole in the Status select.
- [ ] Clean up dead/duplicate code.
- [ ] Auto-fill today's date.
- [ ] Wrap admin table in `overflow-x:auto`.
