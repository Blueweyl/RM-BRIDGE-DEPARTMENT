# Setting up the Google backend (about 20 minutes)

You need: the Google account that should own the data, and a computer.
Everything is stored in that account's Google Sheets and Google Drive.

## 1. Create the database Sheet
Go to **sheets.google.com** → **Blank spreadsheet** and name it `Bridge NLEX Daily Report DB`.
(Already done for you if Claude created **Bridge NLEX Daily Report (App)** in your Drive: open the
Sheet inside that folder.)

## 2. Add the backend code
1. In the Sheet, open the menu **Extensions → Apps Script**. A code editor opens.
2. Delete what is in `Code.gs`, then paste in all of [`google-apps-script/Code.gs`](Code.gs).
   On GitHub, open the file and click the **Copy raw file** button (two squares icon) to copy all of it.
3. Click **Save** (disk icon).

`appsscript.json` is optional: the code sets the Manila time zone itself.

## 3. Run setup once
1. In the function dropdown at the top, choose **setup** → **Run**.
2. Google asks for permission: **Review permissions** → your account → **Advanced** →
   **Go to … (unsafe)** → **Allow**. ("Unsafe" only means Google has not reviewed a script you wrote yourself.
   It asks for access to this Sheet and your Drive, to save photos.)
3. The Sheet now has the tabs **Users, Teams, Roster, Attendance, DailyReports, Photos,
   Revisions, AuditLog, Sessions, Requests**, with the 4 teams and 34 crew members. A photo folder is
   created, or the existing **Bridge NLEX Daily Report Photos** folder is used.

**Already using an older version?** Paste the new `Code.gs`, run **setup** again, then
**Deploy → Manage deployments → ✏️ → New version**. Your data is kept: *Reports* becomes
*DailyReports*, the old *Audit* tab is kept as *Audit (v1)*, and the PINs move from *Teams* to
*Users* (same PINs, now stored hashed). Phones that already have the old setup link keep
working for 7 days; after that send the new link from **showSetupLink**.

## 4. PINs
`setup` gives the admin and each leadman a **new random PIN**, shown **once** in the execution
log. **Write them down now**: the **Users** tab only keeps a hash (`h:…`). Give each leadman
only their own PIN. Keep the admin PIN private.

To change a PIN: type 4 new digits into that person's PIN cell in the **Users** tab. It works
at once, signs that person out on every phone, and is replaced by its hash at the next sign-in.

## 5. Publish the backend
1. In the Apps Script editor: **Deploy → New deployment** → gear icon → **Web app**.
2. **Execute as: Me**. **Who has access: Anyone**. (Phones call it without a Google sign-in;
   the single-use setup links, device keys and PINs protect it.)
3. **Deploy** → copy the **Web app URL** (it ends in `/exec`).

After changing the code later, use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The URL stays the same, so phones keep working.

## 6. Put the app online
The app is a set of files in `frontend/dist` after running `npm run build` inside `frontend/`.
This production build contains **no demo PINs or demo data**; opened without a setup link it only
says "not connected". (`npm run build:demo` makes the offline demo, for training only.)
Host it anywhere that serves plain files over **https**, for example:
- **GitHub Pages** (free for public repositories): repository **Settings → Pages → Source: GitHub Actions**,
  then **Actions → "Deploy app to GitHub Pages" → Run workflow**. The address is shown when it finishes.
- **Netlify Drop**: drag the `frontend/dist` folder onto app.netlify.com/drop.

## 7. Make the setup link and send it to each phone
1. `showSetupLink` already points to `https://bridge-nlex-report.netlify.app/`. If you host the app
   somewhere else, change `APP_ADDRESS` there and save.
2. Choose **showSetupLink** → **Run** → **Execution log** shows a link like
   `https://your-app/?backend=https%3A%2F%2Fscript.google.com%2F…%2Fexec&key=abc123…`
3. Send that link (Viber, Messenger, SMS) to **one** person. **Each link connects ONE phone, once,
   within 24 hours** — run **showSetupLink** again for the next phone. The phone swaps the link for its
   own device key the first time and forgets it; if the link is forwarded or reused afterwards it is
   refused (and shows in the audit log). Phones connected before this version keep working.
4. On the phone: open the link → sign in with the PIN → browser menu → **Add to Home screen**.
   From then on, open the app from the home-screen icon. It works without signal.

## Day-to-day admin
| Task | How |
|---|---|
| Lost or stolen phone | App → Admin → **Phones** → **Disconnect** that phone (give a reason). It is signed out and cannot sign in again; the PIN and the person's other phones keep working |
| Someone left | Type a new PIN in the Users tab, or set Active = No (signs them out everywhere) |
| Sign out every device | Apps Script → run **signOutEveryone** |
| Setup link was leaked | If it was not used yet: run **cancelSetupLinks** (all unused links stop working) and send a new one. If someone else used it first, their phone appears under Admin → **Phones**: disconnect it. |
| Photos | Private in Drive (not shared by link). The app shows them to signed-in users of that team and the admin; the Sheet has "Before photo / After photo" links that open for the Drive owner. Run **makePhotosPrivate** if setup says some are still shared |
| "Audit log tampering detected" | Run **verifyAuditLog** (log shows what changed). After checking, run **resetAuditCheckpoint** |
| A phone may be compromised | Run **forgetAllPhones**: every phone needs a new setup link |
| "Too many wrong PINs" for everyone | Wait 15 minutes, or run **clearLoginLock**. Check the AuditLog tab for who tried. |
| Change a leadman | Users tab: change the name and type a new PIN. Add the new person in the app (Admin → team → Add to crew). |
| Backup | Sheet: **File → Make a copy** monthly. Photos are already in Drive. |
| See who changed what | Admin screen → **Audit log**, or the **AuditLog** tab. Run **verifyAuditLog** to check it was not edited by hand. |
| See every version of a report | Admin screen → **Show reports** → **History**, or the **Revisions** tab |
| Work stuck on a phone | Admin screen → **Needs attention** ("On the phone: …") or **Show reports** ("On phone, not synced", "Conflict ×N"). Ask the leadman to open the app with signal. |
| "Audit log entries could not be written" warning | Check the AuditLog tab is intact (**verifyAuditLog**), then run **clearAuditFailures** |
| Accomplishment Report tab | Filled automatically, one row per submitted report, in the weekly report layout. If it is edited by hand or rows get mixed up, run **rebuildAccomplishmentReport** to regenerate it from the reports. |
| Client report tabs (Bridge RM_Team 1, Segment 10 Scupper Drain, Attendance …) | Filled automatically in the client's format. Names use the Roster's **Report Name** column (e.g. BILLONES, JUSTIN B.) — fill it in for new crew. Run **rebuildClientTabs** to regenerate them. |
| .xlsx exports | Each export also makes a small Sheet in the photo folder's **Exports** subfolder (only the exported rows). Delete old ones whenever you like. |

## Do not
- Rename, reorder or delete tabs or columns (the app relies on them). Editing values in the
  **Users** and **Teams** tabs is fine. Do not edit AuditLog, Revisions or Sessions.
- Share the Sheet or the photo folder with people who should not see all teams' data.
