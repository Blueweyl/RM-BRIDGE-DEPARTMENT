# Setting up the Google backend

You need the Google account that should own the data, and a computer.
Everything is stored in that account's Google Sheet and Google Drive.

## New Sheet
1. **sheets.google.com → Blank spreadsheet**, name it `Bridge NLEX Daily Report DB`.
2. **Extensions → Apps Script**. Delete what is in `Code.gs`, paste in all of [`Code.gs`](Code.gs), click **Save**.
3. Choose **setup** in the function list → **Run**. Allow the permissions it asks for
   (**Advanced → Go to … (unsafe) → Allow**: "unsafe" only means Google has not reviewed a script you wrote).
   The Sheet now has **Teams, Roster, Attendance, Reports, Photos, Audit** with the 4 teams and their crews.
4. **Deploy → New deployment** → gear → **Web app**. **Execute as: Me**. **Who has access: Anyone**. **Deploy**.
5. Copy the **Web app URL** (ends in `/exec`) and put it in `netlify.toml` as `VITE_BACKEND_URL`
   (or send it to Claude), then publish the app. It is built into the app, so **anyone who opens
   https://bridge-nlex-report.netlify.app/ can use it**: no per-phone setup. On the phone: open the address →
   choose the team → browser menu → **Add to Home screen**.

## Upgrading an older version (with PINs)
1. Open the Sheet → **Extensions → Apps Script**. Replace all of `Code.gs` with the new one, **Save**.
2. Run **setup** once. Your data is kept:
   - *DailyReports* becomes *Reports* (readable columns first), *AuditLog* becomes *Audit*.
   - Leadman names move into the **Teams** tab. PINs, sign-in tabs (*Users, Sessions, Devices*) and
     their secrets are deleted. *Revisions* and *Requests* are hidden, not deleted.
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The address stays the same.
4. Then publish the new app (Netlify). Phones that were already connected keep working with no new link.

Do the backend first, then the app. Reports left unsent on a phone from the old app are kept on that
phone as a copy (the app says so); ask that leadman to send that day's report again.

## Day to day (Sheet → Daily Report menu)
| Task | How |
|---|---|
| A new leadman | Send the app address https://bridge-nlex-report.netlify.app/ (**Show the app link** shows it) |
| A leadman needs to fix a sent report | **Reopen a submitted report…** (today or yesterday, give a reason). They fix it and submit again; both versions are in **Audit** |
| Export | **Export reports (Excel)…** (makes a file in the photo folder's *Exports* subfolder) |
| Add a crew member | Type a new row in **Roster** (Team ID, Name, Role). It gets an ID the next time the app loads, or run **Give new Roster rows an ID** |
| Remove a crew member | Roster → **Status** = `Archived` (their past attendance stays) |
| Change a leadman or team name | Edit the **Teams** tab. **Active** = `No` hides a team from the app |
| Client report tabs look wrong | **Rebuild the client report tabs** |
| Check nobody edited the history | **Check the audit log** |
| Backup | **File → Make a copy** monthly. Photos are already in Drive |

## Do not
- Rename, reorder or delete tabs or columns. Editing values in **Teams** and **Roster** is fine.
  Do not edit **Audit**.
- Share the Sheet or the photo folder with people who should not see every team's data.
