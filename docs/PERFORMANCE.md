# Speed on low/mid-range Android phones

Applies to the no-PIN guided app (branch `claude/simple-field-report-eniukg`, PR #3).

## Before / after

Measured with `npm run perf`. The script uses Chromium with the CPU slowed 4×, a 360×800 screen, a 300 ms
delay on every backend call, and the real `Code.gs` on in-memory Google services. The test photo is a
12-megapixel (4000×3000) 5.6 MB camera JPEG made of noise, the hardest kind of photo to compress.

| What the leadman does | Before | After |
|---|---|---|
| Take a 12 MP photo: longest screen freeze | **1,186 ms** | **80–103 ms** |
| Take a 12 MP photo: total blocking time | 2,037 ms | 30–56 ms |
| Take a 12 MP photo: preview on screen | 2,550 ms | 860–880 ms |
| Photo kept on the phone for upload | 432 KB (base64 text) | 304 KB (JPEG file) |
| Reopen the app: today's report on screen | 588 ms | 323–340 ms |
| Backend calls when reopening | 2 (`teams`, `team`) | 1 (`team`) |
| Downloaded on first open | 374 KB | 225 KB |
| Typing 71 keys: phone-storage writes | 71 writes (29 KB) | 1 write |
| 6 attendance taps: phone-storage writes | 6 | 1 |
| 6 attendance taps: longest freeze | 53 ms | 0 ms |
| Typing: time per key | 21 ms | 20–24 ms (same) |
| First open, team list on screen | ~750 ms | ~735–800 ms (same) |

The first run of the old build (cold, before warm-up) took 2.25 s to show the team list, and its photo step
froze the screen for 10.7 s. That photo figure turned out to include the test tool handing over the 6 MB
file, so the table uses the corrected method for both builds. The file is now created inside the page
beforehand.

Caveat: Chromium's CPU slow-down mostly affects the main thread. On a real low-end phone the background
photo worker is slower too, so the preview takes longer than 0.9 s. The screen stays responsive while it
works, and a "Preparing the photo…" note shows.

## Root causes found

1. **Photo processing ran twice, on the main thread.** Every photo was decoded from the 12 MP original two
   times (a 560 px preview, then the 1600 px upload copy), and sometimes three times (a 1280 px retry).
   Each decode also drew on a canvas and ran a synchronous `toDataURL` JPEG encode, which blocked the screen.
2. **Large base64 strings.** The upload copy and the preview were base64 data URLs: 33% larger, held in
   React state and IndexedDB, and re-encoded each time.
3. **A storage write on every key and tap.** Each keystroke serialised the draft to `localStorage`
   (synchronous, on the main thread). On every render, the app also read and parsed yesterday's draft
   from `localStorage`.
4. **Whole-screen re-render per keystroke.** New inline handlers on every render defeated memoisation, so a
   tap re-drew the header, the step bar and every attendance row.
5. **Extra network on start.** Every open fetched the full team list as well as the team, and `team`
   returned 14 days of reports even though the start screen needs only today/yesterday.
6. **Heavy assets.** Three web-font families (7 weights, about 150 KB to precache) and a 115 KB logo shown
   30 px tall.

## What changed (files)

| File | Change |
|---|---|
| `frontend/src/photo-core.js` (new) | One decode → one 1600 px canvas → stamp → JPEG `Blob`. The preview is drawn from that canvas, not decoded again. Limits are in one place (`LIMITS`). |
| `frontend/src/photo.worker.js` (new) | Runs the above off the main thread (`createImageBitmap` + `OffscreenCanvas.convertToBlob`). |
| `frontend/src/photo.js` | Uses the worker when available and falls back to the main thread (one decode, async `toBlob`). Converts to a data URL only at upload time (`asDataUrl`). Previews are object URLs. |
| `frontend/src/App.jsx` | Debounced autosave (0.6 s after the last change, and at once on hide, close, submit, team or day change). Stable handlers. Yesterday's draft is read once, not on every render. One upload in flight per photo, with an "Uploading…" state. Start loads only `team`; the team list loads only on the team screen; history loads only when Previous reports is opened. Old preview URLs are released. |
| `frontend/src/screens.jsx` | `React.memo` on Header, StepBar, each attendance row and each photo slot. Photo "Uploading…" state. `decoding="async"` on previews. Fixed logo size, so the layout does not jump. |
| `frontend/src/index.css` | The phone's own fonts (nothing to download). Tap targets at least 48 px, main buttons 54 px. No shadows. `touch-action: manipulation` to remove the tap delay. |
| `frontend/src/main.jsx`, `package.json` | Web-font packages removed. New `npm run perf`. |
| `frontend/public/savvice-logo.png` | 680×296, 115 KB → 221×96, 24 KB. |
| `google-apps-script/Code.gs` | `team` returns today/yesterday by default and the last 14 days only with `history: true`. |
| `frontend/tests/perf.mjs` (new) | The measurement script below. |
| `frontend/tests/live-e2e.mjs` | Adds a 360 px phone with no worker: layout, tap sizes, reload right after typing, offline photo then online submit. |

Not changed, because the redesign already covers it: sign-in (there is none; the app reopens straight to
today's report, with "Change team"), and admin screens (they are in the Sheet's Daily Report menu, not in the
phone app).

## Photo and storage limits

| Limit | Value |
|---|---|
| Largest camera file accepted | 40 MB (else "take it again with the camera") |
| Upload copy | longest side 1,600 px, JPEG quality 0.80, stamped with BEFORE/AFTER, team, Manila time, leadman, location |
| If the upload copy is over 1.2 MB | re-encoded at 1,280 px, quality 0.65 |
| Upload refused on the phone above | 5.5 MB (the server's limit is 6 MB) |
| Preview (screen only, never uploaded) | 480 px, quality 0.60 |
| Photos per report | 1 Before (required) + 1 After (required when Complete) |
| Photos per team per day (server) | 40 |
| Where photos wait | IndexedDB `bnlex/photos`, as JPEG files, until the report is confirmed. Cleaned up after: drafts older than yesterday, and photos no draft, queue or recent sent report needs |
| Draft | `localStorage`, about 1–3 KB per team per day, written 0.6 s after the last change |
| Typical upload | about 150–450 KB per photo; a normal day is 2 photos plus one report call |

## How to measure (repeatable plan)

1. **Lab check, on every change** (`npm run perf`, about 30 s). Watch for these limits:
   - photo longest freeze < 200 ms; total blocking time < 300 ms
   - reopen to today's report < 1 s with 1 backend call
   - storage writes while typing: 1 per pause, not 1 per key
   - downloaded on first open < 300 KB
   - no page errors
2. **Before/after comparison.** Build the old version into a folder and run
   `node tests/perf.mjs <folder> before`, then `npm run perf` for the new one.
3. **On a real phone** (a ~₱6,000 Android, Chrome), once per release:
   - Chrome on a computer → `chrome://inspect` → the phone → **Performance** recording while taking a
     photo. There should be no red "long task" bar over 200 ms on the Main track.
   - With a stopwatch: tap the home-screen icon until today's report shows (target under 2 s on 4G).
   - Airplane mode: fill a report, take photos, submit, turn signal back on. It must send by itself.
4. **In the field** (optional): note the time from opening the app to "Report sent" for a few leadmen in
   week one. The goal is 3–5 minutes.

## Remaining risks

- **Very old phones** (Android 8 or older, or Chrome before 69) have no background worker and use the
  fallback, which processes on the main thread. It is still once instead of twice, but the screen can pause
  for 1–2 s per photo.
- **Low memory**: decoding a 12–50 MP photo can still close a tab on a 2 GB phone. The worker frees the
  original as soon as the 1,600 px copy exists.
- **Data on phone storage**: if Android clears site data, unsent drafts and photos are lost. This was
  already the case; "Add to Home screen" makes it less likely.
- **Autosave delay**: at most 0.6 s of typing could be lost if the browser is killed without a page-hide
  event (a crash). Normal closing, switching apps and reloading all save at once (tested).
- The single-file HTML copy cannot load the worker file, so it uses the fallback.
