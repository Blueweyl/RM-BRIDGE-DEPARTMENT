# RM Bridge Department — Bridge NLEX Daily Report

Clickable prototype of the daily field-ops reporting app for the Savvice NLEX
bridge / road maintenance crews. Leadmen use it on their phones for attendance,
activity reports and before/after photos. Admin uses it on desktop for the
command view, crew roster and CSV export.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | **The front end.** A standalone React + Vite app built from the v3 design, with the Savvice logo. |
| `prototype/Bridge NLEX Daily Report.dc.html` | **Current app (v3).** Template markup plus one `Component` logic class. |
| `prototype/support.js` | DC runtime, auto-generated. Do not edit. Loads React 18.3.1 + Babel from unpkg. |
| `prototype/image-slot.js` | `<image-slot>` photo component (used by v1 only). |
| `prototype/tests/tests-v3.js` | In-browser functional test (PIN login, submit rules, photos, CSV export, drafts). |
| `prototype/tests/width-v3.js` | In-browser layout test: overflow and tap-target size at 320/360/390/430px. |
| `prototype/archive/` | Earlier v1 and v2, kept for reference. To run one, copy it into `prototype/` next to `support.js`. |
| `docs/AUDIT-v1.md` | Audit brief written against v1. |
| `assets/savvice-logo.png` | Original Savvice Corporation logo. The cropped copy and icons are in `frontend/public/`. |

## Front end (`frontend/`)

Does not need `support.js` or unpkg. React is bundled, so it runs from any static host.

```sh
cd frontend
npm install
npm run dev      # local dev server
npm run build    # production files go to frontend/dist/
```

Deploy by uploading `frontend/dist/` to any static host (Netlify, Vercel, GitHub Pages or a plain web server).
It builds with relative paths, so it also works from a sub-folder.

- `src/App.jsx`: the design's logic class, copied unchanged from the v3 prototype.
- `src/View.jsx`: the screens (Login, Admin, Leadman Activity/Attendance/History), matching the v3 template.
- `src/css.js`: converts the design's CSS-text styles into React style objects.

URL options: `?screen=admin` or `?screen=team1` opens on that screen. `?nav=0` hides the
"Prototype only" screen jumper. `?after=1` makes the After photo always required.

Savvice branding: logo card on the login screen, logo in the admin header, a logo strip at
the top of each leadman screen, and a favicon/home-screen icon made from the Savvice check mark.

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

The same scripts pass against both the prototype and the built `frontend/`. Open the app, then paste a test file into the browser devtools console:

- `tests-v3.js`: results appear in `window.__R`. For the second pass, reload the page,
  run `window.__MODE = 'reload'`, then paste the file again. This checks that drafts
  and locked reports survive the reload.
- `width-v3.js`: results appear in `window.__W`.
