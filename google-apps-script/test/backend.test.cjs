// Runs the real Code.gs against in-memory Google services.
// Usage: node google-apps-script/test/backend.test.cjs
const { makeBackend } = require('./fake-gas.cjs');

let failed = 0;
const ok = (name, cond, detail) => { if (!cond) failed++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined && !cond ? '  [' + detail + ']' : '')); };
const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

const B = makeBackend();
B.env.setup({ demoPins: true }); B.env.setup({ demoPins: true });
const call = B.call;
const today = B.env.today_(), yesterday = B.env.yesterday_();

// ── Setup ───────────────────────────────────────────────────────────────
ok('setup creates all tabs', ['Teams', 'Roster', 'Attendance', 'Reports', 'Photos', 'Audit'].every(n => B.sheets[n]));
ok('setup is safe to re-run (5 team rows, 34 roster rows)', B.sheets.Teams.getLastRow() === 6 && B.sheets.Roster.getLastRow() === 35, B.sheets.Roster.getLastRow());
const R = require('./fake-gas.cjs').makeBackend(); R.env.setup();
const rp = R.env.readAll_('Teams').map(t => t.pin);
ok('real setup makes 5 different random PINs, none of the demo ones', rp.length === 5 && new Set(rp).size === 5 && rp.every(p => /^\d{4}$/.test(p) && !['0000', '1111', '2222', '3333', '4444'].includes(p)), rp.join());
ok('token secret created', (B.props.TOKEN_SECRET || '').length > 40);

// ── Auth ────────────────────────────────────────────────────────────────
ok('no token → sign in again', call({ action: 'load' }).auth === true);
ok('tampered token rejected', call({ action: 'load', token: 'abc.def' }).auth === true);
ok('login without setup key refused', call({ action: 'login', pin: '0000', setupKey: 'wrong', device: 'x' }).notSetUp === true);
let r = call({ action: 'login', pin: '9999', device: 'phoneA' });
ok('wrong PIN rejected', !r.ok && r.wrongPin);
const admin = call({ action: 'login', pin: '0000', device: 'pc' });
const lead2 = call({ action: 'login', pin: '2222', device: 'phoneB' });
const lead3 = call({ action: 'login', pin: '3333', device: 'phoneC' });
ok('admin login', admin.ok && admin.user.role === 'admin');
ok('leadman login is bound to team', lead2.ok && lead2.user.role === 'leadman' && lead2.user.teamId === 'team2' && lead2.user.name === 'Glenn Butiong');
for (let i = 0; i < 5; i++) call({ action: 'login', pin: '1234', device: 'brute' });
ok('after 5 wrong PINs the device is locked, even with a correct PIN', /Too many/.test(call({ action: 'login', pin: '1111', device: 'brute' }).error || ''));
ok('other devices unaffected by that lock', call({ action: 'login', pin: '1111', device: 'phoneA' }).ok);

const T = { admin: admin.token, t2: lead2.token, t3: lead3.token };

// ── Scoping ─────────────────────────────────────────────────────────────
let L = call({ action: 'load', token: T.t2 });
ok('leadman load only returns own team', L.ok && L.teams.length === 1 && L.teams[0].teamId === 'team2' && L.roster.every(m => m.teamId === 'team2') && L.roster.length === 9);
ok('leadman does not get the Sheet link', L.sheetUrl === '');
const A = call({ action: 'load', token: T.admin });
ok('admin load returns all 4 teams + roster', A.teams.length === 4 && A.roster.length === 34 && A.sheetUrl.includes('SHEETID'));
ok('leadman cannot write another team', /own team/.test(call({ action: 'saveAttendance', token: T.t3, teamId: 'team2', reportDate: today, people: [] }).error));
ok('leadman cannot add crew', /Admin only/.test(call({ action: 'addMember', token: T.t2, teamId: 'team2', name: 'X' }).error));
ok('leadman cannot export', /Admin only/.test(call({ action: 'exportCsv', token: T.t2 }).error));

// ── Report rules ────────────────────────────────────────────────────────
const form = { fromTime: '07:00', toTime: '16:00', location: 'Km.11+000 to km.10+020 C3 exit ramp', activityDetails: 'Cleaning of clogged scupper drain',
  status: 'Complete', target: '1', actual: '1', unit: 'KM', targetManpower: '8', actualManpower: '7', plateNumber: 'nku 8624', remarks: '=HYPERLINK("x")' };
r = call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: form });
ok('submit blocked before attendance + photos', !r.ok && r.missing.includes('Submit attendance first (Attendance tab)') && r.missing.includes('Add a Before Work photo'));

const people = L.roster.map(m => ({ personId: m.personId, status: m.name === 'Abraham Balmeo' ? 'Absent' : 'Present' }));
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people });
ok('absent without reason rejected', !r.ok && /Abraham Balmeo/.test(r.error));
people.find(p => p.status === 'Absent').absenceReason = 'Leave';
r = call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: today, people });
ok('attendance saved', r.ok && r.crewPresent === '8/9', JSON.stringify(r));
ok('future date refused', /future/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: '2099-01-01', people }).error));
ok('old date locked for leadman', /locked/.test(call({ action: 'saveAttendance', token: T.t2, teamId: 'team2', reportDate: B.env.shiftDate_(today, -3), people }).error));

ok('non-image upload refused', !call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: 'data:text/html;base64,PGgxPg==' }).ok);
r = call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'before', dataUrl: img, originalFilename: 'IMG_0001.jpg' });
ok('before photo uploaded to Drive', r.ok && r.photo.fileId && r.photo.thumbnailUrl.includes(r.photo.fileId) && r.photo.uploadedBy === 'Glenn Butiong');
const f1 = B.files[r.photo.fileId];
ok('photo stored in date/team folder', f1.folder.name === 'Segment 10' && f1.blob.name.startsWith(today + '_Segment10_BEFORE_') && f1.shared);
r = call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: form });
ok('Complete needs After photo', !r.ok && r.missing.length === 1 && /After Work/.test(r.missing[0]));
ok('Ongoing does not need After photo', call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: { ...form, status: 'Ongoing', location: '' } }).missing.join() === 'Enter the location');
call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, originalFilename: 'IMG_0002.jpg' });
r = call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: form });
ok('report submitted', r.ok && r.version === '1' && r.submittedBy === 'Glenn Butiong', JSON.stringify(r));
ok('double submit refused', /already submitted/.test(call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: form }).error));
ok('photo change refused after submit', /Edit report/.test(call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img }).error));

// ── Cross-device: admin sees it ─────────────────────────────────────────
let A2 = call({ action: 'load', token: T.admin });
let rep = A2.reports.find(x => x.teamId === 'team2' && x.reportDate === today);
ok('admin sees submitted report', rep && rep.state === 'submitted' && rep.location === form.location && rep.plateNumber === 'NKU 8624' && rep.unit === 'KM');
ok('remarks stored as text, not a formula', B.sheets.Reports.getRange(2, B.env.col_('Reports', 'remarks')).getFormulas()[0][0] === '' && rep.remarks === form.remarks);
ok('photo previews in Sheet are IMAGE formulas', B.sheets.Reports.getRange(2, B.env.col_('Reports', 'beforePreview')).getFormulas()[0][0].startsWith('=IMAGE('));
ok('admin sees attendance with reason', A2.attendance.filter(a => a.teamId === 'team2').length === 9 && A2.attendance.find(a => a.name === 'Abraham Balmeo').absenceReason === 'Leave');
ok('admin sees 2 active photos', A2.photos.filter(p => p.teamId === 'team2').length === 2);
ok('other leadman cannot see team2', call({ action: 'load', token: T.t3 }).reports.every(x => x.teamId === 'team3'));

// ── Edit + audit ────────────────────────────────────────────────────────
ok('reopen', call({ action: 'reopenReport', token: T.t2, teamId: 'team2', reportDate: today }).ok);
call({ action: 'uploadPhoto', token: T.t2, teamId: 'team2', reportDate: today, type: 'after', dataUrl: img, originalFilename: 'IMG_0003.jpg' });
r = call({ action: 'submitReport', token: T.t2, teamId: 'team2', reportDate: today, report: { ...form, location: 'Km.12' } });
ok('resubmit bumps version', r.ok && r.version === '2');
const audit = B.env.readAll_('Audit');
const last = audit[audit.length - 1];
ok('audit records the change summary', last.action === 'report resubmitted (v2)' && /location: .* → "Km.12"/.test(last.changes) && /after photo replaced/.test(last.changes), last.changes);
ok('replaced photo kept in Photos tab', B.env.readAll_('Photos').filter(p => p.teamId === 'team2' && p.type === 'after').map(p => p.status).join() === 'Replaced,Active');

// ── Roster ──────────────────────────────────────────────────────────────
r = call({ action: 'addMember', token: T.admin, teamId: 'team2', name: '  Juan  Dela Cruz ' });
ok('admin adds crew', r.ok && r.personId === 'team2-juan-dela-cruz');
ok('duplicate name refused', /Already/.test(call({ action: 'addMember', token: T.admin, teamId: 'team2', name: 'juan dela cruz' }).error));
ok('archive', call({ action: 'archiveMember', token: T.admin, personId: r.personId }).ok);
ok('leadman cannot be archived', /leadman/i.test(call({ action: 'archiveMember', token: T.admin, personId: 'team2-glenn-butiong' }).error));
ok('restore', call({ action: 'restoreMember', token: T.admin, personId: r.personId }).ok && B.env.row_('Roster', r.personId).status === 'Active');

// ── Export ──────────────────────────────────────────────────────────────
r = call({ action: 'exportCsv', token: T.admin, from: yesterday, to: today });
const lines = r.csv.split('\r\n');
ok('CSV export from Sheet data', r.ok && r.rows === 1 && lines[0].startsWith('Date,Team,Leadman') && lines[1].includes('Segment 10 Scupper Drain') && lines[1].includes('drive.google.com/file/d/'));
ok('CSV neutralises formulas', lines[1].includes(`"'=HYPERLINK(""x"")"`), lines[1]);
ok('xlsx link', r.xlsxUrl.endsWith('/export?format=xlsx'));

// ── Session revocation ──────────────────────────────────────────────────
B.env.upsert_('Teams', 'team2', { pin: '2468' });
ok('changing a PIN signs that leadman out', call({ action: 'load', token: T.t2 }).auth === true);
ok('new PIN works', call({ action: 'login', pin: '2468', device: 'phoneB' }).ok);
B.env.signOutEveryone();
ok('signOutEveryone invalidates admin', call({ action: 'load', token: T.admin }).auth === true);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
