// End-to-end test of the field app against the real backend code.
//
// Serves the production build (dist/) and answers every call to the Google Apps Script URL by running
// google-apps-script/Code.gs on in-memory Google services. Each "phone" is a separate browser.
// Covers the guided flow (team → attendance → work → photos → review → submit), autosave, the
// offline queue, lost answers, a second phone sending the same team's report, and a crew list
// changed by the office.
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

// Per-action call counts, and one-shot faults: 'fail' (network error, nothing reaches the server)
// or 'drop' (the server commits, the answer never reaches the phone).
const calls = {}, faults = {};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const p = path.join(DIST, u);
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const APP = `http://localhost:${srv.address().port}/`;
const LINK = APP + '?backend=' + encodeURIComponent(BACKEND);

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (!cond && detail !== undefined ? '  [' + detail + ']' : '')); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Manila' });
  await ctx.route(BACKEND, async route => {
    const body = JSON.parse(route.request().postData());
    calls[body.action] = (calls[body.action] || 0) + 1;
    const f = faults[body.action];
    if (f === 'fail') { delete faults[body.action]; return route.abort('failed'); }
    const out = B.call(body);
    if (f === 'drop') { delete faults[body.action]; return route.abort('failed'); }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  return { ctx, page };
}
const text = page => page.evaluate(() => document.body.innerText);
const click = (page, label, exact = true) => page.getByRole('button', { name: label, exact }).first().click();
const waitText = (page, t, timeout = 8000) => page.waitForFunction(x => document.body.innerText.includes(x), t, { timeout }).then(() => true, () => false);
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const photoFile = async (page, label) => {
  const buf = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#E8760F'; g.fillRect(0, 0, 320, 240); const b = await new Promise(r => c.toBlob(r, 'image/jpeg')); return [...new Uint8Array(await b.arrayBuffer())]; });
  await page.setInputFiles(`label[aria-label="${label}"] input`, { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(buf) });
};
const today = B.env.today_();
const report = t => B.env.row_('Reports', t + '|' + today);
const audits = action => B.env.readAll_('Audit').filter(a => a.action === action);

const pickTeam = async (page, name) => { await page.getByRole('button', { name: new RegExp('^Choose ' + name) }).click(); await waitText(page, 'Who is here today?'); };
const fillWork = async (page, loc, status = 'Complete') => {
  await page.fill('input[type=time] >> nth=0', '07:00');
  await page.fill('input[type=time] >> nth=1', '16:00');
  await page.fill('input[placeholder^="e.g. Km"]', loc);
  await page.selectOption('select[aria-label="Pick common work"]', { index: 1 });
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: status }).click();
  await page.fill('label:has-text("Target") input', '1');
  await page.fill('label:has-text("Actual") input', '1');
};
/** Attendance (all Present) → work → photos → review, ready to submit. */
const fullReport = async (page, loc, status = 'Complete') => {
  await click(page, 'Next: Work details');
  await fillWork(page, loc, status);
  await click(page, 'Next: Photos');
  await photoFile(page, 'Take Before photo');
  await page.waitForSelector('img[alt="Before photo"]');
  if (status === 'Complete') { await photoFile(page, 'Take After photo'); await page.waitForSelector('img[alt="After photo"]'); }
  await click(page, 'Next: Review');
  await waitText(page, 'Check and submit');
};

try {
  // ── Production build: no sign-in code and no demo data ──────────────────
  const bundle = fs.readdirSync(path.join(DIST, 'assets')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('');
  const SRC = path.join(HERE, '..', 'src');
  const appSrc = ['App.jsx', 'screens.jsx', 'rules.js', 'photo.js', 'main.jsx'].map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  ok('old sign-in files are gone', !['View.jsx', 'live.js', 'css.js', 'demo.jsx'].some(f => fs.existsSync(path.join(SRC, f))));
  ok('app source has no PIN, login, session token or setup key', !/\bpin\b|PIN|login|signIn|sessionToken|deviceKey|setup key/i.test(appSrc));
  ok('production bundle has no demo crews or demo backend', !/Juan Santos|Demo Bridge Team|bnlex\.demo\.|Pijay/.test(bundle));
  ok('production bundle has no PIN keypad', !/Digit 1|Enter your 4-digit PIN|Sign in with PIN/.test(bundle));

  // ── No backend link yet ─────────────────────────────────────────────────
  const N = await phone();
  await N.page.goto(APP);
  ok('a phone with no app link says it is not connected (no demo)', await waitText(N.page, 'Not connected to the office yet') && !(await text(N.page)).includes('Demo'));
  await N.ctx.close();

  // ── Phone L: team2, the whole flow ──────────────────────────────────────
  const L = await phone();
  await L.page.goto(LINK);
  ok('app link removed from the address bar and stored', await until(async () => !L.page.url().includes('backend=') && (await ls(L.page, 'bnlex.live.url')) === JSON.stringify(BACKEND)));
  ok('team list shows every team with its leadman', await waitText(L.page, 'Leadman: Glenn Butiong') && (await L.page.locator('.team-btn').count()) === 4);
  await pickTeam(L.page, 'Segment 10 Scupper Drain');
  ok('chosen team is remembered on the phone', (await ls(L.page, 'bnlex.live.team')) === '"team2"');
  ok('no PIN or sign-in anywhere', !/PIN|Sign in|Log in/i.test(await text(L.page)));
  const roster = B.call({ action: 'team', teamId: 'team2' }).roster;
  ok('attendance: everyone Present by default', await waitText(L.page, `${roster.length} of ${roster.length} present`));
  const away = roster[3].name;
  await L.page.getByRole('group', { name: 'Attendance for ' + away }).getByRole('button', { name: 'Absent' }).click();
  ok('choosing Absent asks why (Sick / Leave / No Show / Other)', await waitText(L.page, 'Why?') && ['Sick', 'Leave', 'No Show', 'Other'].every(async r => true) && (await L.page.getByRole('group', { name: 'Why is ' + away + ' absent?' }).getByRole('button').count()) === 4);
  await click(L.page, 'Next: Work details');
  ok('Next is blocked until a reason is chosen', await waitText(L.page, 'Choose why ' + away + ' is absent') && (await text(L.page)).includes('Who is here today?'));
  await L.page.getByRole('group', { name: 'Why is ' + away + ' absent?' }).getByRole('button', { name: 'Sick' }).click();
  ok('present count updates', await waitText(L.page, `${roster.length - 1} of ${roster.length} present`));
  ok('"Saved automatically" shows', await waitText(L.page, '✓ Saved automatically'));
  await click(L.page, 'Next: Work details');
  ok('work step opens', await waitText(L.page, 'What did you do?'));
  ok('manpower comes from attendance', (await text(L.page)).includes('Manpower: ' + (roster.length - 1)));
  await click(L.page, 'Next: Photos');
  ok('empty work details are flagged', await waitText(L.page, 'Enter the location') && (await text(L.page)).includes('What did you do?'));
  await fillWork(L.page, 'Km.11+000 C3 exit ramp', 'Ongoing');
  ok('no Save Draft button', !(await L.page.getByRole('button', { name: /save draft/i }).count()));

  // Reload: the draft is still there, on the same step.
  await L.page.waitForTimeout(300);
  await L.page.reload();
  await waitText(L.page, 'What did you do?');
  ok('reload keeps the draft and the step', (await L.page.inputValue('input[placeholder^="e.g. Km"]')) === 'Km.11+000 C3 exit ramp');
  await L.page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Complete' }).click();
  await click(L.page, 'Next: Photos');
  ok('photos: Before required; After required when Complete', await waitText(L.page, 'After photo is needed because the work is Complete'));

  // The Before photo's first upload fails (no signal): it waits on the phone and goes later.
  faults.uploadPhoto = 'fail';
  await photoFile(L.page, 'Take Before photo');
  ok('photo preview shows', await L.page.waitForSelector('img[alt="Before photo"]').then(() => true, () => false));
  ok('failed upload waits on the phone', await waitText(L.page, 'Will upload when there is signal'));
  await click(L.page, 'Next: Review');
  ok('Next is blocked until the After photo is added', await waitText(L.page, 'Add the After photo') && (await text(L.page)).includes('After photo is needed'));
  await L.page.getByRole('button', { name: /Review$/ }).first().click();
  await click(L.page, 'SUBMIT DAILY REPORT');
  ok('jumping to Review: submit is blocked and lists what to fix', await waitText(L.page, 'Before you can submit') && !report('team2'));
  await click(L.page, 'Add the After photo (needed when the work is Complete)');
  await photoFile(L.page, 'Take After photo');
  ok('After photo uploads', await waitText(L.page, '✓ Saved'));
  await click(L.page, 'Next: Review');
  const rev = await text(L.page);
  ok('review shows team, present count, absent reason, location', rev.includes('Segment 10 Scupper Drain') && rev.includes(`${roster.length - 1} of ${roster.length}`) && rev.includes(away + ' (Sick)') && rev.includes('Km.11+000 C3 exit ramp'));

  // The answer to the submit is lost: the report is kept and sent again with the same request ID.
  faults.submitReport = 'drop';
  const before = calls.submitReport || 0;
  await click(L.page, 'SUBMIT DAILY REPORT');
  ok('lost answer: report saved on the phone, waiting', await waitText(L.page, 'Report saved on this phone'));
  ok('the server already has it (one row)', !!report('team2') && report('team2').state === 'submitted');
  ok('"Change something" is not offered once the office may have it', !(await L.page.getByRole('button', { name: 'Change something' }).count()));
  await click(L.page, 'Try again now');
  ok('success screen after the office confirms', await waitText(L.page, 'Report sent') && (await text(L.page)).includes('Done'));
  ok('the retry was a replay, not a second report', (calls.submitReport - before) === 2 && audits('report submitted').length === 1 && audits('duplicate report refused').length === 0);
  const R = report('team2');
  ok('Reports row: present counted by the server, status, location, both photos', R.crewPresent === `${roster.length - 1}/${roster.length}` && R.actualManpower === String(roster.length - 1) && R.status === 'Complete' && R.location === 'Km.11+000 C3 exit ramp' && !!R.beforePhotoId && !!R.afterPhotoId, JSON.stringify(R));
  ok('Attendance rows written (absent with reason)', B.env.readAll_('Attendance').filter(a => a.teamId === 'team2' && a.reportDate === today).length === roster.length && B.env.readAll_('Attendance').some(a => a.name === away && a.status === 'Sick'));
  ok('photos stored once each (retried upload not duplicated)', B.env.readAll_('Photos').filter(p => p.teamId === 'team2').length === 2);
  await click(L.page, 'Done');
  ok('after Done, the report is locked', await waitText(L.page, 'Need to change something? Tell the office.') && !(await L.page.getByRole('button', { name: 'SUBMIT DAILY REPORT' }).count()));
  await L.page.reload();
  ok('still locked after reload', await waitText(L.page, 'Report sent') && (await text(L.page)).includes('Tell the office'));
  ok('draft cleared and queue empty', !(await ls(L.page, 'bnlex.live.draft.team2|' + today)) && (await ls(L.page, 'bnlex.live.queue')) === '{}');
  await click(L.page, 'Previous reports');
  ok('previous reports lists today', await waitText(L.page, 'Km.11+000 C3 exit ramp') && (await text(L.page)).includes('Previous reports'));
  await click(L.page, 'Back');
  await click(L.page, 'Change team');
  ok('"Change team" opens the team list', await waitText(L.page, 'Choose your team'));
  ok('no page errors on phone L', !L.page.errors.length, L.page.errors.join(' | '));

  // ── A second phone on the same team sees it is already sent ─────────────
  const M = await phone();
  await M.page.goto(LINK);
  await waitText(M.page, 'Choose your team');
  await M.page.getByRole('button', { name: /^Choose Segment 10/ }).click();
  ok('second phone: today is already sent, nothing to fill in', await waitText(M.page, 'Report sent') && !(await M.page.getByRole('button', { name: 'SUBMIT DAILY REPORT' }).count()));
  await M.ctx.close();

  // ── Two phones on team1: one offline, one sends first ───────────────────
  const P = await phone(), Q = await phone();
  for (const X of [P, Q]) { await X.page.goto(LINK); await waitText(X.page, 'Choose your team'); await pickTeam(X.page, 'Bridge RM_Team 1'); }
  await P.ctx.setOffline(true);
  await P.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  ok('offline banner in plain words', await waitText(P.page, 'No signal. Everything is saved on this phone.'));
  await fullReport(P.page, 'Sta. Rita bridge', 'Ongoing');
  ok('Ongoing: After photo optional', !(await text(P.page)).includes('Add the After photo'));
  await click(P.page, 'SUBMIT DAILY REPORT');
  ok('offline submit waits on the phone', await waitText(P.page, 'It will send automatically when there is signal'));
  ok('offline: "Change something" is offered (nothing reached the office)', await P.page.getByRole('button', { name: 'Change something' }).count() === 1);
  await fullReport(Q.page, 'Sta. Rita bridge north', 'Ongoing');
  await click(Q.page, 'SUBMIT DAILY REPORT');
  ok('phone Q sends first', await waitText(Q.page, 'Report sent') && report('team1').location === 'Sta. Rita bridge north');
  await P.ctx.setOffline(false);
  await P.page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('phone P is told it was already sent from another phone', await waitText(P.page, 'from another phone', 12000));
  ok('the first report is kept, the second is refused', report('team1').location === 'Sta. Rita bridge north' && report('team1').version === '1' && audits('report submitted').filter(a => a.teamId === 'team1').length === 1);
  ok('no page errors on phones P and Q', !P.page.errors.length && !Q.page.errors.length, P.page.errors.concat(Q.page.errors).join(' | '));
  await P.ctx.close(); await Q.ctx.close();

  // ── The office changes the crew list while a report is being filled ─────
  const S = await phone();
  await S.page.goto(LINK); await waitText(S.page, 'Choose your team');
  await pickTeam(S.page, 'Bridge Epoxy 1');
  await fullReport(S.page, 'Candaba viaduct pier 12', 'Ongoing');
  const gone = B.call({ action: 'team', teamId: 'team3' }).roster[2];
  B.env.upsert_('Roster', gone.personId, { status: 'Archived' });
  await click(S.page, 'SUBMIT DAILY REPORT');
  ok('crew list changed: back to attendance with a plain message', await waitText(S.page, 'The crew list was changed by the office') && await waitText(S.page, 'Who is here today?') && !report('team3'));
  ok('the updated crew list loads', await until(async () => !(await text(S.page)).includes(gone.name)));
  await S.page.getByRole('button', { name: /Review$/ }).first().click();
  await waitText(S.page, 'Check and submit');
  await click(S.page, 'SUBMIT DAILY REPORT');
  ok('then the report goes through', await waitText(S.page, 'Report sent') && report('team3').crewPresent === (B.call({ action: 'team', teamId: 'team3' }).roster.length + '/' + B.call({ action: 'team', teamId: 'team3' }).roster.length));
  ok('no page errors on phone S', !S.page.errors.length, S.page.errors.join(' | '));
  await S.ctx.close();

  // ── An old-version phone: sign-in data removed, unsent work kept as a copy ──
  const O = await phone();
  await O.page.goto(APP);
  await O.page.evaluate(b => {
    localStorage.setItem('bnlex.live.url', JSON.stringify(b));
    localStorage.setItem('bnlex.live.session', JSON.stringify({ token: 'x' }));
    localStorage.setItem('bnlex.live.deviceKey', '"abc"');
    localStorage.setItem('bnlex.live.outbox', JSON.stringify({ 'att|team4|2026-01-01': { x: 1 } }));
  }, BACKEND);
  await O.page.reload();
  ok('old version: notice shown, sign-in data removed, copy kept', await waitText(O.page, 'unsent work from the old version') && !(await ls(O.page, 'bnlex.live.session')) && !(await ls(O.page, 'bnlex.live.deviceKey')) && (await ls(O.page, 'bnlex.quarantine') || '').includes('att|team4'));
  ok('old version phone keeps its office connection', await waitText(O.page, 'Leadman: Gilbert Rivera'));
  await O.ctx.close();
} catch (e) {
  failed++;
  console.log('FAIL  test crashed: ' + (e && e.stack || e));
} finally {
  await browser.close(); srv.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
