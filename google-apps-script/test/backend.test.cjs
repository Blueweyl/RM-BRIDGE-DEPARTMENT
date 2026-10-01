// Runs the real Code.gs against in-memory Google services, including the adversarial cases
// from the production audit (forged team, role escalation, bad tokens, replays, conflicts...).
// Usage: node google-apps-script/test/backend.test.cjs
const crypto = require('crypto');
const { makeBackend } = require('./fake-gas.cjs');

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && !cond ? '  [' + detail + ']' : '')); };
// Real images (64×48, made by a browser canvas like the app does).
const FIX = require('path').join(__dirname, 'fixtures'), fs0 = require('fs');
const jpegBytes = fs0.readFileSync(FIX + '/tiny.jpeg'), pngBytes = fs0.readFileSync(FIX + '/tiny.png'), webpBytes = fs0.readFileSync(FIX + '/tiny.webp');
const img = 'data:image/jpeg;base64,' + jpegBytes.toString('base64');
const uid = () => crypto.randomUUID();
const DEMO_PINS = ['0000', '1111', '2222', '3333', '4444'];   // fixed PINs for tests only (admin, team1..team4)

const B = makeBackend();
B.env.setup({ pins: DEMO_PINS }); B.env.setup({ pins: DEMO_PINS });
const call = B.call;
const today = B.env.today_(), yesterday = B.env.yesterday_();

// ── Setup ───────────────────────────────────────────────────────────────
const TABS = ['Users', 'Teams', 'Roster', 'Attendance', 'DailyReports', 'Photos', 'Revisions', 'AuditLog', 'Sessions'];
ok('setup creates all tabs', TABS.every(n => B.sheets[n]), Object.keys(B.sheets).join());
ok('setup is safe to re-run (5 users, 4 teams, 34 roster rows)', B.sheets.Users.getLastRow() === 6 && B.sheets.Teams.getLastRow() === 5 && B.sheets.Roster.getLastRow() === 35, B.sheets.Roster.getLastRow());
ok('PINs are stored hashed, never as digits', B.env.readAll_('Users').every(u => /^h:/.test(u.pin)));
const R = makeBackend(); const rs = R.env.setup();
const rp = Object.values(rs.pins);
ok('real setup makes 5 different random PINs, none of the demo ones', rp.length === 5 && new Set(rp).size === 5 && rp.every(p => /^\d{4}$/.test(p) && !['0000', '1111', '2222', '3333', '4444'].includes(p)), rp.join());
ok('secrets created', ['TOKEN_SECRET', 'PIN_SECRET', 'DEVICE_SECRET', 'AUDIT_SECRET'].every(k => (B.props[k] || '').length > 40));
ok('no reusable shared setup key is kept', !B.props.SETUP_KEY && !B.props.SETUP_KEY_EXPIRES);

// ── Auth ────────────────────────────────────────────────────────────────
ok('[3] no token → sign in again', call({ action: 'load' }).auth === true);
ok('[3] fake token rejected', call({ action: 'load', token: 'abc.def' }).auth === true);
ok('enrol with wrong setup key refused', B.raw({ action: 'enroll', setupKey: 'wrong' }).notSetUp === true);
ok('login without device key refused', B.raw({ action: 'login', pin: '0000' }).notSetUp === true);
ok('login with forged device key refused', B.raw({ action: 'login', pin: '0000', deviceKey: 'eyJkIjoieCJ9.abc' }).notSetUp === true);
let r = call({ action: 'login', pin: '9999', device: 'phoneA' });
ok('wrong PIN rejected', !r.ok && r.wrongPin);
const admin = call({ action: 'login', pin: '0000', device: 'pc' });
const lead2 = call({ action: 'login', pin: '2222', device: 'phoneB' });
const lead3 = call({ action: 'login', pin: '3333', device: 'phoneC' });
ok('admin login', admin.ok && admin.user.role === 'admin');
ok('leadman login is bound to team', lead2.ok && lead2.user.role === 'leadman' && lead2.user.teamId === 'team2' && lead2.user.name === 'Glenn Butiong');
ok('session row stored server-side', B.env.readAll_('Sessions').filter(x => x.userId === 'lead-team2').length === 1);
for (let i = 0; i < 5; i++) call({ action: 'login', pin: '1234', device: 'brute' });
ok('after 5 wrong PINs the phone is locked, even with a correct PIN', /Too many/.test(call({ action: 'login', pin: '1111', device: 'brute' }).error || ''));
ok('other phones unaffected by that lock', call({ action: 'login', pin: '1111', device: 'phoneA' }).ok);
// ── Leadmen sign in by tapping their name (no PIN) ──────────────────────
ok('name list refused without a set-up phone', B.raw({ action: 'crews' }).notSetUp === true);
const crewList = B.raw({ action: 'crews', deviceKey: B.deviceKey('tapPhone') });
ok('name list: every active leadman with their team, no admin, no PINs', crewList.ok && crewList.crews.length === 4 && crewList.crews.every(c => c.userId && c.name && c.team && !('pin' in c)) && !crewList.crews.some(c => c.userId === 'admin'), JSON.stringify(crewList));
const tap = B.raw({ action: 'login', userId: crewList.crews.find(c => c.teamId === 'team2').userId, deviceKey: B.deviceKey('tapPhone') });
ok('leadman signs in by tapping their name', tap.ok && tap.user.role === 'leadman' && tap.user.teamId === 'team2', JSON.stringify(tap));
ok('tapping works even when the phone is locked by wrong PINs', B.raw({ action: 'login', userId: crewList.crews[0].userId, deviceKey: B.deviceKey('brute') }).ok);
ok('admin cannot be signed in without a PIN', !B.raw({ action: 'login', userId: 'admin', deviceKey: B.deviceKey('tapPhone') }).ok);
ok('tap sign-in needs a set-up phone', B.raw({ action: 'login', userId: crewList.crews[0].userId }).notSetUp === true);
ok('changing the device name in the request does not dodge the lock', /Too many/.test(B.raw({ action: 'login', pin: '1111', deviceKey: B.deviceKey('brute'), device: 'other' }).error || ''));

const T = { admin: admin.token, t2: lead2.token, t3: lead3.token };

// [3] expired / tampered tokens
const [body] = T.t2.split('.');
const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
const sign = o => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', B.props.TOKEN_SECRET).update(b).digest('base64url'); };
ok('[3] expired token rejected (even when correctly signed)', call({ action: 'load', token: sign({ ...payload, exp: Date.now() - 1000 }) }).auth === true);
ok('[3] token for another user is rejected', call({ action: 'load', token: body.replace(/.$/, 'x') + '.' + T.t2.split('.')[1] }).auth === true);
ok('[3] signed token pointing at another user\'s session rejected', call({ action: 'load', token: sign({ ...payload, u: 'admin' }) }).auth === true);
B.env.upsert_('Sessions', payload.s, { expiresAt: String(Date.now() - 1) });
ok('[3] server-side session expiry enforced', call({ action: 'load', token: T.t2 }).auth === true);
B.env.upsert_('Sessions', payload.s, { expiresAt: String(Date.now() + 3600e3) });
ok('session works again once valid', call({ action: 'load', token: T.t2 }).ok);

// ── Sessions are bound to the phone that signed in (stolen token) ───────
r = B.raw({ action: 'load', token: T.t2 });
ok('[3] stolen token without the phone\'s device key refused', r.auth === true);
r = B.raw({ action: 'load', token: T.t2, deviceKey: B.deviceKey('someOtherPhone') });
ok('[3] stolen token used with another enrolled phone\'s key refused', r.auth === true);
ok('[3] stolen-token attempt written to the audit log', B.env.readAll_('AuditLog').some(a => a.action === 'DENIED session used from another device' && a.user === 'Glenn Butiong'));
ok('sessions are short: leadman 72 h, admin 8 h', Math.abs(lead2.expiresAt - Date.now() - 72 * 3600e3) < 60e3 && Math.abs(admin.expiresAt - Date.now() - 8 * 3600e3) < 60e3);

// ── [1] forged teamId / [2] leadman calling admin endpoints ─────────────
let L = call({ action: 'load', token: T.t2 });
ok('leadman load only returns own team', L.ok && L.teams.length === 1 && L.teams[0].teamId === 'team2' && L.roster.every(m => m.teamId === 'team2') && L.roster.length === 9);
ok('leadman does not get the Sheet link', L.sheetUrl === '');
const A = call({ action: 'load', token: T.admin });
ok('admin load returns all 4 teams + roster', A.teams.length === 4 && A.roster.length === 34 && A.sheetUrl.includes('SHEETID'));
const allPresent = roster => roster.map(m => ({ personId: m.personId, status: 'Present' }));
r = call({ action: 'saveAttendance', token: T.t3, teamId: 'team2', reportDate: today, people: [], baseRev: '0' });
ok('[1] leadman cannot write another team (forged teamId)', r.denied && /own team/.test(r.error));
ok('[1] forged teamId is written to the audit log', B.env.readAll_('AuditLog').some(a => a.action === 'DENIED team access' && a.user === 'Allan Miranda'));
ok('[1] forged teamId on upload refused', call({ action: 'uploadPhoto', token: T.t3, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, clientId: uid() }).denied === true);
for (const [action, extra] of [['addMember', { teamId: 'team2', name: 'X' }], ['archiveMember', { personId: 'team2-abraham-balmeo' }], ['restoreMember', { personId: 'x' }],
  ['exportCsv', {}], ['adminReports', {}], ['revisions', { reportId: 'x' }], ['auditLog', {}]]) {
  ok(`[2] leadman cannot call ${action}`, /Admin only/.test(call({ action, token: T.t2, ...extra }).error || ''));
}

// ── Attendance: explicit status for everyone ────────────────────────────
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people: L.roster.slice(1).map(m => ({ personId: m.personId, status: 'Present' })), baseRev: '0' });
ok('attendance refused while anyone is unverified', !r.ok && /Not verified: Glenn Butiong/.test(r.error), r.error);
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people: L.roster.map(m => ({ personId: m.personId, status: 'Here' })), baseRev: '0' });
ok('unknown status counts as unverified', !r.ok && /Not verified/.test(r.error));
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people: [...allPresent(L.roster), { personId: 'team3-elmer-dordulo', status: 'Present' }], baseRev: '0' });
ok('person from another team refused', !r.ok && /Unknown crew member/.test(r.error));
const people = L.roster.map(m => ({ personId: m.personId, status: m.name === 'Abraham Balmeo' ? 'Other' : m.name === 'Rolando Faustino' ? 'Leave' : 'Present' }));
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0' });
ok('"Other" without a note refused', !r.ok && /Abraham Balmeo/.test(r.error));
people.find(p => p.status === 'Other').note = 'Medical check-up';
const attReq = uid();
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0', requestId: attReq });
ok('attendance saved', r.ok && r.crewPresent === '7/9' && r.rev === '1' && /^R\d{8}-team2-/.test(r.reportId), JSON.stringify(r));
const reportId = r.reportId;
ok('[4] same attendance request replayed → no second write', call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0', requestId: attReq }).replay === true
  && B.env.row_('DailyReports', 'team2|' + today).rev === '1');
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0', requestId: uid() });
ok('[11] stale revision never locks the user (another device saved first, save goes through)', r.ok && !r.conflict, JSON.stringify(r));
ok('[9] future date refused', /future/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: '2099-01-01', people, baseRev: '0' }).error));
ok('[9] impossible date refused', /bad date/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: '2026-02-30', people, baseRev: '0' }).error));
ok('[9] old date locked for leadman', /locked/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: B.env.shiftDate_(today, -3), people, baseRev: '0' }).error));
ok('[11] conflict is written to the audit log', B.env.readAll_('AuditLog').some(a => a.action === 'CONFLICT attendance' && a.entityId === reportId));
const rev1 = () => B.env.row_('DailyReports', 'team2|' + today).rev;
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: rev1(), requestId: uid() });
ok('sending the same marks again changes nothing (no new revision)', r.ok && r.unchanged && rev1() === '1');
const ian = L.roster.find(m => m.name === 'Ian Enriquez').personId;
const people2 = people.map(p => p.personId === ian ? { ...p, status: 'Sick' } : p);
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people: people2, baseRev: rev1(), requestId: uid() });
ok('changing submitted attendance needs a reason', !r.ok && r.needReason && rev1() === '1', JSON.stringify(r));
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people: people2, baseRev: rev1(), requestId: uid(), reason: 'Ian went home sick at 9am' });
const attAudit = B.env.readAll_('AuditLog').filter(a => a.action === 'attendance updated').pop();
ok('attendance change audited: old value, new value, user (name + ID), server time, reason, revision', r.ok && rev1() === '2' && attAudit.user === 'Glenn Butiong' && attAudit.userId === 'lead-team2' && attAudit.rev === '2' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(attAudit.at)
  && JSON.parse(attAudit.before)['Ian Enriquez'].status === 'Present' && JSON.parse(attAudit.after)['Ian Enriquez'].status === 'Sick' && /Ian went home sick/.test(attAudit.reason), attAudit && JSON.stringify(attAudit));
ok('previous attendance kept as a revision', B.env.readAll_('Revisions').some(v => v.kind === 'attendance before update' && JSON.parse(v.snapshot).attendance.find(a => a.name === 'Ian Enriquez').status === 'Present'));
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: rev1(), requestId: uid(), reason: 'Ian came back after lunch' });
ok('attendance changed back (with reason)', r.ok && rev1() === '3');
// Request IDs are remembered per user: the answer to a retry is the first answer, even after later changes.
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0', requestId: attReq });
ok('[4][14] old request replayed after later changes → first answer back, nothing written', r.ok && r.replay && r.rev === '1' && rev1() === '3', JSON.stringify(r));
r = call({ action: 'saveAttendance', token: T.t3, teamId: 'team3', reportDate: today, people: [], baseRev: '0', requestId: attReq });
ok('another user cannot pick up someone else\'s cached answer', !r.replay && !r.ok);

// ── Photos ──────────────────────────────────────────────────────────────
const html = Buffer.from('<html><script>alert(1)</script></html>'.repeat(5)).toString('base64');
ok('HTML disguised as a JPEG refused (file bytes checked)', /not a real JPEG/.test(call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: 'data:image/jpeg;base64,' + html, clientId: uid() }).error || ''));
ok('JPEG declared as PNG refused', /not a real/.test(call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: 'data:image/png;base64,' + jpegBytes.toString('base64'), clientId: uid() }).error || ''));
ok('oversize photo refused', /too large/.test(call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([jpegBytes, Buffer.alloc(6.5 * 1024 * 1024)]).toString('base64'), clientId: uid() }).error || ''));
ok('non-image upload refused', !call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: 'data:text/html;base64,PGgxPg==', clientId: uid() }).ok);
ok('upload without client photo ID refused', !call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img }).ok);
const cBefore = uid();
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, originalFilename: 'IMG_0001.jpg', clientId: cBefore, capturedAt: today + ' 07:12', location: 'Km.11' });
ok('before photo uploaded to Drive with metadata', r.ok && r.photo.fileId && r.photo.reportId === reportId && r.photo.leadman === 'Glenn Butiong' && r.photo.capturedAt === today + ' 07:12' && r.photo.clientId === cBefore, JSON.stringify(r));
const beforeId = r.photo.photoId;
const f1 = B.files[r.photo.fileId];
ok('photo stored in date/team folder with report ID in description', f1.folder.name === 'Segment 10' && f1.blob.name.startsWith(today + '_Segment10_BEFORE_') && f1.access === 'private' && f1.description.includes(reportId));
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, clientId: cBefore });
ok('[4][7] retried upload returns the same photo, no duplicate', r.ok && r.replay && r.photo.photoId === beforeId && B.env.readAll_('Photos').filter(p => p.teamId === 'team2').length === 1);
ok('photo ID reused on another type refused', call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, clientId: cBefore }).denied === true);

// ── Report rules ────────────────────────────────────────────────────────
const form = { fromTime: '07:00', toTime: '16:00', location: 'Km.11+000 to km.10+020 C3 exit ramp', activityDetails: 'Cleaning of clogged scupper drain',
  status: 'Complete', target: '1', actual: '1', unit: 'KM', targetManpower: '8', actualManpower: '7', plateNumber: 'nku 8624', remarks: '=HYPERLINK("x")' };
const submit = (f, extra = {}) => call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: f, baseRev: B.env.row_('DailyReports', 'team2|' + today).rev, beforePhotoId: beforeId, afterPhotoId: '', requestId: uid(), ...extra });
r = submit(form);
ok('[10] Complete without After photo refused by server', !r.ok && r.missing.length === 1 && /After Work/.test(r.missing[0]), JSON.stringify(r.missing));
const bad = (name, f, re) => { const x = submit({ ...form, status: 'Ongoing', remarks: 'still working', ...f }); ok('[9] ' + name, !x.ok && x.missing && x.missing.some(m => re.test(m)), JSON.stringify(x.missing || x.error)); };
bad('from after to refused', { fromTime: '16:00', toTime: '07:00' }, /before "To"/);
bad('invalid time refused', { fromTime: '25:00' }, /valid From and To/);
bad('negative number refused', { actual: '-1' }, /actual as a number/);
bad('text in a number refused', { target: 'abc' }, /target as a number/);
bad('huge target refused', { target: '99999' }, /Target looks wrong/);
bad('huge manpower refused', { actualManpower: '500' }, /Actual manpower looks wrong/);
bad('fractional manpower refused', { targetManpower: '7.5' }, /whole number/);
bad('unknown status refused', { status: 'Done' }, /Ongoing or Complete/);
bad('unknown unit refused', { unit: 'Miles' }, /unit/);
bad('manpower above attendance needs remarks', { actualManpower: '9', remarks: '' }, /more than present/);
ok('[9] Ongoing without remarks refused', submit({ ...form, status: 'Ongoing', remarks: '' }).missing.some(m => /Ongoing/.test(m)));
ok('[9] actual below target without remarks refused', submit({ ...form, status: 'Ongoing', target: '3', actual: '1', remarks: '' }).missing.some(m => /below target/.test(m)));

const cAfter = uid();
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, originalFilename: 'IMG_0002.jpg', clientId: cAfter });
const afterId = r.photo.photoId;
const subReq = uid(), subRev = B.env.row_('DailyReports', 'team2|' + today).rev;
r = submit(form, { afterPhotoId: afterId, requestId: subReq, baseRev: subRev });
ok('report submitted', r.ok && r.version === '1' && r.submittedBy === 'Glenn Butiong' && r.reportId === reportId, JSON.stringify(r));
const repAfter = B.env.row_('DailyReports', 'team2|' + today);
ok('[4] duplicate submit with same request → replay, still version 1', submit(form, { afterPhotoId: afterId, requestId: subReq, baseRev: subRev }).replay === true && B.env.row_('DailyReports', 'team2|' + today).version === '1');
ok('[4] accepted writes are kept in the durable Requests ledger', B.env.readAll_('Requests').some(q => q.requestId === subReq && q.action === 'submitReport' && q.userId === 'lead-team2'));
for (const k of Object.keys(B.cache)) if (k.startsWith('rq:')) delete B.cache[k];
ok('[4] replay still works after the fast cache is gone (ledger)', submit(form, { afterPhotoId: afterId, requestId: subReq, baseRev: subRev }).replay === true && B.env.row_('DailyReports', 'team2|' + today).version === '1');
r = submit({ ...form, location: 'Somewhere else' }, { afterPhotoId: afterId, requestId: subReq, baseRev: subRev });
ok('[4] same request ID with different data is refused (and audited), nothing changed', r.denied && /different data/.test(r.error) && B.env.row_('DailyReports', 'team2|' + today).location === form.location);
ok('writes without a request ID are refused', /request ID/.test(B.raw({ action: 'submitReport', token: T.t2, deviceKey: B.deviceKey('phoneB'), teamId: 'team2', reportDate: today, report: form, baseRev: '0' }).error || ''));
ok('[5] second submit (double-click, new request) refused', /already submitted/.test(submit(form, { afterPhotoId: afterId }).error));
ok('photo change refused after submit', /Edit report/.test(call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, clientId: uid() }).error));
ok('attendance change refused after submit', /Edit report/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: repAfter.rev }).error));
ok('attendance lock applies to admin too (reopen first)', /Edit report/.test(call({ action: 'saveAttendance', token: T.admin, teamId: 'team2', reportDate: today, people, baseRev: repAfter.rev, reason: 'fix' }).error));
ok('revision snapshot stored on submit', B.env.readAll_('Revisions').some(v => v.reportId === reportId && v.kind === 'submitted' && JSON.parse(v.snapshot).attendance.length === 9));
ok('report is not late (submitted before cutoff or in test clock window)', ['Yes', 'No'].includes(repAfter.late));

// ── Cross-device: admin sees it ─────────────────────────────────────────
let A2 = call({ action: 'load', token: T.admin });
let rep = A2.reports.find(x => x.teamId === 'team2' && x.reportDate === today);
ok('admin sees submitted report', rep && rep.state === 'submitted' && rep.location === form.location && rep.plateNumber === 'NKU 8624' && rep.unit === 'KM');
ok('remarks stored as text, not a formula', B.sheets.DailyReports.getRange(2, B.env.col_('DailyReports', 'remarks')).getFormulas()[0][0] === '' && rep.remarks === form.remarks);
ok('photo cells in Sheet link to the private Drive file (no public =IMAGE)', /^=HYPERLINK\("https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view","Before photo"\)$/.test(B.sheets.DailyReports.getRange(2, B.env.col_('DailyReports', 'beforePreview')).getFormulas()[0][0]));
ok('admin sees attendance with status + note', A2.attendance.filter(a => a.teamId === 'team2').length === 9 && A2.attendance.find(a => a.name === 'Abraham Balmeo').note === 'Medical check-up');
ok('admin sees 2 active photos', A2.photos.filter(p => p.teamId === 'team2').length === 2);
ok('other leadman cannot see team2', call({ action: 'load', token: T.t3 }).reports.every(x => x.teamId === 'team3'));

// ── [13] Reopen rules ───────────────────────────────────────────────────
ok('[13] other leadman cannot reopen team2', call({ action: 'reopenReport', token: T.t3, teamId: 'team2', reportDate: today, reason: 'x', baseRev: repAfter.rev }).denied === true);
ok('[13] reopen needs a reason', /reason/.test(call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today, baseRev: repAfter.rev }).error));
r = call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today, reason: 'Wrong location typed', baseRev: '0', requestId: uid() });
ok('[13] reopen with a stale revision still goes through (never locks the user)', r.ok && !r.conflict, JSON.stringify(r));
ok('reopen with reason', r.ok && B.env.row_('DailyReports', 'team2|' + today).state === 'draft' && B.env.row_('DailyReports', 'team2|' + today).reopenReason === 'Wrong location typed');
ok('reopen keeps a snapshot of the submitted version', B.env.readAll_('Revisions').some(v => v.kind === 'reopened' && v.reason === 'Wrong location typed' && JSON.parse(v.snapshot).location === form.location));
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, originalFilename: 'IMG_0003.jpg', clientId: uid() });
const after2 = r.photo.photoId;
r = submit({ ...form, location: 'Km.12' }, { afterPhotoId: afterId, baseRev: '0' });
ok('resubmit bumps version (stale revision and an older photo ID never lock the user)', r.ok && r.version === '2', JSON.stringify(r));
ok('report uses the newest photo on the server; the mismatch is audited', B.env.row_('DailyReports', 'team2|' + today).afterPhotoId === after2 && B.env.readAll_('AuditLog').some(a => a.action === 'CONFLICT photos') && B.env.readAll_('AuditLog').some(a => a.action === 'CONFLICT submit'));
const last = B.env.readAll_('AuditLog').filter(a => a.action.startsWith('report resubmitted')).pop();
ok('report audit carries user ID and the new revision', last && last.userId === 'lead-team2' && last.rev === B.env.row_('DailyReports', 'team2|' + today).rev && /Reopened because: Wrong location typed/.test(last.reason), last && JSON.stringify(last));
const reo = B.env.readAll_('AuditLog').filter(a => a.action === 'report reopened for editing').pop();
ok('reopen audit: reason, old/new state and revision', reo.reason === 'Wrong location typed' && JSON.parse(reo.before).state === 'submitted' && JSON.parse(reo.after).state === 'draft' && reo.rev === JSON.parse(reo.after).rev);
ok('audit records before/after and change summary', last && /location: .* → "Km.12"/.test(last.reason) && /after photo replaced/.test(last.reason) && JSON.parse(last.before).location === form.location && JSON.parse(last.after).location === 'Km.12', last && last.reason);
ok('replaced photo kept in Photos tab', B.env.readAll_('Photos').filter(p => p.teamId === 'team2' && p.type === 'after').map(p => p.status).join() === 'Replaced,Active');
ok('original submitted record never destroyed (2 submit snapshots)', B.env.readAll_('Revisions').filter(v => v.reportId === reportId && v.kind === 'submitted').length === 2);
ok('[13] leadman cannot reopen a locked (old) day', /locked/.test(call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: B.env.shiftDate_(today, -5), reason: 'x y z', baseRev: '0' }).error));

// ── Remove photo: must belong to the report ─────────────────────────────
const t3 = call({ action: 'load', token: T.t3 });
call({ action: 'saveAttendance', token: T.t3, teamId: 'team3', reportDate: today, people: allPresent(t3.roster), baseRev: '0' });
r = call({ action: 'uploadPhoto', token: T.t3, teamId: 'team3', reportDate: today, type: 'before', dataUrl: img, clientId: uid() });
ok('leadman cannot remove another team\'s photo by ID', call({ action: 'removePhoto', token: T.t3, teamId: 'team3', reportDate: today, photoId: beforeId }).denied === true);
ok('leadman removes own photo', call({ action: 'removePhoto', token: T.t3, teamId: 'team3', reportDate: today, photoId: r.photo.photoId }).ok && B.env.row_('Photos', r.photo.photoId).status === 'Removed');

// ── Report needs attendance for today's whole crew; queued phones name photos by their own ID ──
const newbie = call({ action: 'addMember', token: T.admin, teamId: 'team3', name: 'Pedro Penduko' }).personId;
const cB3 = uid();
call({ action: 'uploadPhoto', token: T.t3, teamId: 'team3', reportDate: today, type: 'before', dataUrl: img, clientId: cB3 });
const form3 = { fromTime: '07:00', toTime: '16:00', location: 'CANDABA VIADUCT', activityDetails: 'Epoxy injection', status: 'Ongoing', target: '3', actual: '2', unit: 'Locations', targetManpower: '9', actualManpower: '9', plateNumber: 'NCG 5500', remarks: 'Pier 112 left' };
const rev3 = () => B.env.row_('DailyReports', 'team3|' + today).rev;
r = call({ action: 'submitReport', token: T.t3, teamId: 'team3', reportDate: today, report: form3, baseRev: rev3(), beforeClientId: cB3, requestId: uid() });
ok('[9] crew added after attendance: report refused until attendance covers them', !r.ok && r.missing.some(m => /Attendance is missing for: Pedro Penduko/.test(m)), JSON.stringify(r));
const t3b = call({ action: 'load', token: T.t3 });
r = call({ action: 'saveAttendance', token: T.t3, teamId: 'team3', reportDate: today, people: allPresent(t3b.roster), baseRev: rev3(), requestId: uid(), reason: 'New crew member joined' });
ok('attendance updated to include the new member', r.ok && r.crewPresent === '10/10', JSON.stringify(r));
r = call({ action: 'submitReport', token: T.t3, teamId: 'team3', reportDate: today, report: form3, baseRev: rev3(), beforeClientId: cB3, requestId: uid() });
ok('report sent from the offline queue names its photo by the phone\'s photo ID', r.ok && B.env.row_('DailyReports', 'team3|' + today).beforePhotoId === B.env.readAll_('Photos').find(p => p.clientId === cB3).photoId, JSON.stringify(r));
call({ action: 'archiveMember', token: T.admin, personId: newbie });

// ── Admin sees what phones still hold, conflicts, audit problems; server clock ──
r = call({ action: 'load', token: T.t3, outbox: [{ kind: 'act', date: today, state: 'conflict', error: 'Changed on another device' }, { kind: 'bogus', date: today, state: 'pending' }, { kind: 'photo', date: 'x', state: 'failed' }] });
ok('load returns the server clock and Manila date', r.ok && Math.abs(r.serverTime - Date.now()) < 5000 && r.today === today);
let AQ = call({ action: 'load', token: T.admin });
ok('admin sees a phone\'s unsent/conflicting work (bad entries dropped)', AQ.phoneQueue.team3 && AQ.phoneQueue.team3.items.length === 1 && AQ.phoneQueue.team3.items[0].state === 'conflict' && AQ.phoneQueue.team3.by === 'Allan Miranda', JSON.stringify(AQ.phoneQueue));
ok('a leadman never sees other phones\' queues', Object.keys(call({ action: 'load', token: T.t3 }).phoneQueue).length === 0);
r = call({ action: 'adminReports', token: T.admin, from: today, to: today });
ok('overview flags pending/conflicting work on the phone', /Activity report: Conflict/.test(r.rows.find(x => x.teamId === 'team3').onPhone.join()), JSON.stringify(r.rows.find(x => x.teamId === 'team3')));
ok('overview counts refused conflicting writes per report', r.rows.find(x => x.teamId === 'team2').conflicts >= 1);
call({ action: 'load', token: T.t3, outbox: [] });
ok('queue cleared once the phone has nothing left', !call({ action: 'load', token: T.admin }).phoneQueue.team3);
const auditTab = B.sheets.AuditLog; delete B.sheets.AuditLog;
call({ action: 'removePhoto', token: T.t3, teamId: 'team3', reportDate: today, photoId: 'nope' });
call({ action: 'load', token: T.t3, outbox: [] });
B.env.audit_({ name: 'x', role: 'test' }, '', 'test entry', '', '', null, null, '');
B.sheets.AuditLog = auditTab;
AQ = call({ action: 'load', token: T.admin });
ok('an audit entry that cannot be written is never silent (admin warned)', AQ.auditFailures && AQ.auditFailures.count >= 1 && AQ.auditFailures.action === 'test entry', JSON.stringify(AQ.auditFailures));
B.env.clearAuditFailures();
ok('no demo PINs in the backend code', !/'(0000|1111|2222|3333|4444)'/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8')));

// ── Accomplishment Report tab (the team's weekly report layout, filled automatically) ──
const ACC = B.sheets['Accomplishment Report'];
const accRows = () => ACC.data.slice(3).filter(r => r && r[15]);
ok('Accomplishment Report tab has the report layout (title, groups, 15 columns + hidden report ID)', ACC && String(ACC.data[0][0]).startsWith('Bridge Team Accomplishment Report')
  && ACC.data[1][1] === 'Schedule' && ACC.data[1][4] === 'Activities' && ACC.data[1][7] === 'Photos' && ACC.data[1][9] === 'Actual Resources Deploy for the Week'
  && ACC.data[2].slice(0, 15).join('|') === '#|Date|From|To|Location|Activity|Status|Before|After|Qty|Equipment|Qty|Manpower|Qty|Leadman/Driver', ACC && JSON.stringify(ACC.data.slice(0, 3)));
const a2 = accRows().find(r => r[15] === reportId), rep2 = B.env.row_('DailyReports', 'team2|' + today);
ok('each submitted report fills a row automatically', a2 && a2[1] === today && a2[2] === '07:00' && a2[3] === '16:00' && a2[4] === 'Km.12' && a2[5] === form.activityDetails && a2[6] === 'COMPLETE' && a2[10] === 'NKU 8624' && a2[14] === 'Glenn Butiong', JSON.stringify(a2));
ok('…with before/after photo links in the cells', /^=HYPERLINK\("https:\/\/drive\.google\.com\/file\/d\/.+Before photo/.test(a2[7]) && /^=HYPERLINK\(.+After photo/.test(a2[8]));
ok('…and the crew present (names + count, leadman in his own column)', a2[11] === String(a2[12].split('\n').length) && !a2[12].includes('Glenn Butiong') && a2[12].includes('Ian Enriquez') && !a2[12].includes('Rolando Faustino') && a2[13] === '1', a2[11] + ' / ' + a2[12]);
ok('an edited and resubmitted report updates its row (no duplicate row)', accRows().filter(r => r[15] === reportId).length === 1 && a2[4] === rep2.location);
ok('rows are numbered like the original (#)', accRows().map(r => r[0]).join() === accRows().map((r, i) => String(i + 1)).join() && accRows().length === 2, accRows().map(r => r[0] + ':' + r[15]).join());
const before = JSON.stringify(accRows());
B.env.setup({ pins: DEMO_PINS });
ok('running setup() again keeps the tab and its rows', JSON.stringify(accRows()) === before);
const nReb = B.env.rebuildAccomplishmentReport();
ok('rebuildAccomplishmentReport() regenerates the same rows from the reports', nReb === 2 && JSON.stringify(accRows()) === before, nReb + ' ' + JSON.stringify(accRows().map(r => r.slice(0, 7))) + ' vs ' + JSON.stringify(JSON.parse(before).map(r => r.slice(0, 7))));

// ── Client report tabs (per-team activity tab + attendance grid) ────────
const TR = B.sheets['Segment 10 Scupper Drain'], AT = B.sheets['Attendance Segment 10'];
ok('client tabs created by setup', ['Bridge RM_Team 1', 'Segment 10 Scupper Drain', 'Bridge Epoxy', 'Attendance Bridge RM', 'Attendance Segment 10', 'Attendance Epoxy 1-2', 'Bridge_Conso', 'Summary per Activity', 'Monthly Summary(Raw)'].every(n => B.sheets[n]), Object.keys(B.sheets).join());
ok('activity tab has the client columns', TR.data[0].slice(0, 21).join('|') === 'Days|Date|From|To|Location |Activity|Activity Details|Status|Target (KM)\nStation|Actual (KM)\nStation|Before|After|Target (EQP)|Actual (EQP|Plate Number|Target (Manpower)|Actual (Manpower)|Team|Target (Leadman)|Actual (Leadman)|Leadman/Driver', JSON.stringify(TR.data[0]));
const trRows = TR.data.slice(1).filter(r => r && r[21]);
const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T12:00:00Z').getUTCDay()];
const tr = trRows.find(r => r[21] === reportId);
ok('submitted report fills a row in its team tab (one row, updated on resubmit)', trRows.filter(r => r[21] === reportId).length === 1 && tr[0] === wd && tr[1] === today && tr[2] === '07:00' && tr[4] === 'Km.12'
  && tr[5] === 'Segment 10 Scupper Drain' && tr[7] === 'COMPLETE' && tr[14] === 'NKU 8624' && tr[20] === 'Glenn Butiong' && tr[19] === '1', JSON.stringify(tr));
ok('Team column lists present crew in LAST, FIRST M. form (leadman separate)', tr[17].split('\n').includes('DE MESA, GLEN JORICK M.') && !tr[17].includes('BUTIONG') && !tr[17].includes('FAUSTINO') && tr[16] === rep2.actualManpower, tr[17]);
ok('Roster keeps the report name (filled from the client sheets, editable)', B.env.row_('Roster', 'team2-ian-enriquez').reportName === 'ENRIQUEZ, IAN T.');
const col = AT.data[1].indexOf(today), gridPeople = AT.data.slice(3, 12);
ok('attendance grid: title, dates across, weekday row, 9 slots', AT.data[1][0] === 'BRIDGE CONNECTOR NLEX - ACCOMPLISHMENT REPORT' && col > 2 && AT.data[2][col] === wd && AT.data[2][2] === 'NAME' && gridPeople.length === 9 && AT.data[3][1] === 'Driver/Leadman' && AT.data[3][2] === 'BUTIONG, GLENN A.', JSON.stringify(AT.data.slice(1, 5).map(r => r.slice(0, col + 1))));
const mark = n => gridPeople.find(r => r[2] === n)[col];
ok('attendance grid: 1 = present, 0 = leave/other; no data = blank', mark('BUTIONG, GLENN A.') === 1 && mark('FAUSTINO, ROLANDO G.') === 0 && mark('BALMEO, ABRAHAM P.') === 0 && mark('DE MESA, GLEN JORICK M.') === 1 && gridPeople[0][col === 3 ? 4 : 3] === '', gridPeople.map(r => r[2] + ':' + r[col]).join(', '));
const rowOf = label => AT.data.find(r => r && String(r[0]).startsWith(label));
ok('attendance grid totals: required 9, driver 1, skilled, non-skilled', rowOf('TOTAL MANPOWER REQUIRED')[col] === 9 && rowOf('Driver')[col] === 1 && rowOf('Skilled labor')[col] === 2 && rowOf('Non-Skilled labor')[col] === 4, [rowOf('TOTAL')[col], rowOf('Driver')[col], rowOf('Skilled')[col], rowOf('Non-Skilled')[col]].join());
ok('attendance grid: equipment and vehicle rows', AT.data.some(r => r && r[0] === 'BRIDGE SEG 10 EQUIPMENT') && AT.data.find(r => r && r[1] === 'Grass Cutter')[col] === 1 && AT.data.find(r => r && r[1] === 'NKU 8624')[col] === 1);
// Epoxy: both teams in one activity tab and one attendance grid.
const EP = B.sheets['Bridge Epoxy'], rep3 = B.env.row_('DailyReports', 'team3|' + today);
const ep = EP.data.slice(1).find(r => r && r[21] === rep3.reportId);
ok('Bridge Epoxy tab: Target/Actual (Loc), Activity = team, leadman in capitals', EP.data[0][8] === 'Target (Loc)' && ep && ep[5] === 'Bridge Epoxy 1' && ep[8] === '3' && ep[9] === '2' && ep[20] === 'ALLAN MIRANDA', JSON.stringify(ep));
const AE = B.sheets['Attendance Epoxy 1-2'], aeCol = AE.data[1].indexOf(today);
ok('Attendance Epoxy 1-2: two team blocks, 18 required, 5 equipment with codes, 2 vehicles', AE.data[3][2] === 'MIRANDA, ALLAN P.' && AE.data.some(r => r && r[2] === 'RIVERA, GILBERT O.')
  && AE.data.find(r => r && r[0] === 'TOTAL MANPOWER REQUIRED')[aeCol] === 18 && AE.data.find(r => r && r[1] === 'Wagner Epoxy injection pump')[2] === 'RM-IJM-01'
  && AE.data.find(r => r && r[1] === 'EPOXY 1 - NCG 5500')[aeCol] === 1 && AE.data.find(r => r && r[1] === 'EPOXY 2 - NEO 5124')[aeCol] === '', JSON.stringify(AE.data.map(r => r && r.slice(0, 3))));
ok('…a crew member removed after working still appears on the days they worked', AE.data.some(r => r && r[2] === 'PENDUKO, PEDRO' && r[aeCol] === 1));
// Bridge_Conso: every team's reports, with KM / Station / Loc split out and the month.
const CO = B.sheets['Bridge_Conso'], coRows = CO.data.slice(1).filter(r => r && r[26]);
const co2 = coRows.find(r => r[26] === reportId), co3 = coRows.find(r => r[26] === rep3.reportId);
const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(today.slice(5, 7)) - 1];
ok('Bridge_Conso: all teams, one row per report, client columns + KM/Loc/Month', CO.data[0].slice(21, 26).join('|') === 'Target (KM)|Actual (KM)|Target (Loc)|Actual (Loc)|Month' && coRows.length === 2
  && co2[5] === 'Segment 10 Scupper Drain' && co2[8] === '1' && co2[23] === '' && co2[25] === month && co3[23] === '3' && co3[24] === '2' && co3[8] === '', JSON.stringify([co2, co3].map(r => r.slice(5, 26))));
const MS = B.sheets['Monthly Summary(Raw)'], msRows = MS.data.slice(1).filter(r => r && r[0]);
ok('Monthly Summary(Raw): one row per report + Grand Total with SUM formulas', msRows.length === 3 && msRows[0][2] === 'BRIDGE EPOXY 1' && msRows[0][11] === '3' && msRows[1][2] === 'SEGMENT 10 SCUPPER DRAIN' && msRows[1][3] === '1'
  && msRows[2][0] === 'Grand Total' && msRows[2][7] === '=SUM(H2:H3)', JSON.stringify(msRows));
const SU = B.sheets['Summary per Activity'];
ok('Summary per Activity: activities with live SUMIFS over Bridge_Conso, month filter in B1, Grand Total', SU.data[0][1] === 'All' && SU.data[2][1] === ' Target (Loc)' && SU.data[3][0] === 'BRIDGE EPOXY 1'
  && /^=SUMIFS\('Bridge_Conso'!\$X:\$X,'Bridge_Conso'!\$F:\$F,\$A4,'Bridge_Conso'!\$Z:\$Z,IF\(\$B\$1="All","\*",\$B\$1\)\)$/.test(SU.data[3][1]) && SU.data.find(r => r && r[0] === 'Grand Total')[1] === '=SUM(B4:B7)', JSON.stringify(SU.data.slice(0, 5)));
const trBefore = JSON.stringify(trRows), atBefore = JSON.stringify(AT.data);
B.env.rebuildClientTabs();
ok('rebuildClientTabs() regenerates the same tabs', JSON.stringify(B.sheets['Segment 10 Scupper Drain'].data.slice(1).filter(r => r && r[21])) === trBefore && JSON.stringify(B.sheets['Attendance Segment 10'].data) === atBefore);

// ── Roster ──────────────────────────────────────────────────────────────
r = call({ action: 'addMember', token: T.admin, teamId: 'team2', name: '  Juan  Dela Cruz ' });
ok('admin adds crew', r.ok && r.personId === 'team2-juan-dela-cruz');
ok('duplicate name refused', /Already/.test(call({ action: 'addMember', token: T.admin, teamId: 'team2', name: 'juan dela cruz' }).error));
ok('[12] formula-like name refused', /cannot start/.test(call({ action: 'addMember', token: T.admin, teamId: 'team2', name: '=cmd|calc' }).error));
ok('archive', call({ action: 'archiveMember', token: T.admin, personId: r.personId }).ok);
ok('leadman cannot be archived', /leadman/i.test(call({ action: 'archiveMember', token: T.admin, personId: 'team2-glenn-butiong' }).error));
ok('restore', call({ action: 'restoreMember', token: T.admin, personId: r.personId }).ok && B.env.row_('Roster', r.personId).status === 'Active');

// ── [12] Export ─────────────────────────────────────────────────────────
r = call({ action: 'exportCsv', token: T.admin, from: yesterday, to: today });
const lines = r.csv.split('\r\n');
ok('CSV/XLSX carry the stable report ID + revision number', lines[0].startsWith('Date,Report ID,Revision,Version,Team') && lines.some(l => l.includes(reportId + ',' + B.env.row_('DailyReports', 'team2|' + today).rev + ',2,')), lines[0]);
const xl = Object.values(B.exports).pop();
ok('.xlsx is a separate file with only the export rows (no Users/Sessions/Audit tabs)', r.xlsxUrl.includes(xl.id) && xl.sheet.data.length === 3 && xl.sheet.data[0][1] === 'Report ID' && xl.folder && xl.folder.name === 'Exports');
ok('CSV export for a chosen date range', r.ok && r.rows === 2 && r.from === yesterday && r.csv.includes('Segment 10 Scupper Drain') && r.csv.includes('drive.google.com/file/d/'), r.rows);
ok('[12] CSV neutralises = formulas', r.csv.includes(`"'=HYPERLINK(""x"")"`));
B.env.upsert_('DailyReports', 'team2|' + today, { remarks: '+SUM(1)', location: '@evil', activityDetails: '-2+3' });
const esc = call({ action: 'exportCsv', token: T.admin, from: today, to: today }).csv;
ok('[12] CSV neutralises + @ - payloads', esc.includes("'+SUM(1)") && esc.includes("'@evil") && esc.includes("'-2+3"));
ok('[9] export range backwards refused', /on or before/.test(call({ action: 'exportCsv', token: T.admin, from: today, to: yesterday }).error));
ok('[9] export range too long refused', /at most/.test(call({ action: 'exportCsv', token: T.admin, from: '2020-01-01', to: today }).error));
ok('xlsx link', r.xlsxUrl.endsWith('/export?format=xlsx') && !r.xlsxUrl.includes('SHEETID'));

// ── Admin overview, revisions, audit log ────────────────────────────────
r = call({ action: 'adminReports', token: T.admin, from: yesterday, to: today });
const row2 = r.rows.find(x => x.teamId === 'team2' && x.reportDate === today), rowY = r.rows.find(x => x.teamId === 'team1' && x.reportDate === yesterday);
ok('overview lists every team × day (8 rows)', r.ok && r.rows.length === 8);
ok('overview: submitted report with completeness', row2.state === 'Submitted' && row2.attendanceRows === 9 && row2.photos === 2 && row2.revisions >= 3, JSON.stringify(row2));
ok('overview: missing yesterday report flagged late', rowY.state === 'Missing' && rowY.late === true);
r = call({ action: 'revisions', token: T.admin, reportId });
ok('revision history for a report', r.ok && r.revisions.length >= 3 && r.revisions.some(v => v.kind === 'reopened') && r.audit.length >= 3);
r = call({ action: 'auditLog', token: T.admin, from: today, to: today, teamId: 'team2' });
ok('audit log viewer filters by team', r.ok && r.rows.length > 5 && r.rows.every(a => a.teamId === 'team2'));
ok('audit log is hash-chained and intact', B.env.verifyAuditLog().ok);
const aSheet = B.sheets.AuditLog, aRow = 3, aCol = B.env.col_('AuditLog', 'reason');
aSheet.data[aRow - 1][aCol - 1] = 'edited by hand';
B.env.CACHE = {};
ok('audit log edit by hand is detected', B.env.verifyAuditLog().ok === false);

// ── Session revocation ──────────────────────────────────────────────────
B.env.upsert_('Users', 'lead-team2', { pin: '2468' });
ok('changing a PIN signs that leadman out', call({ action: 'load', token: T.t2 }).auth === true);
ok('new PIN works (and is then hashed)', call({ action: 'login', pin: '2468', device: 'phoneB' }).ok && /^h:/.test(B.env.row_('Users', 'lead-team2').pin));
const l3b = call({ action: 'login', pin: '3333', device: 'phoneC2' });
ok('logout revokes the session server-side', call({ action: 'logout', token: l3b.token }).ok && call({ action: 'load', token: l3b.token }).auth === true);
B.env.upsert_('Users', 'lead-team3', { active: 'No' });
ok('deactivated user is signed out', call({ action: 'load', token: T.t3 }).auth === true);
B.env.signOutEveryone();
ok('signOutEveryone invalidates admin', call({ action: 'load', token: T.admin }).auth === true);

// ── Global lockout ──────────────────────────────────────────────────────
const G = makeBackend(); G.env.setup({ pins: DEMO_PINS });
for (let i = 0; i < 30; i++) G.raw({ action: 'enroll', setupKey: 'guess' + i });
ok('wrong setup keys do not lock PIN sign-in for everyone', G.call({ action: 'login', pin: '0000', device: 'fresh0' }).ok);
for (let i = 0; i < 30; i++) G.raw({ action: 'enroll', setupKey: 'guess' + i });
ok('…but are rate-limited themselves', /Too many/.test(G.raw({ action: 'enroll', setupKey: G.env.newSetupLink_().token }).error || ''));
delete G.cache['fail:enroll'];   // let the next phones enrol
for (let d = 0; d < 4; d++) for (let i = 0; i < 5; i++) G.call({ action: 'login', pin: '9876', device: 'attacker' + d });
ok('20 wrong PINs across phones lock all sign-ins for a while', /Too many/.test(G.call({ action: 'login', pin: '0000', device: 'fresh' }).error || ''));
ok('lockout recorded in audit log', G.env.readAll_('AuditLog').some(a => a.action === 'sign-in locked'));
G.env.clearLoginLock();
ok('clearLoginLock lifts it', G.call({ action: 'login', pin: '0000', device: 'fresh2' }).ok);
const oldLink = G.env.newSetupLink_().token, oldKey = G.env.setupLinkKey_(oldLink);
G.props[oldKey] = JSON.stringify({ ...JSON.parse(G.props[oldKey]), exp: Date.now() - 1 });
ok('expired setup link cannot enrol new phones', /expired/.test(G.raw({ action: 'enroll', setupKey: oldLink, enrollId: 'late-phone-1' }).error || ''));

// ── Hardening v4: private photos, single-use setup links, device revocation, audit checkpoint ──
const H = makeBackend(); H.env.setup({ pins: DEMO_PINS });
const hc = H.call, devH = name => H.env.unsign_(H.deviceKey(name), 'DEVICE_SECRET').d;
const hAdmin = hc({ action: 'login', pin: '0000', device: 'h-pc' }), h1 = hc({ action: 'login', pin: '1111', device: 'h-p1' }), h2 = hc({ action: 'login', pin: '2222', device: 'h-p2' });
const upH = (tok, team, type, bytes, mime = 'image/jpeg', extra = {}) => hc({ action: 'uploadPhoto', token: tok, teamId: team, reportDate: H.env.today_(), type, dataUrl: 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64'), clientId: uid(), ...extra });

// Photo privacy
r = upH(h1.token, 'team1', 'before', jpegBytes);
const hp = r.photo;
ok('[P1] uploaded photo file is private (never shared by link)', r.ok && H.files[hp.fileId].access === 'private', JSON.stringify(r));
ok('[P1] Code.gs no longer shares anything "anyone with the link"', !/ANYONE_WITH_LINK/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8')));
r = hc({ action: 'photoView', token: h1.token, photoId: hp.photoId });
ok('[P1] leadman sees own team\'s photo through the authenticated API (same bytes)', r.ok && Buffer.from(r.dataUrl.split(',')[1], 'base64').equals(jpegBytes));
r = hc({ action: 'photoView', token: h2.token, photoId: hp.photoId, teamId: 'team1' });
ok('[P1] leadman of another team is refused (even claiming that team) and it is audited', r.denied === true && H.env.readAll_('AuditLog').some(a => a.action === 'DENIED photoView' && a.userId === 'lead-team2'), JSON.stringify(r));
ok('[P1] admin sees any team\'s photo', hc({ action: 'photoView', token: hAdmin.token, photoId: hp.photoId }).ok);
ok('[P1] no sign-in → refused', H.raw({ action: 'photoView', photoId: hp.photoId }).auth === true);
ok('[P1] stolen token without the phone\'s device key → refused', H.raw({ action: 'photoView', token: h1.token, photoId: hp.photoId }).auth === true);
ok('[P1] unknown photo ID → not found', !hc({ action: 'photoView', token: hAdmin.token, photoId: 'ph-nope' }).ok);
H.files[hp.fileId].access = 'anyone-with-link'; H.props.PHOTOS_PRIVATE_UPTO = '0';
H.env.makePhotosPrivate_(60000);
ok('[P1] photos shared by an older version are made private again (makePhotosPrivate / setup)', H.files[hp.fileId].access === 'private');

// Client capture metadata is a claim, not evidence
r = upH(h1.token, 'team1', 'after', jpegBytes, 'image/jpeg', { capturedAt: '2020-01-01 03:00', location: 'Forged GPS 0,0', uploadedAt: '2020-01-01 03:00:00', uploadedBy: 'someone else', photoId: 'ph-forged' });
const fp = r.photo, lastAud = H.env.readAll_('AuditLog').filter(a => a.entityId === (fp || {}).photoId).pop() || {};
ok('[P2] forged capture time/location stored only as the phone\'s claim', r.ok && fp.capturedAt === '2020-01-01 03:00' && fp.location === 'Forged GPS 0,0', JSON.stringify(r));
ok('[P2] a forged old report date is refused (locked), not trusted', /locked/.test(upH(h1.token, 'team1', 'after', jpegBytes, 'image/jpeg', { reportDate: '2020-01-01', capturedAt: '2020-01-01 03:00' }).error || ''));
ok('[P2] report date, upload time and uploader come from the server, not the request', fp.reportDate === H.env.today_() && fp.uploadedAt.slice(0, 10) === H.env.today_() && fp.uploadedBy === 'Pijay Tanjeco' && fp.photoId !== 'ph-forged');
ok('[P2] audit time is the server clock', lastAud.at && lastAud.at.slice(0, 10) === H.env.today_());
ok('[P2] Photos tab labels client metadata "not verified" and server time', H.sheets.Photos.data[0].includes('Captured (phone clock, not verified)') && H.sheets.Photos.data[0].includes('Location (typed on phone, not verified)') && H.sheets.Photos.data[0].includes('Uploaded (server time)'));
ok('[P2] Drive description says the phone time is not verified', /phone clock at capture \(not verified\) 2020-01-01 03:00/.test(H.files[fp.fileId].description) && /uploaded \(server time\) /.test(H.files[fp.fileId].description));
ok('[P2] malformed capture time is dropped', upH(h1.token, 'team1', 'after', jpegBytes, 'image/jpeg', { capturedAt: '<script>' }).photo.capturedAt === '');

// Stronger photo validation
const refused = x => /damaged or not a real photo|not a real JPEG, PNG or WebP/.test(x.error || '');
ok('[P6] real PNG accepted', upH(h1.token, 'team1', 'after', pngBytes, 'image/png').ok);
ok('[P6] real WebP accepted', upH(h1.token, 'team1', 'after', webpBytes, 'image/webp').ok);
ok('[P6] truncated JPEG refused', refused(upH(h1.token, 'team1', 'after', jpegBytes.subarray(0, jpegBytes.length - 60))));
ok('[P6] JPEG with a file hidden after it (polyglot) refused', refused(upH(h1.token, 'team1', 'after', Buffer.concat([jpegBytes, Buffer.from('PK\x03\x04<html><script>alert(1)</script>')]))));
ok('[P6] JPEG header + junk (magic bytes only) refused', refused(upH(h1.token, 'team1', 'after', Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake-jpeg-bytes'.repeat(20))]))));
const sof = jpegBytes.indexOf(Buffer.from([0xFF, 0xC0])), huge = Buffer.from(jpegBytes); huge.writeUInt16BE(60000, sof + 5); huge.writeUInt16BE(60000, sof + 7);
ok('[P6] JPEG claiming 60000×60000 pixels refused', refused(upH(h1.token, 'team1', 'after', huge)));
const badCrc = Buffer.from(pngBytes); badCrc[17] ^= 0xFF;
ok('[P6] PNG with a damaged header (CRC) refused', refused(upH(h1.token, 'team1', 'after', badCrc, 'image/png')));
ok('[P6] PNG with data after IEND refused', refused(upH(h1.token, 'team1', 'after', Buffer.concat([pngBytes, Buffer.from('<?php echo 1; ?>')]), 'image/png')));
const badRiff = Buffer.from(webpBytes); badRiff.writeUInt32LE(badRiff.readUInt32LE(4) + 500, 4);
ok('[P6] WebP whose size does not match its header refused', refused(upH(h1.token, 'team1', 'after', badRiff, 'image/webp')));
ok('[P6] ZIP declared as JPEG refused', refused(upH(h1.token, 'team1', 'after', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(300, 1)]))));
ok('[P6] refused photos are audited and never reach Drive', H.env.readAll_('AuditLog').some(a => a.action === 'DENIED photo refused') && Object.values(H.files).every(f => { const k = f.blob.bytes.length; return k === jpegBytes.length || k === pngBytes.length || k === webpBytes.length; }));

// Single-use setup links
const LNK = H.env.newSetupLink_().token;
const e1 = H.raw({ action: 'enroll', setupKey: LNK, enrollId: 'phone-A-enrol-1', deviceLabel: 'Phone A' });
const dA = e1.ok && H.env.unsign_(e1.deviceKey, 'DEVICE_SECRET').d;
ok('[P3] a new link connects one phone (listed in Devices)', e1.ok && !!H.env.row_('Devices', dA));
r = H.raw({ action: 'enroll', setupKey: LNK, enrollId: 'attacker-enrol-9', deviceLabel: 'Attacker' });
ok('[P3] replaying a used link (leaked/forwarded) is refused and audited', r.notSetUp && /already used/.test(r.error) && H.env.readAll_('AuditLog').some(a => a.action === 'DENIED setup link used again'));
ok('[P3] replay without an enrolment ID refused', /already used/.test(H.raw({ action: 'enroll', setupKey: LNK }).error || ''));
r = H.raw({ action: 'enroll', setupKey: LNK, enrollId: 'phone-A-enrol-1', deviceLabel: 'Phone A' });
ok('[P3] the same phone retrying after a lost reply gets its own device back (no second device)', r.ok && H.env.unsign_(r.deviceKey, 'DEVICE_SECRET').d === dA && H.env.readAll_('Devices').filter(d => d.label === 'Phone A').length === 1);
const LNK2 = H.env.newSetupLink_().token, k2 = H.env.setupLinkKey_(LNK2);
H.props[k2] = JSON.stringify({ ...JSON.parse(H.props[k2]), exp: Date.now() - 1 });
ok('[P3] expired link refused', /expired/.test(H.raw({ action: 'enroll', setupKey: LNK2, enrollId: 'phone-B-enrol-1' }).error || ''));
const LNK3 = H.env.newSetupLink_().token;
ok('[P3] altered link refused', /not valid/.test(H.raw({ action: 'enroll', setupKey: LNK3.slice(0, -1) + (LNK3.slice(-1) === 'a' ? 'b' : 'a') }).error || ''));
H.env.cancelSetupLinks();
ok('[P3] cancelSetupLinks makes unused links useless', /not valid/.test(H.raw({ action: 'enroll', setupKey: LNK3, enrollId: 'phone-C-enrol-1' }).error || ''));
H.props.SETUP_KEY = 'oldsharedkey1234567890'; H.props.SETUP_KEY_EXPIRES = String(Date.now() + 86400e3);
ok('[P3] the old reusable shared setup key no longer enrols phones', /not valid/.test(H.raw({ action: 'enroll', setupKey: 'oldsharedkey1234567890' }).error || ''));
H.env.setup({ pins: DEMO_PINS });
ok('[P3] setup() deletes the old shared key', !H.props.SETUP_KEY && !H.props.SETUP_KEY_EXPIRES);
const legacyKey = H.env.signed_({ d: 'devH-legacy-000001', iat: 1 }, 'DEVICE_SECRET');
ok('[P3] a phone connected before this change (no Devices row) still signs in', H.raw({ action: 'login', pin: '4444', deviceKey: legacyKey }).ok);
const LNK4 = H.env.newSetupLink_().token; H.env.forgetAllPhones();
ok('[P3] forgetAllPhones also cancels outstanding links', /not valid/.test(H.raw({ action: 'enroll', setupKey: LNK4, enrollId: 'phone-D-enrol-1' }).error || ''));

// showSetupLink prints a usable link only with the real Web app address (/exec)
const enrKeys = () => Object.keys(H.props).filter(k => k.startsWith('ENR_')).length;
H.logs.length = 0; H.env.showSetupLink();
const printed = H.logs.find(l => l.includes('?backend=')) || '', pq = new URL(printed).searchParams;
ok('[P3] showSetupLink prints the app link with the /exec backend and a fresh key', /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(pq.get('backend')) && /^[a-f0-9]{40}$/.test(pq.get('key')), printed);
ok('[P3] …and that printed link really connects a phone', H.raw({ action: 'enroll', setupKey: pq.get('key'), enrollId: 'printed-link-1' }).ok);
H.service.url = 'https://script.google.com/macros/s/HEAD-DEPLOYMENT/dev'; H.logs.length = 0;
const enrBefore = enrKeys(); H.env.showSetupLink();
ok('[P3] if Apps Script reports its test (/dev) address, no link is made and the log says how to fix it', enrKeys() === enrBefore && !H.logs.some(l => l.includes('?backend=')) && H.logs.some(l => /NO LINK MADE/.test(l) && /\/dev/.test(l)));
H.service.url = 'https://script.google.com/a/macros/example.com/s/WORKSPACE-ID/exec'; H.logs.length = 0; H.env.showSetupLink();
ok('[P3] Google Workspace web app addresses are accepted', H.logs.some(l => l.includes(encodeURIComponent('/a/macros/example.com/s/WORKSPACE-ID/exec'))));
H.service.url = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';

// Device revocation (fresh backend so earlier sign-outs do not interfere)
const V = makeBackend(); V.env.setup({ pins: DEMO_PINS });
const vc = V.call, vdev = name => V.env.unsign_(V.deviceKey(name), 'DEVICE_SECRET').d;
const vAdmin = vc({ action: 'login', pin: '0000', device: 'office-pc' });
const p1 = vc({ action: 'login', pin: '1111', device: 'lost-phone' }), p2 = vc({ action: 'login', pin: '1111', device: 'spare-phone' });
const pinBefore = V.env.row_('Users', 'lead-team1').pin;
ok('[P4] leadman cannot disconnect phones', vc({ action: 'revokeDevice', token: p2.token, deviceId: vdev('lost-phone'), reason: 'test' }).denied === true);
ok('[P4] a reason is required', /reason/.test(vc({ action: 'revokeDevice', token: vAdmin.token, deviceId: vdev('lost-phone'), reason: '' }).error || ''));
ok('[P4] admin cannot disconnect the device they are using', /using now/.test(vc({ action: 'revokeDevice', token: vAdmin.token, deviceId: vdev('office-pc'), reason: 'oops' }).error || ''));
r = vc({ action: 'revokeDevice', token: vAdmin.token, deviceId: vdev('lost-phone'), reason: 'Phone lost on site' });
ok('[P4] admin disconnects ONE phone', r.ok && r.sessionsEnded === 1, JSON.stringify(r));
r = vc({ action: 'load', token: p1.token });
ok('[P4] that phone\'s session stops working and it is told to re-enrol', r.auth === true && r.notSetUp === true, JSON.stringify(r));
ok('[P4] the same user\'s other phone keeps working', vc({ action: 'load', token: p2.token }).ok);
ok('[P4] the user\'s PIN is unchanged', V.env.row_('Users', 'lead-team1').pin === pinBefore);
r = V.raw({ action: 'login', pin: '1111', deviceKey: V.deviceKey('lost-phone') });
ok('[P4] the disconnected phone cannot sign in again (even with the right PIN), audited', r.notSetUp && /disconnected/.test(r.error) && V.env.readAll_('AuditLog').some(a => a.action === 'DENIED sign-in from disconnected phone'));
const da = V.env.readAll_('AuditLog').find(a => a.action === 'device disconnected');
ok('[P4] disconnection audited with admin, device and reason', da && da.userId === 'admin' && da.entityId === vdev('lost-phone') && da.reason === 'Phone lost on site');
r = vc({ action: 'devices', token: vAdmin.token });
const lost = (r.devices || []).find(d => d.deviceId === vdev('lost-phone')), spare = (r.devices || []).find(d => d.deviceId === vdev('spare-phone'));
ok('[P4] admin device list shows who used each phone and which are disconnected', r.ok && lost && lost.revokedAt && lost.lastUser === 'Pijay Tanjeco' && spare && !spare.revokedAt && spare.activeSessions === 1 && r.devices.some(d => d.thisDevice));
ok('[P4] disconnecting twice is harmless', vc({ action: 'revokeDevice', token: vAdmin.token, deviceId: vdev('lost-phone'), reason: 'again' }).already === true);
ok('[P4] leadman cannot list phones', vc({ action: 'devices', token: p2.token }).denied === true);

// Audit checkpoint
ok('[P5] audit log verifies with a checkpoint', V.env.verifyAuditLog().ok && V.env.verifyAuditLog().checkpoint);
const AL = V.sheets.AuditLog, keep = AL.data.map(r => r.slice());
AL.data.splice(AL.getLastRow() - 2, 2); V.env.CACHE = {};
r = V.env.verifyAuditLog();
ok('[P5] deleting the last audit rows is detected', !r.ok && /deleted from the end/.test(r.reason), JSON.stringify(r));
vc({ action: 'load', token: vAdmin.token });
vc({ action: 'login', pin: '2222', device: 'after-tamper' });
r = V.env.verifyAuditLog();
ok('[P5] …and stays detected after new entries are appended', !r.ok && /tamper|deleted/.test(r.reason), JSON.stringify(r));
ok('[P5] the admin screen shows the tampering warning', /deleted from the end/.test((vc({ action: 'load', token: vAdmin.token }).auditFailures || {}).tamper || ''));
V.env.resetAuditCheckpoint();
ok('[P5] resetAuditCheckpoint (after checking) accepts the log as it is, audited', V.env.verifyAuditLog().ok && V.env.readAll_('AuditLog').some(a => a.action === 'audit checkpoint reset'));
const n0 = AL.getLastRow(), swap = AL.data[n0 - 1]; AL.data[n0 - 1] = AL.data[n0 - 2]; AL.data[n0 - 2] = swap; V.env.CACHE = {};
ok('[P5] reordered rows detected', !V.env.verifyAuditLog().ok);
AL.data[n0 - 2] = AL.data[n0 - 1]; AL.data[n0 - 1] = swap; V.env.CACHE = {};
ok('[P5] (restored order verifies again)', V.env.verifyAuditLog().ok);
AL.data.splice(3, 0, AL.data[3].slice()); V.env.CACHE = {};
ok('[P5] inserted (copied) row detected', !V.env.verifyAuditLog().ok);
AL.data.splice(3, 1); V.env.CACHE = {};
AL.data[4][V.env.col_('AuditLog', 'reason') - 1] = 'edited'; V.env.CACHE = {};
ok('[P5] edited row detected', !V.env.verifyAuditLog().ok);
AL.data.length = 0; keep.forEach(r => AL.data.push(r)); V.env.CACHE = {};
V.props.AUDIT_CHECKPOINT = JSON.stringify({ ...JSON.parse(V.props.AUDIT_CHECKPOINT), n: 3 });
ok('[P5] a hand-edited checkpoint is detected', /checkpoint itself was changed/.test(V.env.verifyAuditLog().reason || ''));

// Old =IMAGE photo cells (public links) are rewritten once as private links by setup()
B.env.upsert_('DailyReports', 'team2|' + today, { beforePreview: '=IMAGE("https://drive.google.com/thumbnail?id=x&sz=w800")' });
delete B.props.PREVIEWS_PRIVATE;
B.env.setup({ pins: DEMO_PINS });
const anyImage = Object.values(B.sheets).some(sh => sh.data.some(row => (row || []).some(v => /^=IMAGE\(/i.test(String(v == null ? '' : v)))));
ok('[P1] setup() rewrites old =IMAGE photo cells in every tab as private links', !anyImage);

// Speed: a first attendance submit writes the whole crew in one Sheets call (phones were timing out)
const W = makeBackend(); W.env.setup({ pins: DEMO_PINS });
const w1 = W.call({ action: 'login', pin: '1111', device: 'speed' });
const wRoster = W.call({ action: 'load', token: w1.token }).roster.filter(m => m.status === 'Active');
const w0 = W.writes.Attendance || 0;
r = W.call({ action: 'saveAttendance', token: w1.token, teamId: 'team1', reportDate: W.env.today_(), baseRev: '0', people: wRoster.map(m => ({ personId: m.personId, status: 'Present' })) });
ok('first attendance submit: whole crew written with ONE Sheets call, all rows correct', r.ok && (W.writes.Attendance - w0) === 1 && W.env.readAll_('Attendance').filter(a => a.teamId === 'team1' && a.status === 'Present' && a.rev === r.rev).length === wRoster.length, (W.writes.Attendance - w0) + ' writes');
W.env.CACHE = {};
ok('…and the rows read back from the Sheet match (cache and Sheet agree)', W.env.readAll_('Attendance').filter(a => a.teamId === 'team1').length === wRoster.length && W.env.readAll_('Attendance').every(a => /^\d{4}-/.test(a.createdAt)));
const wAtt = W.env.readAll_('Attendance').filter(a => a.teamId === 'team1');
r = W.call({ action: 'saveAttendance', token: w1.token, teamId: 'team1', reportDate: W.env.today_(), baseRev: r.rev, reason: 'Justin went home', people: wRoster.map(m => ({ personId: m.personId, status: m.name === 'Justin Billones' ? 'Sick' : 'Present' })) });
W.env.CACHE = {};
ok('changing submitted attendance still updates the existing rows (no duplicates)', r.ok && W.env.readAll_('Attendance').filter(a => a.teamId === 'team1').length === wAtt.length && W.env.readAll_('Attendance').find(a => a.name === 'Justin Billones').status === 'Sick', JSON.stringify(r));

// ── Upgrade an old (v1) Sheet in place ──────────────────────────────────
const M = makeBackend({ code: require('path').join(__dirname, 'fixtures', 'Code-v1.gs') });
M.env.setup({ demoPins: true });   // the old v1 code has its own test option
const v1 = M.call({ action: 'login', pin: '2222', device: 'old', setupKey: M.props.SETUP_KEY });
M.env.CACHE = {};
const v1l = JSON.parse(M.env.doPost({ postData: { contents: JSON.stringify({ action: 'load', token: v1.token }) } }).s);
const pv = v1l.roster.map(m => ({ personId: m.personId, status: m.name === 'Abraham Balmeo' ? 'Absent' : 'Present', absenceReason: m.name === 'Abraham Balmeo' ? 'Sick' : '' }));
JSON.parse(M.env.doPost({ postData: { contents: JSON.stringify({ action: 'saveAttendance', token: v1.token, teamId: 'team2', reportDate: today, people: pv }) } }).s);
// Swap in the new code on the same Sheet and run setup() again.
const vm = require('vm'), fs = require('fs');
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8'), M.env);
M.env.setup({ pins: DEMO_PINS });
ok('upgrade: Reports tab renamed to DailyReports, old Audit kept', !!M.sheets.DailyReports && !M.sheets.Reports && !!M.sheets['Audit (v1)']);
ok('upgrade: PINs moved from Teams to Users (hashed), Teams has no admin row', M.env.readAll_('Users').length === 5 && M.env.readAll_('Users').every(u => /^h:/.test(u.pin)) && !M.env.row_('Teams', 'admin'));
ok('upgrade: old attendance reason kept as note', M.env.readAll_('Attendance').find(a => a.name === 'Abraham Balmeo').note === 'Sick');
ok('upgrade: old report row got a report ID', /^R\d{8}-team2-/.test(M.env.row_('DailyReports', 'team2|' + today).reportId));
const up = M.call({ action: 'login', pin: '2222', device: 'new' });
ok('upgrade: same PINs still sign in', up.ok, JSON.stringify(up));

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
