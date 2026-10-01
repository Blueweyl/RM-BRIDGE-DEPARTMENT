// Speed check on a simulated low/mid-range Android phone (4× slower CPU, 360×800 screen).
// Serves a build folder, answers the backend with the real Code.gs (as the e2e test does, plus a
// 300 ms network delay) and measures what a leadman feels:
//   • first open (team list) and reopen (straight to today's report)
//   • typing: time per key, main-thread long tasks, localStorage writes
//   • a 12-megapixel camera photo: time to preview, longest freeze, total blocking time
//   • network calls and bytes downloaded
//
//   npm run build && node tests/perf.mjs [distFolder] [label]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.argv[2] || path.join(HERE, '..', 'dist'));
const LABEL = process.argv[3] || path.basename(DIST);
const { makeBackend } = require(path.join(HERE, '..', '..', 'google-apps-script', 'test', 'fake-gas.cjs'));
const BACKEND = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';
const B = makeBackend(); B.env.setup();

let bytes = 0;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const p = path.join(DIST, u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } bytes += d.length; res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const APP = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Manila', serviceWorkers: 'block' });
const calls = {};
await ctx.route(BACKEND, async route => {
  const body = JSON.parse(route.request().postData());
  calls[body.action] = (calls[body.action] || 0) + 1;
  await new Promise(r => setTimeout(r, 300));
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(B.call(body)) });
});
// Long tasks and localStorage writes, collected inside the page.
await ctx.addInitScript(() => {
  window.__lt = []; window.__ls = { n: 0, bytes: 0 };
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__ls.n++; window.__ls.bytes += String(v).length; return set.call(this, k, v); };
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const ms = n => Math.round(n) + ' ms';
const out = {};
const mark = () => page.evaluate(() => ({ t: performance.now(), lt: window.__lt.length, ls: { ...window.__ls } }));
const since = (m) => page.evaluate(m => {
  const lt = window.__lt.slice(m.lt).map(x => x[1]);
  return { longest: Math.max(0, ...lt), blocking: lt.reduce((a, d) => a + Math.max(0, d - 50), 0), count: lt.length, lsWrites: window.__ls.n - m.ls.n, lsBytes: window.__ls.bytes - m.ls.bytes };
}, m);

// 1. First open from the app link → team list.
let t0 = Date.now();
await page.goto(APP + '?backend=' + encodeURIComponent(BACKEND));
await page.waitForSelector('.team-btn');
out['First open → team list shown'] = ms(Date.now() - t0);
out['Downloaded on first open'] = Math.round(bytes / 1024) + ' KB';
await page.getByRole('button', { name: /^Choose Segment 10/ }).click();
await page.waitForSelector('text=Who is here today?');
await page.waitForTimeout(1200);

// 2. Reopen (team remembered) → today's report.
for (const k in calls) delete calls[k];
t0 = Date.now();
await page.reload();
await page.waitForSelector('text=Who is here today?');
out['Reopen → today\'s report shown'] = ms(Date.now() - t0);
await page.waitForTimeout(1500);
out['Network calls on reopen'] = Object.entries(calls).map(([k, v]) => `${k}×${v}`).join(', ') || 'none';

// 3. Attendance taps.
let m = await mark();
const people = page.locator('.person');
for (let i = 1; i <= 3; i++) {
  await people.nth(i).getByRole('button', { name: 'Absent' }).click();
  await people.nth(i).getByRole('button', { name: 'Sick' }).click();
}
await page.waitForTimeout(1000);
let s = await since(m);
out['6 attendance taps: longest freeze'] = ms(s.longest);
out['6 attendance taps: localStorage writes'] = `${s.lsWrites} (${Math.round(s.lsBytes / 1024)} KB)`;

// 4. Typing.
await page.getByRole('button', { name: 'Next: Work details' }).click();
await page.waitForSelector('textarea');
const TEXT = 'Cleaning of clogged scupper drains along the northbound lane near km 45';
m = await mark();
t0 = Date.now();
await page.locator('textarea').first().pressSequentially(TEXT);
const typeMs = Date.now() - t0;
await page.waitForTimeout(1000);          // let a delayed autosave happen, so it is counted
s = await since(m);
out['Typing: time per key'] = ms(typeMs / TEXT.length);
out['Typing: longest freeze'] = ms(s.longest);
out['Typing: localStorage writes (1 s after)'] = `${s.lsWrites} for ${TEXT.length} keys (${Math.round(s.lsBytes / 1024)} KB)`;
await page.waitForTimeout(1000);

// 5. A 12 MP camera photo.
await page.fill('input[type=time] >> nth=0', '07:00');
await page.fill('input[type=time] >> nth=1', '16:00');
await page.fill('input[placeholder^="e.g. Km"]', 'Km.45');
await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Ongoing' }).click();
await page.fill('label:has-text("Target") input', '1');
await page.fill('label:has-text("Actual") input', '1');
await page.getByRole('button', { name: 'Next: Photos' }).click();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
// The photo is made inside the page beforehand, so only the app's own work is measured
// (handing a 6 MB file over from the test tool would itself freeze the page).
const size = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const g = c.getContext('2d');
  const img = g.createImageData(4000, 3000); for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = v; img.data[i + 1] = (i / 16000) % 255; img.data[i + 2] = 255 - v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  window.__photo = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); return window.__photo.size;
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.waitForTimeout(500);
out['Test photo'] = '4000×3000 JPEG, ' + Math.round(size / 1024) + ' KB';
m = await mark();
t0 = Date.now();
await page.evaluate(() => {
  const input = document.querySelector('label[aria-label="Take Before photo"] input');
  const dt = new DataTransfer(); dt.items.add(new File([window.__photo], 'IMG_0001.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('img[alt="Before photo"]', { timeout: 60000 });
out['Photo: time until preview shows'] = ms(Date.now() - t0);
await page.waitForSelector('text=✓ Saved', { timeout: 60000 });
out['Photo: time until uploaded'] = ms(Date.now() - t0);
s = await since(m);
out['Photo: longest freeze'] = ms(s.longest);
out['Photo: total blocking time'] = ms(s.blocking);
out['Photo: localStorage bytes written'] = Math.round(s.lsBytes / 1024) + ' KB';
const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : 'n/a');
out['JS memory after photo'] = heap;
const stored = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('bnlex', 1); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result.map(v => { const f = v.full; return f && f.size != null ? f.size : String(f || '').length; })); }; r.onerror = () => res([]); }));
out['Photo kept on phone for upload'] = stored.map(n => Math.round(n / 1024) + ' KB').join(', ') + ' (old version: base64 text; new: JPEG file)';
out['Page errors'] = errors.join(' | ') || 'none';

console.log('\n' + LABEL);
for (const [k, v] of Object.entries(out)) console.log(('  ' + k).padEnd(46) + v);
await browser.close(); srv.close();
