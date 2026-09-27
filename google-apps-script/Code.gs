/**
 * Bridge NLEX Daily Report — backend (Google Sheets + Google Drive + Apps Script).
 *
 * The Google Sheet this script is attached to is the database. Tabs:
 *   Teams       team list and sign-in PINs (admin edits PINs here)
 *   Roster      crew per team, Active or Archived, with a stable personId
 *   Attendance  one row per person per team per day
 *   Reports     one row per team per day (the activity report), with photo previews
 *   Photos      every photo uploaded to Drive, including replaced ones
 *   Audit       who changed what, when
 * Photos live in Drive: "Bridge NLEX Daily Report Photos/<yyyy-mm-dd>/<team>/".
 *
 * The web app (frontend/) calls doPost() with JSON. Every call except "login"
 * carries a signed session token; the token says who the user is and which team
 * they may touch. See docs/BACKEND.md for the full design.
 */

var TZ = 'Asia/Manila';
var PHOTO_ROOT = 'Bridge NLEX Daily Report Photos';
var SESSION_DAYS = 14;
var MAX_PHOTO_BYTES = 6 * 1024 * 1024;
var REASONS = ['Sick', 'Leave', 'No show', 'Other'];

// [field key, column header]. Field keys are what the app sends and receives.
var TABLES = {
  Teams: [
    ['teamId', 'Team ID'], ['name', 'Team'], ['short', 'Short Name'], ['leadman', 'Leadman'], ['pin', 'PIN (4 digits)'],
    ['defaultUnit', 'Default Unit'], ['active', 'Active (Yes/No)'],
  ],
  Roster: [
    ['personId', 'Person ID'], ['teamId', 'Team ID'], ['name', 'Name'], ['role', 'Role'], ['status', 'Status'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['archivedAt', 'Archived'], ['editedBy', 'Edited By'],
  ],
  Attendance: [
    ['key', 'Key'], ['reportDate', 'Date'], ['teamId', 'Team ID'], ['personId', 'Person ID'], ['name', 'Name'], ['role', 'Role'],
    ['status', 'Status'], ['absenceReason', 'Absence Reason'], ['submittedAt', 'Submitted'], ['submittedBy', 'Submitted By'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'],
  ],
  Reports: [
    ['key', 'Key'], ['reportDate', 'Date'], ['teamId', 'Team ID'], ['team', 'Team'], ['leadman', 'Leadman'], ['state', 'State'],
    ['fromTime', 'From'], ['toTime', 'To'], ['location', 'Location'], ['activityDetails', 'Activity Details'], ['status', 'Status'],
    ['target', 'Target'], ['actual', 'Actual'], ['unit', 'Unit'], ['targetManpower', 'Target Manpower'], ['actualManpower', 'Actual Manpower'],
    ['plateNumber', 'Equipment / Plate'], ['remarks', 'Remarks'], ['crewPresent', 'Crew Present'], ['absentList', 'Absent (reason)'],
    ['beforePreview', 'Before Photo'], ['afterPreview', 'After Photo'], ['beforePhotoId', 'Before Photo ID'], ['afterPhotoId', 'After Photo ID'],
    ['attendanceSubmittedAt', 'Attendance Submitted'], ['submittedAt', 'Report Submitted'], ['submittedBy', 'Submitted By'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['editedBy', 'Edited By'], ['version', 'Version'],
  ],
  Photos: [
    ['photoId', 'Photo ID'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['type', 'Type'], ['status', 'Status'],
    ['fileId', 'Drive File ID'], ['fileUrl', 'File URL'], ['thumbnailUrl', 'Thumbnail URL'], ['originalFilename', 'Original Filename'],
    ['uploadedAt', 'Uploaded'], ['uploadedBy', 'Uploaded By'],
  ],
  Audit: [
    ['at', 'Time'], ['user', 'User'], ['role', 'Role'], ['teamId', 'Team ID'], ['reportDate', 'Date'], ['action', 'Action'], ['changes', 'Changes'],
  ],
};
var KEY_FIELD = { Teams: 'teamId', Roster: 'personId', Attendance: 'key', Reports: 'key', Photos: 'photoId' };
var FORMULA_FIELDS = { beforePreview: true, afterPreview: true };

// Real crews from the prototype. setup() copies them into the Sheet once.
var SEED = [
  ['team1', 'Bridge RM_Team 1', 'RM Team 1', 'Pijay Tanjeco', '1111', 'Locations',
    [['Justin Billones', 'Skilled'], ['Ignacio Alcoriza Jr.', 'Crew'], ['Alvin Angelo', 'Crew'], ['Joven Blanza', 'Crew'], ['Rocky Miranda', 'Crew'], ['Richard Candelaria', 'Crew'], ['Crisostomo Sebuc', 'Crew']]],
  ['team2', 'Segment 10 Scupper Drain', 'Segment 10', 'Glenn Butiong', '2222', 'KM',
    [['Glen Jorick De Mesa', 'Skilled'], ['Justine Gregg Baylon', 'Skilled'], ['John Christian Bernardo', 'Crew'], ['Ian Enriquez', 'Crew'], ['Joanner Royce Quilao', 'Crew'], ['Rolando Faustino', 'Crew'], ['Richard Santiago', 'Crew'], ['Abraham Balmeo', 'Crew']]],
  ['team3', 'Bridge Epoxy 1', 'Epoxy 1', 'Allan Miranda', '3333', 'Locations',
    [['Elmer Dordulo', 'Skilled'], ['Edwin Lozano', 'Skilled'], ['R-Jay John Aquino', 'Crew'], ['Mark Joseph De Guzman', 'Crew'], ['Edbryan Dela Cruz', 'Crew'], ['Mark Ian Dungca', 'Crew'], ['Johnry Manese', 'Crew'], ['Eroll Pangilinan', 'Crew']]],
  ['team4', 'Bridge Epoxy 2', 'Epoxy 2', 'Gilbert Rivera', '4444', 'Locations',
    [['Alvin Galang', 'Skilled'], ['Ivan Cabunag', 'Crew'], ['AJ Enriquez', 'Crew'], ['Jaypee Occidental', 'Crew'], ['Edgar Ortillo', 'Crew'], ['Voltaire Rotamula', 'Crew'], ['Joshua Andrei Tayco', 'Crew']]],
];

// ════════════════════════════════════════════════════════════════════════════
// Setup (run once from the editor)
// ════════════════════════════════════════════════════════════════════════════

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABLES[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[1]; })])
      .setFontWeight('bold').setBackground('#0F2540').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    formatRows_(sh, name, 2, sh.getMaxRows() - 1);
  });
  var now = now_();
  if (readAll_('Teams').length === 0) {
    upsert_('Teams', 'admin', { teamId: 'admin', name: 'Operations Admin', short: 'Admin', leadman: '', pin: '0000', defaultUnit: '', active: 'Yes' });
    SEED.forEach(function (t) {
      upsert_('Teams', t[0], { teamId: t[0], name: t[1], short: t[2], leadman: t[3], pin: t[4], defaultUnit: t[5], active: 'Yes' });
    });
  }
  if (readAll_('Roster').length === 0) {
    SEED.forEach(function (t) {
      [[t[3], 'Leadman']].concat(t[6]).forEach(function (m) {
        var id = newPersonId_(t[0], m[0]);
        upsert_('Roster', id, { personId: id, teamId: t[0], name: m[0], role: m[1], status: 'Active', createdAt: now, updatedAt: now, editedBy: 'setup' });
      });
    });
  }
  var rep = ss.getSheetByName('Reports');
  rep.setColumnWidth(col_('Reports', 'beforePreview'), 110);
  rep.setColumnWidth(col_('Reports', 'afterPreview'), 110);
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN_SECRET')) props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('SETUP_KEY')) props.setProperty('SETUP_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  photoRoot_();
  Logger.log('Setup complete. Now: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).');
  Logger.log('Setup key (goes in the setup link, keep it private): ' + props.getProperty('SETUP_KEY'));
  Logger.log('IMPORTANT: change the demo PINs in the Teams tab before real use.');
}

/** Print the setup link to send to phones. Run from the editor after deploying; paste your app address below. */
function showSetupLink() {
  var APP_ADDRESS = 'https://YOUR-APP-ADDRESS/';            // where frontend/dist is hosted
  var url = ScriptApp.getService().getUrl();
  var key = PropertiesService.getScriptProperties().getProperty('SETUP_KEY');
  Logger.log(APP_ADDRESS + '?backend=' + encodeURIComponent(url) + '&key=' + key);
}

/** New setup key: old setup links stop working for new sign-ins (phones already signed in stay signed in). */
function newSetupKey() {
  PropertiesService.getScriptProperties().setProperty('SETUP_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  showSetupLink();
}

/** Sign everyone out (e.g. a phone was lost). Run from the editor. */
function signOutEveryone() {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP entry points
// ════════════════════════════════════════════════════════════════════════════

function doGet() {
  return out_({ ok: true, app: 'Bridge NLEX Daily Report API', time: now_() });
}

function doPost(e) {
  CACHE = {};
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  try {
    if (req.action === 'login') return out_(login_(req));
    var sess = verify_(req.token);
    var fn = ACTIONS[req.action];
    if (!fn) return out_({ ok: false, error: 'Unknown action' });
    var lock = null;
    if (fn.writes) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) return out_({ ok: false, error: 'Server busy — please try again.' });
    }
    try { return out_(fn.run(sess, req)); }
    finally { if (lock) lock.releaseLock(); }
  } catch (err) {
    var msg = String(err && err.message || err);
    return out_({ ok: false, error: msg.replace(/^AUTH: /, ''), auth: msg.indexOf('AUTH: ') === 0 });
  }
}

var ACTIONS = {
  me:             { run: function (s) { return { ok: true, user: s.user }; } },
  load:           { run: load_ },
  saveAttendance: { run: saveAttendance_, writes: true },
  uploadPhoto:    { run: uploadPhoto_, writes: true },
  removePhoto:    { run: removePhoto_, writes: true },
  submitReport:   { run: submitReport_, writes: true },
  reopenReport:   { run: reopenReport_, writes: true },
  addMember:      { run: addMember_, writes: true },
  archiveMember:  { run: archiveMember_, writes: true },
  restoreMember:  { run: restoreMember_, writes: true },
  exportCsv:      { run: exportCsv_ },
};

// ════════════════════════════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════════════════════════════

function login_(req) {
  var pin = String(req.pin || '');
  var cache = CacheService.getScriptCache();
  var devKey = 'fail:' + String(req.device || 'unknown').slice(0, 40);
  var devFails = Number(cache.get(devKey) || 0), allFails = Number(cache.get('fail:all') || 0);
  if (devFails >= 5 || allFails >= 30) return { ok: false, error: 'Too many wrong PINs. Wait 15 minutes, then try again.' };
  // The setup key comes from the admin's setup link, so a PIN alone is not enough to sign in.
  var setupKey = PropertiesService.getScriptProperties().getProperty('SETUP_KEY');
  if (!setupKey || req.setupKey !== setupKey) {
    cache.put('fail:all', String(allFails + 1), 3600);
    return { ok: false, error: 'This phone is not set up yet. Open the setup link from your admin.', notSetUp: true };
  }

  var team = null;
  if (/^\d{4}$/.test(pin)) {
    team = readAll_('Teams').filter(function (t) { return t.pin === pin && t.active !== 'No'; })[0] || null;
  }
  if (!team) {
    cache.put(devKey, String(devFails + 1), 900);
    cache.put('fail:all', String(allFails + 1), 3600);
    return { ok: false, error: 'Wrong PIN. Please try again.', wrongPin: true };
  }
  var user = userFor_(team);
  var exp = Date.now() + SESSION_DAYS * 86400000;
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ t: team.teamId, exp: exp, pv: pinTag_(team.pin) }));
  audit_(user, team.teamId === 'admin' ? '' : team.teamId, '', 'login', 'Signed in on ' + String(req.device || 'unknown device'));
  return { ok: true, token: body + '.' + sign_(body), user: user, expiresAt: exp };
}

function userFor_(team) {
  if (team.teamId === 'admin') return { role: 'admin', teamId: '', name: team.name || 'Operations Admin', team: 'All teams · NLEX' };
  return { role: 'leadman', teamId: team.teamId, name: team.leadman, team: team.name, short: team.short };
}

function verify_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) throw new Error('AUTH: Please sign in again.');
  var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if (!p.exp || p.exp < Date.now()) throw new Error('AUTH: Session expired. Please sign in again.');
  var team = row_('Teams', p.t);
  // Changing a PIN in the Teams tab (or setting Active = No) signs that person out everywhere.
  if (!team || team.active === 'No' || pinTag_(team.pin) !== p.pv) throw new Error('AUTH: Please sign in again.');
  return { user: userFor_(team), team: team };
}

function sign_(s) {
  var secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) throw new Error('Backend not set up — run setup() in the Apps Script editor.');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret)).replace(/=+$/, '');
}

function pinTag_(pin) { return sign_('pin:' + pin).slice(0, 10); }

function isAdmin_(s) { return s.user.role === 'admin'; }

function needTeam_(s, teamId) {
  if (!row_('Teams', teamId) || teamId === 'admin') throw new Error('Unknown team');
  if (!isAdmin_(s) && s.user.teamId !== teamId) throw new Error('You can only access your own team.');
}

function needAdmin_(s) { if (!isAdmin_(s)) throw new Error('Admin only.'); }

/** Leadmen may write today and yesterday (Manila time) — older reports are locked. Admin may write any day. */
function needWritableDate_(s, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Missing or bad date');
  if (isAdmin_(s)) return;
  if (date > today_()) throw new Error('Cannot report a future date.');
  if (date < yesterday_()) throw new Error('This report is locked. Ask the admin to reopen it.');
}

// ════════════════════════════════════════════════════════════════════════════
// Read
// ════════════════════════════════════════════════════════════════════════════

/** Everything a screen needs. Admin gets all teams; a leadman only gets their own team. */
function load_(s, req) {
  var days = Math.min(Number(req.days) || 30, 120);
  var since = shiftDate_(today_(), -days);
  var date = /^\d{4}-\d{2}-\d{2}$/.test(req.date || '') ? req.date : today_();
  var mine = function (r) { return isAdmin_(s) || r.teamId === s.user.teamId; };
  var teams = readAll_('Teams').filter(function (t) { return t.teamId !== 'admin' && t.active !== 'No' && mine(t); })
    .map(function (t) { return { teamId: t.teamId, name: t.name, short: t.short, leadman: t.leadman, defaultUnit: t.defaultUnit || 'KM' }; });
  var photos = readAll_('Photos').filter(function (p) { return p.status === 'Active' && p.reportDate >= since && mine(p); });
  var reports = readAll_('Reports').filter(function (r) { return r.reportDate >= since && mine(r); }).map(function (r) {
    delete r.beforePreview; delete r.afterPreview;
    r.lockedForLeadman = r.reportDate < yesterday_();
    return r;
  });
  return {
    ok: true, user: s.user, today: today_(), date: date,
    teams: teams,
    roster: readAll_('Roster').filter(mine),
    attendance: readAll_('Attendance').filter(function (a) { return a.reportDate >= since && mine(a); }),
    reports: reports,
    photos: photos,
    sheetUrl: isAdmin_(s) ? SpreadsheetApp.getActiveSpreadsheet().getUrl() : '',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Attendance
// ════════════════════════════════════════════════════════════════════════════

function saveAttendance_(s, req) {
  needTeam_(s, req.teamId);
  needWritableDate_(s, req.reportDate);
  var rep = row_('Reports', req.teamId + '|' + req.reportDate);
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first to change attendance.');

  var active = readAll_('Roster').filter(function (m) { return m.teamId === req.teamId && m.status === 'Active'; });
  var sent = {};
  (req.people || []).forEach(function (p) { sent[p.personId] = p; });
  var missing = [], rows = [];
  active.forEach(function (m) {
    var p = sent[m.personId] || { status: 'Present' };
    var absent = p.status === 'Absent';
    if (absent && REASONS.indexOf(p.absenceReason) < 0) missing.push(m.name);
    rows.push({ m: m, absent: absent, reason: absent ? p.absenceReason : '' });
  });
  if (missing.length) throw new Error('Choose a reason for every absent crew member: ' + missing.join(', '));

  var now = now_(), by = s.user.name, changes = [];
  var before = {};
  readAll_('Attendance').forEach(function (a) { if (a.teamId === req.teamId && a.reportDate === req.reportDate) before[a.personId] = a; });
  rows.forEach(function (r) {
    var key = req.teamId + '|' + req.reportDate + '|' + r.m.personId, old = before[r.m.personId];
    var status = r.absent ? 'Absent' : 'Present';
    if (old && (old.status !== status || old.absenceReason !== r.reason)) changes.push(r.m.name + ': ' + old.status + (old.absenceReason ? ' (' + old.absenceReason + ')' : '') + ' → ' + status + (r.reason ? ' (' + r.reason + ')' : ''));
    upsert_('Attendance', key, {
      key: key, reportDate: req.reportDate, teamId: req.teamId, personId: r.m.personId, name: r.m.name, role: r.m.role,
      status: status, absenceReason: r.reason, submittedAt: now, submittedBy: by, updatedAt: now,
    }, { createdAt: now });
    delete before[r.m.personId];
  });
  // People no longer on the active roster are dropped from this day's sheet.
  Object.keys(before).forEach(function (pid) { deleteRow_('Attendance', before[pid].key); });

  var present = rows.filter(function (r) { return !r.absent; }).length;
  var absentList = rows.filter(function (r) { return r.absent; }).map(function (r) { return r.m.name + ' (' + r.reason + ')'; }).join('; ');
  var team = row_('Teams', req.teamId);
  upsert_('Reports', req.teamId + '|' + req.reportDate, {
    reportDate: req.reportDate, teamId: req.teamId, team: team.name, leadman: team.leadman,
    crewPresent: present + '/' + rows.length, absentList: absentList, attendanceSubmittedAt: now, updatedAt: now, editedBy: by,
  }, { state: 'draft', createdAt: now, version: '0', unit: team.defaultUnit || 'KM' });
  audit_(s.user, req.teamId, req.reportDate, rep && rep.attendanceSubmittedAt ? 'attendance updated' : 'attendance submitted',
    present + '/' + rows.length + ' present' + (changes.length ? '. ' + changes.join('; ') : '') + (absentList ? '. Absent: ' + absentList : ''));
  return { ok: true, attendanceSubmittedAt: now, crewPresent: present + '/' + rows.length };
}

// ════════════════════════════════════════════════════════════════════════════
// Photos
// ════════════════════════════════════════════════════════════════════════════

function uploadPhoto_(s, req) {
  needTeam_(s, req.teamId);
  needWritableDate_(s, req.reportDate);
  if (req.type !== 'before' && req.type !== 'after') throw new Error('Photo type must be before or after');
  var rep = row_('Reports', req.teamId + '|' + req.reportDate);
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first.');
  var m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/i.exec(req.dataUrl || '');
  if (!m) throw new Error('That file is not a photo (JPEG, PNG or WebP only).');
  var bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > MAX_PHOTO_BYTES) throw new Error('Photo is too large.');

  var team = row_('Teams', req.teamId), now = now_();
  var folder = subFolder_(subFolder_(photoRoot_(), req.reportDate), team.short || team.teamId);
  var ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  var name = req.reportDate + '_' + (team.short || team.teamId).replace(/[^A-Za-z0-9]+/g, '') + '_' + req.type.toUpperCase() + '_' + now.slice(11).replace(/:/g, '') + '.' + ext;
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], name));
  file.setDescription('Original filename: ' + String(req.originalFilename || '') + ' · uploaded by ' + s.user.name);
  // Link sharing lets the app and the Sheet show a preview. Workspace domains may block it;
  // the photo is still stored and admins can open it from Drive.
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  var replaced = markPhotos_(req.teamId, req.reportDate, req.type, 'Replaced');
  var photoId = 'ph-' + Utilities.getUuid().slice(0, 8);
  var photo = {
    photoId: photoId, teamId: req.teamId, reportDate: req.reportDate, type: req.type, status: 'Active',
    fileId: file.getId(), fileUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800',
    originalFilename: String(req.originalFilename || '').slice(0, 200), uploadedAt: now, uploadedBy: s.user.name,
  };
  upsert_('Photos', photoId, photo);
  audit_(s.user, req.teamId, req.reportDate, req.type + ' photo ' + (replaced ? 'replaced' : 'uploaded'), photo.originalFilename);
  return { ok: true, photo: photo };
}

function removePhoto_(s, req) {
  needTeam_(s, req.teamId);
  needWritableDate_(s, req.reportDate);
  var rep = row_('Reports', req.teamId + '|' + req.reportDate);
  if (rep && rep.state === 'submitted' && !isAdmin_(s)) throw new Error('Report already submitted. Tap Edit report first.');
  var n = markPhotos_(req.teamId, req.reportDate, req.type, 'Removed');
  if (n) audit_(s.user, req.teamId, req.reportDate, req.type + ' photo removed', '');
  return { ok: true };
}

/** Mark the active photo(s) of this type as Replaced/Removed. Files stay in Drive for the audit trail. */
function markPhotos_(teamId, date, type, status) {
  var n = 0;
  readAll_('Photos').forEach(function (p) {
    if (p.teamId === teamId && p.reportDate === date && p.type === type && p.status === 'Active') {
      upsert_('Photos', p.photoId, { status: status }); n++;
    }
  });
  return n;
}

function activePhoto_(teamId, date, type) {
  return readAll_('Photos').filter(function (p) { return p.teamId === teamId && p.reportDate === date && p.type === type && p.status === 'Active'; })[0] || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Activity report
// ════════════════════════════════════════════════════════════════════════════

var REPORT_FIELDS = ['fromTime', 'toTime', 'location', 'activityDetails', 'status', 'target', 'actual', 'unit', 'targetManpower', 'actualManpower', 'plateNumber', 'remarks'];

function submitReport_(s, req) {
  needTeam_(s, req.teamId);
  needWritableDate_(s, req.reportDate);
  var key = req.teamId + '|' + req.reportDate, old = row_('Reports', key), f = req.report || {};
  if (old && old.state === 'submitted') throw new Error('Report is already submitted.');

  var clean = {};
  REPORT_FIELDS.forEach(function (k) { clean[k] = String(f[k] == null ? '' : f[k]).trim().slice(0, 2000); });
  clean.status = clean.status === 'Complete' ? 'Complete' : 'Ongoing';
  clean.unit = clean.unit === 'Locations' ? 'Locations' : 'KM';
  clean.plateNumber = clean.plateNumber.toUpperCase();

  // Same rules as the app, enforced again here so a report can never be accepted half-filled.
  var before = activePhoto_(req.teamId, req.reportDate, 'before'), after = activePhoto_(req.teamId, req.reportDate, 'after');
  var errs = [];
  if (!old || !old.attendanceSubmittedAt) errs.push('Submit attendance first (Attendance tab)');
  if (!clean.location) errs.push('Enter the location');
  if (!clean.activityDetails) errs.push('Describe the work done');
  if (!(Number(clean.actualManpower) > 0)) errs.push('Enter actual manpower');
  if (!clean.plateNumber) errs.push('Enter equipment / plate number');
  if (!before) errs.push('Add a Before Work photo');
  if (clean.status === 'Complete' && !after) errs.push('Add an After Work photo (required when Complete)');
  if (errs.length) return { ok: false, error: 'Cannot submit yet: ' + errs.join('; '), missing: errs };

  var now = now_(), team = row_('Teams', req.teamId);
  var changes = [];
  if (old && Number(old.version) > 0) {
    REPORT_FIELDS.forEach(function (k) { if (String(old[k]) !== clean[k]) changes.push(k + ': "' + short_(old[k]) + '" → "' + short_(clean[k]) + '"'); });
    if (old.beforePhotoId !== before.photoId) changes.push('before photo replaced');
    if (after && old.afterPhotoId !== after.photoId) changes.push('after photo replaced');
  }
  var row = {
    reportDate: req.reportDate, teamId: req.teamId, team: team.name, leadman: team.leadman, state: 'submitted',
    beforePhotoId: before.photoId, afterPhotoId: after ? after.photoId : '',
    beforePreview: '=IMAGE("' + before.thumbnailUrl + '")', afterPreview: after ? '=IMAGE("' + after.thumbnailUrl + '")' : '',
    submittedAt: now, submittedBy: s.user.name, updatedAt: now, editedBy: s.user.name,
    version: String((Number(old && old.version) || 0) + 1),
  };
  REPORT_FIELDS.forEach(function (k) { row[k] = clean[k]; });
  upsert_('Reports', key, row, { createdAt: now });
  audit_(s.user, req.teamId, req.reportDate, row.version === '1' ? 'report submitted' : 'report resubmitted (v' + row.version + ')',
    changes.length ? changes.join('; ') : (row.version === '1' ? clean.status + ' · ' + short_(clean.location) : 'no field changes'));
  return { ok: true, submittedAt: now, submittedBy: s.user.name, version: row.version };
}

function reopenReport_(s, req) {
  needTeam_(s, req.teamId);
  needWritableDate_(s, req.reportDate);
  var key = req.teamId + '|' + req.reportDate, old = row_('Reports', key);
  if (!old || old.state !== 'submitted') return { ok: true };
  upsert_('Reports', key, { state: 'draft', updatedAt: now_(), editedBy: s.user.name });
  audit_(s.user, req.teamId, req.reportDate, 'report reopened for editing', 'was submitted ' + old.submittedAt + ' by ' + old.submittedBy);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Roster (admin)
// ════════════════════════════════════════════════════════════════════════════

function addMember_(s, req) {
  needAdmin_(s); needTeam_(s, req.teamId);
  var name = String(req.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('Type a name first');
  var clash = readAll_('Roster').filter(function (m) { return m.teamId === req.teamId && m.status === 'Active' && m.name.toLowerCase() === name.toLowerCase(); });
  if (clash.length) throw new Error('Already on this crew');
  var now = now_(), id = newPersonId_(req.teamId, name);
  var role = req.role === 'Skilled' ? 'Skilled' : 'Crew';
  upsert_('Roster', id, { personId: id, teamId: req.teamId, name: name, role: role, status: 'Active', createdAt: now, updatedAt: now, editedBy: s.user.name });
  audit_(s.user, req.teamId, '', 'crew added', name + ' (' + role + ')');
  return { ok: true, personId: id };
}

function archiveMember_(s, req) {
  needAdmin_(s);
  var m = row_('Roster', req.personId);
  if (!m) throw new Error('Person not found');
  if (m.role === 'Leadman') throw new Error('The leadman cannot be removed here — change the leadman in the Teams tab.');
  var now = now_();
  upsert_('Roster', m.personId, { status: 'Archived', archivedAt: now, updatedAt: now, editedBy: s.user.name });
  audit_(s.user, m.teamId, '', 'crew archived', m.name + ' (attendance history kept)');
  return { ok: true };
}

function restoreMember_(s, req) {
  needAdmin_(s);
  var m = row_('Roster', req.personId);
  if (!m) throw new Error('Person not found');
  upsert_('Roster', m.personId, { status: 'Active', archivedAt: '', updatedAt: now_(), editedBy: s.user.name });
  audit_(s.user, m.teamId, '', 'crew restored', m.name);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Export (admin)
// ════════════════════════════════════════════════════════════════════════════

function exportCsv_(s, req) {
  needAdmin_(s);
  var from = /^\d{4}-\d{2}-\d{2}$/.test(req.from || '') ? req.from : shiftDate_(today_(), -30);
  var to = /^\d{4}-\d{2}-\d{2}$/.test(req.to || '') ? req.to : today_();
  var photos = {};
  readAll_('Photos').forEach(function (p) { photos[p.photoId] = p; });
  var head = ['Date', 'Team', 'Leadman', 'State', 'From', 'To', 'Location', 'Activity Details', 'Status', 'Target', 'Actual', 'Unit',
    'Target Manpower', 'Actual Manpower', 'Crew Present', 'Absent (reason)', 'Equipment / Plate', 'Remarks',
    'Before Photo', 'After Photo', 'Attendance Submitted', 'Report Submitted', 'Submitted By', 'Version'];
  var rows = readAll_('Reports').filter(function (r) { return r.reportDate >= from && r.reportDate <= to; })
    .sort(function (a, b) { return a.reportDate === b.reportDate ? a.teamId.localeCompare(b.teamId) : a.reportDate.localeCompare(b.reportDate); })
    .map(function (r) {
      var bp = photos[r.beforePhotoId], ap = photos[r.afterPhotoId];
      return [r.reportDate, r.team, r.leadman, r.state === 'submitted' ? 'Submitted' : (r.attendanceSubmittedAt ? 'Draft (attendance only)' : 'Draft'),
        r.fromTime, r.toTime, r.location, r.activityDetails, r.status, r.target, r.actual, r.unit,
        r.targetManpower, r.actualManpower, r.crewPresent, r.absentList, r.plateNumber, r.remarks,
        bp ? bp.fileUrl : '', ap ? ap.fileUrl : '', r.attendanceSubmittedAt, r.submittedAt, r.submittedBy, r.version];
    });
  var esc = function (v) {
    var x = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(x)) x = "'" + x;          // stops Excel from running cell text as a formula
    return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
  };
  var csv = [head].concat(rows).map(function (r) { return r.map(esc).join(','); }).join('\r\n');
  audit_(s.user, '', '', 'export', from + ' to ' + to + ' · ' + rows.length + ' rows');
  var id = SpreadsheetApp.getActiveSpreadsheet().getId();
  return { ok: true, csv: csv, rows: rows.length, filename: 'NLEX_Daily_Report_' + from + '_to_' + to + '.csv',
    xlsxUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx' };
}

// ════════════════════════════════════════════════════════════════════════════
// Sheet helpers
// ════════════════════════════════════════════════════════════════════════════

var CACHE = {};

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function yesterday_() { return shiftDate_(today_(), -1); }
function shiftDate_(iso, days) {
  var p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function short_(v) { v = String(v == null ? '' : v); return v.length > 60 ? v.slice(0, 57) + '…' : v; }

function col_(name, field) {
  var cols = TABLES[name];
  for (var i = 0; i < cols.length; i++) if (cols[i][0] === field) return i + 1;
  throw new Error('No column ' + field);
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" is missing — run setup() in the Apps Script editor.');
  return sh;
}

/** Text format everywhere (so dates/times/plate numbers stay exactly as typed), except photo preview formulas. */
function formatRows_(sh, name, fromRow, count) {
  if (count < 1) return;
  var fmts = TABLES[name].map(function (c) { return FORMULA_FIELDS[c[0]] ? 'General' : '@'; });
  var grid = [];
  for (var i = 0; i < count; i++) grid.push(fmts);
  sh.getRange(fromRow, 1, count, fmts.length).setNumberFormats(grid);
}

function readAll_(name) {
  if (CACHE[name]) return CACHE[name].rows.map(function (r) { return Object.assign({}, r); });
  var sh = sheet_(name), n = sh.getLastRow() - 1, cols = TABLES[name];
  var rows = n < 1 ? [] : sh.getRange(2, 1, n, cols.length).getDisplayValues().map(function (v) {
    var o = {};
    cols.forEach(function (c, i) { o[c[0]] = v[i] == null ? '' : String(v[i]); });
    return o;
  });
  var index = {}, kf = KEY_FIELD[name];
  if (kf) rows.forEach(function (r, i) { index[r[kf]] = i; });
  CACHE[name] = { rows: rows, index: index };
  return rows.map(function (r) { return Object.assign({}, r); });
}

function row_(name, key) {
  readAll_(name);
  var i = CACHE[name].index[key];
  return i == null ? null : Object.assign({}, CACHE[name].rows[i]);
}

/**
 * Insert or update one row by key. Only fields present in `data` change;
 * `defaults` are used for new rows only. Whole row is written in one call.
 */
function upsert_(name, key, data, defaults) {
  var sh = sheet_(name), cols = TABLES[name], kf = KEY_FIELD[name];
  readAll_(name);
  var i = CACHE[name].index[key], isNew = i == null;
  var rowNum = isNew ? CACHE[name].rows.length + 2 : i + 2;
  var current;
  if (isNew) {
    current = {};
    if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatRows_(sh, name, rowNum, 1);
  } else {
    current = CACHE[name].rows[i];
    var formulas = sh.getRange(rowNum, 1, 1, cols.length).getFormulas()[0];
    cols.forEach(function (c, j) { if (FORMULA_FIELDS[c[0]]) current[c[0]] = formulas[j] || ''; });
  }
  var merged = {};
  cols.forEach(function (c) {
    var k = c[0];
    if (k === kf) merged[k] = key;
    else if (data && Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined) merged[k] = data[k];
    else if (isNew && defaults && Object.prototype.hasOwnProperty.call(defaults, k)) merged[k] = defaults[k];
    else merged[k] = current[k] == null ? '' : current[k];
  });
  var values = cols.map(function (c) {
    var v = merged[c[0]] == null ? '' : String(merged[c[0]]);
    if (FORMULA_FIELDS[c[0]]) return v;
    return /^[=+@]/.test(v) ? "'" + v : v;          // typed text is never run as a formula
  });
  sh.getRange(rowNum, 1, 1, cols.length).setValues([values]);
  if (name === 'Reports') sh.setRowHeight(rowNum, 72);
  var stored = {};
  cols.forEach(function (c) { stored[c[0]] = FORMULA_FIELDS[c[0]] ? '' : String(merged[c[0]] == null ? '' : merged[c[0]]); });
  if (isNew) { CACHE[name].index[key] = CACHE[name].rows.length; CACHE[name].rows.push(stored); }
  else CACHE[name].rows[i] = stored;
  return rowNum;
}

function deleteRow_(name, key) {
  readAll_(name);
  var i = CACHE[name].index[key];
  if (i == null) return;
  sheet_(name).deleteRow(i + 2);
  delete CACHE[name];
}

function audit_(user, teamId, date, action, changes) {
  try {
    var sh = sheet_('Audit');
    var row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    formatRows_(sh, 'Audit', row, 1);
    sh.getRange(row, 1, 1, 7).setValues([[now_(), user.name, user.role, teamId || '', date || '', action, String(changes || '').slice(0, 1000)]
      .map(function (v) { v = String(v); return /^[=+@]/.test(v) ? "'" + v : v; })]);
  } catch (e) {}
}

function newPersonId_(teamId, name) {
  var base = teamId + '-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  var id = base, n = 2;
  while (row_('Roster', id)) id = base + '-' + (n++);
  return id;
}

function photoRoot_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(PHOTO_ROOT);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_ROOT);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function subFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
