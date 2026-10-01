// Runs the real Code.gs against in-memory Google services: the no-sign-in field API (teams, team,
// uploadPhoto, submitReport), every server-side rule, duplicate and concurrency protection, the audit
// trail, the Sheet-menu admin functions, the client report tabs, and upgrades from older versions.
// Usage: node google-apps-script/test/backend.test.cjs
const crypto = require('crypto');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { makeBackend } = require('./fake-gas.cjs');

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && !cond ? '  [' + detail + ']' : '')); };
// Real images (64×48, made by a browser canvas like the app does).
const FIX = path.join(__dirname, 'fixtures');
const jpegBytes = fs.readFileSync(FIX + '/tiny.jpeg'), pngBytes = fs.readFileSync(FIX + '/tiny.png'), webpBytes = fs.readFileSync(FIX + '/tiny.webp');
const img = 'data:image/jpeg;base64,' + jpegBytes.toString('base64');
const uid = () => crypto.randomUUID();
const CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const B = makeBackend();
B.env.setup(); B.env.setup();
const call = B.call;
const today = B.env.today_(), yesterday = B.env.yesterday_();
const heads = name => B.sheets[name].data[0].filter(Boolean);

// ── Setup ───────────────────────────────────────────────────────────────
const TABS = ['Teams', 'Roster', 'Attendance', 'Reports', 'Photos', 'Audit'];
ok('setup creates Teams, Roster, Attendance, Reports, Photos, Audit', TABS.every(n => B.sheets[n]), Object.keys(B.sheets).join());
ok('no sign-in tabs (Users, Sessions, Devices) and no old DailyReports/AuditLog tabs', !['Users', 'Sessions', 'Devices', 'DailyReports', 'AuditLog', 'Requests', 'Revisions'].some(n => B.sheets[n]), Object.keys(B.sheets).join());
ok('setup is safe to re-run (4 teams, 34 roster rows)', B.sheets.Teams.getLastRow() === 5 && B.sheets.Roster.getLastRow() === 35, B.sheets.Roster.getLastRow());
ok('Teams columns: Team ID, Team, Short Name, Leadman, Unit, Active (no PIN)', heads('Teams').join('|') === 'Team ID|Team|Short Name|Leadman|Unit|Active', heads('Teams').join('|'));
ok('each team has its leadman in the Teams tab', B.env.readAll_('Teams').map(t => t.leadman).join() === 'Pijay Tanjeco,Glenn Butiong,Allan Miranda,Gilbert Rivera');
ok('Reports: important columns first', heads('Reports').slice(0, 12).join('|') === 'Date|Team|Location|Activity|Status|Present|Target|Actual|Unit|Before|After|Submitted', heads('Reports').join('|'));
ok('Reports keeps IDs, version, timestamps further right', ['Report ID', 'Version', 'Revision', 'Created', 'Updated', 'Request ID', 'Device', 'First Submitted'].every(h => heads('Reports').includes(h)));
ok('Attendance: readable columns first', heads('Attendance').slice(0, 6).join('|') === 'Date|Team|Name|Role|Status|Reason / Note');
ok('no sign-in secrets are kept; the audit secret is', !['TOKEN_SECRET', 'PIN_SECRET', 'DEVICE_SECRET'].some(k => B.props[k]) && (B.props.AUDIT_SECRET || '').length > 40);
ok('no PIN, token, session or setup-key code left in the backend', !/pinHash_|normalizePins_|verify_\(|signed_\(|unsign_\(|loginGate_|enroll_|SESSION_HOURS|deviceKey|TOKEN_SECRET'\)|newSetupLink_/.test(CODE));
ok('no demo PINs in the backend code', !/'(0000|1111|2222|3333|4444)'/.test(CODE));

// ── The web API is only the four field actions ──────────────────────────
ok('API actions: teams, team, uploadPhoto, submitReport', Object.keys(B.env.ACTIONS).sort().join() === 'submitReport,team,teams,uploadPhoto', Object.keys(B.env.ACTIONS).join());
for (const action of ['login', 'enroll', 'crews', 'logout', 'load', 'saveAttendance', 'reopenReport', 'removePhoto', 'photoView', 'addMember', 'archiveMember', 'exportCsv', 'adminReports', 'auditLog', 'revisions', 'devices', 'revokeDevice']) {
  const x = call({ action, teamId: 'team2', reportDate: today, reason: 'x y z', from: today, to: today });
  ok(`admin/old action "${action}" is not reachable over the web`, !x.ok && /needs updating/.test(x.error), JSON.stringify(x));
}
ok('bad JSON refused', JSON.parse(B.env.doPost({ postData: { contents: '{nope' } }).s).error === 'Bad request');

// ── Teams + team ────────────────────────────────────────────────────────
let r = call({ action: 'teams' });
ok('teams: every active team with leadman and unit', r.ok && r.teams.length === 4 && r.teams[1].teamId === 'team2' && r.teams[1].leadman === 'Glenn Butiong' && r.teams[1].unit === 'KM' && r.today === today, JSON.stringify(r.teams[1]));
B.env.upsert_('Teams', 'team4', { active: 'No' });
ok('an inactive team is not offered', call({ action: 'teams' }).teams.length === 3);
ok('an inactive team cannot be opened', /not in the list/.test(call({ action: 'team', teamId: 'team4' }).error));
B.env.upsert_('Teams', 'team4', { active: 'Yes' });
ok('unknown team refused', /not in the list/.test(call({ action: 'team', teamId: 'nope' }).error));
let T2 = call({ action: 'team', teamId: 'team2' });
ok('team: crew list (leadman first) and no reports yet', T2.ok && T2.roster.length === 9 && T2.roster[0].name === 'Glenn Butiong' && T2.roster[0].role === 'Leadman' && T2.reports.length === 0 && T2.team.name === 'Segment 10 Scupper Drain', JSON.stringify(T2.roster[0]));
ok('team: returns the server clock and Manila date', Math.abs(T2.serverTime - Date.now()) < 5000 && T2.today === today);

// ── Photos ──────────────────────────────────────────────────────────────
const up = (extra) => call({ action: 'uploadPhoto', teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, clientId: uid(), deviceId: 'phone-aaaa-1111', ...extra });
const html = Buffer.from('<html><script>alert(1)</script></html>'.repeat(5)).toString('base64');
ok('HTML disguised as a JPEG refused (file bytes checked)', /not a real JPEG/.test(up({ dataUrl: 'data:image/jpeg;base64,' + html }).error || ''));
ok('JPEG declared as PNG refused', /not a real/.test(up({ dataUrl: 'data:image/png;base64,' + jpegBytes.toString('base64') }).error || ''));
ok('oversize photo refused', /too large/.test(up({ dataUrl: 'data:image/jpeg;base64,' + Buffer.concat([jpegBytes, Buffer.alloc(6.5 * 1024 * 1024)]).toString('base64') }).error || ''));
ok('non-image upload refused', !up({ dataUrl: 'data:text/html;base64,PGgxPg==' }).ok);
ok('upload without a photo ID refused', !up({ clientId: undefined }).ok);
ok('photo for a future date refused', /ahead/.test(up({ reportDate: B.env.shiftDate_(today, 1) }).error || ''));
ok('photo for an old date refused', /older than yesterday/.test(up({ reportDate: B.env.shiftDate_(today, -3) }).error || ''));
ok('PNG and WebP photos accepted', up({ dataUrl: 'data:image/png;base64,' + pngBytes.toString('base64'), teamId: 'team1' }).ok && up({ dataUrl: 'data:image/webp;base64,' + webpBytes.toString('base64'), teamId: 'team1' }).ok);
const truncated = Buffer.concat([jpegBytes.slice(0, jpegBytes.length - 40)]);
ok('damaged (cut-off) JPEG refused and audited', /damaged/.test(up({ dataUrl: 'data:image/jpeg;base64,' + truncated.toString('base64') }).error || '') && B.env.readAll_('Audit').some(a => a.action === 'photo refused'));
const cBefore = uid();
r = up({ clientId: cBefore, originalFilename: 'IMG_0001.jpg', capturedAt: today + ' 07:12', location: 'Km.11' });
ok('before photo uploaded to Drive', r.ok && r.photo.photoId && r.photo.clientId === cBefore, JSON.stringify(r));
const beforeId = r.photo.photoId, pb = B.env.row_('Photos', beforeId), f1 = B.files[pb.fileId];
ok('photo stored private, in date/team folder, with metadata', f1.folder.name === 'Segment 10' && f1.blob.name.startsWith(today + '_Segment10_BEFORE_') && f1.access === 'private' && pb.leadman === 'Glenn Butiong' && pb.capturedAt === today + ' 07:12' && pb.device === 'phone-aaaa-1111');
r = up({ clientId: cBefore });
ok('retried upload returns the same photo, no duplicate', r.ok && r.replay && r.photo.photoId === beforeId && B.env.readAll_('Photos').filter(p => p.teamId === 'team2').length === 1);
ok('photo ID reused on another type refused', /another report/.test(up({ clientId: cBefore, type: 'after' }).error || ''));
ok('photo reply carries no Drive file link', !('fileId' in r.photo) && !('fileUrl' in r.photo));
const cOld = uid();
const oldBefore = up({ clientId: cOld }).photo.photoId;
ok('a newer before photo replaces the older one', B.env.row_('Photos', beforeId).status === 'Replaced' && B.env.row_('Photos', oldBefore).status === 'Active');

// ── Report rules (all checked on the server) ────────────────────────────
const roster2 = T2.roster;
const att = (map = {}) => roster2.map(m => ({ personId: m.personId, status: map[m.name] ? map[m.name][0] : 'Present', note: map[m.name] ? map[m.name][1] || '' : '' }));
const absent = { 'Rolando Faustino': ['Leave'], 'Abraham Balmeo': ['Other', '=Medical check-up'] };
const form = { fromTime: '07:00', toTime: '16:00', location: 'Km.11+000 to km.10+020 C3 exit ramp', activityDetails: 'Cleaning of clogged scupper drain',
  status: 'Complete', target: '1', actual: '1', unit: 'KM', plateNumber: 'nku 8624', remarks: '=HYPERLINK("x")', actualManpower: '50' };
const submit = (f, extra = {}) => call({ action: 'submitReport', teamId: 'team2', reportDate: today, attendance: att(absent), report: f, beforePhotoId: beforeId, deviceId: 'phone-aaaa-1111', ...extra });
r = submit(form);
ok('Complete without After photo refused by server', !r.ok && r.missing.length === 1 && /After photo/.test(r.missing[0]), JSON.stringify(r.missing));
const bad = (name, f, re, extra) => { const x = submit({ ...form, status: 'Ongoing', ...f }, extra); ok(name, !x.ok && x.missing && x.missing.some(m => re.test(m)), JSON.stringify(x.missing || x.error)); };
bad('start after end refused', { fromTime: '16:00', toTime: '07:00' }, /before end/);
bad('invalid time refused', { fromTime: '25:00' }, /start and end time/);
bad('missing location refused', { location: '  ' }, /location/);
bad('missing work description refused', { activityDetails: '' }, /work done/);
bad('negative number refused', { actual: '-1' }, /actual as a number/);
bad('text in a number refused', { target: 'abc' }, /target as a number/);
bad('huge target refused', { target: '99999' }, /Target looks wrong/);
bad('fractional locations refused', { unit: 'Locations', target: '1.5' }, /whole number/);
bad('unknown status refused', { status: 'Done' }, /Ongoing or Complete/);
bad('unknown unit refused', { unit: 'Miles' }, /unit/);
bad('bad plate characters refused', { plateNumber: 'NKU<8624>' }, /plate/);
bad('too-long remarks refused', { remarks: 'x'.repeat(1001) }, /Remarks are too long/);
bad('no Before photo refused', {}, /Before photo/, { beforePhotoId: '' });
bad('a photo of another team cannot be used', {}, /Before photo/, { beforePhotoId: B.env.readAll_('Photos').find(p => p.teamId === 'team1').photoId });
bad('nobody present refused', {}, /at least one/, { attendance: roster2.map(m => ({ personId: m.personId, status: 'Sick' })) });
r = submit({ ...form, status: 'Ongoing' }, { attendance: att(absent).slice(1) });
ok('someone on the crew not marked → "check attendance again"', !r.ok && r.rosterChanged && /Glenn Butiong/.test(r.missing[0]), JSON.stringify(r));
r = submit({ ...form, status: 'Ongoing' }, { attendance: att(absent).concat({ personId: 'team3-elmer-dordulo', status: 'Present' }) });
ok('a person from another team refused', !r.ok && r.rosterChanged);
r = submit({ ...form, status: 'Ongoing' }, { attendance: att({ 'Ian Enriquez': ['Absent'] }) });
ok('a status other than Present/Sick/Leave/No Show/Other refused', !r.ok && r.rosterChanged && /Ian Enriquez/.test(r.missing[0]));
ok('submit without a request ID refused', /needs updating/.test(B.raw({ action: 'submitReport', teamId: 'team2', reportDate: today, attendance: att(), report: form }).error || ''));
ok('nothing was written by the refused submits', !B.env.row_('Reports', 'team2|' + today) && B.env.readAll_('Attendance').length === 0);

const cAfter = uid();
const afterId = up({ type: 'after', clientId: cAfter, originalFilename: 'IMG_0002.jpg' }).photo.photoId;
const subReq = uid();
r = submit(form, { beforeClientId: cBefore, beforePhotoId: '', afterPhotoId: afterId, requestId: subReq });
ok('report submitted (photo named by the phone\'s own ID works)', r.ok && r.version === '1' && /^R\d{8}-team2-/.test(r.reportId) && r.crewPresent === '7/9', JSON.stringify(r));
const reportId = r.reportId, rep = () => B.env.row_('Reports', 'team2|' + today);
ok('actual manpower is counted from attendance, never taken from the phone', rep().actualManpower === '7' && rep().targetManpower === '9' && rep().crewPresent === '7/9', rep().actualManpower);
ok('Reports row: date, team, location, activity, status, present, target, actual first', B.sheets.Reports.data[1].slice(0, 9).join('|') === [today, 'Segment 10 Scupper Drain', form.location, form.activityDetails, 'Complete', '7/9', '1', '1', 'KM'].join('|'), B.sheets.Reports.data[1].slice(0, 9).join('|'));
ok('plate stored in capitals; remarks stored as text, not a formula', rep().plateNumber === 'NKU 8624' && rep().remarks === form.remarks && B.sheets.Reports.getRange(2, B.env.col_('Reports', 'remarks')).getFormulas()[0][0] === '');
ok('photo cells link to the private Drive file', /^=HYPERLINK\("https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view","Before photo"\)$/.test(B.sheets.Reports.getRange(2, B.env.col_('Reports', 'beforePreview')).getFormulas()[0][0]));
ok('the named photo is used even though an older one was replaced after it', rep().beforePhotoId === beforeId && B.env.row_('Photos', beforeId).status === 'Active' && B.env.row_('Photos', oldBefore).status === 'Replaced' && B.env.row_('Photos', beforeId).reportId === reportId);
const A = B.env.readAll_('Attendance').filter(a => a.teamId === 'team2');
ok('attendance: one row per person, with team name, status and reason', A.length === 9 && A.every(a => a.team === 'Segment 10 Scupper Drain' && a.reportId === reportId) && A.find(a => a.name === 'Rolando Faustino').status === 'Leave' && A.find(a => a.name === 'Abraham Balmeo').note === '=Medical check-up');
ok('attendance text is never run as a formula', B.sheets.Attendance.data.some(row => row.includes("'=Medical check-up")));
ok('absent list readable in the report', rep().absentList === 'Rolando Faustino (Leave); Abraham Balmeo (Other: =Medical check-up)', rep().absentList);
ok('device and request ID kept', rep().device === 'phone-aaaa-1111' && rep().lastRequestId === subReq);
const subAudit = B.env.readAll_('Audit').filter(a => a.action === 'report submitted').pop();
ok('audit: report submitted, by the team\'s leadman (field app), server time, device, request ID', subAudit && subAudit.user === 'Glenn Butiong' && subAudit.role === 'field app' && subAudit.entityId === reportId && subAudit.device === 'phone-aaaa-1111' && subAudit.requestId === subReq && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(subAudit.at), JSON.stringify(subAudit));

// ── Duplicate protection ────────────────────────────────────────────────
r = submit(form, { afterPhotoId: afterId, requestId: subReq });
ok('same submit sent again (retry after no signal) → first answer back, still version 1', r.ok && r.replay && r.reportId === reportId && rep().version === '1');
r = submit(form, { afterPhotoId: afterId });
ok('a second report for the same team and day is refused, the first is kept', !r.ok && r.alreadySubmitted && r.reportId === reportId && /already sent at/.test(r.error) && rep().version === '1', JSON.stringify(r));
ok('…and the refused duplicate is in the audit log', B.env.readAll_('Audit').some(a => a.action === 'duplicate report refused' && a.entityId === reportId));
r = up({ type: 'after' });
ok('a photo for a report already sent is refused', !r.ok && r.alreadySubmitted);
T2 = call({ action: 'team', teamId: 'team2' });
ok('team shows today\'s report as sent (the app locks it)', T2.reports.length === 1 && T2.reports[0].reportDate === today && T2.reports[0].present === '7/9' && T2.reports[0].before && T2.reports[0].after);

// ── Concurrency: writes take the script lock ────────────────────────────
const realLock = B.env.LockService.getScriptLock;
B.env.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
r = submit(form, { afterPhotoId: afterId, reportDate: today, teamId: 'team2' });
ok('when the lock cannot be had, nothing is written and the phone retries', !r.ok && r.retry === true);
B.env.LockService.getScriptLock = realLock;

// ── Ongoing: After photo optional; yesterday allowed ────────────────────
const T3 = call({ action: 'team', teamId: 'team3' });
const b3 = call({ action: 'uploadPhoto', teamId: 'team3', reportDate: yesterday, type: 'before', dataUrl: img, clientId: uid() }).photo.photoId;
const form3 = { fromTime: '07:00', toTime: '16:00', location: 'CANDABA VIADUCT', activityDetails: 'Epoxy injection', status: 'Ongoing', target: '3', actual: '2', unit: 'Locations', plateNumber: '', remarks: '' };
r = call({ action: 'submitReport', teamId: 'team3', reportDate: yesterday, attendance: T3.roster.map(m => ({ personId: m.personId, status: 'Present' })), report: form3, beforePhotoId: b3 });
ok('Ongoing with no After photo, no plate and no remarks is accepted (yesterday\'s report, sent late)', r.ok && r.crewPresent === '9/9' && r.late === 'Yes', JSON.stringify(r));
const b3t = call({ action: 'uploadPhoto', teamId: 'team3', reportDate: today, type: 'before', dataUrl: img, clientId: uid() }).photo.photoId;
r = call({ action: 'submitReport', teamId: 'team3', reportDate: today, attendance: T3.roster.map((m, i) => ({ personId: m.personId, status: i === 8 ? 'No Show' : 'Present' })), report: form3, beforePhotoId: b3t });
ok('team3 today submitted with one No Show', r.ok && r.crewPresent === '8/9');

// ── Roster edited in the Sheet ──────────────────────────────────────────
const rosterSheet = B.sheets.Roster, nr = rosterSheet.getLastRow();
rosterSheet.data[nr] = []; rosterSheet.data[nr][B.env.col_('Roster', 'teamId') - 1] = 'team1'; rosterSheet.data[nr][B.env.col_('Roster', 'name') - 1] = 'Pedro Penduko';
B.env.CACHE = {};
const T1 = call({ action: 'team', teamId: 'team1' });
ok('a crew member typed into the Roster tab gets an ID and appears in the app', T1.roster.some(m => m.name === 'Pedro Penduko' && m.personId === 'team1-pedro-penduko' && m.role === 'Crew') && B.env.row_('Roster', 'team1-pedro-penduko').status === 'Active');
B.env.upsert_('Roster', 'team1-rocky-miranda', { status: 'Archived' });
ok('an archived crew member is left out', !call({ action: 'team', teamId: 'team1' }).roster.some(m => m.name === 'Rocky Miranda'));
const b1 = call({ action: 'uploadPhoto', teamId: 'team1', reportDate: today, type: 'before', dataUrl: img, clientId: uid() }).photo.photoId;
r = call({ action: 'submitReport', teamId: 'team1', reportDate: today, attendance: T1.roster.filter(m => m.name !== 'Pedro Penduko').map(m => ({ personId: m.personId, status: 'Present' })), report: { ...form3, location: 'Km 40' }, beforePhotoId: b1 });
ok('a phone with an old crew list is asked to check attendance again', !r.ok && r.rosterChanged && /Pedro Penduko/.test(r.missing[0]), JSON.stringify(r));

// ── Admin (Sheet menu): reopen ──────────────────────────────────────────
const throws = f => { try { f(); return ''; } catch (e) { return String(e.message || e); } };
ok('reopen needs a reason', /reason/.test(throws(() => B.env.reopenReport('team2', today, ''))));
ok('reopen of an old date refused', /today's or yesterday's/.test(throws(() => B.env.reopenReport('team2', B.env.shiftDate_(today, -5), 'wrong location'))));
ok('reopen of a report not sent refused', /no submitted report/.test(throws(() => B.env.reopenReport('team4', today, 'wrong location'))));
B.env.reopenReport('team2', today, 'Wrong location typed');
ok('reopened report is unlocked for the app', rep().state === 'reopened' && rep().reopenReason === 'Wrong location typed' && call({ action: 'team', teamId: 'team2' }).reports.length === 0);
const reo = B.env.readAll_('Audit').filter(a => a.action === 'report reopened').pop();
ok('reopen audit keeps the submitted version (fields + attendance) and the reason', reo && reo.role === 'admin' && JSON.parse(reo.before).location === form.location && JSON.parse(reo.before).attendance.length === 9 && reo.reason === 'Wrong location typed');
const after2 = up({ type: 'after' }).photo.photoId;
r = submit({ ...form, location: 'Km.12' }, { attendance: att({ ...absent, 'Ian Enriquez': ['Sick'] }), afterPhotoId: after2 });
ok('resubmit after reopen: version 2, same report ID', r.ok && r.version === '2' && r.reportId === reportId && rep().crewPresent === '6/9', JSON.stringify(r));
const last = B.env.readAll_('Audit').filter(a => a.action.startsWith('report resubmitted')).pop();
ok('resubmit audit: why it was reopened and what changed (fields, attendance, photo)', last && /Reopened because: Wrong location typed/.test(last.reason) && /location: .* → "Km.12"/.test(last.reason) && /Ian Enriquez: Present → Sick/.test(last.reason) && /after photo changed/.test(last.reason) && JSON.parse(last.before).location === form.location, last && last.reason);
ok('replaced photos kept in the Photos tab', B.env.readAll_('Photos').filter(p => p.teamId === 'team2' && p.type === 'after').map(p => p.status).join() === 'Replaced,Active');
ok('attendance history: the day keeps one row per person (updated)', B.env.readAll_('Attendance').filter(a => a.teamId === 'team2' && a.reportDate === today).length === 9 && B.env.row_('Attendance', 'team2|' + today + '|team2-ian-enriquez').status === 'Sick');

// ── Audit chain ─────────────────────────────────────────────────────────
ok('audit log verifies (hash chain + checkpoint)', B.env.verifyAuditLog().ok);
const au = B.sheets.Audit, keep = au.data[3][10];
au.data[3][10] = 'edited by hand';
ok('a hand edit in the Audit tab is detected', !B.env.verifyAuditLog().ok);
au.data[3][10] = keep;
const auditTab = B.sheets.Audit; delete B.sheets.Audit;
B.env.audit_({ name: 'x', role: 'test' }, '', 'test entry', '', '', null, null, '');
B.sheets.Audit = auditTab;
ok('an audit entry that cannot be written is never silent', B.env.auditFailures_() && B.env.auditFailures_().count >= 1);
B.env.clearAuditFailures();

// ── Accomplishment Report tab (filled automatically) ────────────────────
const ACC = B.sheets['Accomplishment Report'];
const accRows = () => ACC.data.slice(3).filter(x => x && x[15]);
ok('Accomplishment Report tab has the report layout', ACC && String(ACC.data[0][0]).startsWith('Bridge Team Accomplishment Report') && ACC.data[2].slice(0, 15).join('|') === '#|Date|From|To|Location|Activity|Status|Before|After|Qty|Equipment|Qty|Manpower|Qty|Leadman/Driver');
const a2 = accRows().find(x => x[15] === reportId);
ok('each submitted report fills a row; a resubmit updates it (no duplicate)', a2 && accRows().filter(x => x[15] === reportId).length === 1 && a2[1] === today && a2[4] === 'Km.12' && a2[6] === 'COMPLETE' && a2[10] === 'NKU 8624' && a2[14] === 'Glenn Butiong', JSON.stringify(a2));
ok('…with crew present (leadman in his own column)', a2[11] === '5' && !a2[12].includes('Glenn Butiong') && !a2[12].includes('Ian Enriquez') && a2[13] === '1', a2[11] + ' / ' + a2[12]);
const accSet = () => JSON.stringify(accRows().map(x => x.slice(1)).sort((a, b) => a[14].localeCompare(b[14])));
const accBefore = accSet();
ok('rebuildAccomplishmentReport() regenerates the same rows (in date order)', B.env.rebuildAccomplishmentReport() === 3 && accSet() === accBefore && accRows()[0][1] === yesterday);

// ── Client report tabs ──────────────────────────────────────────────────
const TR = B.sheets['Segment 10 Scupper Drain'], AT = B.sheets['Attendance Segment 10'];
ok('client tabs exist', ['Bridge RM_Team 1', 'Segment 10 Scupper Drain', 'Bridge Epoxy', 'Attendance Bridge RM', 'Attendance Segment 10', 'Attendance Epoxy 1-2', 'Bridge_Conso', 'Summary per Activity', 'Monthly Summary(Raw)'].every(n => B.sheets[n]));
const tr = TR.data.slice(1).find(x => x && x[21] === reportId);
const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T12:00:00Z').getUTCDay()];
ok('team tab row: weekday, times, location, status, plate, manpower, leadman', tr && tr[0] === wd && tr[2] === '07:00' && tr[4] === 'Km.12' && tr[7] === 'COMPLETE' && tr[14] === 'NKU 8624' && tr[15] === '9' && tr[16] === '6' && tr[20] === 'Glenn Butiong' && tr[17].split('\n').includes('DE MESA, GLEN JORICK M.'), JSON.stringify(tr));
const col = AT.data[1].indexOf(today), gridPeople = AT.data.slice(3, 12), mark = n => gridPeople.find(x => x[2] === n)[col];
ok('attendance grid: 1 = present, 0 = not present', col > 2 && mark('BUTIONG, GLENN A.') === 1 && mark('FAUSTINO, ROLANDO G.') === 0 && mark('ENRIQUEZ, IAN T.') === 0 && mark('DE MESA, GLEN JORICK M.') === 1);
const EP = B.sheets['Bridge Epoxy'], rep3 = B.env.row_('Reports', 'team3|' + today), ep = EP.data.slice(1).find(x => x && x[21] === rep3.reportId);
ok('Bridge Epoxy tab: Target/Actual (Loc), leadman in capitals', ep && ep[8] === '3' && ep[9] === '2' && ep[20] === 'ALLAN MIRANDA', JSON.stringify(ep));
const CO = B.sheets['Bridge_Conso'], coRows = CO.data.slice(1).filter(x => x && x[26]);
ok('Bridge_Conso: one row per report', coRows.length === 3 && coRows.find(x => x[26] === reportId)[8] === '1');
const MS = B.sheets['Monthly Summary(Raw)'];
ok('Monthly Summary(Raw): rows + Grand Total', MS.data.slice(1).filter(x => x && x[0]).pop()[0] === 'Grand Total');
const trBefore = JSON.stringify(TR.data.slice(1).filter(x => x && x[21]));
B.env.rebuildClientTabs();
ok('rebuildClientTabs() regenerates the same rows', JSON.stringify(B.sheets['Segment 10 Scupper Drain'].data.slice(1).filter(x => x && x[21])) === trBefore);

// ── Export (Sheet menu) ─────────────────────────────────────────────────
r = B.env.exportReports(yesterday, today);
const lines = r.csv.split('\r\n');
ok('export: readable columns first, one row per report', lines[0].startsWith('Date,Team,Location,Activity,Status,Present,Target,Actual') && r.rows === 3, lines[0]);
ok('export: formulas neutralised', r.csv.includes(`"'=HYPERLINK(""x"")"`) && !/,=/.test(r.csv));
const xl = Object.values(B.exports).pop();
ok('export: separate Excel file in the Exports folder', r.xlsxUrl.includes(xl.id) && xl.folder && xl.folder.name === 'Exports' && xl.sheet.data.length === 4);
ok('export range backwards refused', /on or before/.test(throws(() => B.env.exportReports(today, yesterday))));

// ── App link (Sheet menu) ───────────────────────────────────────────────
ok('app link: Netlify app with this backend\'s URL (no key)', B.env.appLink().link === 'https://bridge-nlex-report.netlify.app/?backend=' + encodeURIComponent(B.service.url));
B.service.url = 'https://script.google.com/macros/s/TEST/dev';
ok('app link refuses the /dev test address', B.env.appLink().ok === false && B.env.showAppLink() === '');
B.service.url = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';

// ── Upgrade the live (v2, PIN sign-in) Sheet in place ───────────────────
const M = makeBackend({ code: path.join(FIX, 'Code-v2.gs') });
M.env.setup({ pins: ['0000', '1111', '2222', '3333', '4444'] });
const v2 = M.legacyCall({ action: 'login', pin: '2222', device: 'old' });
const v2l = M.legacyCall({ action: 'load', token: v2.token });
M.legacyCall({ action: 'saveAttendance', token: v2.token, teamId: 'team2', reportDate: today, people: v2l.roster.map(m => ({ personId: m.personId, status: m.name === 'Abraham Balmeo' ? 'Sick' : 'Present' })), baseRev: '0' });
const v2b = M.legacyCall({ action: 'uploadPhoto', token: v2.token, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, clientId: uid() }).photo.photoId;
const v2r = M.legacyCall({ action: 'submitReport', token: v2.token, teamId: 'team2', reportDate: today, report: { ...form, status: 'Ongoing', remarks: 'still going', targetManpower: '9', actualManpower: '8' }, baseRev: '1', beforePhotoId: v2b });
ok('v2 fixture: report submitted with the old app', v2r.ok, JSON.stringify(v2r));
M.env.upsert_('Teams', 'team3', { name: 'Bridge Epoxy 1' });
const auditN = M.env.readAll_('AuditLog').length;
vm.runInContext(CODE, M.env);
M.env.setup();
ok('upgrade: DailyReports → Reports, AuditLog → Audit; sign-in tabs removed', !!M.sheets.Reports && !M.sheets.DailyReports && !!M.sheets.Audit && !M.sheets.AuditLog && !M.sheets.Users && !M.sheets.Sessions && !M.sheets.Devices, Object.keys(M.sheets).join());
ok('upgrade: old Revisions and Requests tabs kept but hidden', M.sheets.Revisions && M.sheets.Revisions.hidden && M.sheets.Requests && M.sheets.Requests.hidden);
ok('upgrade: sign-in secrets and setup links removed', !['TOKEN_SECRET', 'PIN_SECRET', 'DEVICE_SECRET'].some(k => M.props[k]) && !Object.keys(M.props).some(k => k.startsWith('ENR_')) && !!M.props.AUDIT_SECRET);
ok('upgrade: Teams gets each leadman (from the old Users tab), no PIN column', M.env.readAll_('Teams').map(t => t.leadman).join() === 'Pijay Tanjeco,Glenn Butiong,Allan Miranda,Gilbert Rivera' && M.sheets.Teams.data[0].join('|') === 'Team ID|Team|Short Name|Leadman|Unit|Active');
const mr = M.env.row_('Reports', 'team2|' + today);
ok('upgrade: the submitted report keeps every value, in the new column order', mr.state === 'submitted' && mr.reportId === v2r.reportId && mr.location === form.location && mr.crewPresent === '8/9' && mr.actualManpower === '8' && mr.fromTime === '07:00' && mr.beforePhotoId === v2b && M.sheets.Reports.data[1][0] === today && M.sheets.Reports.data[1][1] === 'Segment 10 Scupper Drain', JSON.stringify(mr));
ok('upgrade: photo link formula kept', /^=HYPERLINK/.test(M.sheets.Reports.getRange(2, M.env.col_('Reports', 'beforePreview')).getFormulas()[0][0]));
ok('upgrade: attendance history kept, with team names filled in', M.env.readAll_('Attendance').length === 9 && M.env.readAll_('Attendance').every(a => a.team === 'Segment 10 Scupper Drain') && M.env.readAll_('Attendance').find(a => a.name === 'Abraham Balmeo').status === 'Sick');
ok('upgrade: audit history kept and still verifies', M.env.readAll_('Audit').length > auditN && M.env.verifyAuditLog().ok, JSON.stringify(M.env.verifyAuditLog()));
r = M.call({ action: 'submitReport', teamId: 'team2', reportDate: today, attendance: [], report: form });
ok('upgrade: today\'s report sent with the old app is locked for the new app', !r.ok && r.alreadySubmitted);
ok('upgrade: the new app works on the upgraded Sheet', M.call({ action: 'team', teamId: 'team1' }).roster.length === 8 && M.call({ action: 'teams' }).teams.length === 4);
ok('upgrade: the old sign-in no longer works', /needs updating/.test(M.raw({ action: 'login', pin: '2222' }).error));

// ── Upgrade a v1 Sheet (PINs in Teams, "Reports" and "Audit" tabs) ──────
const V = makeBackend({ code: path.join(FIX, 'Code-v1.gs') });
V.env.setup({ demoPins: true });
const v1 = V.legacyCall({ action: 'login', pin: '2222', device: 'old', setupKey: V.props.SETUP_KEY });
V.env.CACHE = {};
const v1l = JSON.parse(V.env.doPost({ postData: { contents: JSON.stringify({ action: 'load', token: v1.token }) } }).s);
V.env.doPost({ postData: { contents: JSON.stringify({ action: 'saveAttendance', token: v1.token, teamId: 'team2', reportDate: today, people: v1l.roster.map(m => ({ personId: m.personId, status: m.name === 'Abraham Balmeo' ? 'Absent' : 'Present', absenceReason: m.name === 'Abraham Balmeo' ? 'Sick' : '' })) }) } });
vm.runInContext(CODE, V.env);
V.env.setup();
ok('v1 upgrade: v1 Audit kept as "Audit (v1)", new Audit tab made', !!V.sheets['Audit (v1)'] && V.sheets.Audit.data[0][0] === 'Audit ID');
ok('v1 upgrade: Teams keeps the leadmen, PIN column and admin row gone', V.env.readAll_('Teams').length === 4 && V.env.readAll_('Teams')[1].leadman === 'Glenn Butiong' && !V.sheets.Teams.data[0].some(h => /PIN/.test(h)));
ok('v1 upgrade: old absence reason kept as the note', V.env.readAll_('Attendance').find(a => a.name === 'Abraham Balmeo').note === 'Sick');
ok('v1 upgrade: report row has a report ID', /^R\d{8}-team2-/.test(V.env.row_('Reports', 'team2|' + today).reportId));

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
