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
B.env.setup({ pins: ['0000', '1111', '2222', '3333', '4444'] });   // fixed PINs for the test (admin, team1..team4)
// Each phone gets its own single-use setup link (as showSetupLink() prints).
let lastLink = '';
const SETUP = () => { lastLink = B.env.newSetupLink_().token; return APP + '?backend=' + encodeURIComponent(BACKEND) + '&key=' + lastLink; };

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

async function device(viewport, timezoneId = 'Asia/Manila') {
  const ctx = await browser.newContext({ viewport, timezoneId, acceptDownloads: true });
  await ctx.route(BACKEND, async route => {
    const body = JSON.parse(route.request().postData());
    calls[body.action] = (calls[body.action] || 0) + 1;
    const f = faults[body.action];
    if (f === 'fail') { delete faults[body.action]; return route.abort('failed'); }
    if (f === 'slow') await new Promise(r => setTimeout(r, 700));
    // 'hang': the server commits but never answers (the phone's own timeout must fire).
    if (f === 'hang') { delete faults[body.action]; B.call(body); return; }
    // 'refuse': the server refuses a photo as not a real image.
    if (f === 'refuse') { delete faults[body.action]; return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'That file is not a real JPEG, PNG or WebP photo — take it again.' }) }); }
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
  await page.fill('input[placeholder^="e.g. NCG"]', 'NKU 8624');
};
async function signIn(pinCode, name, tz) {
  const D = await device({ width: 390, height: 844 }, tz);
  await D.page.goto(SETUP());
  await pin(D.page, pinCode);
  await waitText(D.page, "Start today's report");
  await click(D.page, "Start today's report");
  await waitText(D.page, 'Leadman · ' + name);
  await D.page.waitForTimeout(400);
  return D;
}

const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const attUpd = () => B.env.readAll_('AuditLog').filter(a => a.action === 'attendance updated').pop();
const manilaLong = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };

try {
  // ── Production build: no demo PINs or demo data; no backend = no demo login ──
  const bundle = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('');
  const SRC = path.join(HERE, '..', 'src');
  const prodSrc = ['App.jsx', 'View.jsx', 'live.js', 'api.js', 'main.jsx', 'idb.js', 'css.js'].map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(HERE, '..', '..', 'google-apps-script', 'Code.gs'), 'utf8');
  ok('production source has no demo PINs, team.pin, admin PIN constant or Demo PIN box', !/\b(0000|1111|2222|3333|4444)\b|\b[tx]\.pin\b|ADMIN_PIN|adminPin|Demo PINs/.test(prodSrc));
  ok('production bundle contains no demo PINs, crew names or sample reports', !/Pijay|Crisostomo|SAPANG BAGO|NFJ 6654|Demo PINs/.test(bundle) && !/['"](1111|2222|3333|4444)['"]/.test(bundle));
  const N = await device({ width: 390, height: 844 });
  await N.page.goto(APP);
  await N.page.waitForSelector('button[aria-label="Digit 0"]');
  await pin(N.page, '0000');
  ok('app with no backend never opens a demo admin ("not connected")', await waitText(N.page, 'not connected') && !(await text(N.page)).includes('Operations Admin'));
  await N.ctx.close();

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
  const usedLink = lastLink;
  const RL = await device({ width: 390, height: 844 });
  await RL.page.goto(APP + '?backend=' + encodeURIComponent(BACKEND) + '&key=' + usedLink);
  await RL.page.waitForSelector('button[aria-label="Digit 1"]');
  ok('[P3] a setup link already used by another phone is refused (single use)', await waitText(RL.page, 'already used') && !(await ls(RL.page, 'bnlex.live.deviceKey')));
  await pin(RL.page, '2222');
  ok('[P3] …and that phone cannot sign in; the PIN screen shows why (not a generic message)', await waitText(RL.page, 'The setup link did not work: This setup link was already used'));
  await RL.ctx.close();
  ok('no prototype screen bar in live mode', await L.page.locator('nav').count() === 0);
  ok('no demo PINs shown in live mode', !(await text(L.page)).includes('Demo PINs'));

  await pin(L.page, '9999');
  ok('wrong PIN rejected by server', await waitText(L.page, 'Wrong PIN'));
  await L.page.waitForTimeout(1000);
  await pin(L.page, '2222');
  ok('PIN 2222 accepted by server → Glenn Butiong', await waitText(L.page, 'Glenn Butiong') && (await text(L.page)).includes('PIN accepted'));
  await click(L.page, "Start today's report");
  ok('opens Segment 10 screen', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain'), (await text(L.page)).slice(0, 600) + ' ERR ' + L.page.errors.join(' / '));
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
  L2.page.onDialog = d => d.accept('Abraham came back from leave');
  await click(L2.page, 'Update attendance');
  ok('[11] other phone updates attendance; the change needs a reason, kept in the audit log', await waitText(L2.page, 'Attendance submitted and saved') && report().crewPresent === '8/9'
    && /Abraham came back/.test(attUpd().reason) && JSON.parse(attUpd().before)['Abraham Balmeo'].status === 'Leave' && JSON.parse(attUpd().after)['Abraham Balmeo'].status === 'Present');
  await L.page.click('button[aria-label="Mark Ian Enriquez not present"]');
  await L.page.locator('[aria-label="Reason for Ian Enriquez"]').getByRole('button', { name: 'Sick', exact: true }).click();
  L.page.onDialog = d => d.accept('Ian went home sick');
  await click(L.page, 'Update attendance');
  ok('[11] stale phone: Conflict state shown, server copy not overwritten', await waitText(L.page, 'Attendance: Conflict — NOT saved') && report().crewPresent === '8/9' && B.env.readAll_('Attendance').find(a => a.name === 'Ian Enriquez').status === 'Present');
  ok('[11] header chip shows Conflict', (await text(L.page)).includes('Conflict'));
  await L.page.waitForTimeout(600);
  ok('[11] unsent marks kept on the stale phone', await L.page.locator('button[aria-label="Mark Ian Enriquez not present"][aria-pressed="true"]').count() === 1);
  await L.page.click('button[aria-label="Mark Ian Enriquez present"]');
  await L.page.click('button[aria-label="Mark Abraham Balmeo present"]');
  await click(L.page, 'Update attendance');
  ok('resubmit after refresh accepted (same as server → no new revision)', await waitText(L.page, 'Attendance unchanged') && report().crewPresent === '8/9' && !(await text(L.page)).includes('Conflict'));
  L.page.onDialog = null;
  await L2.ctx.close();

  await L.page.getByRole('tab', { name: /Activity/ }).click();
  const tpl = L.page.locator('select[aria-label="Quick activity template"]');
  ok('quick activity template: 10 templates for the team', await tpl.locator('option').count() === 11);
  await tpl.selectOption('Removal of accumulated silt from scupper drains');
  ok('…picking one fills Activity details (still editable)', await L.page.inputValue('textarea[placeholder^="What did"]') === 'Removal of accumulated silt from scupper drains' && await L.page.locator('textarea[placeholder^="What did"]').isEditable());
  await tpl.selectOption('Cleaning of clogged scupper drains');
  ok('…a second pick asks, then replaces the text', await L.page.inputValue('textarea[placeholder^="What did"]') === 'Cleaning of clogged scupper drains');
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
  ok('[7] uploaded photo still kept on the phone (until its report is confirmed)', await idbCount(L.page) === 1);
  const up = B.env.readAll_('Photos').find(p => p.teamId === 'team2');
  ok('photo metadata stored (report ID, leadman, capture time, location)', up.reportId === report().reportId && up.leadman === 'Glenn Butiong' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(up.capturedAt) && up.location.startsWith('Km.11'), JSON.stringify(up));

  await click(L.page, 'Submit report');
  ok('[10] Complete without After photo blocked', await waitText(L.page, 'Add an After Work photo'));
  await photoFile(L.page, 'Upload After Work photo', 'IMG_2002.jpg');
  await waitText(L.page, 'After photo uploaded');

  // [6] offline → queued as Pending sync → sent by itself when signal returns.
  await L.ctx.setOffline(true);
  ok('[6] offline warning shown', await waitText(L.page, 'No signal — keep working'));
  await click(L.page, 'Submit report');
  ok('[6] offline submit is queued as "Pending sync" (never shown as submitted)', await waitText(L.page, 'Report: Pending sync') && !(await text(L.page)).includes('Report submitted at'));
  ok('[6] nothing submitted on the server', report().state === 'draft');
  ok('[6] header chip says Pending Sync; fields locked while waiting', (await text(L.page)).includes('Pending Sync') && await L.page.locator('fieldset').evaluate(f => f.disabled));
  ok('[6] queued report saved on the phone (survives a restart)', (await ls(L.page, 'bnlex.live.outbox') || '').includes('act|team2|' + today));
  await L.ctx.setOffline(false);
  await L.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[6] back online: sent automatically and confirmed by the server', await waitText(L.page, 'Report submitted at', 15000) && report().state === 'submitted' && report().submittedBy === 'Glenn Butiong');
  ok('[7] local photo copies deleted only after the report was confirmed by the server', await until(async () => await idbCount(L.page) === 0));
  ok('[6] "confirmed by server" shown only after the server answered; queue emptied', (await text(L.page)).includes('confirmed by server') && !(await ls(L.page, 'bnlex.live.outbox') || '').includes('act|team2'));
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
  // [5] double tap: only one submit reaches the server.
  calls.submitReport = 0;
  faults.submitReport = 'slow';
  // Two taps in the same instant (before the screen can re-render), then a third a moment later.
  await L.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText === 'Submit report'); b.click(); b.click(); setTimeout(() => b.click(), 80); });
  ok('resubmitted as version 2, original kept as revision', await waitText(L.page, 'Report submitted at') && report().version === '2'
    && B.env.readAll_('Revisions').filter(v => v.reportId === report().reportId && v.kind === 'submitted').length === 2);
  delete faults.submitReport;
  ok('[5] double tap sent ONE submit', calls.submitReport === 1, calls.submitReport);

  // [8] edited localStorage: pretend to be admin / another team.
  await L.page.evaluate(() => { const k = 'bnlex.live.session'; const s = JSON.parse(localStorage.getItem(k)); s.user = { ...s.user, role: 'admin', teamId: 'team1', team: 'All teams' }; localStorage.setItem(k, JSON.stringify(s)); });
  await L.page.reload();
  ok('[8] edited session in localStorage: server puts the leadman back on their own team', await waitText(L.page, 'Leadman · Segment 10 Scupper Drain', 10000));
  const forged = await L.page.evaluate(async url => { const s = JSON.parse(localStorage.getItem('bnlex.live.session')); const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'exportCsv', token: s.token, deviceKey: JSON.parse(localStorage.getItem('bnlex.live.deviceKey')) }) }); return r.json(); }, BACKEND);
  ok('[8][2] leadman token cannot export even with edited local role', !forged.ok && /Admin only/.test(forged.error));
  const forgedTeam = await L.page.evaluate(async url => { const s = JSON.parse(localStorage.getItem('bnlex.live.session')); const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'reopenReport', token: s.token, deviceKey: JSON.parse(localStorage.getItem('bnlex.live.deviceKey')), requestId: crypto.randomUUID(), teamId: 'team1', reportDate: new Date().toISOString().slice(0, 10), reason: 'forged', baseRev: '0' }) }); return r.json(); }, BACKEND);
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
  ok('[14] unconfirmed record (with its request ID) remembered across reloads', (await ls(E.page, 'bnlex.live.outbox') || '').includes('act|team3'));
  await E.page.reload();
  ok('[14] after reload the phone shows the server truth: submitted', await waitText(E.page, 'Report submitted at', 10000));
  // The re-send (same request ID) that clears the record runs alongside the reload's other calls (e.g. photo previews).
  ok('[4][14] no duplicate: still version 1, record cleared', await until(async () => !(await ls(E.page, 'bnlex.live.outbox') || '').includes('act|team3'), 10000) && report('team3').version === '1');

  // ── Epoxy 2 phone queues attendance offline; the admin archives a crew member meanwhile ──
  const adminTok = B.call({ action: 'login', pin: '0000', device: 'test-admin' }).token;
  const G4 = await signIn('4444', 'Bridge Epoxy 2');
  await G4.page.getByRole('tab', { name: /Attendance/ }).click();
  await G4.page.waitForSelector('button[aria-label="Mark Edgar Ortillo present"]');
  await G4.ctx.setOffline(true);
  await click(G4.page, 'Mark rest present');
  await click(G4.page, 'Submit attendance (8/8)');
  ok('offline attendance queued as "Pending sync"', await waitText(G4.page, 'Attendance: Pending sync') && !B.env.readAll_('Attendance').some(a => a.teamId === 'team4'));
  B.call({ action: 'archiveMember', token: adminTok, personId: 'team4-edgar-ortillo' });
  await G4.ctx.setOffline(false);
  await G4.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('queued attendance naming a crew member archived meanwhile: refused by the server, nothing saved, shown clearly', await waitText(G4.page, 'Attendance: Not accepted by the server', 15000) && !B.env.readAll_('Attendance').some(a => a.teamId === 'team4'));
  await G4.page.evaluate(() => window.dispatchEvent(new Event('online')));   // the next load tells the server what is still on the phone
  await G4.page.waitForTimeout(1500);
  await G4.page.setViewportSize({ width: 320, height: 700 });
  ok('sync-state box fits a 320px phone (no sideways scroll)', await G4.page.evaluate(() => document.documentElement.scrollWidth <= 320));
  await G4.page.setViewportSize({ width: 390, height: 844 });
  ok('phone reports its refused record to the server', /rejected/.test((B.cache['queue:team4'] || {}).v || ''));

  // ── Private photos: previews come through the signed-in API ────────────
  ok('[P1] every photo file in Drive is private', Object.keys(B.files).length > 0 && Object.values(B.files).every(f => f.access === 'private'));
  calls.photoView = 0;
  await L.page.reload();
  await L.page.getByRole('tab', { name: /Activity/ }).click().catch(() => {});
  const dataPreview = () => L.page.evaluate(() => [...document.querySelectorAll('div')].some(e => /url\("data:image\/jpeg/.test(e.getAttribute('style') || '')));
  ok('[P1] after a reload the uploaded photo preview is fetched through the signed-in API', await until(dataPreview, 15000) && calls.photoView >= 1, calls.photoView);
  ok('[P1] no public Drive thumbnail/link is used for previews', !(await L.page.content()).includes('drive.google.com/thumbnail'));

  // ── Admin computer ──────────────────────────────────────────────────────
  const A = await device({ width: 1280, height: 900 });
  await A.page.goto(SETUP());
  await pin(A.page, '0000');
  await click(A.page, 'Open command center');
  ok('admin sees the phone submission', await waitText(A.page, 'Km.11+000 to km.10+000 C3 exit ramp'));
  const rowText = await A.page.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.style.gridTemplateColumns && d.style.gridTemplateColumns.startsWith('200px') && d.innerText.includes('Segment 10 Scupper Drain')).map(d => d.innerText).pop() || '');
  ok('row shows Submitted + photos 2/2 + manpower 8/8', /Submitted/.test(rowText) && /2 \/ 2/.test(rowText) && /8 \/ 8/.test(rowText), rowText.replace(/\n/g, ' | '));
  ok('other teams show Missing Attendance', (await text(A.page)).includes('Missing Attendance'));
  const stolen = await A.page.evaluate(async ([url, t]) => (await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'load', token: t, deviceKey: JSON.parse(localStorage.getItem('bnlex.live.deviceKey')) }) })).json(), [BACKEND, JSON.parse(await ls(L.page, 'bnlex.live.session')).token]);
  ok('[3] stolen session: a leadman\'s token copied to another phone is refused', stolen.auth === true);
  ok('admin "Needs attention" shows work stuck on a phone', (await text(A.page)).includes('On the phone: Attendance refused by server'));
  ok('Open Google Sheet link', await A.page.locator('a:has-text("Open Google Sheet")').count() === 1);

  await A.page.fill('input[aria-label="From date"]', B.env.shiftDate_(today, -1));
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('button[aria-label="Download report as CSV file for Excel"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('CSV carries the stable report ID + revision number', csv.split('\r\n')[0].includes('Date,Report ID,Revision,Version') && csv.includes(report().reportId + ',' + report().rev + ',2,'));
  ok('CSV for the chosen date range downloaded', dl.suggestedFilename() === `NLEX_Daily_Report_${B.env.shiftDate_(today, -1)}_to_${today}.csv` && csv.includes('Segment 10 Scupper Drain') && csv.includes('drive.google.com/file/d/') && csv.charCodeAt(0) === 0xfeff);
  ok('.xlsx link offered', await A.page.locator('a:has-text("Download .xlsx")').count() === 1);

  await click(A.page, 'Show reports');
  ok('admin report overview: missing/overdue flagged, completeness shown', await waitText(A.page, 'missing/overdue') && (await text(A.page)).includes('Missing') && (await text(A.page)).includes('9/9 marked'));
  ok('overview flags conflicts, revisions and work not yet synced from a phone', (await text(A.page)).includes('Conflict ×') && (await text(A.page)).includes('On phone, not synced') && (await text(A.page)).includes('revisions'));
  await A.page.getByRole('button', { name: /History for Segment 10 Scupper Drain/ }).first().click();
  ok('revision history viewer shows the reopen reason', await waitText(A.page, 'Wrong chainage typed'));
  await click(A.page, 'Audit log');
  ok('audit log viewer shows denied attempts', await waitText(A.page, 'DENIED'));

  // [P4] Disconnect one lost phone from the admin screen
  const P = await signIn('4444', 'Bridge Epoxy 2');
  const pDev = B.env.unsign_(JSON.parse(await ls(P.page, 'bnlex.live.deviceKey')), 'DEVICE_SECRET').d;
  await click(A.page, 'Phones');
  ok('[P4] admin Phones list shows connected phones and who used them', await waitText(A.page, 'connected ·') && (await text(A.page)).includes(pDev) && (await text(A.page)).includes('Gilbert Rivera'));
  A.page.onDialog = d => d.accept('Phone lost on site');
  await A.page.getByRole('row').filter({ hasText: pDev }).getByRole('button', { name: /Disconnect/ }).click();
  ok('[P4] admin disconnects that one phone (reason asked, audited)', await waitText(A.page, 'Phone disconnected') && B.env.readAll_('AuditLog').some(a => a.action === 'device disconnected' && a.entityId === pDev && a.reason === 'Phone lost on site'));
  A.page.onDialog = null;
  ok('[P4] the list shows it disconnected', await waitText(A.page, 'Disconnected '));
  await P.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[P4] the disconnected phone is signed out and loses its device key', await waitText(P.page, 'disconnected by the admin', 15000) && !(await ls(P.page, 'bnlex.live.deviceKey')));
  const g4s = JSON.parse(await ls(G4.page, 'bnlex.live.session')), g4k = JSON.parse(await ls(G4.page, 'bnlex.live.deviceKey'));
  ok('[P4] the same leadman\'s other phone keeps working (PIN unchanged)', B.raw({ action: 'load', token: g4s.token, deviceKey: g4k }).ok);
  await P.ctx.close();

  // [P5] Audit rows deleted from the end → warning on the admin screen
  const AL = B.sheets.AuditLog;
  AL.data.splice(AL.getLastRow() - 2, 2); B.env.CACHE = {};
  B.call({ action: 'login', pin: '0000', device: 'test-admin' });
  await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[P5] admin screen warns that audit entries were deleted', await waitText(A.page, 'Audit log tampering detected', 15000) && !B.env.verifyAuditLog().ok);
  B.env.resetAuditCheckpoint();

  // Admin edits roster; the phone picks it up on refresh.
  await A.page.getByRole('button', { name: /Segment 10 Scupper Drain/ }).first().click();
  await A.page.fill('input[placeholder="New crew member full name"]', 'Juan Dela Cruz');
  await click(A.page, '+ Add to crew');
  ok('admin adds crew via backend', await waitText(A.page, 'Juan Dela Cruz added') && !!B.env.row_('Roster', 'team2-juan-dela-cruz'));

  // ── Epoxy 2: fixed after the roster refresh; then an expired session with work queued ──
  await click(G4.page, 'Submit attendance (7/7)');
  ok('after the roster refresh the attendance goes through', await waitText(G4.page, 'Attendance submitted and saved') && B.env.readAll_('Attendance').filter(a => a.teamId === 'team4').length === 7);
  await G4.ctx.setOffline(true);
  await G4.page.click('button[aria-label="Mark Ivan Cabunag not present"]');
  await G4.page.locator('[aria-label="Reason for Ivan Cabunag"]').getByRole('button', { name: 'Sick', exact: true }).click();
  G4.page.onDialog = d => d.accept('Ivan sent home sick');
  await click(G4.page, 'Update attendance');
  ok('attendance change queued while offline', await waitText(G4.page, 'Attendance: Pending sync'));
  const g4sid = JSON.parse(Buffer.from(JSON.parse(await ls(G4.page, 'bnlex.live.session')).token.split('.')[0], 'base64url').toString()).s;
  B.env.upsert_('Sessions', g4sid, { expiresAt: String(Date.now() - 1000) });
  await G4.ctx.setOffline(false);
  await G4.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('[3] expired session: phone asks for the PIN, queued change kept', await waitText(G4.page, 'Enter your 4-digit PIN', 10000) && (await ls(G4.page, 'bnlex.live.outbox') || '').includes('att|team4'));
  await pin(G4.page, '4444');
  await waitText(G4.page, "Start today's report");
  await click(G4.page, "Start today's report");
  ok('after signing in again the queued change is sent, with its reason', await waitText(G4.page, 'Attendance submitted and saved', 15000) && B.env.readAll_('Attendance').find(a => a.name === 'Ivan Cabunag').status === 'Sick' && /Ivan sent home sick/.test(attUpd().reason));

  // ── Epoxy 2 report: a refused required photo blocks confirmation; then a server that never answers ──
  await G4.page.getByRole('tab', { name: /Activity/ }).click();
  await fillForm(G4.page, 'CANDABA VIADUCT North bound');
  await G4.page.fill('label:has-text("Actual manpower") input', '6');
  await G4.page.fill('textarea[aria-label="Remarks"]', 'Scaffolding continues tomorrow');
  faults.uploadPhoto = 'refuse';
  await photoFile(G4.page, 'Upload Before Work photo', 'IMG_4001.jpg');
  ok('refused photo marked "Refused — retake" (not retried)', await waitText(G4.page, 'Refused — retake'));
  await click(G4.page, 'Submit report');
  ok('failed required photo blocks confirmation: "Not accepted", nothing submitted', await waitText(G4.page, 'Report: Not accepted by the server', 15000) && (await text(G4.page)).includes('Add a Before Work photo') && report('team4').state !== 'submitted');
  await G4.page.click('button[aria-label="Remove Before Work photo"]');
  faults.uploadPhoto = 'drop';
  await photoFile(G4.page, 'Upload Before Work photo', 'IMG_4002.jpg');
  ok('duplicate upload: server saved the photo but the answer was lost → phone shows it as not uploaded', await waitText(G4.page, 'Upload failed') && B.env.readAll_('Photos').filter(p => p.teamId === 'team4').length === 1);
  await G4.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('…the retry gets the same photo back: still ONE photo on the server', await waitText(G4.page, 'Before photo uploaded', 10000) && B.env.readAll_('Photos').filter(p => p.teamId === 'team4').length === 1);
  calls.submitReport = 0;
  faults.submitReport = 'hang';
  await click(G4.page, 'Submit report');
  ok('timeout: after 120 s with no answer the phone says NOT confirmed, keeps it Pending sync', await waitText(G4.page, 'did not answer in time', 140000) && (await text(G4.page)).includes('Report: Pending sync') && !(await text(G4.page)).includes('Report submitted at'));
  ok('…the server had in fact saved it once', report('team4').state === 'submitted' && report('team4').version === '1');
  await G4.page.getByRole('button', { name: 'Send now' }).click();
  ok('re-send after the timeout is recognised: confirmed, still version 1 (no duplicate)', await waitText(G4.page, 'Report submitted at', 15000) && report('team4').version === '1' && calls.submitReport === 2);

  // ── Phone set to another time zone with a clock 3 days fast ─────────────
  const Z = await device({ width: 390, height: 844 }, 'America/Los_Angeles');
  let clockSet = true;
  try { await Z.page.clock.setSystemTime(new Date(Date.now() + 3 * 86400000)); } catch (e) { clockSet = false; }
  await Z.page.goto(SETUP());
  await pin(Z.page, '1111');
  await waitText(Z.page, "Start today's report");
  await click(Z.page, "Start today's report");
  ok('wrong phone time zone/clock: the operational date shown is the Manila server date', clockSet && await waitText(Z.page, manilaLong(today), 10000), manilaLong(today));
  await Z.page.getByRole('tab', { name: /Attendance/ }).click();
  await click(Z.page, 'Mark rest present');
  await click(Z.page, 'Submit attendance (8/8)');
  ok('…and records are dated by the server (Manila), not the phone', await waitText(Z.page, 'Attendance submitted at') && report('team1').attendanceSubmittedAt.startsWith(today));

  // ── Refresh during sync: the phone reloads while its request is on the way ──
  const updates1 = () => B.env.readAll_('AuditLog').filter(a => a.action === 'attendance updated' && a.teamId === 'team1').length;
  const u0 = updates1();
  await Z.page.click('button[aria-label="Mark Joven Blanza not present"]');
  await Z.page.locator('[aria-label="Reason for Joven Blanza"]').getByRole('button', { name: 'Sick', exact: true }).click();
  Z.page.onDialog = d => d.accept('Joven felt sick');
  faults.saveAttendance = 'slow';
  await click(Z.page, 'Update attendance');
  await Z.page.waitForTimeout(100);
  await Z.page.reload();
  await Z.page.getByRole('tab', { name: /Attendance/ }).click();
  ok('refresh during sync: after reload the phone shows it confirmed', await until(async () => (await text(Z.page)).includes('Attendance submitted at') && !(await text(Z.page)).includes('Pending sync') && !(await text(Z.page)).includes('Syncing'), 15000));
  await Z.page.waitForTimeout(1500);
  ok('…and the server applied it exactly once', updates1() === u0 + 1 && B.env.readAll_('Attendance').find(a => a.name === 'Joven Blanza').status === 'Sick' && !(await ls(Z.page, 'bnlex.live.outbox') || '').includes('att|team1'), updates1() - u0);

  // ── Account switch with a pending queue ─────────────────────────────────
  await Z.ctx.setOffline(true);
  await Z.page.click('button[aria-label="Mark Joven Blanza present"]');
  Z.page.onDialog = d => d.accept('Joven is back');
  await click(Z.page, 'Update attendance');
  ok('leadman queues a change offline', await waitText(Z.page, 'Attendance: Pending sync'));
  Z.page.onDialog = d => d.accept();
  await click(Z.page, 'Log out');
  await Z.ctx.setOffline(false);
  await waitText(Z.page, 'Enter your 4-digit PIN');
  await pin(Z.page, '0000');
  ok('another user signs in on the same phone: clear warning about the first user\'s unsent work', await waitText(Z.page, 'This phone holds 1 unsent report/attendance record from Pijay Tanjeco (Bridge RM_Team 1)'));
  await click(Z.page, 'Open command center');
  await Z.page.waitForTimeout(2000);
  ok('…and it is NOT sent with the other user\'s sign-in', B.env.readAll_('Attendance').find(a => a.name === 'Joven Blanza').status === 'Sick' && (await ls(Z.page, 'bnlex.live.outbox') || '').includes('att|team1'));
  Z.page.onDialog = d => d.accept();
  await click(Z.page, 'Log out');
  await waitText(Z.page, 'Enter your 4-digit PIN');
  await pin(Z.page, '1111');
  await waitText(Z.page, "Start today's report");
  await click(Z.page, "Start today's report");
  ok('when the original leadman signs in again, the queued change is sent (with its reason)', await until(() => B.env.readAll_('Attendance').find(a => a.name === 'Joven Blanza').status === 'Present', 15000) && /Joven is back/.test(attUpd().reason));
  ok('Z: no page errors', Z.page.errors.length === 0, Z.page.errors.join(' | '));
  await Z.ctx.close();

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

  // ── Damaged / hand-edited data saved on the phone ───────────────────────
  // The admin reopens the report (server: draft v2 with all fields); the phone's saved draft is damaged.
  B.call({ action: 'reopenReport', token: adminTok, teamId: 'team2', reportDate: today, reason: 'Admin check', baseRev: report().rev });
  await L.page.evaluate(t => {
    localStorage.setItem('bnlex.v3.day.' + t, JSON.stringify({ forms: { team2: { location: 5, details: '' } }, draftAt: { team2: '9:00 AM' }, att: { team2: [1, 2] }, photos: { team2: { before: 5 } }, attAt: { team2: { x: 1 } }, rev: { team2: 7 } }));
    localStorage.setItem('bnlex.live.outbox', '{"bad|key":{"x":1}}');
    localStorage.setItem('bnlex.v3.roster', 'not json');
    localStorage.setItem('bnlex.live.teams', '5');
    localStorage.setItem('bnlex.live.base', '[1,2]');
  }, today);
  await L.page.reload();
  ok('corrupted local data: app still opens and warns', await waitText(L.page, 'damaged'));
  ok('…the damaged draft is NOT turned into an empty report: the server copy is shown', await until(async () => await L.page.inputValue('input[placeholder^="e.g. CANDABA"]') === 'Km.11+000 to km.10+000 C3 exit ramp') && report().location === 'Km.11+000 to km.10+000 C3 exit ramp');
  ok('…and a copy of the damaged data is kept for recovery', /day\.|roster|outbox/.test(await ls(L.page, 'bnlex.quarantine') || ''));

  // ── Sign out ────────────────────────────────────────────────────────────
  const tok = JSON.parse(await ls(L.page, 'bnlex.live.session')).token, lDk = JSON.parse(await ls(L.page, 'bnlex.live.deviceKey'));
  await click(L.page, 'Log out');
  ok('logout returns to PIN screen', await waitText(L.page, 'Enter your 4-digit PIN'));
  await L.page.waitForTimeout(300);
  ok('logout revoked the session on the server', B.raw({ action: 'load', token: tok, deviceKey: lDk }).auth === true);
  await L.page.reload();
  ok('logged out stays logged out after reload', await waitText(L.page, 'Enter your 4-digit PIN'));

  for (const d of [L, A, E, G4]) ok('no page errors', d.page.errors.length === 0, d.page.errors.join(' | '));
} catch (e) {
  failed++; console.log('ERROR ' + (e && e.stack || e));
} finally {
  await browser.close(); srv.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
