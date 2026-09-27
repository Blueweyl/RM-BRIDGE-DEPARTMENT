// End-to-end test of the live app against the real backend code.
//
// Serves the production build (dist/), and answers every call to the Google
// Apps Script URL by running google-apps-script/Code.gs on in-memory Google
// services. Leadman "phones" and an admin "computer" run as separate browsers.
// Includes the client-side adversarial cases from the production audit
// (double tap, failed upload, lost response, reload mid-submit, edited localStorage, two phones).
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
B.env.setup({ demoPins: true });
const SETUP = () => APP + '?backend=' + encodeURIComponent(BACKEND) + '&key=' + B.props.SETUP_KEY;

// Per-action call counts, and one-shot faults: 'fail' (network error, nothing reaches the server)
// or 'drop' (server commits, the answer never reaches the phone).
const calls = {}, faults = {};
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
    const body = JSON.parse(route.request().postData());
    calls[body.action] = (calls[body.action] || 0) + 1;
    const f = faults[body.action];
    if (f === 'fail') { delete faults[body.action]; return route.abort('failed'); }
    if (f === 'slow') await new Promise(r => setTimeout(r, 700));
    const out = B.call(body);
    if (f === 'drop') { delete faults[body.action]; return route.abort('failed'); }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => (page.onDialog ? page.onDialog(d) : d.accept()));
  return { ctx, page };
}
const text = page => page.evaluate(() => document.body.innerText);
const click = (page, label, exact = true) => page.getByRole('button', { name: label, exact }).first().click();
const pin = async (page, p) => { for (const d of p) await page.click(`button[aria-label="Digit ${d}"]`); };
const waitText = (page, t, timeout = 8000) => page.waitForFunction(x => document.body.innerText.includes(x), t, { timeout }).then(() => true, () => false);
const photoFile = async (page, label, name) => {
  const buf = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#E8760F'; g.fillRect(0, 0, 320, 240); const b = await new Promise(r => c.toBlob(r, 'image/jpeg')); return [...new Uint8Array(await b.arrayBuffer())]; });
  await page.setInputFiles(`label[aria-label="${label}"] input`, { name, mimeType: 'image/jpeg', buffer: Buffer.from(buf) });
};
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const idbCount = page => page.evaluate(() => new Promise(res => { const r = indexedDB.open('bnlex', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').count(); q.onsuccess = () => res(q.result); }; }));
const today = B.env.today_();
const report = (t = 'team2') => B.env.row_('DailyReports', t + '|' + today);
const fillForm = async (page, loc) => {
  await page.fill('input[placeholder^="e.g. CANDABA"]', loc);
  await page.fill('textarea[placeholder^="What did"]', 'Cleaning of clogged scupper drain');
  await page.fill('label:has-text("Target (KM") input', '1');
  await page.fill('label:has-text("Actual (KM") input', '1');
  await page.fill('label:has-text("Target manpower") input', '8');
};
async function signIn(pinCode, name) {
  const D = await device({ width: 390, height: 844 });
  await D.page.goto(SETUP());
  await pin(D.page, pinCode);
  await waitText(D.page, "Start today's report");
  await click(D.page, "Start today's report");
  await waitText(D.page, 'Leadman · ' + name);
  await D.page.waitForTimeout(400);
  return D;
}

try {
  // ── Leadman phone ───────────────────────────────────────────────────────
  const X = await device({ width: 390, height: 844 });
  await X.page.goto(APP + '?backend=' + encodeURIComponent(BACKEND));
  await X.page.waitForSelector('button[aria-label="Digit 1"]');
  await pin(X.page, '2222');
  ok('phone without setup link cannot sign in', await waitText(X.page, 'not set up yet'));
  await X.ctx.close();

  const L = await device({ width: 390, height: 844 });
  await L.page.goto(SETUP());
  await L.page.waitForSelector('button[aria-label="Digit 1"]');
  ok('setup link removed from address bar', !L.page.url().includes('backend=') && !L.page.url().includes('key='));
  await L.page.waitForFunction(() => !!localStorage.getItem('bnlex.live.deviceKey'), null, { timeout: 5000 }).catch(() => {});
  ok('setup key exchanged for a device key, then deleted from the phone', !!(await ls(L.page, 'bnlex.live.deviceKey')) && !(await ls(L.page, 'bnlex.live.key')));
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
  await L.page.waitForSelector('button[aria-label="Mark Abraham Balmeo not present"]');
  ok('roster comes from the Sheet (9 people)', await L.page.locator('[role=group][aria-label^="Attendance for"]').count() === 9);
  ok('attendance starts NOT verified (nobody pre-marked present)', (await text(L.page)).includes('Not verified') && await L.page.locator('button[aria-pressed="true"][aria-label^="Mark"]').count() === 0);
  const attBtn = L.page.getByRole('button', { name: /Mark everyone first \(9 left\)/ });
  ok('attendance Submit disabled until everyone is verified', await attBtn.isDisabled());
  await L.page.click('button[aria-label="Mark Abraham Balmeo not present"]');
  await L.page.locator('[aria-label="Reason for Abraham Balmeo"]').getByRole('button', { name: 'Leave', exact: true }).click();
  await L.page.click('button[aria-label="Mark Rolando Faustino not present"]');
  await L.page.locator('[aria-label="Reason for Rolando Faustino"]').getByRole('button', { name: 'Other', exact: true }).click();
  await click(L.page, 'Mark rest present');
  await click(L.page, 'Submit attendance (7/9)');
  ok('"Other" without a note blocked', await waitText(L.page, 'Write a note for "Other"'));
  await L.page.fill('input[aria-label="Note for Rolando Faustino"]', 'Medical check-up');
  calls.saveAttendance = 0;
  await click(L.page, 'Submit attendance (7/9)');
  ok('attendance saved to Sheet', await waitText(L.page, 'Attendance submitted at') && B.env.readAll_('Attendance').filter(a => a.teamId === 'team2').length === 9);
  ok('statuses and note stored', B.env.readAll_('Attendance').find(a => a.name === 'Abraham Balmeo').status === 'Leave' && B.env.readAll_('Attendance').find(a => a.name === 'Rolando Faustino').note === 'Medical check-up');

  // [11] Second phone for the same team saves first; this phone's stale update is refused, its marks kept.
  const L2 = await signIn('2222', 'Segment 10 Scupper Drain');
  await L2.page.getByRole('tab', { name: /Attendance/ }).click();
  await L2.page.click('button[aria-label="Mark Abraham Balmeo present"]');
  await click(L2.page, 'Update attendance');
  ok('[11] other phone updates attendance', await waitText(L2.page, 'Attendance submitted and saved') && report().crewPresent === '8/9');
  await L.page.click('button[aria-label="Mark Ian Enriquez not present"]');
  await L.page.locator('[aria-label="Reason for Ian Enriquez"]').getByRole('button', { name: 'Sick', exact: true }).click();
  await click(L.page, 'Update attendance');
  ok('[11] stale phone gets "changed on another device", server copy not overwritten', await waitText(L.page, 'changed on another device') && report().crewPresent === '8/9' && B.env.readAll_('Attendance').find(a => a.name === 'Ian Enriquez').status === 'Present');
  await L.page.waitForTimeout(600);
  ok('[11] unsent marks kept on the stale phone', await L.page.locator('button[aria-label="Mark Ian Enriquez not present"][aria-pressed="true"]').count() === 1);
  await L.page.click('button[aria-label="Mark Ian Enriquez present"]');
  await L.page.click('button[aria-label="Mark Abraham Balmeo present"]');
  await click(L.page, 'Update attendance');
  ok('resubmit after refresh succeeds', await waitText(L.page, 'Attendance submitted and saved') && report().crewPresent === '8/9');
  await L2.ctx.close();

  await L.page.getByRole('tab', { name: /Activity/ }).click();
  await fillForm(L.page, 'Km.11+000 to km.10+020 C3 exit ramp');
  await L.page.fill('label:has-text("Actual manpower") input', '9');
  await click(L.page, 'Complete');
  await click(L.page, 'Submit report');
  ok('[9] manpower above attendance needs remarks (client)', await waitText(L.page, 'manpower is above attendance'));
  await L.page.fill('label:has-text("Actual manpower") input', '8');
  await L.page.fill('input[type=time] >> nth=0', '17:00');
  await click(L.page, 'Submit report');
  ok('[9] From after To blocked (client)', await waitText(L.page, '"From" must be before "To"'));
  await L.page.fill('input[type=time] >> nth=0', '07:00');
  ok('camera capture offered, gallery kept as fallback', await L.page.locator('label[aria-label="Take Before Work photo with camera"] input[capture="environment"]').count() === 1 && await L.page.locator('label[aria-label="Upload Before Work photo"] input:not([capture])').count() === 1);

  // [7] failed photo upload: kept in IndexedDB, retried, uploaded once.
  faults.uploadPhoto = 'fail';
  await photoFile(L.page, 'Upload Before Work photo', 'IMG_2001.jpg');
  ok('[7] failed upload shown, photo kept in IndexedDB (not localStorage)', await waitText(L.page, 'Upload failed') && await idbCount(L.page) === 1 && !(await ls(L.page, 'bnlex.v3.day.' + today) || '').includes('data:image'));
  await L.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[7] retry uploads it (one photo on the server)', await waitText(L.page, 'Before photo uploaded') && B.env.readAll_('Photos').filter(p => p.teamId === 'team2' && p.type === 'before').length === 1);
  ok('[7] uploaded photo removed from IndexedDB', await idbCount(L.page) === 0);
  const up = B.env.readAll_('Photos').find(p => p.teamId === 'team2');
  ok('photo metadata stored (report ID, leadman, capture time, location)', up.reportId === report().reportId && up.leadman === 'Glenn Butiong' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(up.capturedAt) && up.location.startsWith('Km.11'), JSON.stringify(up));

  await click(L.page, 'Submit report');
  ok('[10] Complete without After photo blocked', await waitText(L.page, 'Add an After Work photo'));
  await photoFile(L.page, 'Upload After Work photo', 'IMG_2002.jpg');
  await waitText(L.page, 'After photo uploaded');

  await L.ctx.setOffline(true);
  ok('[6] offline warning shown', await waitText(L.page, 'No signal — keep working'));
  await click(L.page, 'Submit report');
  ok('[6] offline submit refused honestly', await waitText(L.page, 'report NOT submitted'));
  ok('[6] nothing submitted on the server', report().state === 'draft');
  ok('[6] app does not show it as submitted', !(await text(L.page)).includes('Report submitted at'));

  await L.ctx.setOffline(false);
  await L.page.waitForTimeout(300);
  // [5] double tap: only one submit reaches the server.
  calls.submitReport = 0;
  faults.submitReport = 'slow';
  // Two taps in the same instant (before the screen can re-render), then a third a moment later.
  await L.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText === 'Submit report'); b.click(); b.click(); setTimeout(() => b.click(), 80); });
  ok('[6] online submit confirmed by server', await waitText(L.page, 'Report submitted at') && report().state === 'submitted' && report().submittedBy === 'Glenn Butiong');
  delete faults.submitReport;
  ok('[5] double tap sent ONE submit, version 1', calls.submitReport === 1 && report().version === '1', calls.submitReport);
  ok('fields locked after submit', await L.page.locator('fieldset').evaluate(f => f.disabled));
  ok('unit and plate stored', report().unit === 'KM' && report().plateNumber === 'NKU 8624', JSON.stringify(report()));

  await L.page.reload();
  ok('session kept after reload (no PIN needed)', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain') && await waitText(L.page, 'Report submitted at'));

  // [13] Edit needs a reason; cancelling keeps it submitted.
  L.page.onDialog = d => d.dismiss();
  await click(L.page, 'Edit report');
  await L.page.waitForTimeout(400);
  ok('[13] edit without a reason keeps the report submitted', report().state === 'submitted');
  L.page.onDialog = d => d.accept('Wrong chainage typed');
  await click(L.page, 'Edit report');
  ok('reopen with reason → draft + revision', await waitText(L.page, 'Report unlocked') && report().state === 'draft' && report().reopenReason === 'Wrong chainage typed');
  L.page.onDialog = null;
  await L.page.fill('input[placeholder^="e.g. CANDABA"]', 'Km.11+000 to km.10+000 C3 exit ramp');
  await click(L.page, 'Submit report');
  ok('resubmitted as version 2, original kept as revision', await waitText(L.page, 'Report submitted at') && report().version === '2'
    && B.env.readAll_('Revisions').filter(v => v.reportId === report().reportId && v.kind === 'submitted').length === 2);

  // [8] edited localStorage: pretend to be admin / another team.
  await L.page.evaluate(() => { const k = 'bnlex.live.session'; const s = JSON.parse(localStorage.getItem(k)); s.user = { ...s.user, role: 'admin', teamId: 'team1', team: 'All teams' }; localStorage.setItem(k, JSON.stringify(s)); });
  await L.page.reload();
  ok('[8] edited session in localStorage: server puts the leadman back on their own team', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain', 10000));
  const forged = await L.page.evaluate(async url => { const s = JSON.parse(localStorage.getItem('bnlex.live.session')); const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'exportCsv', token: s.token }) }); return r.json(); }, BACKEND);
  ok('[8][2] leadman token cannot export even with edited local role', !forged.ok && /Admin only/.test(forged.error));
  const forgedTeam = await L.page.evaluate(async url => { const s = JSON.parse(localStorage.getItem('bnlex.live.session')); const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'reopenReport', token: s.token, teamId: 'team1', reportDate: new Date().toISOString().slice(0, 10), reason: 'forged', baseRev: '0' }) }); return r.json(); }, BACKEND);
  ok('[1][13] forged teamId from the phone refused', !forgedTeam.ok && forgedTeam.denied);

  // ── [14] Epoxy 1 phone: the answer to Submit is lost, then the phone reloads ─
  const E = await signIn('3333', 'Bridge Epoxy 1');
  await E.page.getByRole('tab', { name: /Attendance/ }).click();
  await click(E.page, 'Mark rest present');
  await click(E.page, 'Submit attendance (9/9)');
  await waitText(E.page, 'Attendance submitted at');
  await E.page.getByRole('tab', { name: /Activity/ }).click();
  await E.page.getByRole('button', { name: 'KM', exact: true }).click();
  await fillForm(E.page, 'CANDABA VIADUCT North bound');
  await E.page.fill('label:has-text("Actual manpower") input', '9');
  await E.page.fill('label:has-text("Target manpower") input', '9');
  await click(E.page, 'Complete');
  await E.ctx.setOffline(true);
  await photoFile(E.page, 'Upload Before Work photo', 'IMG_3001.jpg');
  ok('[6] offline photo kept on phone, marked not uploaded', await waitText(E.page, 'Not uploaded yet') && !B.env.readAll_('Photos').some(p => p.teamId === 'team3'));
  await E.ctx.setOffline(false);
  await E.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[6] photo uploads automatically when back online', await waitText(E.page, 'Before photo uploaded', 10000) && B.env.readAll_('Photos').some(p => p.teamId === 'team3' && p.type === 'before'));
  await photoFile(E.page, 'Upload After Work photo', 'IMG_3002.jpg');
  await waitText(E.page, 'After photo uploaded');
  faults.submitReport = 'drop';
  await click(E.page, 'Submit report');
  ok('[14] lost answer: phone says NOT confirmed', await waitText(E.page, 'Report NOT confirmed') && !(await text(E.page)).includes('Report submitted at'));
  ok('[14] …but the server did save it', report('team3').state === 'submitted' && report('team3').version === '1');
  ok('[14] unconfirmed request remembered across reloads', (await ls(E.page, 'bnlex.live.reqs') || '').includes('act|team3'));
  await E.page.reload();
  ok('[14] after reload the phone shows the server truth: submitted', await waitText(E.page, 'Report submitted at', 10000));
  ok('[4][14] no duplicate: still version 1, request cleared', report('team3').version === '1' && !(await ls(E.page, 'bnlex.live.reqs') || '').includes('act|team3'));

  // ── Admin computer ──────────────────────────────────────────────────────
  const A = await device({ width: 1280, height: 900 });
  await A.page.goto(SETUP());
  await pin(A.page, '0000');
  await click(A.page, 'Open command center');
  ok('admin sees the phone submission', await waitText(A.page, 'Km.11+000 to km.10+000 C3 exit ramp'));
  const rowText = await A.page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.style.gridTemplateColumns && d.style.gridTemplateColumns.startsWith('200px') && d.innerText.includes('Segment 10 Scupper Drain')).map(d => d.innerText).pop() || '');
  ok('row shows Submitted + photos 2/2 + manpower 8/8', /Submitted/.test(rowText) && /2 \/ 2/.test(rowText) && /8 \/ 8/.test(rowText), rowText.replace(/\n/g, ' | '));
  ok('other teams show Missing Attendance', (await text(A.page)).includes('Missing Attendance'));
  ok('Open Google Sheet link', await A.page.locator('a:has-text("Open Google Sheet")').count() === 1);

  await A.page.fill('input[aria-label="From date"]', B.env.shiftDate_(today, -1));
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('button[aria-label="Download report as CSV file for Excel"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('CSV for the chosen date range downloaded', dl.suggestedFilename() === `NLEX_Daily_Report_${B.env.shiftDate_(today, -1)}_to_${today}.csv` && csv.includes('Segment 10 Scupper Drain') && csv.includes('drive.google.com/file/d/') && csv.charCodeAt(0) === 0xfeff);
  ok('.xlsx link offered', await A.page.locator('a:has-text("Download .xlsx")').count() === 1);

  await click(A.page, 'Show reports');
  ok('admin report overview: missing/overdue flagged, completeness shown', await waitText(A.page, 'missing/overdue') && (await text(A.page)).includes('Missing') && (await text(A.page)).includes('9/9 marked'));
  await A.page.getByRole('button', { name: /History for Segment 10 Scupper Drain/ }).first().click();
  ok('revision history viewer shows the reopen reason', await waitText(A.page, 'Wrong chainage typed'));
  await click(A.page, 'Audit log');
  ok('audit log viewer shows denied attempts', await waitText(A.page, 'DENIED'));

  // Admin edits roster; the phone picks it up on refresh.
  await A.page.getByRole('button', { name: /Segment 10 Scupper Drain/ }).first().click();
  await A.page.fill('input[placeholder="New crew member full name"]', 'Juan Dela Cruz');
  await click(A.page, '+ Add to crew');
  ok('admin adds crew via backend', await waitText(A.page, 'Juan Dela Cruz added') && !!B.env.row_('Roster', 'team2-juan-dela-cruz'));

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
  ok('next day starts clean (no carried-over report, attendance unverified)', await waitText(L.page, 'Submit report') && await L.page.inputValue('input[placeholder^="e.g. CANDABA"]') === '' && !(await text(L.page)).includes('Report submitted at'));
  await L.page.getByRole('tab', { name: /History/ }).click();
  ok("yesterday's report moves to History", await waitText(L.page, 'Km.11+000 to km.10+000 C3 exit ramp'));
  await L.page.getByRole('tab', { name: /Activity/ }).click();
  B.clock.offsetDays = 0;

  // ── Sign out ────────────────────────────────────────────────────────────
  const tok = JSON.parse(await ls(L.page, 'bnlex.live.session')).token;
  await click(L.page, 'Log out');
  ok('logout returns to PIN screen', await waitText(L.page, 'Enter your 4-digit PIN'));
  await L.page.waitForTimeout(300);
  ok('logout revoked the session on the server', B.call({ action: 'load', token: tok }).auth === true);
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
