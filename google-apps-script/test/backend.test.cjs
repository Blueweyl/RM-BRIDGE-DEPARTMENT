// Runs the real Code.gs against in-memory Google services, including the adversarial cases
// from the production audit (forged team, role escalation, bad tokens, replays, conflicts...).
// Usage: node google-apps-script/test/backend.test.cjs
const crypto = require('crypto');
const { makeBackend } = require('./fake-gas.cjs');

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && !cond ? '  [' + detail + ']' : '')); };
const jpegBytes = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('fake-jpeg-bytes'.repeat(20))]);
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
ok('setup key expires', Number(B.props.SETUP_KEY_EXPIRES) > Date.now());

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
ok('[11] stale revision refused (another device saved first)', call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people, baseRev: '0', requestId: uid() }).conflict === true);
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
ok('photo stored in date/team folder with report ID in description', f1.folder.name === 'Segment 10' && f1.blob.name.startsWith(today + '_Segment10_BEFORE_') && f1.shared && f1.description.includes(reportId));
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
ok('photo IDs must match the server (tampered IDs refused)', submit({ ...form, status: 'Ongoing', remarks: 'x' }, { beforePhotoId: 'ph-forged' }).conflict === true);

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
ok('photo previews in Sheet are IMAGE formulas', B.sheets.DailyReports.getRange(2, B.env.col_('DailyReports', 'beforePreview')).getFormulas()[0][0].startsWith('=IMAGE('));
ok('admin sees attendance with status + note', A2.attendance.filter(a => a.teamId === 'team2').length === 9 && A2.attendance.find(a => a.name === 'Abraham Balmeo').note === 'Medical check-up');
ok('admin sees 2 active photos', A2.photos.filter(p => p.teamId === 'team2').length === 2);
ok('other leadman cannot see team2', call({ action: 'load', token: T.t3 }).reports.every(x => x.teamId === 'team3'));

// ── [13] Reopen rules ───────────────────────────────────────────────────
ok('[13] other leadman cannot reopen team2', call({ action: 'reopenReport', token: T.t3, teamId: 'team2', reportDate: today, reason: 'x', baseRev: repAfter.rev }).denied === true);
ok('[13] reopen needs a reason', /reason/.test(call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today, baseRev: repAfter.rev }).error));
ok('[13] reopen with stale revision refused', call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today, reason: 'wrong location', baseRev: '0' }).conflict === true);
r = call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today, reason: 'Wrong location typed', baseRev: repAfter.rev, requestId: uid() });
ok('reopen with reason', r.ok && B.env.row_('DailyReports', 'team2|' + today).state === 'draft' && B.env.row_('DailyReports', 'team2|' + today).reopenReason === 'Wrong location typed');
ok('reopen keeps a snapshot of the submitted version', B.env.readAll_('Revisions').some(v => v.kind === 'reopened' && v.reason === 'Wrong location typed' && JSON.parse(v.snapshot).location === form.location));
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, originalFilename: 'IMG_0003.jpg', clientId: uid() });
const after2 = r.photo.photoId;
r = submit({ ...form, location: 'Km.12' }, { afterPhotoId: after2 });
ok('resubmit bumps version', r.ok && r.version === '2', JSON.stringify(r));
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
ok('…with before/after photos shown in the cells', /^=IMAGE\("https:\/\/drive\.google\.com\/thumbnail/.test(a2[7]) && /^=IMAGE\(/.test(a2[8]));
ok('…and the crew present (names + count, leadman in his own column)', a2[11] === String(a2[12].split('\n').length) && !a2[12].includes('Glenn Butiong') && a2[12].includes('Ian Enriquez') && !a2[12].includes('Rolando Faustino') && a2[13] === '1', a2[11] + ' / ' + a2[12]);
ok('an edited and resubmitted report updates its row (no duplicate row)', accRows().filter(r => r[15] === reportId).length === 1 && a2[4] === rep2.location);
ok('rows are numbered like the original (#)', accRows().map(r => r[0]).join() === accRows().map((r, i) => String(i + 1)).join() && accRows().length === 2, accRows().map(r => r[0] + ':' + r[15]).join());
const before = JSON.stringify(accRows());
B.env.setup({ pins: DEMO_PINS });
ok('running setup() again keeps the tab and its rows', JSON.stringify(accRows()) === before);
const nReb = B.env.rebuildAccomplishmentReport();
ok('rebuildAccomplishmentReport() regenerates the same rows from the reports', nReb === 2 && JSON.stringify(accRows()) === before, nReb + ' ' + JSON.stringify(accRows().map(r => r.slice(0, 7))) + ' vs ' + JSON.stringify(JSON.parse(before).map(r => r.slice(0, 7))));

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
ok('…but are rate-limited themselves', /Too many/.test(G.raw({ action: 'enroll', setupKey: G.props.SETUP_KEY }).error || ''));
delete G.cache['fail:enroll'];   // let the next phones enrol
for (let d = 0; d < 4; d++) for (let i = 0; i < 5; i++) G.call({ action: 'login', pin: '9876', device: 'attacker' + d });
ok('20 wrong PINs across phones lock all sign-ins for a while', /Too many/.test(G.call({ action: 'login', pin: '0000', device: 'fresh' }).error || ''));
ok('lockout recorded in audit log', G.env.readAll_('AuditLog').some(a => a.action === 'sign-in locked'));
G.env.clearLoginLock();
ok('clearLoginLock lifts it', G.call({ action: 'login', pin: '0000', device: 'fresh2' }).ok);
G.props.SETUP_KEY_EXPIRES = String(Date.now() - 1);
ok('expired setup link cannot enrol new phones', /expired/.test(G.raw({ action: 'enroll', setupKey: G.props.SETUP_KEY }).error || ''));

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
