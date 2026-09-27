// End-to-end test of the live app against the real backend code.
//
// Serves the production build (dist/), and answers every call to the Google
// Apps Script URL by running google-apps-script/Code.gs on in-memory Google
// services. A leadman "phone" and an admin "computer" run as separate browsers.
//
//   npm run build && node tests/live-e2e.mjs
// Env: CHROMIUM=/path/to/chrome (default /opt/pw-browsers/chromium)
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(HERE, '..', 'dist');
const { makeBackend } = require(path.join(HERE, '..', '..', 'google-apps-script', 'test', 'fake-gas.cjs'));
const BACKEND = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';

const B = makeBackend();
B.env.setup();
const SETUP = () => APP + '?backend=' + encodeURIComponent(BACKEND) + '&key=' + B.props.SETUP_KEY;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const p = path.join(DIST, u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const APP = `http://localhost:${srv.address().port}/`;

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (!cond && detail !== undefined ? '  [' + detail + ']' : '')); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

async function device(viewport) {
  const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Manila', acceptDownloads: true });
  await ctx.route(BACKEND, async route => {
    const out = B.call(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  return { ctx, page };
}
const text = page => page.evaluate(() => document.body.innerText);
const click = (page, label, exact = true) => page.getByRole('button', { name: label, exact }).first().click();
const pin = async (page, p) => { for (const d of p) await page.click(`button[aria-label="Digit ${d}"]`); };
const waitText = (page, t, timeout = 8000) => page.waitForFunction(x => document.body.innerText.includes(x), t, { timeout }).then(() => true, () => false);
const photoFile = async (page, label, name) => {
  const buf = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = '#E8760F'; g.fillRect(0, 0, 64, 48); const b = await new Promise(r => c.toBlob(r, 'image/jpeg')); return [...new Uint8Array(await b.arrayBuffer())]; });
  await page.setInputFiles(`label[aria-label="${label}"] input`, { name, mimeType: 'image/jpeg', buffer: Buffer.from(buf) });
};
const today = B.env.today_();
const report = () => B.env.row_('Reports', 'team2|' + today);

try {
  // ── Leadman phone ───────────────────────────────────────────────────────
  const X = await device({ width: 390, height: 844 });
  await X.page.goto(APP + '?backend=' + encodeURIComponent(BACKEND));
  await X.page.waitForSelector('button[aria-label="Digit 1"]');
  await pin(X.page, '2222');
  ok('phone without setup key cannot sign in', await waitText(X.page, 'not set up yet'));
  await X.ctx.close();

  const L = await device({ width: 390, height: 844 });
  await L.page.goto(SETUP());
  await L.page.waitForSelector('button[aria-label="Digit 1"]');
  ok('setup link removed from address bar', !L.page.url().includes('backend=') && !L.page.url().includes('key='));
  ok('no prototype screen bar in live mode', await L.page.locator('nav').count() === 0);
  ok('no demo PINs shown in live mode', !(await text(L.page)).includes('Demo PINs'));

  await pin(L.page, '9999');
  ok('wrong PIN rejected by server', await waitText(L.page, 'Wrong PIN'));
  await L.page.waitForTimeout(1000);
  await pin(L.page, '2222');
  ok('PIN 2222 accepted by server → Glenn Butiong', await waitText(L.page, 'Glenn Butiong') && (await text(L.page)).includes('PIN accepted'));
  await click(L.page, "Start today's report");
  ok('opens Segment 10 screen', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain'));
  await L.page.waitForTimeout(500);
  ok('no demo data seeded (location empty)', await L.page.inputValue('input[placeholder^="e.g. CANDABA"]') === '');

  await click(L.page, 'Submit report');
  ok('client blocks submit without attendance', await waitText(L.page, 'Submit attendance first'));

  await L.page.getByRole('tab', { name: /Attendance/ }).click();
  await L.page.waitForSelector('button[aria-label="Mark Abraham Balmeo absent"]');
  ok('roster comes from the Sheet (9 people)', await L.page.locator('[role=group][aria-label^="Attendance for"]').count() === 9);
  await L.page.click('button[aria-label="Mark Abraham Balmeo absent"]');
  await click(L.page, 'Submit attendance (8/9)');
  ok('absent without reason blocked', await waitText(L.page, 'Choose a reason for every absent crew member'));
  await L.page.getByRole('button', { name: 'Leave', exact: true }).click();
  await click(L.page, 'Submit attendance (8/9)');
  ok('attendance saved to Sheet', await waitText(L.page, 'Attendance submitted at') && B.env.readAll_('Attendance').filter(a => a.teamId === 'team2').length === 9);
  ok('absence reason stored', B.env.readAll_('Attendance').find(a => a.name === 'Abraham Balmeo').absenceReason === 'Leave');

  await L.page.getByRole('tab', { name: /Activity/ }).click();
  await L.page.fill('input[placeholder^="e.g. CANDABA"]', 'Km.11+000 to km.10+020 C3 exit ramp');
  await L.page.fill('textarea[placeholder^="What did"]', 'Cleaning of clogged scupper drain');
  await L.page.fill('label:has-text("Actual manpower") input', '8');
  await click(L.page, 'Complete');
  await photoFile(L.page, 'Upload Before Work photo', 'IMG_2001.jpg');
  ok('before photo uploaded to Drive', await waitText(L.page, 'Before photo uploaded') && B.env.readAll_('Photos').some(p => p.teamId === 'team2' && p.type === 'before' && p.status === 'Active'));

  await click(L.page, 'Submit report');
  ok('Complete without After photo blocked', await waitText(L.page, 'Add an After Work photo'));
  await photoFile(L.page, 'Upload After Work photo', 'IMG_2002.jpg');
  await waitText(L.page, 'After photo uploaded');

  await L.ctx.setOffline(true);
  ok('offline warning shown', await waitText(L.page, 'No signal — keep working'));
  await click(L.page, 'Submit report');
  ok('offline submit refused honestly', await waitText(L.page, 'report NOT submitted'));
  ok('nothing submitted on the server', report().state === 'draft');
  ok('app does not show it as submitted', !(await text(L.page)).includes('Report submitted at'));

  await L.ctx.setOffline(false);
  await L.page.waitForTimeout(300);
  await click(L.page, 'Submit report');
  ok('online submit confirmed by server', await waitText(L.page, 'Report submitted at') && report().state === 'submitted' && report().submittedBy === 'Glenn Butiong');
  ok('fields locked after submit', await L.page.locator('fieldset').evaluate(f => f.disabled));
  ok('unit and plate stored', report().unit === 'KM' && report().plateNumber === 'NKU 8624', JSON.stringify(report()));

  await L.page.reload();
  ok('session kept after reload (no PIN needed)', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain') && await waitText(L.page, 'Report submitted at'));

  // ── Admin computer ──────────────────────────────────────────────────────
  const A = await device({ width: 1280, height: 900 });
  await A.page.goto(SETUP());
  await pin(A.page, '0000');
  await click(A.page, 'Open command center');
  ok('admin sees the phone submission', await waitText(A.page, 'Km.11+000 to km.10+020 C3 exit ramp'));
  const rowText = await A.page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.style.gridTemplateColumns && d.style.gridTemplateColumns.startsWith('200px') && d.innerText.includes('Segment 10 Scupper Drain')).map(d => d.innerText).pop() || '');
  ok('row shows Submitted + photos 2/2 + manpower 8/8', /Submitted/.test(rowText) && /2 \/ 2/.test(rowText) && /8 \/ 8/.test(rowText), rowText.replace(/\n/g, ' | '));
  ok('other teams show Missing Attendance', (await text(A.page)).includes('Missing Attendance'));
  ok('Open Google Sheet link', await A.page.locator('a:has-text("Open Google Sheet")').count() === 1);

  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('button[aria-label="Download report as CSV file for Excel"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('CSV downloaded from backend data', dl.suggestedFilename().startsWith('NLEX_Daily_Report_') && csv.includes('Segment 10 Scupper Drain') && csv.includes('drive.google.com/file/d/') && csv.charCodeAt(0) === 0xfeff);
  ok('.xlsx link offered', await A.page.locator('a:has-text("Download .xlsx")').count() === 1);

  // Admin edits roster; the phone picks it up on refresh.
  await A.page.getByRole('button', { name: /Segment 10 Scupper Drain/ }).last().click();
  await A.page.fill('input[placeholder="New crew member full name"]', 'Juan Dela Cruz');
  await click(A.page, '+ Add to crew');
  ok('admin adds crew via backend', await waitText(A.page, 'Juan Dela Cruz added') && !!B.env.row_('Roster', 'team2-juan-dela-cruz'));

  // ── Photo taken offline uploads when signal returns (Epoxy 1 phone) ─────
  const E = await device({ width: 390, height: 844 });
  await E.page.goto(SETUP());
  await pin(E.page, '3333');
  await click(E.page, "Start today's report");
  await waitText(E.page, 'Leadman · Bridge Epoxy 1');
  await E.ctx.setOffline(true);
  await photoFile(E.page, 'Upload Before Work photo', 'IMG_3001.jpg');
  ok('offline photo kept on phone, marked not uploaded', await waitText(E.page, 'Not uploaded yet') && !B.env.readAll_('Photos').some(p => p.teamId === 'team3'));
  await E.ctx.setOffline(false);
  await E.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('photo uploads automatically when back online', await waitText(E.page, 'Before photo uploaded', 10000) && B.env.readAll_('Photos').some(p => p.teamId === 'team3' && p.type === 'before'));

  // ── App opens with no signal (service worker) ───────────────────────────
  const swReady = await E.page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 15000))]));
  ok('service worker installed', swReady);
  await E.page.reload(); await E.page.waitForTimeout(500);
  await E.ctx.setOffline(true);
  await E.page.reload();
  ok('app opens offline from cache, still signed in', await waitText(E.page, 'Leadman · Bridge Epoxy 1') && await waitText(E.page, 'No signal'));
  await E.ctx.setOffline(false);

  // ── App left open past midnight ─────────────────────────────────────────
  B.clock.offsetDays = 1;
  await L.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('next day starts clean (no carried-over report)', await waitText(L.page, 'Submit report') && await L.page.inputValue('input[placeholder^="e.g. CANDABA"]') === '' && !(await text(L.page)).includes('Report submitted at'));
  await L.page.getByRole('tab', { name: /History/ }).click();
  ok("yesterday's report moves to History", await waitText(L.page, 'Km.11+000 to km.10+020 C3 exit ramp'));
  await L.page.getByRole('tab', { name: /Activity/ }).click();
  B.clock.offsetDays = 0;

  // ── Sign out ────────────────────────────────────────────────────────────
  await click(L.page, 'Log out');
  ok('logout returns to PIN screen', await waitText(L.page, 'Enter your 4-digit PIN'));
  await L.page.reload();
  ok('logged out stays logged out after reload', await waitText(L.page, 'Enter your 4-digit PIN'));

  for (const d of [L, A, E]) ok('no page errors', d.page.errors.length === 0, d.page.errors.join(' | '));
} catch (e) {
  failed++; console.log('ERROR ' + (e && e.stack || e));
} finally {
  await browser.close(); srv.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
