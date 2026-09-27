# Setting up the Google backend (about 20 minutes)

You need: the Google account that should own the data, and a computer.
Everything is stored in that account's Google Sheets and Google Drive.

## 1. Create the database Sheet
1. Go to **sheets.google.com** → **Blank spreadsheet**. Name it `Bridge NLEX Daily Report DB`.
2. Menu **Extensions → Apps Script**. A code editor opens.

## 2. Add the backend code
1. In the editor, click `Code.gs`, delete what is there, and paste in all of
   [`google-apps-script/Code.gs`](Code.gs).
2. Click the gear icon (**Project Settings**) → tick **Show "appsscript.json" manifest file**.
   Go back to the editor (**<>** icon), open `appsscript.json`, and replace it with
   [`appsscript.json`](appsscript.json).
3. Click **Save** (disk icon).

## 3. Run setup once
1. In the function dropdown at the top, choose **setup** → click **Run**.
2. Google asks for permission: **Review permissions** → choose your account → **Advanced** →
   **Go to … (unsafe)** → **Allow**. (It says "unsafe" only because you wrote the script yourself.
   It asks for access to this Sheet and to create the photo folder in your Drive.)
3. Back in the Sheet you now have the tabs **Teams, Roster, Attendance, Reports, Photos, Audit**, with
   the 4 teams and 34 crew members filled in. A Drive folder **Bridge NLEX Daily Report Photos** is created.

## 4. Change the PINs (important)
In the **Teams** tab, change every PIN in column E from the demo PINs (0000, 1111, 2222, 3333, 4444)
to new 4-digit PINs. Tell each leadman their own PIN. Keep the admin PIN private.

## 5. Publish the backend
1. In the Apps Script editor: **Deploy → New deployment** → gear icon → **Web app**.
2. **Execute as: Me**. **Who has access: Anyone**. (Phones call it without a Google sign-in;
   the setup key and PINs protect it.)
3. **Deploy** → copy the **Web app URL** (it ends in `/exec`).

After changing the code later, use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The URL stays the same, so phones keep working.

## 6. Put the app online
The app is a set of files in `frontend/dist` after running `npm run build` inside `frontend/`.
Host it anywhere that serves plain files over **https**, for example:
- **GitHub Pages** (free for public repositories): repository **Settings → Pages → Source: GitHub Actions**,
  then **Actions → "Deploy app to GitHub Pages" → Run workflow**. The address is shown when it finishes.
- **Netlify Drop**: drag the `frontend/dist` folder onto app.netlify.com/drop.

## 7. Make the setup link and send it to each phone
1. In Apps Script, open `Code.gs`, find `showSetupLink`, and replace `https://YOUR-APP-ADDRESS/` with
   your app address from step 6. Save.
2. Choose **showSetupLink** → **Run** → **Execution log** shows a link like
   `https://your-app/?backend=https%3A%2F%2Fscript.google.com%2F…%2Fexec&key=abc123…`
3. Send that link (Viber, Messenger, SMS) to each leadman and the admin. **Treat it like a password.**
4. On the phone: open the link → sign in with the PIN → browser menu → **Add to Home screen**.
   From then on, open the app from the home-screen icon. It works without signal.

## Day-to-day admin
| Task | How |
|---|---|
| Lost phone / someone left | Change their PIN in the Teams tab (signs them out everywhere) |
| Sign out every device | Apps Script → run **signOutEveryone** |
| Setup link was leaked | Apps Script → run **newSetupKey** and send the new link. Phones already signed in keep working. |
| Change a leadman | Teams tab: change the Leadman name and PIN. Add the new person in the app (Admin → team → Add to crew). |
| Backup | Sheet: **File → Make a copy** monthly. Photos are already in Drive. |
| See who changed what | **Audit** tab |

## Do not
- Rename, reorder or delete tabs or columns (the app relies on them). Editing values in the
  **Teams** tab is fine.
- Share the Sheet or the photo folder with people who should not see all teams' data.
