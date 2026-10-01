# RM Bridge Department — Bridge NLEX Daily Report

Daily field report app for the Savvice NLEX bridge / road maintenance crews.

**Live app:** https://bridge-nlex-report.netlify.app (Netlify site `bridge-nlex-report`, built from `frontend/`).

A leadman opens the app, and in about 3–5 minutes:

> Choose my team → mark who's absent → enter what we did → add photos → review → **SUBMIT DAILY REPORT**

There is no PIN and no sign-in. The phone remembers the team. Everything is saved on the phone as it is
typed and sent when there is signal. The office works in the Google Sheet (its **Daily Report** menu).

## Layout

| Path | What it is |
|---|---|
| `frontend/` | **The app.** React + Vite, installable, works offline. Production source of truth. |
| `google-apps-script/` | **The backend.** `Code.gs` for the Google Sheet, setup guide, tests. |
| `docs/BACKEND.md` | Backend design: tabs, photos, API, protections, admin menu. |
| `prototype/` | The original Claude Design prototype, kept for reference only. The app does not use it. |
| `assets/savvice-logo.png` | Original Savvice Corporation logo. The cropped copy and icons are in `frontend/public/`. |

## Front end (`frontend/`)

```sh
cd frontend
npm install
npm run dev            # local dev server with a pretend office (demo crews), no Google needed
npm run build          # production files → frontend/dist/ (no demo code or data)
npm run build:demo     # demo build, for training
npm run test:backend   # backend checks: every rule, duplicates, locking, audit, upgrades
npm run test:e2e       # phone tests against the real backend code (offline, lost answers, two phones)
```

| File | What it does |
|---|---|
| `src/App.jsx` | The whole flow: team, the report draft (autosaved), photos, the send queue, sent/locked reports. |
| `src/screens.jsx` | The screens (team list, the four steps, success, sent, waiting, previous reports). |
| `src/rules.js` | What a report needs before it can be submitted (the server checks the same again). |
| `src/api.js` | Calls to the backend, values saved on the phone, Manila time. |
| `src/photo.js`, `src/idb.js` | Photo compression and stamping; photos waiting on the phone (IndexedDB). |
| `src/templates.js` | Common work descriptions per team. |
| `src/demo.js` | Demo builds only: a pretend office in the browser. Not in the production build. |

The phone learns the backend address once from the app link (Sheet → **Daily Report → Show the app link**),
or from `VITE_BACKEND_URL` at build time.

## Backend (`google-apps-script/`)

The Google Sheet is the database, Google Drive holds the photos, Google Apps Script is the API.

- **Setup and upgrade**: [`google-apps-script/SETUP.md`](google-apps-script/SETUP.md)
- **Design**: [`docs/BACKEND.md`](docs/BACKEND.md)
