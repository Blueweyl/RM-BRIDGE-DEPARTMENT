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
3. The Sheet now has the tabs **Teams, Roster, Attendance, Reports, Photos, Audit**, with the
   4 teams and 34 crew members. A photo folder is created, or the existing
   **Bridge NLEX Daily Report Photos** folder is used.

## 4. PINs
`setup` gives the admin and each leadman a **new random PIN**. They are in the **Teams** tab
(column E) and in the execution log. Give each leadman only their own PIN. Keep the admin PIN
private. You can change any PIN in the Teams tab at any time.

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
