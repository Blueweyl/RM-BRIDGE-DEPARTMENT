# RM Bridge Department — Bridge NLEX Daily Report

Daily field-ops reporting app for the Savvice NLEX bridge / road maintenance crews.

**Live app:** https://bridge-nlex-report.netlify.app (Netlify site `bridge-nlex-report`). Phones connect to the
Google backend through the admin's setup link, see [`google-apps-script/SETUP.md`](google-apps-script/SETUP.md). Leadmen use it on their phones for attendance,
activity reports and before/after photos. Admin uses it on desktop for the
command view, crew roster and CSV export.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | **The app.** React + Vite, offline-capable, live mode backed by Google. |
| `google-apps-script/` | **The backend.** `Code.gs` for the Google Sheet, setup guide, tests. |
| `docs/BACKEND.md` | Backend design: tabs, photos, API, roles, access rules, test checklist. |
| `prototype/Bridge NLEX Daily Report.dc.html` | Original Claude Design prototype (v3), browser storage only. |
| `prototype/support.js` | DC runtime, auto-generated. Do not edit. Loads React 18.3.1 + Babel from unpkg. |
| `prototype/image-slot.js` | `<image-slot>` photo component (used by v1 only). |
| `prototype/tests/tests-v3.js` | In-browser functional test (PIN login, submit rules, photos, CSV export, drafts). |
| `prototype/tests/width-v3.js` | In-browser layout test: overflow and tap-target size at 320/360/390/430px. |
| `prototype/archive/` | Earlier v1 and v2, kept for reference. To run one, copy it into `prototype/` next to `support.js`. |
| `docs/AUDIT-v1.md` | Audit brief written against v1. |
| `assets/savvice-logo.png` | Original Savvice Corporation logo. The cropped copy and icons are in `frontend/public/`. |

## Front end (`frontend/`)

A standalone React + Vite app built from the v3 design, with Savvice branding. It installs to
the phone's home screen and works without signal. It runs in two modes:

- **Live**: connected to the Google backend (Google Sheet + Drive). Real PIN sign-in, each
  leadman sees only their own team, and reports sync to the admin on any device. Turned on
  per phone by opening the admin's setup link.
- **Demo**: no backend; data stays in the browser (the original prototype behaviour). Demo builds
  only (`npm run dev`, `npm run build:demo`, `standalone/`): the production build contains no demo
  PINs or demo data and, with no setup link, just says the phone is not connected.

```sh
cd frontend
npm install
npm run dev            # local dev server (demo mode)
npm run build          # production files → frontend/dist/ (no demo data)
npm run build:demo     # offline demo build (fixed demo PINs), for training / the standalone HTML
npm run test:backend   # 185 backend checks (incl. adversarial: forged team, bad tokens, replays, conflicts)
npm run test:e2e       # 112 end-to-end checks: leadman phones + admin computer against the real backend code
```

- `src/App.jsx`: the design's logic class; lines marked `// live` hand off to `live.js`.
- `src/live.js`, `src/api.js`, `src/idb.js`: backend calls, device enrolment + session, the outbox
  (Draft → Pending sync → Syncing → Server confirmed / Conflict), Manila time, IndexedDB photo queue.
- `src/demo.jsx`: everything demo-only — the demo PINs, the Demo PINs box, sample crews and reports.
  Compiled into demo builds only; the production files contain no PINs at all (checked by the e2e test).
- `src/View.jsx`: the screens (Login, Admin, Leadman Activity/Attendance/History).

## Backend (`google-apps-script/`)

The Google Sheet is the database and Google Drive holds the photos. Google Apps Script is the API.

- **Setup (admin, about 20 minutes)**: [`google-apps-script/SETUP.md`](google-apps-script/SETUP.md)
- **Design** (architecture, tabs, photo folders, API, roles, access rules, migration, test checklist):
  [`docs/BACKEND.md`](docs/BACKEND.md)

## Running the original prototype

Serve the `prototype/` folder over HTTP (the page loads `./support.js`) and open
the `.dc.html` file:

```sh
cd prototype && python3 -m http.server 8000
# open http://localhost:8000/Bridge%20NLEX%20Daily%20Report.dc.html
```

Demo PINs: `0000` Admin · `1111` RM Team 1 · `2222` Segment 10 · `3333` Epoxy 1 · `4444` Epoxy 2.
All data is stored in the browser's `localStorage` under keys starting `bnlex.v3.`.
Use **Reset demo data** on the Admin screen to clear it.

## Tests

The same scripts pass against both the prototype and the demo build of `frontend/` (`npm run build:demo`). Open the app, then paste a test file into the browser devtools console:

- `tests-v3.js`: results appear in `window.__R`. For the second pass, reload the page,
  run `window.__MODE = 'reload'`, then paste the file again. This checks that drafts
  and locked reports survive the reload.
- `width-v3.js`: results appear in `window.__W`.
